// The chase camera: it sits behind and above the aircraft along the plane's own line rather than the
// world up axis, so a roll swings the view with the wing instead of against it, and it lags pitch and
// yaw with a soft spring so the plane is never dragged out of frame. It looks slightly down from the
// nose line, which puts the aircraft low in the frame and the terrain it is flying into in front of
// it. A stall, an impact or a low fast pass adds buffet both to the view and to the airframe.

import { DEG, clamp, lerpAngle, normalise, smoothFactor } from './mathkit.js';

export const CHASE = {
  /** How far behind and above the aircraft's centre the eye sits, in metres. */
  back: 14,
  up: 4.2,
  /** The share of the aircraft's pitch the camera keeps, so a climb does not hide the ground. */
  pitchShare: 0.78,
  /** The rate at which the view settles onto the plane's new heading, pitch and bank. */
  lagYaw: 4.6,
  lagPitch: 4.4,
  lagRoll: 6.5,
  /** The aircraft's bank the camera keeps, and a small nose-down bias in the frame. */
  rollShare: 0.7,
  lookDown: -6 * DEG,
  minClearance: 4,
};

export function createChaseCamera() {
  return { yaw: 0, pitch: 0, roll: 0, shake: 0, snap: true };
}

/**
 * Update the chase camera for this frame and return the eye and the angles `rebuildCamera` needs.
 * `shake` in options is an extra impulse (an impact); the aircraft's own stall adds buffet.
 */
export function updateChaseCamera(chase, aircraft, dt, shake) {
  const targetYaw = Math.atan2(aircraft.forward[0], aircraft.forward[2]);
  const targetPitch = Math.asin(clamp(aircraft.forward[1], -1, 1)) * CHASE.pitchShare;
  const targetRoll = aircraft.bank * CHASE.rollShare;
  if (chase.snap) {
    chase.yaw = targetYaw;
    chase.pitch = targetPitch;
    chase.roll = targetRoll;
    chase.snap = false;
  } else {
    chase.yaw = lerpAngle(chase.yaw, targetYaw, smoothFactor(CHASE.lagYaw, dt));
    chase.pitch += (targetPitch - chase.pitch) * smoothFactor(CHASE.lagPitch, dt);
    chase.roll += (targetRoll - chase.roll) * smoothFactor(CHASE.lagRoll, dt);
  }
  const buffet = aircraft.stall * 0.9 + (aircraft.agl < 40 && aircraft.speed > 110 ? 0.3 : 0);
  chase.shake = Math.max(chase.shake * Math.max(0, 1 - dt * 3.2), buffet * 0.6 + (shake || 0));
  const wobbleYaw = Math.sin(aircraft.time * 27.3) * chase.shake * 0.011;
  const wobblePitch = Math.cos(aircraft.time * 31.7) * chase.shake * 0.009;
  const wobbleRoll = Math.sin(aircraft.time * 19.1) * chase.shake * 0.01;

  const yaw = chase.yaw + wobbleYaw;
  const pitch = chase.pitch - CHASE.lookDown + wobblePitch;
  const plane = normalise([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
  const right0 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up0 = [right0[1] * plane[2] - right0[2] * plane[1], right0[2] * plane[0] - right0[0] * plane[2], right0[0] * plane[1] - right0[1] * plane[0]];
  const roll = chase.roll + wobbleRoll;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const up = [up0[0] * cr + right0[0] * sr, up0[1] * cr + right0[1] * sr, up0[2] * cr + right0[2] * sr];
  const eye = [
    aircraft.position[0] - plane[0] * CHASE.back + up[0] * CHASE.up,
    aircraft.position[1] - plane[1] * CHASE.back + up[1] * CHASE.up,
    aircraft.position[2] - plane[2] * CHASE.back + up[2] * CHASE.up,
  ];
  return { eye, yaw, pitch, roll };
}

/** The cockpit view: at the pilot's eye line behind the glareshield, rolled with the plane. */
export function cockpitView(aircraft) {
  const forward = aircraft.forward;
  return {
    eye: [aircraft.position[0] + forward[0] * 2.2, aircraft.position[1] + 1.05, aircraft.position[2] + forward[2] * 2.2],
    yaw: Math.atan2(forward[0], forward[2]),
    pitch: Math.asin(clamp(forward[1], -1, 1)),
    roll: aircraft.bank,
  };
}
