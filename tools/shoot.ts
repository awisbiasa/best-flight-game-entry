// Screenshots of the game, taken by driving the game's own page in a real Chrome over the DevTools
// protocol and reading back the canvas: no image editor touches them, and nothing is composited.
//
// The page is served by a tiny static server on 127.0.0.1 (the game itself loads only its own files),
// Chrome runs headless at exactly the screenshot size, and each scene is the game's own ?shot= stage:
// the real rules, stepped forward, painted, and read back with Canvas.toDataURL.
//
//   node tools/shoot.ts               every scene in shots.json
//   node tools/shoot.ts cover gates   just those
//
// Uses Node's standard library only: a WebSocket client over net for the DevTools connection.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const here = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(join(here, 'game'));
const outDir = resolve(join(here, 'screenshots'));
const WIDTH = 1280;
const HEIGHT = 480;
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
  '/root/.hermes/tools/chromium-1248/chrome-linux64/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean) as string[];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

type Shot = { name: string; query: string };

const shots: Shot[] = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
const wanted = process.argv.slice(2);
const selected = wanted.length ? shots.filter((s: Shot) => wanted.some((w: string) => s.name.includes(w))) : shots;

function serve(): Promise<{ port: number; close: () => void }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = resolve(join(root, normalize(pathname)));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      done({ port, close: () => server.close() });
    });
  });
}

/** A minimal RFC 6455 client: enough for CDP's text frames, for the length this uses. */
class DevToolsSocket {
  private socket: ReturnType<typeof createConnection>;
  private buffer = Buffer.alloc(0);
  public nextId = 1;
  /** CDP answers, unrolled by the caller's own typing: the payload is a plain object at the top. */
  public pending = new Map<number, (value: unknown) => void>();

  private handlers = new Map<string, (params: unknown) => void>();

  constructor(socket: ReturnType<typeof createConnection>) {
    this.socket = socket;
  }

  on(method: string, handler: (params: unknown) => void): void {
    this.handlers.set(method, handler);
  }

  private emit(method: string, params: unknown): void {
    const handler = this.handlers.get(method);
    if (handler) handler(params);
  }

  /** Connect, send the upgrade request, and keep reading: a browser may answer before the socket's
   * 'connect' event is delivered, so the request goes out at once and the answer is read as frames. */
  static open(url: string): Promise<DevToolsSocket> {
    const u = new URL(url);
    const host = u.hostname;
    const port = Number(u.port);
    const socket = createConnection({ host, port });
    socket.setNoDelay(true);
    socket.on('error', () => socket.destroy());
    const key = createHash('sha1').update(`${host}:${port}`).digest('base64');
    socket.write(
      [
        `GET ${u.pathname}${u.search} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'),
    );
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`websocket handshake timed out with ${host}:${port}`)), 15000);
      let received = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        const end = received.indexOf('\r\n\r\n');
        if (end === -1) return;
        clearTimeout(timer);
        socket.off('data', onData);
        const head = received.toString('latin1', 0, end);
        if (!head.startsWith('HTTP/1.1 101')) {
          fail(new Error(`websocket refused: ${head.split('\r\n')[0]}`));
          return;
        }
        const ws = new DevToolsSocket(socket);
        socket.on('data', (data: Buffer) => ws.onData(data));
        ws.onData(received.subarray(end + 4));
        done(ws);
      };
      socket.on('data', onData);
    });
  }

  /** Send one CDP message; a session view overrides this to add its session id to every message. */
  send(message: Record<string, unknown>): void {
    this.sendFrame(1, Buffer.from(JSON.stringify(message), 'utf8'));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const opcode = this.buffer[0] & 0x0f;
      const lenByte = this.buffer[1];
      let length = lenByte & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 1) {
        const message = JSON.parse(payload.toString('utf8'));
        if (message.method && typeof message.id !== 'number') this.emit(message.method, message.params);
        if (typeof message.id === 'number') {
          if (message.error) console.error('devtools refused id', message.id, JSON.stringify(message.error).slice(0, 200));
              const done = this.pending.get(message.id);
          if (done) {
            this.pending.delete(message.id);
            done(message);
          }
        }
      } else if (opcode === 9) {
        this.sendFrame(10, payload);
      } else if (opcode === 8) {
        this.socket.end();
      }
    }
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    // RFC 6455: every frame a client sends is masked, and the mask bit carries a four-byte key.
    const mask = Buffer.from([0x5a, 0x3c, 0x9f, 0x17]);
    header[1] |= 0x80;
    const masked = Buffer.alloc(length);
    for (let i = 0; i < length; i += 1) masked[i] = payload[i] ^ mask[i & 3];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  call<TResult = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<TResult> {
    const id = this.nextId++;
    return new Promise<TResult>((done) => {
      this.pending.set(id, done as (value: unknown) => void);
      this.send({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    });
  }

  /** A view of this socket that stamps every call with a flattened session id. */
  session(sessionId: string): DevToolsSocket {
    const parent = this;
    const view = Object.create(this) as DevToolsSocket;
    const stamp = (message: Record<string, unknown>): Record<string, unknown> => ({ ...message, sessionId });
    view.send = (message: Record<string, unknown>) => parent.send(stamp(message));
    view.call = <TResult = unknown>(method: string, params: Record<string, unknown> = {}) => {
      const id = parent.nextId++;
      return new Promise<TResult>((done) => {
        parent.pending.set(id, done as (value: unknown) => void);
        parent.send(stamp({ id, method, params }));
      });
    };
    return view;
  }

  close(): void {
    try {
      this.sendFrame(8, Buffer.alloc(0));
      this.socket.end();
    } catch {
      this.socket.destroy();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:9224${path}`);
  return res.json();
}

async function main(): Promise<void> {
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('no Chrome binary found');
  mkdirSync(outDir, { recursive: true });
  const server = await serve();
  const profile = `/tmp/coldfront-shoot-${process.pid}`;
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=9224',
      '--no-sandbox',
      '--no-zygote',
      '--single-process',
      '--no-first-run',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    let version: { webSocketDebuggerUrl?: string } | null = null;
    for (let i = 0; i < 80 && !version; i += 1) {
      try {
        version = (await fetchJson('/json/version')) as { webSocketDebuggerUrl?: string };
      } catch {
        await sleep(250);
      }
    }
    if (!version) throw new Error('Chrome did not open its debugging port');
    const page = await DevToolsSocket.open(version.webSocketDebuggerUrl!);
    for (const shot of selected) {
      // A fresh page per scene, navigated before anything is evaluated on it: no reply can then come
      // from a document that has already been replaced.
      const freshTarget = (await page.call<{ result: { targetId: string } }>('Target.createTarget', { url: `http://127.0.0.1:${server.port}/index.html${shot.query}` })).result;
      // A flat session on the browser socket, attached to the scene's page by target id: the same
      // route Chrome's own DevTools takes, and it needs no address lookup that could lag.
      const attached = await page.call<{ result?: { sessionId?: string } }>('Target.attachToTarget', { targetId: freshTarget.targetId, flatten: true });
      const tabId = String(attached?.result?.sessionId || '');
      const tab = page.session(tabId);
      // The page is resized to the screenshot's own size before it paints, so the frame is 1280 by 480.
      await tab.call('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
      tab.on('Runtime.consoleAPICalled', (ev: unknown) => {
        const e = ev as { type: string; args: { value?: unknown; description?: string }[] };
        console.log(`  page ${e.type}: ${e.args.map((a) => String(a.value ?? a.description ?? '')).join(' ')}`);
      });
      tab.on('Runtime.exceptionThrown', (ev: unknown) => {
        const e = ev as { exceptionDetails: { text: string; exception?: { description?: string } } };
        console.log(`  page exception: ${e.exceptionDetails.exception?.description || e.exceptionDetails.text}`);
      });
      await tab.call('Runtime.enable');
      let probeValue = 'false';
      for (let i = 0; i < 60 && probeValue !== 'true'; i += 1) {
        await sleep(200);
        const probe = await tab.call<{ result?: { result?: { value?: string } } }>('Runtime.evaluate', {
          expression: "Promise.resolve(String(document.documentElement.dataset.scene === 'ready'))",
          returnByValue: true,
          awaitPromise: true,
        });
        probeValue = String(probe?.result?.result?.value ?? 'false');
      }
      if (!probeValue.startsWith('true')) throw new Error(`scene ${shot.name} did not paint (${probeValue})`);
      // The scene repaints itself after the resize; wait until the canvas it reports is the shot's own.
      const wantSize = `${WIDTH}x${HEIGHT}`;
      for (let i = 0; i < 40; i += 1) {
        const painted = await tab.call<{ result?: { result?: { value?: string } } }>('Runtime.evaluate', {
          expression: "String(document.documentElement.dataset.painted || '')",
          returnByValue: true,
        });
        if (String(painted?.result?.result?.value ?? '') === wantSize) break;
        await sleep(100);
      }
      const data = await tab.call<{ id: number; result: { result?: { value?: string } } }>('Runtime.evaluate', {
        expression: "document.getElementById('game').toDataURL('image/jpeg', 0.9)",
        returnByValue: true,
        awaitPromise: false,
      });
      const value = typeof data?.result?.result?.value === 'string' ? data.result.result.value : '';
      const base64 = value.replace(/^data:image\/jpeg;base64,/, '');
      if (!base64) throw new Error(`scene ${shot.name} gave no canvas data: ${JSON.stringify(data || null).slice(0, 200)}`);
      writeFileSync(join(outDir, shot.name), Buffer.from(base64, 'base64'));
      console.log(`${shot.name}: ${Buffer.from(base64, 'base64').length} bytes`);
      await page.call('Target.detachFromTarget', { sessionId: tabId }).catch(() => undefined);
      await page.call('Target.closeTarget', { targetId: freshTarget.targetId }).catch(() => undefined);
    }
  } finally {
    chrome.kill('SIGKILL');
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
