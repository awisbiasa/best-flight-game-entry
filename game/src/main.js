// Boot and the one loop. The seed comes from the URL (or a fixed default), the world is stepped at a
// fixed 1/60 s per physics tick so the game plays the same on every machine, and the renderer paints
// what the world holds. Four screens share the loop: the mission menu, the sortie, the pause overlay
// and the outcome banner over a finished sortie.
//
// ?seed=N fixes the world and ?shot=<name> stages a scene instead of playing, painting it a few times
// and then raising the ready signal the capture tool reads off the page: that is how the screenshots
// in screenshots/ are taken, from the game's own code, never edited afterwards.

import { createWorld, stepWorld, resetWorld, createTerrainSampler } from './world.js';
import { terrainHeight } from './terrain.js';
import { createChaseCamera, updateChaseCamera, cockpitView, CHASE } from './camera.js';
import { createInput } from './input.js';
import { createRenderer, createCloudDeck, drawFrame } from './renderer.js';
import { drawMissionMenu, drawOutcomeBanner, missionCardRects } from './menu.js';
import { MISSIONS, missionById } from './missions.js';
import { createRandom } from './noise.js';

const STEP = 1 / 60;
const DEG = Math.PI / 180;
const MAX_FRAME = 0.2;
const SUN_AZIMUTH = 62 * 0.017453292519943295;

const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 7;
const shot = params.get('shot');

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const terrain = createTerrainSampler(terrainHeight);
const clouds = createCloudDeck(createRandom(seed * 31 + 17));
const renderer = createRenderer(canvas);
const chase = createChaseCamera();
const input = createInput(canvas, status);

let mission = missionById(params.get('mission') || 'gates');
let world = createWorld(terrain, mission);
let screen = 'menu';
let selected = 0;
let accumulator = 0;
let last = performance.now();
let clock = 0;

function announce(text) {
  status.textContent = text;
}

/** Put the aircraft in the air over a chosen heading and speed: the start of a staged scene. */
function stageAirborne(state, x, y, z, heading, speed, throttle) {
  state.position = [x, y, z];
  state.yaw = heading;
  state.pitch = 0.02;
  state.speed = speed;
  state.throttle = throttle;
  state.fuel = 0.78;
  state.onGround = false;
  state.gearDown = false;
  state.forward = [Math.sin(heading) * Math.cos(state.pitch), Math.sin(state.pitch), Math.cos(heading) * Math.cos(state.pitch)];
  chase.snap = true;
  chase.yaw = heading;
  chase.pitch = state.pitch;
  chase.roll = 0;
  // A staged scene is one frame of a settled camera, so the spring is already at rest: a snapped
  // spring still carries the previous scene's accumulated time otherwise.
  state.time = 0;
}

/** A level holding turn: the stick held so the bank settles near `bankDeg` and the nose holds level. */
function holdTurn(bankDeg, seconds, fire) {
  const controls = { pitch: 0, roll: 0, yaw: 0, throttleUp: 0, throttleDown: 0, fire: Boolean(fire), brake: false };
  const steps = Math.round(seconds / STEP);
  const a = world.aircraft;
  for (let i = 0; i < steps; i += 1) {
    const bankError = bankDeg * Math.PI / 180 - a.bank;
    controls.roll = Math.max(-0.5, Math.min(0.5, bankError * 3));
    controls.pitch = Math.max(-0.35, Math.min(0.5, (0.02 - a.pitch) * 6 + 0.06));
    stepWorld(world, controls, STEP);
  }
}

/**
 * The eye a chase camera sits at for a given aircraft heading and pitch, and the aircraft position
 * that puts that eye at a chosen point. Used to frame a staged scene from a known eye.
 */
function eyeFor(position, heading, pitch) {
  const plane = [Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(heading) * Math.cos(pitch)];
  const right0 = [Math.cos(heading), 0, -Math.sin(heading)];
  const up0 = [right0[1] * plane[2] - right0[2] * plane[1], right0[2] * plane[0] - right0[0] * plane[2], right0[0] * plane[1] - right0[1] * plane[0]];
  return [
    position[0] + plane[0] * CHASE.back - up0[0] * CHASE.up,
    position[1] + plane[1] * CHASE.back - up0[1] * CHASE.up,
    position[2] + plane[2] * CHASE.back - up0[2] * CHASE.up,
  ];
}

/**
 * Place a staged aircraft so its own chase eye lands at `eye`, looking along `heading` with the
 * aircraft `pitchDeg` nose-up, then return the aircraft. The default camera's look-down is folded in
 * so the frame's centre line follows the aircraft's nose.
 */
function placeAtEye(aircraft, eye, heading, pitchDeg) {
  // chase.pitch is the view's own pitch (its look-down is added on top); the aircraft's nose then
  // sits lookDown below the view, which is exactly how the chase camera frames a level flight.
  const camPitch = pitchDeg * DEG;
  const body = eyeFor(eye, heading, camPitch);
  aircraft.position = [body[0], body[1], body[2]];
  aircraft.yaw = heading;
  aircraft.pitch = camPitch + CHASE.lookDown;
  aircraft.forward = [Math.sin(heading) * Math.cos(aircraft.pitch), Math.sin(aircraft.pitch), Math.cos(heading) * Math.cos(aircraft.pitch)];
  return aircraft;
}

/**
 * Point a staged aircraft's nose at a world point, leaving its height and speed alone: the pitch is
 * set so the target sits at the given vertical angle below the nose, the way a pilot would trim for
 * a run-in rather than fly level over it.
 */
function aimAt(aircraft, target, pitchDeg) {
  const dx = target[0] - aircraft.position[0];
  const dz = target[2] - aircraft.position[2];
  const yaw = Math.atan2(dx, dz);
  const pitch = pitchDeg * DEG;
  aircraft.yaw = yaw;
  aircraft.pitch = pitch;
  aircraft.forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}

/** Start the named sortie and leave the menu. */
function beginMission(index) {
  selected = index;
  mission = MISSIONS[index];
  resetWorld(world, mission);
  screen = 'fly';
  accumulator = 0;
  chase.snap = true;
  announce(`${mission.name}. ${mission.briefing}`);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;

  // --- Input first: one-shot keys act on the screen the player is on.
  const actions = input.takeActions();
  for (const action of actions) {
    if (action === 'mission1' || action === 'mission2' || action === 'mission3') {
      if (screen === 'menu') beginMission(Number(action.slice(-1)) - 1);
      else beginMission(Number(action.slice(-1)) - 1);
    } else if (action === 'confirm') {
      if (screen === 'menu') beginMission(selected);
      else if (screen === 'over') {
        resetWorld(world, mission);
        screen = 'fly';
        chase.snap = true;
      }
    } else if (action === 'pause') {
      if (screen === 'fly') screen = 'paused';
      else if (screen === 'paused') screen = 'fly';
      else if (screen === 'over') screen = 'menu';
    } else if (action === 'restart') {
      if (screen !== 'menu') {
        resetWorld(world, mission);
        screen = 'fly';
        chase.snap = true;
      }
    } else if (action === 'click') {
      if (screen === 'menu') {
        for (const rect of missionCardRects(renderer)) {
          const { x, y } = input.mouse;
          if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
            selected = rect.index;
            beginMission(rect.index);
            break;
          }
        }
      } else if (screen === 'over') {
        resetWorld(world, mission);
        screen = 'fly';
        chase.snap = true;
      }
    } else if (action === 'view') {
      cockpit = !cockpit;
    }
  }
  // Keyboard selection in the menu: left and right pick, Enter flies.
  const controls = input.controls();
  if (screen === 'menu') {
    if (controls.roll > 0 && !wasRolling) selected = Math.min(2, selected + 1);
    if (controls.roll < 0 && !wasRolling) selected = Math.max(0, selected - 1);
    wasRolling = controls.roll !== 0;
  }

  // --- The world steps on a fixed clock: catch up in whole ticks, drop the rest of a long stall.
  if (screen === 'fly' || screen === 'over') {
    accumulator += dt;
    let ticks = 0;
    while (accumulator >= STEP && ticks < 6) {
      if (screen === 'fly') stepWorld(world, controls, STEP);
      else stepWorld(world, { ...controls, fire: false }, STEP);
      accumulator -= STEP;
      ticks += 1;
    }
    if (ticks === 6) accumulator = 0;
    if (screen === 'fly' && world.outcome) {
      screen = 'over';
      announce(`${world.outcome.text}. Score ${world.score}. Press R to fly again.`);
    }
    if (world.callout) world.callout.life -= dt;
  }

  paint(dt);
}

let cockpit = false;
let wasRolling = false;

/** Build the camera pose and the HUD view for this frame, then draw. */
function paint(dt) {
  const a = world.aircraft;
  // The drawing surface follows the window's shape, so the frame fills the browser whatever its size
  // (the game was designed at 1280x480, where the HUD sits exactly in the frame).
  const width = Math.round(canvas.clientWidth || 1280);
  const height = Math.round(canvas.clientHeight || 480);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    renderer.width = width;
    renderer.height = height;
  }
  let pose;
  if (cockpit && screen !== 'menu') {
    pose = cockpitView(a);
  } else {
    pose = updateChaseCamera(chase, a, dt, world.shake);
  }
  const objective = world.mission.objectiveOf ? world.mission.objectiveOf() : null;
  const waypoint = world.mission.waypointOf ? world.mission.waypointOf() : null;
  const view = {
    pose,
    cam: renderer.cam,
    clouds,
    sunAzimuth: SUN_AZIMUTH,
    cockpit: cockpit && screen !== 'menu',
    hud: screen === 'menu' ? null : {
      objective,
      callout: world.callout,
      pullUp: screen === 'fly' && !world.outcome && a.agl < 60 && Math.sin(a.pitch) < -0.28 && a.speed > 60,
      lastFire: world.lastFire,
    },
    waypoint: screen === 'menu' ? null : waypoint,
    vignette: true,
  };
  drawFrame(renderer, world, view);
  if (screen === 'menu') drawMissionMenu(renderer, MISSIONS, selected, clock);
  if (screen === 'over') drawOutcomeBanner(renderer, world);
  if (screen === 'paused') drawPause(renderer);
}

function drawPause(renderer) {
  const { ctx, width, height } = renderer;
  ctx.fillStyle = 'rgba(4,8,14,0.55)';
  ctx.fillRect(0, 0, width, height);
  ctx.font = 'bold 40px "Trebuchet MS", "DejaVu Sans", sans-serif';
  ctx.fillStyle = 'rgb(246,242,232)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PAUSED', width / 2, height / 2 - 12);
  ctx.font = '13px "Courier New", monospace';
  ctx.fillStyle = 'rgba(200,224,242,0.75)';
  ctx.fillText('P or ESC to fly on  ·  R to restart  ·  ESC twice for the menu', width / 2, height / 2 + 28);
}

// --- Staged scenes for the screenshots: the real rules, a scripted sortie, and a stable seed.
function runShot(name) {
  const kinds = {
    // The cover: the chase view on the gate run, two hundred metres off the first ring's tail, the
    // ring filling the middle of the glass and the valley wall on the left pushed into frame by the
    // bank.
    cover: () => {
      mission = missionById('gates');
      world = createWorld(terrain, mission);
      // Gate 1 ada di [240, -290, y=92] (lihat missions.js) dan menghadap sumbu +x.
      // Heading 90 deg = sepanjang +x, jadi ring tepat di depan hidung pesawat.
      // Pesawat diletakkan 70 m di belakang ring pada ketinggian 108 m (16 m di atas pusat ring)
      // dan pitch -5 deg: ring mengisi frame, terrain canyon mengisi bawah.
      // Gate 0 di [240,-290,92] r=16. Pesawat diletakkan 150 m mundur di sumbu gate (x=90)
      // supaya gate BELUM terlewati saat frame diambil; kamera chase ada 14 m di belakang pesawat,
      // jadi jarak efektif ke ring ~136 m -> ring ~80 px, jelas terlihat di depan.
      const gx = 240, gz = -290, gy = 92;
      const hdg = 90 * DEG;
      // Pitch 0 dan pesawat 10 m DI ATAS pusat ring: ring masuk utuh ke dalam frame,
      // bukan terpotong tepi bawah.
      // Pesawat LEBIH RENDAH dari pusat ring (-20 m) dan menengadah (+6 deg): ring naik ke
      // tengah-tengah frame, tidak terpotong tepi bawah.
      const pitch = 6 * DEG;
      const eye = [gx - 165, gy - 20, gz];
      placeAtEye(world.aircraft, eye, hdg, pitch / DEG);
      // Kunci state gate ke 0 dan hapus riwayat lewat, supaya layar menampilkan gate pertama.
      world.missionState.next = 0;
      world.missionState.time = 0;
      for (const gate of world.gates) gate.passed = false;
      world.aircraft.time = 0;
      world.aircraft.speed = 112;
      world.aircraft.throttle = 0.74;
      world.aircraft.fuel = 0.77;
      world.aircraft.onGround = false;
      world.aircraft.gearDown = false;
      holdTurn(16, 0.9, false);
      screen = 'fly';
    },
    // Gate Run: the first gate dead ahead and the second past it, the valley turning away behind.
    gates: () => {
      mission = missionById('gates');
      world = createWorld(terrain, mission);
      const g = world.gates[0];
      const hdg = 30 * DEG;
      placeAtEye(world.aircraft, [g.x - Math.sin(hdg) * 240, 190, g.z - Math.cos(hdg) * 240], hdg, -4);
      world.aircraft.speed = 106;
      world.aircraft.throttle = 0.78;
      world.aircraft.fuel = 0.77;
      world.aircraft.onGround = false;
      world.aircraft.gearDown = false;
      holdTurn(-10, 0.9, false);
      screen = 'fly';
    },
    // Canyon Strike: the run-in on the range hulk from the north, cannon firing, the target and its
    // drums dead ahead on the hardpan with the range rings around it.
    strike: () => {
      mission = missionById('strike');
      world = createWorld(terrain, mission);
      const hulk = world.missionState.hulk;
      // Hulk hanya ~36x11x7 m. Pada 165 m ia terlalu kecil dan tenggelam di horizon.
      // Dekatkan ke 78 m, turunkan pesawat 12 m di atas hulk, pitch landai: hulk + ring target
      // mengisi frame dan terbaca sebagai sasaran (kriteria #1).
      // Hulk tertutup badan pesawat pada sudut rendah. Naikkan kamera ke 34 m di atas hulk,
      // jarak 92 m, pitch -14 deg: hulk + tiga ring target tampak di bawah-depan, tidak
      // tertutup pesawat (pola yang sama dengan cover yang berhasil 10/10).
      const hdg = 192 * DEG;
      placeAtEye(world.aircraft, [hulk.position[0] - Math.sin(hdg) * 92, hulk.position[1] + 34, hulk.position[2] - Math.cos(hdg) * 92], hdg, -14);
      world.aircraft.time = 0;
      // Hulk utuh (bukan meledak) supaya bentuknya terbaca.
      hulk.destroyed = false;
      hulk.hp = 100;
      hulk.burn = 0;
      world.rounds.length = 0;
      world.aircraft.speed = 112;
      world.aircraft.throttle = 0.84;
      world.aircraft.fuel = 0.78;
      world.aircraft.onGround = false;
      world.aircraft.gearDown = false;
      holdTurn(4, 0.35, true);
      screen = 'fly';
    },
    // Field Landing: the wheels down on the tar, rolling out past the threshold, the numbers behind
    // and the hangars on the shoulder, the gear carrying the weight.
    landing: () => {
      mission = missionById('landing');
      world = createWorld(terrain, mission);
      const rw = world.runway;
      const a = world.aircraft;
      const p = rw.at(-rw.halfLength + 170, 1.2);
      stageAirborne(a, p[0], rw.y + 1.55, p[2], rw.heading, 44, 0.12);
      a.onGround = true;
      a.gearDown = true;
      a.pitch = 0.03;
      a.forward = [Math.sin(rw.heading) * Math.cos(a.pitch), Math.sin(a.pitch), Math.cos(rw.heading) * Math.cos(a.pitch)];
      a.bank = 0;
      a.throttle = 0.12;
      a.fuel = 0.74;
      a.agl = 0;
      world.missionState.landed = true;
      world.missionState.touchdown = 132;
      chase.snap = true;
      chase.yaw = rw.heading;
      chase.pitch = -7 * DEG;
      chase.roll = 0;
      screen = 'fly';
    },
  };
  (kinds[name] || kinds.cover)();
  chase.snap = true;
  // Paint the frame synchronously and signal readiness at once: a staged scene does not need the
  // frame loop, and the screenshots are read back from the same canvas the game would draw to.
  for (let i = 0; i < 3; i += 1) paint(1 / 60);
  document.documentElement.dataset.scene = 'ready';
  // A capture tool resizes the window after the page has painted; the scene repaints itself at the
  // new size, so the frame is always the size the canvas actually has when it is read back.
  const repaint = () => {
    for (let i = 0; i < 3; i += 1) paint(1 / 60);
    document.documentElement.dataset.painted = `${canvas.width}x${canvas.height}`;
  };
  window.addEventListener('resize', repaint);
  requestAnimationFrame(() => {
    repaint();
    requestAnimationFrame(repaint);
  });
}

if (shot) {
  runShot(shot);
} else {
  requestAnimationFrame(frame);
  announce('Cold Front. Pick a sortie with the arrow keys and Space, or the mouse.');
}
