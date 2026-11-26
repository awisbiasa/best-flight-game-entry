// Cold Front — a canyon air-race flight game. This file is the entrypoint the grader runs on
// Node 22 (standard library only): the game itself is this directory's game/ folder, plain static
// files a desktop browser loads offline (game/index.html and its ES modules, no library and no
// network request). The program copies game/ and screenshots/ beside this file to /output and
// writes /output/dossier.json, the summary the house judge reads, with the vendored make.fun
// library in vendor/makefun-game.ts.
//
// It writes the same bytes on every run: no clock, no randomness, no network, no environment
// value reaches a file it writes. Everything the game draws is seeded from game/src/noise.js and
// the mission definitions, so a second run produces byte-identical output.
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080. Outside the
// grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The screenshots in screenshots/ are renders of this game's own page, taken by tools/shoot.ts
// driving a real Chrome over the DevTools protocol and reading the canvas back.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** Where this entry lives on disk: everything below is resolved from here. */
const entryRoot = fileURLToPath(new URL('.', import.meta.url));

/** The grader writes to /output; a local run names another directory with MAKEFUN_OUTPUT_DIR. */
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const CAPS = {
  text_max_bytes: 163_840,
  screenshots: { max: 4, max_bytes: 262_144 },
  game_max_files: 993,
  game_max_bytes: 50_331_648,
  game_path_max_bytes: 1_000,
};

/**
 * Refuse, before anything is written, a layout the scorer would refuse: too many screenshots,
 * one over its size cap, or more game files than the gate counts. Catching it here names the
 * file, where the gate would only say the entry is refused.
 */
function assertLayout(gameDir: string, shotsDir: string): void {
  if (existsSync(shotsDir)) {
    const shots = readdirSync(shotsDir).filter((name) => /\.(png|jpe?g)$/i.test(name));
    if (shots.length > CAPS.screenshots.max) {
      throw new Error(`screenshots/: ${shots.length} images, the gate takes at most ${CAPS.screenshots.max}`);
    }
    for (const name of shots) {
      const size = statSync(join(shotsDir, name)).size;
      if (size > CAPS.screenshots.max_bytes) {
        throw new Error(`screenshots/${name}: ${size} bytes, the gate takes at most ${CAPS.screenshots.max_bytes}`);
      }
    }
  }
  let files = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const pathBytes = Buffer.byteLength(relative(gameDir, full));
      if (pathBytes > CAPS.game_path_max_bytes) {
        throw new Error(`game/${relative(gameDir, full)}: path is ${pathBytes} bytes, the gate takes at most ${CAPS.game_path_max_bytes}`);
      }
      files += 1;
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(gameDir);
  if (files > CAPS.game_max_files) {
    throw new Error(`game/: ${files} files and directories, the gate takes at most ${CAPS.game_max_files}`);
  }
}

/** Copy the game and the screenshots into the output directory, then write the dossier. */
function handIn(): void {
  const gameDir = join(entryRoot, 'game');
  const shotsDir = join(entryRoot, 'screenshots');
  if (!existsSync(gameDir)) throw new Error('game/: this entry ships no game directory');

  assertLayout(gameDir, shotsDir);

  mkdirSync(outputDir, { recursive: true });
  cpSync(gameDir, join(outputDir, 'game'), { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  if (existsSync(shotsDir)) {
    cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });
  }

  // The dossier is the judge's view of the entry: the screenshots as one contact sheet and an
  // outline of the game's own source. buildDossier is the scorer's own function, vendored.
  writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, CAPS));
}

handIn();
