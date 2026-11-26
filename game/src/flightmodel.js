// The flight model: a small, honest fixed-wing simulation. Throttle sets the thrust, the wing's lift
// grows with the square of airspeed and past the critical angle the wing stalls and the nose drops.
// Turning follows the bank: the turn rate is g·tan(bank)/v, so a slow plane turns inside a fast one
// and a tight turn bleeds speed through induced drag, exactly the trade a real pilot manages.
//
// The plane is integrated as nose direction plus airspeed; lift, drag and angle of attack fall out
// of the two, so the HUD numbers are the model's own state rather than a display on top of it.

import { DEG, clamp, lerpAngle, normalise } from './mathkit.js';

export const AIRCRAFT = {
  /** Full-throttle thrust as an acceleration (m/s²), and how fast the throttle spools. */
  maxThrust: 17.5,
  reverseThrust: 4.5,
  throttleRate: 0.8,
  /** Fuel burn as a share of the tank a second at idle and at full throttle. */
  burnIdle: 0.0014,
  burnFull: 0.0098,
  /** Drag: the parasite term, and the induced term that rises with the angle of attack. */
  dragParasite: 0.00021,
  dragInduced: 0.0018,
  gravity: 9.81,
  criticalAoA: 15 * DEG,
  /** Elevator pitch rate at full deflection, and the attitude it settles at hands-off. */
  pitchRate: 26 * DEG,
  cruisePitch: 1.5 * DEG,
  rollRate: 115 * DEG,
  /** The bank-to-turn gain: the share of the coordinated turn an airframe gets. */
  turnGain: 0.85,
  yawRate: 12 * DEG,
  rollReturn: 2.2,
  pitchStability: 2.6,
  /** Stall: the lift shortfall past the critical angle, and how hard the nose drops with it. */
  stallDrop: 0.85,
  stallSpeed: 30,
  vne: 150,
  hull: 100,
  cannonRate: 9,
  muzzleSpeed: 900,
  spread: 0.0026,
  /** The speed under which a landing is safe on the tar. */
  touchdownSpeed: 46,
};

/** A fresh aircraft standing on the runway at `heading` over ground height `y`, gear down. */
export function createAircraft(x, y, z, heading) {
  return {
    position: [x, y, z],
    forward: [Math.sin(heading), 0, Math.cos(heading)],
    bank: 0,
    speed: 0,
    pitch: 0,
    yaw: heading,
    aoa: 0,
    turnRate: 0,
    throttle: 0,
    fuel: 1,
    hull: AIRCRAFT.hull,
    gearDown: true,
    onGround: true,
    stall: 0,
    stallWarning: 0,
    gLoad: 1,
    agl: 2.4,
    cannonTimer: 0,
    events: [],
    time: 0,
    distance: 0,
    slip: 0,
  };
}

export function headingOf(state) {
  return Math.atan2(state.forward[0], state.forward[2]);
}

/**
 * The one physics step, `dt` seconds. `controls` is
 *   { pitch, roll, yaw: -1..1, throttleUp, throttleDown: 0..1, brake: bool }
 * and `terrain` answers `sample(x, z) -> { height, peak, slope, flat }` and
 * `peakAround(x, z, r) -> height`. The state's `events` array is cleared and refilled each step.
 */
export function stepFlight(state, controls, dt, terrain) {
  const A = AIRCRAFT;
  const events = (state.events = []);
  state.time += dt;

  // --- Engine. The throttle spools, fuel runs down as it is held, and with no fuel there is no thrust.
  state.throttle = clamp(state.throttle + (controls.throttleUp - controls.throttleDown) * A.throttleRate * dt, 0, 1);
  const dry = state.fuel <= 0;
  if (!dry) {
    state.fuel = Math.max(0, state.fuel - (A.burnIdle + (A.burnFull - A.burnIdle) * state.throttle) * dt);
    if (state.fuel === 0) events.push({ kind: 'flameout' });
  }
  const brake = controls.brake;
  let thrust = dry ? 0 : A.maxThrust * (0.1 + 0.9 * state.throttle);
  if (brake && state.onGround && state.speed < 12) thrust -= A.reverseThrust * state.throttle;

  const airborne = !state.onGround;
  const v = state.speed;

  // --- Lift, drag and the angle of attack. A turn at a bank needs more lift, and more lift means a
  // larger angle of attack and more drag: the cost of turning hard, paid in speed.
  const loadTarget = 1 / Math.max(0.22, Math.cos(state.bank));
  const liftNeeded = A.gravity * loadTarget * (1 + 0.35 * Math.abs(controls.pitch));
  const vRatio = (v * v) / (A.stallSpeed * A.stallSpeed);
  const aoaTarget = clamp(liftNeeded * loadTarget / (A.gravity * Math.max(0.08, vRatio)), 0, A.criticalAoA * 2.2);
  state.aoa = lerpAngle(state.aoa, aoaTarget, Math.min(1, dt * 8));
  state.stall = airborne ? clamp((state.aoa - A.criticalAoA) / (A.criticalAoA * 0.5), 0, 1) : 0;
  state.stallWarning = airborne ? clamp((state.aoa - A.criticalAoA * 0.8) / (A.criticalAoA * 0.2), 0, 1) : 0;
  const drag = (A.dragParasite + A.dragInduced * state.aoa * state.aoa) * v * v * (state.gearDown && airborne ? 1.5 : 1);
  let accel = thrust - drag;
  if (airborne) accel -= A.gravity * Math.sin(state.pitch) * 0.92;
  state.speed = clamp(v + accel * dt, 0, 240);

  // --- The nose. The stick pitches it, the bank turns it, and the stall drops it.
  const authority = clamp(v / 65, 0.2, 1.25);
  const stiff = 1 / (1 + Math.max(0, state.speed - A.vne) / 40);
  if (airborne) {
    const stallSink = state.stall * A.stallDrop + (state.speed < A.stallSpeed ? 0.5 * (1 - state.speed / A.stallSpeed) : 0);
      const pitchRate = controls.pitch * A.pitchRate * authority * stiff - (state.pitch - A.cruisePitch) * A.pitchStability - stallSink;
    state.pitch = clamp(state.pitch + pitchRate * dt, -80 * DEG, 80 * DEG);
    const turnTarget = -Math.tan(state.bank) * (A.gravity / Math.max(28, v)) * A.turnGain;
    state.turnRate = lerpAngle(state.turnRate, turnTarget, Math.min(1, dt * 6));
    state.bank = clamp(state.bank + controls.roll * A.rollRate * authority * dt, -78 * DEG, 78 * DEG);
    if (Math.abs(controls.roll) < 0.04) state.bank = lerpAngle(state.bank, 0, Math.min(1, dt * A.rollReturn));
    // The rudder yaws the nose a little without banking: slip, for lining up a shot or a gate.
    state.yaw += controls.yaw * A.yawRate * authority * dt;
    state.slip = controls.yaw;
    state.gLoad = 1 / Math.max(0.25, Math.cos(state.bank)) * (1 + 0.25 * Math.abs(controls.pitch));
  } else {
    // On the wheels: the rudder steers, the wings stay level and the nose wheel lifts only on the
    // elevator; below flying speed the stick barely moves anything.
    state.turnRate = controls.yaw * 0.2 * clamp(v / 10, 0, 1);
    state.bank = lerpAngle(state.bank, 0, Math.min(1, dt * 5));
    state.pitch = clamp(state.pitch + (controls.pitch * 9 + (state.speed > 50 ? 0.8 : 0)) * DEG * Math.min(1, dt * 6), -6 * DEG, 10 * DEG);
    state.gLoad = 1;
    state.slip = 0;
  }

  // --- Rebuild the direction and the velocity from the nose, the bank and the speed.
  state.yaw += state.turnRate * dt;
  state.forward = normalise([Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), Math.cos(state.yaw) * Math.cos(state.pitch)]);
  const velocity = [state.forward[0] * state.speed, state.forward[1] * state.speed, state.forward[2] * state.speed];
  state.position = [
    state.position[0] + velocity[0] * dt,
    state.position[1] + velocity[1] * dt,
    state.position[2] + velocity[2] * dt,
  ];
  state.distance += Math.hypot(velocity[0], velocity[2]) * dt;

  // --- The ground. Sample under the plane and the highest ground in a short reach ahead, so a wing
  // or the belly meets a wall before the plane's centre passes through it.
  const under = terrain.sample(state.position[0], state.position[2]);
  const reach = Math.max(7, state.speed * dt * 3.4);
  const peakAhead = terrain.peakAround(state.position[0] + state.forward[0] * reach, state.position[2] + state.forward[2] * reach, reach);
  const belly = state.gearDown ? 2.2 : 1.3;
  const floor = under.height + belly;
  state.agl = state.position[1] - under.height;

  if (state.position[1] <= floor) {
    const sink = -velocity[1];
    const wheels = Math.abs(state.bank) < 14 * DEG && Math.abs(state.pitch) < 12 * DEG;
    const onTar = under.flat;
    const gentle = sink < 7 && state.speed < A.touchdownSpeed;
    if (airborne && !(wheels && onTar && gentle)) {
      state.position[1] = floor;
      events.push({ kind: 'crash', sink, bank: state.bank, onTar, speed: state.speed });
      state.hull = 0;
      state.speed = 0;
      state.onGround = true;
      return state;
    }
    if (airborne) {
      events.push({ kind: 'touchdown', sink, speed: state.speed, onTar });
      if (sink > 3.4) state.hull = Math.max(0, state.hull - Math.round(sink * 3));
      if (onTar && sink < 4.6) events.push({ kind: 'landed' });
    }
    state.position[1] = floor;
    state.onGround = true;
    state.gearDown = true;
    state.pitch = 0;
    // Rolling friction, and the brakes once they are held.
    const roll = (brake ? 6.5 : 0.9) * (0.4 + 0.6 * Math.min(1, state.speed / 20));
    state.speed = Math.max(0, state.speed - roll * dt);
    if (state.speed < 0.6 && state.throttle < 0.06) {
      state.speed = 0;
      if (events.length === 0) events.push({ kind: 'stopped' });
    }
    state.yaw = Math.atan2(state.forward[0], state.forward[2]);
    state.forward = normalise([Math.sin(state.yaw), 0, Math.cos(state.yaw)]);
    state.turnRate = 0;
  } else {
    if (state.onGround) {
      state.gearDown = true;
      events.push({ kind: 'liftoff' });
    }
    state.onGround = false;
    if (state.agl > 12) state.gearDown = false;
  }

  // --- Wingtip or belly into rising ground: a scrape, not a landing.
  if (!state.onGround && state.position[1] < peakAhead + 0.8) {
    state.hull = Math.max(0, state.hull - 35);
    state.position[1] = peakAhead + 0.8;
    state.speed *= 0.3;
    events.push({ kind: 'impact', damage: 35 });
  }
  // --- Pulling hard above never-exceed stresses the airframe, slowly.
  if (state.gLoad > 6.2) state.hull = Math.max(0, state.hull - (state.gLoad - 6.2) * 5 * dt);

  return state;
}

/** A cannon round's start point: under a wing root, ahead of the cockpit. */
export function cannonOrigin(state, side) {
  const forward = state.forward;
  const right = normalise([forward[2], 0, -forward[0]]);
  return [
    state.position[0] + forward[0] * 4.2 + right[0] * side * 1.55,
    state.position[1] + forward[1] * 4.2 - 0.5,
    state.position[2] + forward[2] * 4.2 + right[2] * side * 1.55,
  ];
}

/** The direction a round flies: the nose, with a small spread that is stable for a shot index. */
export function cannonAim(state, index) {
  const jitterYaw = Math.sin(index * 12.9898) * AIRCRAFT.spread;
  const jitterPitch = Math.cos(index * 78.233) * AIRCRAFT.spread;
  const yaw = state.yaw + jitterYaw;
  const pitch = state.pitch + jitterPitch;
  return normalise([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
}
