// The world: the terrain sampler the flight model flies over, the aircraft, the cannon rounds, the
// effects that mark events (dust, debris, the wreck, smoke) and the mission in progress. Nothing here
// draws; the renderer reads this state and paints it, and the mission reads it to score the sortie.

import { createAircraft, stepFlight, cannonOrigin, cannonAim, AIRCRAFT } from './flightmodel.js';
import { BASE, alongHeading } from './terrain.js';

const MAX_ROUNDS = 56;
const MAX_DEBRIS = 140;

/**
 * The ground sampler the flight model asks every step: height, slope and whether the surface under
 * the wheels is level enough to land on. `flat` is a slope threshold rather than a rectangle, so the
 * runway pan, the range hardpan and any genuinely level ground all take a landing; a wall never does.
 */
export function createTerrainSampler(heightAt) {
  const step = 2;
  const cache = new Map();
  function height(x, z) {
    const key = Math.round(x / step) * 100003 + Math.round(z / step);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = heightAt(Math.round(x / step) * step, Math.round(z / step) * step);
    if (cache.size > 5000) cache.clear();
    cache.set(key, value);
    return value;
  }
  return {
    height,
    sample(x, z) {
      const e = 4;
      const h = height(x, z);
      const hx = height(x + e, z) - height(x - e, z);
      const hz = height(x, z + e) - height(x, z - e);
      const slope = Math.hypot(hx, hz) / (2 * e);
      return { height: h, peak: h, slope, flat: slope < 0.06 };
    },
    peakAround(x, z, r) {
      return Math.max(height(x, z), height(x + r, z), height(x - r, z), height(x, z + r), height(x, z - r));
    },
  };
}

/** The home runway as a strip: its centre, its threshold, its far end and the line to land on. */
export function runwayInfo() {
  const rw = BASE.runway;
  const sin = Math.sin(rw.heading);
  const cos = Math.cos(rw.heading);
  const half = rw.length / 2;
  return {
    ...rw,
    sin,
    cos,
    y: BASE.elevation,
    threshold: [rw.x - sin * half, BASE.elevation, rw.z - cos * half],
    farEnd: [rw.x + sin * half, BASE.elevation, rw.z + cos * half],
    halfLength: half,
    halfWidth: rw.width / 2,
    local(x, z) {
      const dx = x - rw.x;
      const dz = z - rw.z;
      return { along: dx * sin + dz * cos, across: dx * cos - dz * sin };
    },
    at(along, across) {
      const o = alongHeading(rw.heading, along, across);
      return [rw.x + o.x, BASE.elevation, rw.z + o.z];
    },
  };
}

/** A fresh world on a mission, the aircraft parked at the threshold. */
export function createWorld(terrain, mission) {
  const world = {
    terrain,
    runway: runwayInfo(),
    aircraft: null,
    rounds: [],
    debris: [],
    puffs: [],
    wreck: null,
    mission,
    missionState: null,
    gates: [],
    score: 0,
    hits: 0,
    shots: 0,
    outcome: null,
    outcomeTimer: 0,
    time: 0,
    shotIndex: 0,
    impactFlash: 0,
    firedThisFrame: false,
    lastFire: -9,
    shake: 0,
  };
  resetWorld(world, mission);
  return world;
}

export function resetWorld(world, mission) {
  const start = world.runway.threshold;
  world.aircraft = createAircraft(start[0], start[1] + 2.4, start[2], world.runway.heading);
  world.aircraft.throttle = 0;
  world.rounds.length = 0;
  world.debris.length = 0;
  world.puffs.length = 0;
  world.wreck = null;
  world.mission = mission;
  world.score = 0;
  world.hits = 0;
  world.shots = 0;
  world.outcome = null;
  world.outcomeTimer = 0;
  world.time = 0;
  world.impactFlash = 0;
  world.firedThisFrame = false;
  world.lastFire = -9;
  world.shake = 0;
  world.gates.length = 0;
  mission.start(world);
}

/** One fixed simulation step: the plane, the cannon, the effects, then the mission's own rules. */
export function stepWorld(world, controls, dt) {
  world.firedThisFrame = false;
  world.shake = Math.max(0, world.shake - dt * 2.4);
  if (world.outcome) {
    world.outcomeTimer += dt;
    stepEffects(world, dt);
    return;
  }
  world.time += dt;
  const state = world.aircraft;
  const events = stepFlight(state, controls, dt, world.terrain);
  for (let i = 0; i < events.length; i += 1) applyEvent(world, events[i]);

  // --- Cannon: two rounds leave the wing roots on every tick of the cannon's clock.
  state.cannonTimer -= dt;
  if (controls.fire && state.cannonTimer <= 0 && state.hull > 0 && !state.onGround) {
    state.cannonTimer = 1 / AIRCRAFT.cannonRate;
    world.shotIndex += 1;
    for (let side = -1; side <= 1; side += 2) {
      const aim = cannonAim(state, world.shotIndex * 2 + side);
      world.rounds.push({
        position: cannonOrigin(state, side),
        velocity: [aim[0] * AIRCRAFT.muzzleSpeed, aim[1] * AIRCRAFT.muzzleSpeed, aim[2] * AIRCRAFT.muzzleSpeed],
        previous: cannonOrigin(state, side),
        life: 1.8,
        side,
      });
    }
    world.shots += 2;
    world.firedThisFrame = true;
    world.lastFire = world.time;
    if (world.rounds.length > MAX_ROUNDS) world.rounds.splice(0, world.rounds.length - MAX_ROUNDS);
  }

  // --- Rounds fly until they age out, hit the ground, or a mission claims them.
  for (let i = world.rounds.length - 1; i >= 0; i -= 1) {
    const round = world.rounds[i];
    round.life -= dt;
    round.previous = round.position;
    round.position = [
      round.position[0] + round.velocity[0] * dt,
      round.position[1] + round.velocity[1] * dt,
      round.position[2] + round.velocity[2] * dt,
    ];
    let spent = round.life <= 0;
    if (!spent && round.position[1] < world.terrain.height(round.position[0], round.position[2])) {
      spent = true;
      dustPuff(world, round.position);
    }
    if (!spent && world.mission.onRound) {
      world.mission.onRound(world, round);
      spent = round.life <= 0;
    }
    if (spent) world.rounds.splice(i, 1);
  }

  stepEffects(world, dt);
  world.mission.update(world, dt);
}

function stepEffects(world, dt) {
  for (let i = world.debris.length - 1; i >= 0; i -= 1) {
    const piece = world.debris[i];
    piece.life -= dt;
    piece.velocity[1] -= 9.81 * dt;
    piece.position = [
      piece.position[0] + piece.velocity[0] * dt,
      piece.position[1] + piece.velocity[1] * dt,
      piece.position[2] + piece.velocity[2] * dt,
    ];
    if (world.terrain.height(piece.position[0], piece.position[2]) > piece.position[1]) piece.life = Math.min(piece.life, 1.1);
    piece.spin += piece.spinRate * dt;
    if (piece.life <= 0) world.debris.splice(i, 1);
  }
  for (let i = world.puffs.length - 1; i >= 0; i -= 1) {
    const p = world.puffs[i];
    p.life -= dt;
    p.position[1] += p.rise * dt;
    p.radius += p.grow * dt;
    if (p.life <= 0) world.puffs.splice(i, 1);
  }
  if (world.debris.length > MAX_DEBRIS) world.debris.splice(0, world.debris.length - MAX_DEBRIS);
  world.impactFlash = Math.max(0, world.impactFlash - dt * 2.4);
  if (world.wreck) world.wreck.time += dt;
}

function applyEvent(world, event) {
  const state = world.aircraft;
  const at = state.position;
  if (event.kind === 'crash') {
    world.impactFlash = 1;
    world.shake = 1;
    world.wreck = { position: [at[0], at[1], at[2]], heading: state.yaw, time: 0 };
    addDebrisBurst(world, [at[0], at[1] + 1, at[2]], event.sink > 16 ? 40 : 26, true);
    addSmoke(world, at, 8, true);
    world.outcome = {
      kind: 'crash',
      text: event.onTar ? 'BELLY LANDING ON THE TAR' : 'AIRFRAME LOST',
      detail: event.onTar
        ? 'Wheels down, wings level and slow is the only way onto the tar.'
        : event.sink > 12
          ? 'Too steep: the gear took the impact, not the runway.'
          : 'Not lined up: land on a strip, wings level, nose up.',
    };
  } else if (event.kind === 'impact') {
    world.impactFlash = 0.6;
    world.shake = 0.7;
    addDebrisBurst(world, at, 10, true);
    dustPuff(world, at);
  } else if (event.kind === 'touchdown') {
    const dust = Math.max(3, Math.round(event.sink * 2));
    for (let i = 0; i < dust; i += 1) {
      const a = (i / dust) * Math.PI * 2;
      world.puffs.push({
        position: [at[0] + Math.cos(a) * 3, at[1] - 2, at[2] + Math.sin(a) * 3],
        life: 1.5,
        radius: 1.0,
        grow: 2.6,
        rise: 0.5,
        smoke: false,
      });
    }
  } else if (event.kind === 'landed') {
    world.score += 500;
    if (world.mission.id === 'landing') world.outcome = { kind: 'landed', text: 'ON THE TAR', detail: 'Gear down, wings level, on the centre line: that is how it ends.' };
  }
}

/** A short-lived dust puff, where a round strikes or a wheel touches. */
export function dustPuff(world, at) {
  world.puffs.push({ position: [at[0], at[1], at[2]], life: 1.1, radius: 0.8, grow: 1.8, rise: 0.7, smoke: false });
}

export function addDebrisBurst(world, at, count, warm) {
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + i * 0.7;
    const s = 5 + (i % 6) * 3;
    world.debris.push({
      position: [at[0], at[1], at[2]],
      velocity: [Math.cos(a) * s, 5 + (i % 4) * 3, Math.sin(a) * s],
      life: 2.0 + (i % 4) * 0.5,
      spin: a,
      spinRate: 4 + (i % 5),
      size: 0.45 + (i % 3) * 0.3,
      warm,
    });
  }
}

export function addSmoke(world, at, count, big) {
  for (let i = 0; i < count; i += 1) {
    world.puffs.push({
      position: [at[0] + (i - count / 2) * 1.8, at[1] + 1 + i * 0.8, at[2] + (i % 3) * 1.4],
      life: big ? 6 : 2.8,
      radius: big ? 4 + i * 0.8 : 1.8,
      grow: big ? 4.6 : 2.8,
      rise: big ? 3.4 : 1.6,
      smoke: true,
    });
  }
}
