// Small vector and camera maths shared by the flight model, the world and the renderer. Vectors are
// plain [x, y, z] arrays where +x is east, +y is up and +z is north, so the game's world is
// right-handed like the screen once a camera looks along -z after its yaw and pitch.
//
// Every function allocates a fresh array: the frame budget is tiny at 60 Hz on one core, and
// three-element arrays are cheap next to clarity, but the hot paths (rebuildCamera, the terrain
// painter) take reusable out-arguments so the per-pixel and per-triangle work allocates nothing.

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalise(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, -1];
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/** Rate-limited approach: move `value` toward `target` by at most `maxDelta` this step. */
export function approach(value, target, maxDelta) {
  if (value < target) return Math.min(target, value + maxDelta);
  return Math.max(target, value - maxDelta);
}

/** A frame-rate independent smoothing factor: the share of the gap closed in `dt` at `rate` per second. */
export function smoothFactor(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

/** A smoothstep from 0 at `edge0` to 1 at `edge1`, zero slope at both ends: the terrain's blend curve. */
export function smooth(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Heading in compass degrees, 0 = north (+z), 90 = east (+x); the HUD tape and the compass ribbon share it. */
export function compassHeading(forward) {
  const heading = Math.atan2(forward[0], forward[2]) / DEG;
  return (heading + 360) % 360;
}

/** Half-viewport size, in pixels, of the perspective camera at the projection distance. */
export const PROJECT = { focal: 640, cx: 640, cy: 380 };

/**
 * A camera as the painter needs it: eye position, the right/up/forward axes of its basis, and the
 * pitch-dependent horizon the painter splits sky and ground on. `horizonY` is where an infinitely
 * distant point level with the eye lands; with pitch up it lowers, with pitch down it rises.
 */
export function rebuildCamera(cam, eye, yaw, pitch, roll) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  // Forward from yaw and pitch (yaw 0 looks along +z, positive pitch looks up).
  const fwd = [sy * cp, sp, cy * cp];
  // Right and up before roll, then rolled about the forward axis.
  const right0 = [cy, 0, -sy];
  const up0 = cross(fwd, right0);
  const right = [right0[0] * cr + up0[0] * sr, right0[1] * cr + up0[1] * sr, right0[2] * cr + up0[2] * sr];
  const up = [-right0[0] * sr + up0[0] * cr, -right0[1] * sr + up0[1] * cr, -right0[2] * sr + up0[2] * cr];
  cam.eye = eye;
  cam.fwd = fwd;
  cam.right = right;
  cam.up = up;
  cam.yaw = yaw;
  cam.pitch = pitch;
  cam.roll = roll;
  // Pitch down (negatif) MENURUNKAN garis horizon di layar: nada turun = horizon naik secara
  // konseptual, tapi yang digambar adalah titik di bawah pusat. Tanda harus minus, bukan plus
  // (plus membalik sky/ground dan membuat terrain tidak pernah melukis di bawah frame).
  cam.horizonY = PROJECT.cy - Math.tan(pitch) * PROJECT.focal;
  return cam;
}

export function createCamera() {
  const cam = {};
  rebuildCamera(cam, [0, 0, 0], 0, 0, 0);
  return cam;
}

/** Project a world point into screen pixels; `depth` is the distance along the camera's forward axis. */
export function projectPoint(cam, p) {
  const dx = p[0] - cam.eye[0];
  const dy = p[1] - cam.eye[1];
  const dz = p[2] - cam.eye[2];
  const depth = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (depth < 0.5) return null;
  const x = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const y = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const k = PROJECT.focal / depth;
  return { x: PROJECT.cx + x * k, y: PROJECT.cy - y * k, depth };
}
