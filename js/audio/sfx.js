/**
 * Cuubz — Procedural Sound Effects Engine
 * Web Audio API for procedural SFX: block break/place, footsteps, jump/land,
 * damage flash, UI sounds, eating/drinking. All generated at runtime with no external files.
 */

// ============================================================
// Constants & Configuration
// ============================================================

/** Sound categories */
const SFX_CATEGORY = {
  BLOCK_BREAK: 'block_break',
  BLOCK_PLACE: 'block_place',
  FOOTSTEP:    'footstep',
  JUMP:        'jump',
  LAND:        'land',
  DAMAGE:      'damage',
  UI_CLICK:    'ui_click',
  UI_HOVER:    'ui_hover',
  EATING:      'eating',
  DRINKING:    'drinking',
};

/** Block material types for break/place sound variation */
const BLOCK_MATERIALS = {
  GRASS:     'grass',
  DIRT:      'dirt',
  STONE:     'stone',
  SAND:      'sand',
  GRAVEL:    'gravel',
  WOOD:      'wood',
  LEAVES:    'leaves',
  SNOW:      'snow',
  ICE:       'ice',
  BEDROCK:   'bedrock',
  OBSIDIAN:  'obsidian',
  WATER:     'water',
  LAVA:      'lava',
  METAL:     'metal',    // ores, tools
  PLANKS:    'planks',
  GLASS:     'glass',    // ice, transparent blocks
  CORRUPT:   'corrupt',  // corrupt stone, crystals, toxic slime
};

/** Sound parameters per material — testable configuration */
const MATERIAL_SOUND_PARAMS = {
  [BLOCK_MATERIALS.GRASS]:   { freq: 180, noiseRatio: 0.7, duration: 0.08, volume: 0.25 },
  [BLOCK_MATERIALS.DIRT]:    { freq: 160, noiseRatio: 0.8, duration: 0.09, volume: 0.25 },
  [BLOCK_MATERIALS.STONE]:   { freq: 440, noiseRatio: 0.3, duration: 0.12, volume: 0.3 },
  [BLOCK_MATERIALS.SAND]:    { freq: 120, noiseRatio: 0.9, duration: 0.06, volume: 0.15 },
  [BLOCK_MATERIALS.GRAVEL]:  { freq: 200, noiseRatio: 0.8, duration: 0.10, volume: 0.25 },
  [BLOCK_MATERIALS.WOOD]:    { freq: 300, noiseRatio: 0.4, duration: 0.10, volume: 0.25 },
  [BLOCK_MATERIALS.LEAVES]:  { freq: 100, noiseRatio: 0.9, duration: 0.06, volume: 0.12 },
  [BLOCK_MATERIALS.SNOW]:    { freq: 80,  noiseRatio: 0.95, duration: 0.07, volume: 0.1 },
  [BLOCK_MATERIALS.ICE]:     { freq: 600, noiseRatio: 0.2, duration: 0.15, volume: 0.3 },
  [BLOCK_MATERIALS.BEDROCK]: { freq: 80,  noiseRatio: 0.3, duration: 0.20, volume: 0.4 },
  [BLOCK_MATERIALS.OBSIDIAN]:{ freq: 150, noiseRatio: 0.2, duration: 0.18, volume: 0.35 },
  [BLOCK_MATERIALS.WATER]:   { freq: 250, noiseRatio: 0.6, duration: 0.10, volume: 0.15 },
  [BLOCK_MATERIALS.LAVA]:    { freq: 80,  noiseRatio: 0.5, duration: 0.25, volume: 0.3 },
  [BLOCK_MATERIALS.METAL]:   { freq: 800, noiseRatio: 0.1, duration: 0.14, volume: 0.3 },
  [BLOCK_MATERIALS.PLANKS]:  { freq: 280, noiseRatio: 0.45, duration: 0.09, volume: 0.22 },
  [BLOCK_MATERIALS.GLASS]:   { freq: 700, noiseRatio: 0.15, duration: 0.16, volume: 0.35 },
  [BLOCK_MATERIALS.CORRUPT]: { freq: 200, noiseRatio: 0.5, duration: 0.18, volume: 0.28 },
};

/** Biome surface types for footstep sounds */
const FOOTSTEP_SURFACES = {
  GRASS:  'grass',
  DIRT:   'dirt',
  SAND:   'sand',
  SNOW:   'snow',
  ICE:    'ice',
  STONE:  'stone',
  WOOD:   'wood',       // planks, wood floor
  WATER:  'water',      // wading through water
  LEAVES: 'leaves',
};

const FOOTSTEP_PARAMS = {
  [FOOTSTEP_SURFACES.GRASS]:  { freq: 140, noiseRatio: 0.8, duration: 0.06, volume: 0.12 },
  [FOOTSTEP_SURFACES.DIRT]:   { freq: 130, noiseRatio: 0.85, duration: 0.07, volume: 0.12 },
  [FOOTSTEP_SURFACES.SAND]:   { freq: 100, noiseRatio: 0.95, duration: 0.05, volume: 0.08 },
  [FOOTSTEP_SURFACES.SNOW]:   { freq: 90,  noiseRatio: 0.95, duration: 0.06, volume: 0.07 },
  [FOOTSTEP_SURFACES.ICE]:    { freq: 500, noiseRatio: 0.3, duration: 0.08, volume: 0.15 },
  [FOOTSTEP_SURFACES.STONE]:  { freq: 250, noiseRatio: 0.4, duration: 0.07, volume: 0.15 },
  [FOOTSTEP_SURFACES.WOOD]:   { freq: 220, noiseRatio: 0.5, duration: 0.06, volume: 0.12 },
  [FOOTSTEP_SURFACES.WATER]:  { freq: 180, noiseRatio: 0.7, duration: 0.08, volume: 0.1 },
  [FOOTSTEP_SURFACES.LEAVES]: { freq: 110, noiseRatio: 0.9, duration: 0.05, volume: 0.06 },
};

/** Special effect sound parameters */
const SPECIAL_SFX_PARAMS = {
  JUMP:     { freq: 300, targetFreq: 600, duration: 0.12, volume: 0.2, type: 'sweep' },
  LAND:     { freq: 100, noiseRatio: 0.7, duration: 0.15, volume: 0.3 },
  DAMAGE:   { freq: 150, targetFreq: 50, duration: 0.25, volume: 0.4, type: 'sweep' },
  UI_CLICK: { freq: 800, duration: 0.04, volume: 0.15 },
  UI_HOVER: { freq: 600, duration: 0.02, volume: 0.08 },
  EATING:   { freq: 200, noiseRatio: 0.6, duration: 0.06, volume: 0.15 },
  DRINKING: { freq: 300, noiseRatio: 0.4, duration: 0.08, volume: 0.12 },
};

/** Master volume settings (0-1) */
const DEFAULT_VOLUME = {
  master:    0.7,
  sfx:       0.6,
  perSound:  {}, // individual sound overrides
};

// ============================================================
// Pure Utility Functions (testable without AudioContext)
// ============================================================

/**
 * Get sound parameters for a block material.
 * Returns params object or defaults if material unknown.
 */
function getMaterialParams(material, isPlace) {
  const base = MATERIAL_SOUND_PARAMS[material] || MATERIAL_SOUND_PARAMS[BLOCK_MATERIALS.STONE];
  const params = { ...base };

  // Place sounds are slightly higher pitch and shorter
  if (isPlace) {
    params.freq = Math.round(params.freq * 1.2);
    params.duration *= 0.8;
    params.volume *= 0.9;
  }

  return params;
}

/**
 * Get footstep parameters for a surface type.
 */
function getFootstepParams(surface) {
  return FOOTSTEP_PARAMS[surface] || FOOTSTEP_PARAMS[FOOTSTEP_SURFACES.DIRT];
}

/**
 * Get special SFX parameters by name.
 */
function getSpecialSfxParams(name) {
  return SPECIAL_SFX_PARAMS[name] || null;
}

/**
 * Calculate effective volume with master + category multipliers.
 */
function calculateVolume(soundVolume, masterVolume, categoryVolume) {
  const m = Math.max(0, Math.min(1, masterVolume ?? DEFAULT_VOLUME.master));
  const c = Math.max(0, Math.min(1, categoryVolume ?? DEFAULT_VOLUME.sfx));
  return Math.max(0, Math.min(1, soundVolume * m * c));
}

/**
 * Map a block type ID to its material for sound lookup.
 */
function blockIdToMaterial(blockTypeId) {
  const mapping = {
    1: BLOCK_MATERIALS.GRASS,     // Grass
    2: BLOCK_MATERIALS.DIRT,      // Dirt
    3: BLOCK_MATERIALS.STONE,     // Stone
    4: BLOCK_MATERIALS.SAND,      // Sand
    5: BLOCK_MATERIALS.GRAVEL,    // Gravel
    6: BLOCK_MATERIALS.WATER,     // Water
    7: BLOCK_MATERIALS.WOOD,      // Wood Log
    8: BLOCK_MATERIALS.LEAVES,    // Leaves
    9: BLOCK_MATERIALS.SNOW,      // Snow
    10: BLOCK_MATERIALS.ICE,      // Ice
    11: BLOCK_MATERIALS.BEDROCK,  // Bedrock
    12: BLOCK_MATERIALS.PLANKS,   // Planks
    13: BLOCK_MATERIALS.OBSIDIAN, // Obsidian
    14: BLOCK_MATERIALS.STONE,    // Blackstone (stone-like)
    15: BLOCK_MATERIALS.LAVA,     // Lava
    16: BLOCK_MATERIALS.CORRUPT,  // Corrupt Stone
    17: BLOCK_MATERIALS.CORRUPT,  // Toxic Slime
    18: BLOCK_MATERIALS.METAL,    // Coal Ore
    19: BLOCK_MATERIALS.METAL,    // Iron Ore
    20: BLOCK_MATERIALS.METAL,    // Gold Ore
    21: BLOCK_MATERIALS.METAL,    // Diamond Ore
    22: BLOCK_MATERIALS.CORRUPT,  // Corrupt Crystal
    23: BLOCK_MATERIALS.WOOD,     // Bed (wood-like)
    24: BLOCK_MATERIALS.GRASS,    // Apple (organic)
    25: BLOCK_MATERIALS.METAL,    // Quest Key
    26: BLOCK_MATERIALS.STONE,    // Boss Spawn (invisible stone)
  };
  return mapping[blockTypeId] || BLOCK_MATERIALS.STONE;
}

/**
 * Map biome name to footstep surface.
 */
function biomeToFootstepSurface(biomeName) {
  const mapping = {
    plains:  FOOTSTEP_SURFACES.GRASS,
    forest:  FOOTSTEP_SURFACES.GRASS,
    desert:  FOOTSTEP_SURFACES.SAND,
    tundra:  FOOTSTEP_SURFACES.SNOW,
    mountains: FOOTSTEP_SURFACES.STONE,
    ocean:   FOOTSTEP_SURFACES.WATER,
    lava:    FOOTSTEP_SURFACES.STONE, // obsidian/blackstone surface
    corrupt: FOOTSTEP_SURFACES.STONE,
  };
  return mapping[biomeName] || FOOTSTEP_SURFACES.DIRT;
}

// ============================================================
// Noise Buffer Generator (pure function — testable)
// ============================================================

/**
 * Generate white noise samples. Pure function — no AudioContext needed.
 * @param {number} sampleCount - Number of samples to generate
 * @param {number} seed - Random seed for deterministic noise
 * @returns {Float32Array} Noise samples in range [-1, 1]
 */
function generateNoiseBuffer(sampleCount, seed) {
  const buffer = new Float32Array(sampleCount);
  // Simple LCG PRNG seeded
  let s = (seed || Date.now()) | 0;
  if (s === 0) s = 1;
  for (let i = 0; i < sampleCount; i++) {
    s = (s * 16807 + 12345) % 2147483647;
    buffer[i] = ((s / 2147483647) * 2) - 1; // [-1, 1]
  }
  return buffer;
}

/**
 * Calculate RMS (root mean square) of a Float32Array.
 */
function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Calculate min/max of a Float32Array.
 */
function sampleRange(samples) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] < min) min = samples[i];
    if (samples[i] > max) max = samples[i];
  }
  return { min, max };
}

// ============================================================
// SoundManager Class — Browser Audio Playback
// ============================================================

/**
 * Manages Web Audio API context and plays procedural sound effects.
 * Designed for browser use with Web Audio API.
 * Core logic (params, mapping) is testable without real audio hardware.
 */
class SoundManager {
  constructor(options = {}) {
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.volume = { ...DEFAULT_VOLUME };
    this.enabled = options.enabled !== false;
    this._activeSounds = new Map(); // track active oscillators for cleanup
    this._initialized = false;

    // Per-category volume overrides
    if (options.volume) {
      Object.assign(this.volume, options.volume);
    }
  }

  /**
   * Initialize the AudioContext. Must be called after user gesture in browsers.
   * @returns {boolean} Whether initialization succeeded
   */
  init() {
    if (this._initialized) return true;
    if (!this.enabled) return false;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume.master;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.volume.sfx;
      this.sfxGain.connect(this.masterGain);

      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      this._initialized = true;
      return true;
    } catch (e) {
      console.warn('SoundManager init failed:', e.message);
      return false;
    }
  }

  /**
   * Set master volume (0-1).
   */
  setMasterVolume(value) {
    this.volume.master = Math.max(0, Math.min(1, value));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume.master;
    }
  }

  /**
   * Set SFX category volume (0-1).
   */
  setSfxVolume(value) {
    this.volume.sfx = Math.max(0, Math.min(1, value));
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.volume.sfx;
    }
  }

  /**
   * Get effective volume for a sound.
   */
  getEffectiveVolume(soundVolume) {
    return calculateVolume(soundVolume, this.volume.master, this.volume.sfx);
  }

  /**
   * Play a block break sound.
   * @param {number|string} material - Block type ID or material name
   * @returns {boolean} Whether sound was played
   */
  playBlockBreak(material) {
    if (!this._initialized || !this.enabled) return false;
    const mat = typeof material === 'number' ? blockIdToMaterial(material) : material;
    const params = getMaterialParams(mat, false);
    const vol = this.getEffectiveVolume(params.volume);
    return this._playNoiseTone(params.freq, params.duration, vol, params.noiseRatio);
  }

  /**
   * Play a block place sound.
   */
  playBlockPlace(material) {
    if (!this._initialized || !this.enabled) return false;
    const mat = typeof material === 'number' ? blockIdToMaterial(material) : material;
    const params = getMaterialParams(mat, true);
    const vol = this.getEffectiveVolume(params.volume);
    return this._playNoiseTone(params.freq, params.duration, vol, params.noiseRatio);
  }

  /**
   * Play a footstep sound.
   * @param {string} surface - Surface type (or biome name)
   */
  playFootstep(surface) {
    if (!this._initialized || !this.enabled) return false;
    // Accept biome names directly
    const surf = FOOTSTEP_PARAMS[surface] ? surface : biomeToFootstepSurface(surface);
    const params = getFootstepParams(surf);
    const vol = this.getEffectiveVolume(params.volume * 0.7); // footsteps quieter
    return this._playNoiseTone(params.freq, params.duration, vol, params.noiseRatio);
  }

  /**
   * Play a jump sound (frequency sweep up).
   */
  playJump() {
    if (!this._initialized || !this.enabled) return false;
    const params = SPECIAL_SFX_PARAMS.JUMP;
    const vol = this.getEffectiveVolume(params.volume);
    return this._playSweep(params.freq, params.targetFreq, params.duration, vol);
  }

  /**
   * Play a land sound (impact noise).
   */
  playLand() {
    if (!this._initialized || !this.enabled) return false;
    const params = SPECIAL_SFX_PARAMS.LAND;
    const vol = this.getEffectiveVolume(params.volume);
    return this._playNoiseTone(params.freq, params.duration, vol, params.noiseRatio);
  }

  /**
   * Play a damage sound (harsh sweep down).
   */
  playDamage() {
    if (!this._initialized || !this.enabled) return false;
    const params = SPECIAL_SFX_PARAMS.DAMAGE;
    const vol = this.getEffectiveVolume(params.volume);
    return this._playSweep(params.freq, params.targetFreq, params.duration, vol);
  }

  /**
   * Play a UI click sound.
   */
  playUiClick() {
    if (!this._initialized || !this.enabled) return false;
    const params = SPECIAL_SFX_PARAMS.UI_CLICK;
    const vol = this.getEffectiveVolume(params.volume);
    return this._playTone(params.freq, params.duration, vol, 0.9);
  }

  /**
   * Play a UI hover sound.
   */
  playUiHover() {
    if (!this._initialized || !this.enabled) return false;
    const params = SPECIAL_SFX_PARAMS.UI_HOVER;
    const vol = this.getEffectiveVolume(params.volume);
    return this._playTone(params.freq, params.duration, vol, 0.8);
  }

  /**
   * Play an eating sound (crunch noise).
   */
  playEating() {
    if (!this._initialized || !this.enabled) return false;
    const params = SPECIAL_SFX_PARAMS.EATING;
    const vol = this.getEffectiveVolume(params.volume);
    return this._playNoiseTone(params.freq, params.duration, vol, params.noiseRatio);
  }

  /**
   * Play a drinking sound (liquid noise).
   */
  playDrinking() {
    if (!this._initialized || !this.enabled) return false;
    const params = SPECIAL_SFX_PARAMS.DRINKING;
    const vol = this.getEffectiveVolume(params.volume);
    return this._playNoiseTone(params.freq, params.duration, vol, params.noiseRatio);
  }

  // ----------------------------------------------------------
  // Internal audio synthesis methods
  // ----------------------------------------------------------

  /**
   * Play a noise-tone mix: oscillator + filtered white noise.
   */
  _playNoiseTone(freq, duration, volume, noiseRatio) {
    try {
      const now = this.ctx.currentTime;

      // Oscillator component (1 - noiseRatio)
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      const oscGain = this.ctx.createGain();
      oscGain.gain.setValueAtTime(volume * (1 - noiseRatio), now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(oscGain);
      oscGain.connect(this.sfxGain);

      // Noise component (noiseRatio)
      const bufferSize = this.ctx.sampleRate * duration;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = ((Math.random() * 2) - 1);
      }
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(freq * 2, now);
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(volume * noiseRatio, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.sfxGain);

      // Start and stop
      osc.start(now);
      osc.stop(now + duration + 0.01);
      noiseSource.start(now);
      noiseSource.stop(now + duration + 0.01);

      // Cleanup tracking
      const id = Math.random();
      this._activeSounds.set(id, { osc, noiseSource, end: now + duration });
      setTimeout(() => this._activeSounds.delete(id), (duration + 0.05) * 1000);

      return true;
    } catch (e) {
      console.warn('Sound playback error:', e.message);
      return false;
    }
  }

  /**
   * Play a pure tone with fast envelope.
   */
  _playTone(freq, duration, volume, attackRelease) {
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const gain = this.ctx.createGain();
      const envTime = duration * (1 - attackRelease);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(volume, now + envTime * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + duration + 0.01);

      return true;
    } catch (e) {
      console.warn('Sound playback error:', e.message);
      return false;
    }
  }

  /**
   * Play a frequency sweep (rising or falling).
   */
  _playSweep(fromFreq, toFreq, duration, volume) {
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(Math.max(20, fromFreq), now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), now + duration);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      // Low-pass filter to soften sawtooth
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.max(fromFreq, toFreq) * 2, now);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + duration + 0.01);

      return true;
    } catch (e) {
      console.warn('Sound playback error:', e.message);
      return false;
    }
  }

  /**
   * Stop all active sounds immediately.
   */
  stopAll() {
    if (!this.ctx) return;
    for (const [, sound] of this._activeSounds) {
      try {
        if (sound.osc) sound.osc.stop();
        if (sound.noiseSource) sound.noiseSource.stop();
      } catch (_) {}
    }
    this._activeSounds.clear();
  }

  /**
   * Dispose the audio context and clean up.
   */
  dispose() {
    this.stopAll();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this._initialized = false;
  }
}

// ============================================================
// Exports — everything for testing in Node.js
// ============================================================

module.exports = {
  // Constants
  SFX_CATEGORY,
  BLOCK_MATERIALS,
  MATERIAL_SOUND_PARAMS,
  FOOTSTEP_SURFACES,
  FOOTSTEP_PARAMS,
  SPECIAL_SFX_PARAMS,
  DEFAULT_VOLUME,

  // Pure utility functions (testable without AudioContext)
  getMaterialParams,
  getFootstepParams,
  getSpecialSfxParams,
  calculateVolume,
  blockIdToMaterial,
  biomeToFootstepSurface,

  // Noise generation (pure functions)
  generateNoiseBuffer,
  rms,
  sampleRange,

  // Browser class
  SoundManager,
};
