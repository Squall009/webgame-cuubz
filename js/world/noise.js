/**
 * Cuubz — Noise Functions (VoxelGen Overhaul)
 * Ported from voxelgen.html — the source of truth for all generation algorithms.
 * 
 * Architecture: each call to createPerlin() gets its own independent permutation table.
 * No shared state between instances. Use createSharedPerlin(seed) to get all 9 named
 * instances at once (continentalness, erosion, temperature, humidity, detail, cave1, cave2, river, jitter).
 */

// ── Mulberry32 PRNG ────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s |= 0;
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── String → uint32 hash (FNV-1a) ─────────────────────────────────
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── Perlin noise factory (returns independent instance) ────────────
function createPerlin(seed) {
  const rng = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function grad3(h, x, y, z) {
    h &= 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  function noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, aa = perm[a], ab = perm[a + 1];
    const b = perm[X + 1] + Y, ba = perm[b], bb = perm[b + 1];
    return lerp(lerp(grad3(perm[aa], x, y, 0), grad3(perm[ba], x - 1, y, 0), u),
                lerp(grad3(perm[ab], x, y - 1, 0), grad3(perm[bb], x - 1, y - 1, 0), u), v);
  }

  function noise3(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(lerp(lerp(grad3(perm[AA], x, y, z), grad3(perm[BA], x - 1, y, z), u),
                     lerp(grad3(perm[AB], x, y - 1, z), grad3(perm[BB], x - 1, y - 1, z), u), v),
                lerp(lerp(grad3(perm[AA + 1], x, y, z - 1), grad3(perm[BA + 1], x - 1, y, z - 1), u),
                     lerp(grad3(perm[AB + 1], x, y - 1, z - 1), grad3(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }

  return { noise2, noise3 };
}

// ── FBM (Fractal Brownian Motion) — 2D multi-octave ───────────────
function fbm2(perlin, x, y, octaves, persistence, lacunarity) {
  let val = 0, amp = 1, freq = 1, maxV = 0;
  for (let i = 0; i < octaves; i++) {
    val += perlin.noise2(x * freq, y * freq) * amp;
    maxV += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return val / maxV;
}

// ── Spline interpolation through control points ────────────────────
function applySpline(val, points) {
  if (val <= points[0][0]) return points[0][1];
  if (val >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 0; i < points.length - 1; i++) {
    if (val < points[i + 1][0]) {
      const t = (val - points[i][0]) / (points[i + 1][0] - points[i][0]);
      return points[i][1] + (points[i + 1][1] - points[i][1]) * t;
    }
  }
}

// ── Create all named Perlin instances for a world seed ─────────────
function createSharedPerlin(seed) {
  const sInt = hashString(String(seed));
  return {
    cont:   createPerlin(sInt ^ 0x1111),
    eros:   createPerlin(sInt ^ 0x2222),
    temp:   createPerlin(sInt ^ 0x3333),
    hum:    createPerlin(sInt ^ 0x4444),
    det:    createPerlin(sInt ^ 0x5555),
    c1:     createPerlin(sInt ^ 0x6666),
    c2:     createPerlin(sInt ^ 0x7777),
    river:  createPerlin(sInt ^ 0x8888),
    jitter: createPerlin(sInt ^ 0xBBBB)
  };
}

// ── Deterministic hash for feature placement (non-spatial) ─────────
function hash(x, y, seed = 0) {
  let h = ((x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0)) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  h = ((h ^ (h >>> 16)) >>> 0);
  return h / 4294967296;
}

// ── Seeded PRNG for decoration placement ───────────────────────────
function createPRNG(subSeed, seed = 0) {
  let s = ((subSeed || 0) * 16807 + seed + 12345) % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// ── Backwards-compatible NoiseGenerator class ──────────────────────
// Used by featurePlacer.js and any code that still references the old API.
class NoiseGenerator {
  constructor(seed = 0) {
    this.seed = typeof seed === 'string' ? hashString(seed) : (Number(seed) || 0);
    this._perlin = createPerlin(this.seed ^ 0xAAAA);
  }

  perlin2(x, y) { return this._perlin.noise2(x, y); }
  perlin3(x, y, z) { return this._perlin.noise3(x, y, z); }

  octaveNoise2(x, y, octaves = 4, persistence = 0.5) {
    let total = 0, amplitude = 1, frequency = 1, maxAmplitude = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.perlin2(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude; amplitude *= persistence; frequency *= 2;
    }
    return total / maxAmplitude;
  }

  octaveNoise3(x, y, z, octaves = 4, persistence = 0.5) {
    let total = 0, amplitude = 1, frequency = 1, maxAmplitude = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.perlin3(x * frequency, y * frequency, z * frequency) * amplitude;
      maxAmplitude += amplitude; amplitude *= persistence; frequency *= 2;
    }
    return total / maxAmplitude;
  }

  ridgeNoise(x, y, z, octaves = 4, persistence = 0.5) {
    let total = 0, amplitude = 1, frequency = 1, maxAmplitude = 0;
    for (let i = 0; i < octaves; i++) {
      let value = this.perlin3(x * frequency, y * frequency, z * frequency);
      value = Math.abs(value); value = 1 - value; value = value * value;
      total += value * amplitude; maxAmplitude += amplitude;
      amplitude *= persistence; frequency *= 2;
    }
    return total / maxAmplitude;
  }

  normalized(x, y, z) { return (this.perlin3(x, y, z) + 1) / 2; }

  hash(x, y) { return hash(x, y, this.seed); }
  createPRNG(subSeed) { return createPRNG(subSeed, this.seed); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mulberry32, hashString, createPerlin, fbm2, applySpline, createSharedPerlin, hash, createPRNG, NoiseGenerator };
}
