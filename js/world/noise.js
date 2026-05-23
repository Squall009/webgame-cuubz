/**
 * Cuubz — Noise Functions
 * Perlin/Simplex noise with seed support for terrain, biome, and cave generation.
 */

class NoiseGenerator {
  constructor(seed = 0) {
    this.seed = seed;
    this.perm = this._buildPermutation(seed);
  }

  /**
   * Build permutation table from seed
   */
  _buildPermutation(seed) {
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    
    // Fisher-Yates shuffle with proper LCG (non-zero additive constant)
    let s = seed || 1; // Ensure s is never 0
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 12345) % 2147483647;
      const j = ((s % (i + 1)) + (i + 1)) % (i + 1); // Handle negative modulo
      [p[i], p[j]] = [p[j], p[i]];
    }
    
    // Double for seamless wrapping
    const perm = new Array(512);
    for (let i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
    }
    return perm;
  }

  /**
   * Fade function for smooth interpolation
   */
  _fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /**
   * Linear interpolation
   */
  _lerp(a, b, t) {
    return a + t * (b - a);
  }

  /**
   * Gradient function for Perlin noise
   */
  _grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  /**
   * 3D Perlin noise — returns value between -1 and 1
   */
  perlin3(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    
    const u = this._fade(x);
    const v = this._fade(y);
    const w = this._fade(z);
    
    const p = this.perm;
    
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    
    return this._lerp(
      this._lerp(
        this._lerp(this._grad(p[AA], x, y, z), this._grad(p[BA], x - 1, y, z), u),
        this._lerp(this._grad(p[AB], x, y - 1, z), this._grad(p[BB], x - 1, y - 1, z), u),
        v
      ),
      this._lerp(
        this._lerp(this._grad(p[AA + 1], x, y, z - 1), this._grad(p[BA + 1], x - 1, y, z - 1), u),
        this._lerp(this._grad(p[AB + 1], x, y - 1, z - 1), this._grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  /**
   * 2D Perlin noise — returns value between -1 and 1
   */
  perlin2(x, y) {
    return this.perlin3(x, y, 0);
  }

  /**
   * Multi-octave noise for terrain detail
   * @param {number} x 
   * @param {number} y 
   * @param {number} octaves - Number of noise layers (default: 4)
   * @param {number} persistence - Amplitude reduction per octave (default: 0.5)
   * @returns {number} Normalized value between -1 and 1
   */
  octaveNoise2(x, y, octaves = 4, persistence = 0.5) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmplitude = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.perlin2(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }

    return total / maxAmplitude;
  }

  /**
   * Multi-octave 3D noise
   */
  octaveNoise3(x, y, z, octaves = 4, persistence = 0.5) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmplitude = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.perlin3(x * frequency, y * frequency, z * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }

    return total / maxAmplitude;
  }

  /**
   * Ridge noise — creates mountain ridges and cave systems
   * Inverts and takes absolute value of noise to create ridge-like patterns
   */
  ridgeNoise(x, y, z, octaves = 4, persistence = 0.5) {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmplitude = 0;

    for (let i = 0; i < octaves; i++) {
      let value = this.perlin3(x * frequency, y * frequency, z * frequency);
      value = Math.abs(value);
      value = 1 - value; // Invert to create ridges
      value = value * value; // Sharpen ridges
      
      total += value * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }

    return total / maxAmplitude;
  }

  /**
   * Get normalized noise value (0 to 1)
   */
  normalized(x, y, z) {
    return (this.perlin3(x, y, z) + 1) / 2;
  }
}

module.exports = NoiseGenerator;
