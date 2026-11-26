// The floor of the world: canyon walls, a river gorge, a runway west of the base and two airfields.
// Everything is a pure function of the asked position and nowhere stateful, so the flight model,
// the renderer and the mission scripts all see the same terrain, and the same seed always builds
// the same valley. The terrain curve is the valley's spine: it starts at the home base, bends east
// through the first gorge, doubles back through a narrow pass and empties onto a plateau at the far
// end, where the target range lives.

import { DEG, clamp, smooth } from './mathkit.js';
import { fbm } from './noise.js';

/** How far 1 unit is: about 1 metre, so the aircraft flies 33 m a second at cruise. */
export const UNIT = 1;

/** Control points of the valley spine: [x, z, halfWidth of the floor, floor height, wall height]. */
const SPINE = [
  [0, -520, 150, 40, 110],
  [40, -150, 150, 40, 150],
  [260, 240, 120, 34, 220],
  [760, 520, 96, 30, 260],
  [1180, 620, 70, 26, 280],
  [1440, 360, 78, 24, 240],
  [1520, -40, 110, 22, 170],
  [1290, -380, 150, 18, 120],
  [980, -560, 190, 16, 90],
];

/** The home base: a runway on the valley floor by the first spine point. */
export const BASE = {
  name: 'FERNHOLLOW',
  elevation: 40,
  runway: { x: 0, z: -520, heading: 4 * DEG, length: 520, width: 34 },
  tower: { x: -96, z: -640 },
  hangars: 3,
  /** Where the aircraft is parked for the opening frame: on the tar, short of the threshold. */
  parking: { along: -330, across: -12 },
};

/** The target range at the valley's far end: a hulk parked on a hardpan pan inside the last bend. */
export const RANGE = { x: 820, z: -470, radius: 260, height: 0 };

/** Where the props on the ground sit: the heights are filled in once the terrain functions exist. */
export const STRIP = { name: 'GREY PEAK', x: 1000, z: -566, heading: 88 * DEG, length: 300, width: 22, height: 0 };
export const PASS = { x: 760, z: 520, height: 0 };

/** The river runs the whole length of the valley floor, a few metres below the floor height. */
export const RIVER_DEPTH = 4;

function spinePointAt(t) {
  const n = SPINE.length - 1;
  const f = clamp(t, 0, 0.9999) * n;
  const i = Math.floor(f);
  const a = SPINE[i];
  const b = SPINE[Math.min(n, i + 1)];
  // Catmull-Rom through the neighbouring points so the bend at the joints is smooth.
  const p0 = SPINE[Math.max(0, i - 1)];
  const p3 = SPINE[Math.min(n, i + 2)];
  const t2 = f - i;
  const t3 = t2 * t2;
  const t4 = t3 * t2;
  function cr(v0, v1, v2, v3) {
    return 0.5 * (2 * v1 + (-v0 + v2) * t2 + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t3 + (-v0 + 3 * v1 - 3 * v2 + v3) * t4);
  }
  return {
    x: cr(p0[0], a[0], b[0], p3[0]),
    z: cr(p0[1], a[1], b[1], p3[1]),
    halfWidth: cr(p0[2], a[2], b[2], p3[2]),
    floor: cr(p0[3], a[3], b[3], p3[3]),
    wall: cr(p0[4], a[4], b[4], p3[4]),
  };
}

/** The distance from a point to the nearest point of the valley spine, and that point's parameters. */
export function nearestSpine(x, z) {
  let bestD = Infinity;
  let bestT = 0;
  let best = spinePointAt(0);
  const steps = 96;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p = spinePointAt(t);
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bestD) {
      bestD = d;
      bestT = t;
      best = p;
    }
  }
  // A short refinement pass: narrowing the bracket to a hundredth of a segment.
  let lo = Math.max(0, bestT - 1 / steps);
  let hi = Math.min(1, bestT + 1 / steps);
  for (let i = 0; i < 12; i += 1) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const p1 = spinePointAt(m1);
    const p2 = spinePointAt(m2);
    if (Math.hypot(x - p1.x, z - p1.z) < Math.hypot(x - p2.x, z - p2.z)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const p = spinePointAt(t);
  return { distance: Math.hypot(x - p.x, z - p.z), t, point: p };
}

/** Rotate a local offset (along, across) by a heading, to world offsets (x, z). */
export function alongHeading(heading, along, across) {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return { x: along * sin + across * cos, z: along * cos - across * sin };
}

/**
 * Height of the ground at (x, z). Inside the valley the floor is the spine's floor height plus
 * gentle noise; outside it the walls climb steeply to a rounded ridge, then break into rolling
 * high country. The runway pan and the range pan are flattened so a landing reads true.
 */
export function terrainHeight(x, z) {
  const near = nearestSpine(x, z);
  const { point, distance } = near;
  const width = point.halfWidth;
  const fromSpine = distance - width;
  const ridge = point.wall;
  // The wall rises over twice the half-width and rounds off.
  const climb = fromSpine <= 0 ? 0 : smooth(0, 1, clamp(fromSpine / (width * 2.2), 0, 1));
  let elevated = point.floor + point.wall * climb * climb;
  const outside = Math.max(0, fromSpine);
  // Rolling high country beyond the ridge, so the walls read as a plateau rather than a tube.
  const highland = fbm((x + 4000) / 900, (z + 4000) / 900, 16, 4, 7) * 120;
  elevated += clamp(outside / (width * 3), 0, 1) * highland;
  // Fine grain on the floor and slopes: a few boulders and hummocks that never reaches the ridge.
  const grain = (fbm((x + 4000) / 60, (z + 4000) / 60, 64, 3, 31) - 0.5) * (6 + 22 * clamp(outside / width, 0, 1));
  elevated += grain * (1 - clamp(climb, 0, 1));
  // The river: the lowest band of the valley floor is cut into a gorge a few metres deep.
  if (fromSpine < -width * 0.62) {
    const centre = clamp((-fromSpine - width * 0.62) / (width * 0.38), 0, 1);
    elevated -= RIVER_DEPTH * smooth(0, 1, centre);
  }
  // The pass: a saddle where the ridge dips on the east side, so the valley reads as reachable.
  const passD = Math.hypot(x - PASS.x, z - PASS.z);
  if (passD < 300) {
    const dip = 1 - smooth(0, 1, passD / 300);
    const psp = nearestSpine(PASS.x, PASS.z).point;
    const saddle = psp.floor + 34;
    const blendPass = clamp(outside / (width * 0.15), 0, 1);
    elevated += (saddle - elevated) * dip * blendPass * 0.85;
  }
  // Flat pans that the missions need: the home runway is a mesa of its own, hardpan smooth.
  const rw = BASE.runway;
  const toRunway = (() => {
    const off = alongHeading(rw.heading, x - rw.x, z - rw.z);
    return Math.max(Math.abs(off.x) - rw.length / 2, Math.abs(off.z) - rw.width / 2 - 40);
  })();
  const runwayBlend = 1 - smooth(0, 1, clamp(toRunway / 120, 0, 1));
  elevated += (BASE.elevation - elevated) * runwayBlend;
  // The range: a flat hardpan pan around the target hulk, sitting on the last plateau.
  const rangeD = Math.hypot(x - RANGE.x, z - RANGE.z);
  const rangeBlend = 1 - smooth(0, 1, clamp((rangeD - RANGE.radius) / 80, 0, 1));
  elevated += ((point.floor + 6) - elevated) * rangeBlend;
  // The dirt strip on the plateau, likewise flat.
  const stripD = Math.hypot(x - STRIP.x, z - STRIP.z);
  const stripBlend = 1 - smooth(0, 1, clamp((stripD - 240) / 60, 0, 1));
  const stripBase = nearestSpine(STRIP.x, STRIP.z).point.floor + 2;
  elevated += (stripBase - elevated) * stripBlend;
  return elevated;
}

/** Ground gradient by central difference: the slope a plane would see beneath it. */
export function terrainSlope(x, z) {
  const e = 6;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

/** The valley spine sampled for the mission scripts (ring placement, autopilot waypoints). */
export function spineAt(t) {
  return spinePointAt(t);
}

/** Where the spine has the most room for gates: a list of [t, x, y, z] gate anchors. */
export function gateLine(count) {
  const gates = [];
  for (let i = 0; i < count; i += 1) {
    const t = 0.045 + (i / Math.max(1, count - 1)) * 0.78;
    const p = spineAt(t);
    gates.push({ t, x: p.x, y: p.floor + 46 + Math.sin(i * 1.7) * 10, z: p.z, halfWidth: p.halfWidth });
  }
  return gates;
}

/**
 * Fill in the props' ground heights once, at load: the range pan's hardpan, the dirt strip on the
 * plateau and the pass cairn. Everything downstream reads the heights from these objects.
 */
RANGE.height = terrainHeight(RANGE.x, RANGE.z);
STRIP.height = terrainHeight(STRIP.x, STRIP.z);
PASS.height = terrainHeight(PASS.x, PASS.z);
