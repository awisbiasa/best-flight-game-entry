// Deterministic pseudo-randomness: a seeded generator and tileable value noise. Nothing in the game
// ever calls Math.random(), so the same seed always builds the same terrain, the same canyon and the
// same cloud deck, and two runs of the entry write identical bytes.

/** mulberry32: a small, fast 32-bit generator returning floats in [0, 1). */
export function createRandom(seed) {
  let state = seed >>> 0;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range(low, high) {
      return low + (high - low) * next();
    },
    int(low, high) {
      return low + Math.floor(next() * (high - low + 1));
    },
    pick(items) {
      return items[Math.min(items.length - 1, Math.floor(next() * items.length))];
    },
  };
}

/** A hash of two integers to [0, 1): the lattice value noise is built on. */
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothStep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Tileable value noise on a lattice of `period` cells that repeats every `period` cells in both
 * axes, so a texture built from it wraps without a seam. Coordinates are in cells.
 */
export function tileNoise(x, z, period, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smoothStep(x - x0);
  const fz = smoothStep(z - z0);
  const xa = ((x0 % period) + period) % period;
  const za = ((z0 % period) + period) % period;
  const xb = (xa + 1) % period;
  const zb = (za + 1) % period;
  const v00 = hash2(xa, za, seed);
  const v10 = hash2(xb, za, seed);
  const v01 = hash2(xa, zb, seed);
  const v11 = hash2(xb, zb, seed);
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fz;
}

/** Fractal value noise: `octaves` layers of tileable noise at doubling frequency and halving weight. */
export function fbm(x, z, period, octaves, seed) {
  let sum = 0;
  let weight = 1;
  let total = 0;
  let p = period;
  let f = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += weight * tileNoise(x * f, z * f, p, seed + i * 101);
    total += weight;
    weight *= 0.5;
    f *= 2;
    p *= 2;
  }
  return sum / total;
}

/** A stable pseudo-random direction for an integer index, used for debris and cloud placement. */
export function directionFromIndex(index, salt) {
  const r = createRandom((index * 2654435761 + salt * 40503) >>> 0);
  return r.next();
}
