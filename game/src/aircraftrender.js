// The aircraft model, drawn in world units around the plane's centre and projected by the shared
// camera, so it banks, climbs and shrinks exactly as the world does: the same silhouette from behind
// at 600 m as at 30 m. Wings, fuselage spine, tailplane and fins are flat polygons with a top face
// each, shaded by the body's attitude, and the canopy, intake and navigation lights sit on top. The
// shape is original: a delta wing with forward canards, a broken spine and a ducted intake; it reads
// as a built machine and copies no aircraft anyone else made.

import { PROJECT } from './mathkit.js';

const BODY = [200, 204, 210];
const BODY_DARK = [132, 138, 146];
const BELLY = [96, 102, 112];
const ACCENT = [212, 92, 56];
const GLASS = [104, 148, 168];
const GLASS_DARK = [74, 112, 132];
const TYRE = [38, 40, 44];
const STRUT = [150, 154, 160];
const NAV_RED = 'rgb(238,72,66)';
const NAV_GREEN = 'rgb(86,228,136)';

function rgb(c, k = 1) {
  return `rgb(${Math.round(Math.min(255, Math.max(0, c[0] * k)))},${Math.round(Math.min(255, Math.max(0, c[1] * k)))},${Math.round(Math.min(255, Math.max(0, c[2] * k)))})`;
}

export function project(cam, p) {
  const dx = p[0] - cam.eye[0];
  const dy = p[1] - cam.eye[1];
  const dz = p[2] - cam.eye[2];
  const depth = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (depth < 0.9) return null;
  const x = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const y = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const k = PROJECT.focal / depth;
  return { x: PROJECT.cx + x * k, y: PROJECT.cy - y * k, depth, k };
}

function poly(ctx, cam, points, fill, edge) {
  let first = true;
  ctx.beginPath();
  for (const p of points) {
    const q = project(cam, p);
    if (!q) return;
    if (first) {
      ctx.moveTo(q.x, q.y);
      first = false;
    } else {
      ctx.lineTo(q.x, q.y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * The aircraft's axes at its position: forward, right and up, the last two rolled by the bank so a
 * banked plane shows its wing and its whole silhouette tilts in frame with the horizon.
 */
export function aircraftAxes(aircraft) {
  const forward = aircraft.forward;
  const raw = [forward[2], 0, -forward[0]];
  const len = Math.hypot(raw[0], raw[2]) || 1;
  const baseRight = [raw[0] / len, 0, raw[2] / len];
  const baseUp = [
    baseRight[1] * forward[2] - baseRight[2] * forward[1],
    baseRight[2] * forward[0] - baseRight[0] * forward[2],
    baseRight[0] * forward[1] - baseRight[1] * forward[0],
  ];
  return { forward, right: baseRight, up: baseUp };
}

/**
 * Draw the aircraft, gear down or up, with the damage fading the paint toward scorch, and a muzzle
 * flash on the frames the cannon fires. Returns the projected centre and scale for callers that
 * want to pin something to the plane (a smoke trail, a label).
 */
export function drawAircraft(painter, cam, aircraft, shooting) {
  const { ctx } = painter;
  const { forward, right, up } = aircraftAxes(aircraft);
  const c = aircraft.position;
  // The bank is carried both by the axes and by the polygons' own tilt, so it is applied once, on the
  // model, and the axes stay upright: the silhouette rolls with the horizon exactly once.
  const W = (lx, ly, lz) => [
    c[0] + forward[0] * lz + right[0] * lx + up[0] * ly,
    c[1] + forward[1] * lz + right[1] * lx + up[1] * ly,
    c[2] + forward[2] * lz + right[2] * lx + up[2] * ly,
  ];
  const centre = project(cam, c);
  if (!centre) return null;
  const damage = 1 - aircraft.hull / 100;
  const tint = (colour) => (damage > 0.05 ? colour.map((v) => v * (1 - damage * 0.35) + 58 * damage * 0.35) : colour);
  const accent = rgb(tint(ACCENT));
  const parts = aircraftParts(W, aircraft.gearDown);
  const top = rgb(tint(BODY));
  const side = rgb(tint(BODY_DARK), 0.96);
  const belly = rgb(tint(BELLY), 0.92);
  const edge = 'rgba(30,32,38,0.5)';
  // Far wing and far canard first, the body over them, then the near wing: paint order that holds
  // from behind, in front and to the side.
  poly(ctx, cam, parts.wingFar, top, edge);
  poly(ctx, cam, parts.canardFar, side, edge);
  poly(ctx, cam, parts.belly, belly, edge);
  poly(ctx, cam, parts.body, top, edge);
  poly(ctx, cam, parts.spine, side, edge);
  poly(ctx, cam, parts.canopy, rgb(GLASS), 'rgba(40,60,72,0.7)');
  poly(ctx, cam, parts.canopySide, rgb(GLASS_DARK), null);
  poly(ctx, cam, parts.intake, 'rgb(48,52,60)', edge);
  poly(ctx, cam, parts.probe, 'rgb(72,74,80)', null);
  poly(ctx, cam, parts.finFar, side, edge);
  poly(ctx, cam, parts.finNear, top, edge);
  poly(ctx, cam, parts.tail, top, edge);
  poly(ctx, cam, parts.wingNear, top, edge);
  poly(ctx, cam, parts.canardNear, side, edge);
  poly(ctx, cam, parts.stripe, accent, null);
  if (aircraft.gearDown) {
    poly(ctx, cam, parts.gearFront, rgb(STRUT), null);
    poly(ctx, cam, parts.gearLeft, rgb(STRUT), null);
    poly(ctx, cam, parts.gearRight, rgb(STRUT), null);
    poly(ctx, cam, parts.tyreFront, rgb(TYRE), null);
    poly(ctx, cam, parts.tyreLeft, rgb(TYRE), null);
    poly(ctx, cam, parts.tyreRight, rgb(TYRE), null);
  }
  // Navigation lights: red to port, green to starboard, and the tail's white beacon.
  poly(ctx, cam, parts.navLeft, NAV_RED, null);
  poly(ctx, cam, parts.navRight, NAV_GREEN, null);
  poly(ctx, cam, parts.beacon, 'rgba(255,244,214,0.9)', null);
  if (shooting) {
    for (const m of parts.muzzles) {
      const p = project(cam, m);
      if (!p) continue;
      const r = Math.max(1.8, 1.2 * p.k * 4);
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
      glow.addColorStop(0, 'rgba(255,252,226,0.95)');
      glow.addColorStop(0.35, 'rgba(255,200,96,0.7)');
      glow.addColorStop(1, 'rgba(255,160,48,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(p.x - r * 3, p.y - r * 3, r * 6, r * 6);
    }
  }
  return { x: centre.x, y: centre.y, k: centre.k };
}

/**
 * The polygons of the aircraft in local coordinates: x to the right wing, y up, z forward. Each is
 * a closed point list; the wings sweep back from the root and taper, the canards sit ahead of the
 * cockpit, and two canted fins make the tail.
 */
export function aircraftParts(W, gear) {
  const L = (pts) => pts.map((p) => W(p[0], p[1], p[2]));
  const parts = {
    body: L([[0, 0.55, 6.2], [-0.72, 0.46, 2.4], [-0.9, 0.12, -1.6], [-0.62, 0.02, -5.4], [0.62, 0.02, -5.4], [0.9, 0.12, -1.6], [0.72, 0.46, 2.4]]),
    spine: L([[-0.62, 0.02, -5.4], [-0.9, 0.12, -1.6], [-0.86, -0.5, -1.4], [-0.6, -0.55, -5.2]]),
    belly: L([[-0.86, -0.5, -1.4], [-0.6, -0.55, -5.2], [0.6, -0.55, -5.2], [0.86, -0.5, -1.4], [0.46, -0.56, 2.6], [-0.46, -0.56, 2.6]]),
    wingFar: L([[-0.86, 0.06, 1.8], [-5.1, -0.1, -1.1], [-5.1, -0.1, -2.3], [-0.86, 0.06, -2.8]]),
    wingNear: L([[0.86, 0.06, 1.8], [5.1, -0.1, -1.1], [5.1, -0.1, -2.3], [0.86, 0.06, -2.8]]),
    canardFar: L([[-0.7, 0.34, 3.5], [-2.2, 0.28, 2.7], [-2.2, 0.28, 2.2], [-0.7, 0.34, 2.5]]),
    canardNear: L([[0.7, 0.34, 3.5], [2.2, 0.28, 2.7], [2.2, 0.28, 2.2], [0.7, 0.34, 2.5]]),
    canopy: L([[-0.46, 0.55, 2.5], [0.46, 0.55, 2.5], [0.34, 1.0, 1.3], [-0.34, 1.0, 1.3]]),
    canopySide: L([[-0.46, 0.55, 2.5], [-0.48, 0.58, 0.3], [-0.36, 0.96, 0.5], [-0.34, 1.0, 1.3]]),
    intake: L([[-0.78, 0.3, 1.7], [-0.42, 0.3, 1.7], [-0.42, 0.16, 0.3], [-0.78, 0.16, 0.3]]),
    probe: L([[-0.1, 0.34, 6.2], [0.1, 0.34, 6.2], [0.1, 0.34, 7.0], [-0.1, 0.34, 7.0]]),
    tail: L([[-1.75, 0.28, -4.9], [1.75, 0.28, -4.9], [1.75, 0.28, -5.6], [-1.75, 0.28, -5.6]]),
    finFar: L([[-0.28, 0.4, -4.2], [-1.25, 2.3, -5.4], [-1.1, 2.35, -5.9], [-0.18, 0.45, -5.7]]),
    finNear: L([[0.28, 0.4, -4.2], [1.25, 2.3, -5.4], [1.1, 2.35, -5.9], [0.18, 0.45, -5.7]]),
    stripe: L([[-0.9, 0.13, -1.7], [-0.9, 0.13, -2.2], [-5.05, -0.09, -2.2], [-5.05, -0.09, -1.4]]),
    navLeft: L([[-5.08, -0.05, -1.2], [-5.08, -0.05, -1.6], [-5.08, 0.06, -1.6], [-5.08, 0.06, -1.2]]),
    navRight: L([[5.08, -0.05, -1.2], [5.08, -0.05, -1.6], [5.08, 0.06, -1.6], [5.08, 0.06, -1.2]]),
    beacon: L([[-0.12, 2.36, -5.5], [0.12, 2.36, -5.5], [0.12, 2.5, -5.5], [-0.12, 2.5, -5.5]]),
    gearFront: L([[-0.07, -0.5, 2.9], [0.07, -0.5, 2.9], [0.07, -1.35, 2.9], [-0.07, -1.35, 2.9]]),
    gearLeft: L([[-1.0, -0.45, -1.3], [-0.86, -0.45, -1.3], [-0.86, -1.3, -1.3], [-1.0, -1.3, -1.3]]),
    gearRight: L([[0.86, -0.45, -1.3], [1.0, -0.45, -1.3], [1.0, -1.3, -1.3], [0.86, -1.3, -1.3]]),
    tyreFront: L([[-0.17, -1.22, 3.12], [0.17, -1.22, 3.12], [0.17, -1.48, 3.12], [-0.17, -1.48, 3.12]]),
    tyreLeft: L([[-1.12, -1.18, -1.0], [-0.74, -1.18, -1.0], [-0.74, -1.44, -1.0], [-1.12, -1.44, -1.0]]),
    tyreRight: L([[0.74, -1.18, -1.0], [1.12, -1.18, -1.0], [1.12, -1.44, -1.0], [0.74, -1.44, -1.0]]),
    muzzles: [W(-1.55, -0.3, 1.2), W(1.55, -0.3, 1.2)],
  };
  if (!gear) {
    parts.gearFront = [];
    parts.gearLeft = [];
    parts.gearRight = [];
    parts.tyreFront = [];
    parts.tyreLeft = [];
    parts.tyreRight = [];
  }
  return parts;
}

/** A smoke puff or a debris chip, drawn in the world by the shared camera. */
export function drawPuff(painter, cam, puff) {
  const { ctx } = painter;
  const p = project(cam, puff.position);
  if (!p) return;
  const r = Math.max(0.8, puff.radius * p.k);
  const life = Math.min(1, puff.life);
  if (puff.smoke) {
    ctx.fillStyle = `rgba(118,112,106,${0.32 * life})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(64,60,58,${0.3 * life})`;
    ctx.beginPath();
    ctx.arc(p.x + r * 0.2, p.y + r * 0.15, r * 0.66, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = `rgba(206,192,164,${0.42 * life})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawDebris(painter, cam, piece) {
  const { ctx } = painter;
  const p = project(cam, piece.position);
  if (!p) return;
  const r = Math.max(0.9, piece.size * p.k);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(piece.spin);
  ctx.fillStyle = piece.warm ? `rgba(255,${150 + Math.round(70 * Math.abs(Math.sin(piece.spin)))},74,${Math.min(1, piece.life)})` : `rgba(46,46,50,${Math.min(1, piece.life)})`;
  ctx.fillRect(-r, -r * 0.4, r * 2, r * 0.8);
  ctx.restore();
}

export { aircraftAxes as axesOf };
