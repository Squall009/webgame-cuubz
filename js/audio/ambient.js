/**
 * Cuubz — Procedural Ambient Soundscapes Engine
 * Web Audio API for procedural calm ambient sound: biome-specific drone/chord progressions,
 * day/night volume variation, smooth cross-fading between biomes.
 * All generated at runtime with no external audio files.
 */

// ============================================================
// Constants & Configuration
// ============================================================

/** Musical note frequencies (Hz) — used for chord construction */
const NOTE_FREQS = {
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.00, A2: 110.00, Bb2: 116.54,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, Bb3: 233.08,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, Bb4: 466.16,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
};

/** Scale degree offsets from root (semitones) */
const SCALES = {
  majorPentatonic:   [0, 2, 4, 7, 9],       // 1, 2, 3, 5, 6
  minorPentatonic:   [0, 3, 5, 7, 10],      // 1, b3, 4, 5, b7
  majorTriad:        [0, 4, 7],              // 1, 3, 5
  minorTriad:        [0, 3, 7],              // 1, b3, 5
  diminished:        [0, 3, 6, 9],           // 1, b3, #4, 5 — tense
  wholeTone:         [0, 2, 4, 6, 8, 10],    // dreamy/ethereal
};

/**
 * Biome-specific ambient configuration.
 * Each biome defines:
 * - rootNote: The base note for the drone
 * - scale: Which scale to pull chord tones from
 * - chordDegrees: Which degrees of the scale form the ambient chord (array of indices into scale)
 * - droneType: 'sine' (smooth/peaceful), 'triangle' (brighter), 'sawtooth' (tense/harsh)
 * - swellSpeed: How fast the volume swells (seconds per cycle). Higher = slower, more meditative.
 * - baseVolume: Starting volume multiplier (0-1), modified by day/night
 * - mood: Descriptive tag for reference
 */
const BIOME_AMBIENT_CONFIG = {
  plains: {
    rootNote: 'A3',
    scale: SCALES.majorPentatonic,
    chordDegrees: [0, 2, 4],           // A-C#-E (major triad from pentatonic)
    droneType: 'sine',
    swellSpeed: 12.0,
    baseVolume: 0.15,
    mood: 'peaceful',
  },
  forest: {
    rootNote: 'G3',
    scale: SCALES.majorPentatonic,
    chordDegrees: [0, 2, 4],           // G-B-D
    droneType: 'sine',
    swellSpeed: 14.0,
    baseVolume: 0.13,
    mood: 'peaceful_wooded',
  },
  desert: {
    rootNote: 'E3',
    scale: SCALES.minorPentatonic,
    chordDegrees: [0, 2, 4],           // E-G-B (minor feel)
    droneType: 'triangle',
    swellSpeed: 8.0,
    baseVolume: 0.12,
    mood: 'tense_ambient',
  },
  tundra: {
    rootNote: 'C4',
    scale: SCALES.wholeTone,
    chordDegrees: [0, 2, 4],           // C-D#-F# (ethereal whole tone)
    droneType: 'sine',
    swellSpeed: 18.0,
    baseVolume: 0.10,
    mood: 'ethereal_cold',
  },
  mountains: {
    rootNote: 'G2',
    scale: SCALES.majorTriad,
    chordDegrees: [0, 1, 2],           // G-B-D (powerful low)
    droneType: 'sine',
    swellSpeed: 16.0,
    baseVolume: 0.14,
    mood: 'majestic',
  },
  ocean: {
    rootNote: 'D3',
    scale: SCALES.majorPentatonic,
    chordDegrees: [0, 2, 4],           // D-F#-A
    droneType: 'sine',
    swellSpeed: 10.0,
    baseVolume: 0.11,
    mood: 'calm_flow',
    hasNoiseLayer: true,               // Ocean adds filtered noise (wave wash)
  },
  lava: {
    rootNote: 'D2',
    scale: SCALES.minorTriad,
    chordDegrees: [0, 1, 2],           // D-F-A (dark minor)
    droneType: 'sawtooth',
    swellSpeed: 4.0,                   // Fast, pulsing — tense
    baseVolume: 0.18,
    mood: 'tense_dangerous',
  },
  corrupt: {
    rootNote: 'Bb2',
    scale: SCALES.diminished,
    chordDegrees: [0, 1, 3],           // Bb-D-F (diminished — very tense)
    droneType: 'sawtooth',
    swellSpeed: 6.0,
    baseVolume: 0.16,
    mood: 'eerie_sinister',
    detuneAmount: 7.0,                 // Microtone detuning for unease (cents)
  },
};

/** Day/night volume multipliers */
const DAY_NIGHT_VOLUMES = {
  day:    1.0,   // Full volume during daytime
  night:  0.6,   // Quieter at night — more subtle ambient
};

/** Smooth crossfade duration between biomes (seconds) */
const CROSSFADE_DURATION = 2.0;

/** Default master ambient volume (0-1) */
const DEFAULT_AMBIENT_VOLUME = {
  master: 0.5,
};

// ============================================================
// Pure Utility Functions (testable without AudioContext)
// ============================================================

/**
 * Get the frequency of a named note.
 */
function getNoteFrequency(noteName) {
  return NOTE_FREQS[noteName] || null;
}

/**
 * Calculate chord frequencies from a root note and scale degrees.
 * @param {string} rootNote - Note name (e.g., 'A3')
 * @param {number[]} scale - Scale semitone offsets (e.g., [0, 2, 4, 7, 9])
 * @param {number[]} chordDegrees - Indices into the scale to pick chord tones
 * @returns {number[]} Array of frequencies for each chord tone
 */
function calculateChordFrequencies(rootNote, scale, chordDegrees) {
  const rootFreq = getNoteFrequency(rootNote);
  if (rootFreq === null) return [];

  // Calculate semitone offset from A4 (440Hz) for the root note
  const a4Semitones = 69; // MIDI note number for A4
  const rootMidi = Math.round(12 * Math.log2(rootFreq / 440) + a4Semitones);

  return chordDegrees.map(degIdx => {
    const semitoneOffset = scale[degIdx] !== undefined ? scale[degIdx] : 0;
    const midiNote = rootMidi + semitoneOffset;
    // MIDI to frequency: f = 440 * 2^((n-69)/12)
    return 440 * Math.pow(2, (midiNote - a4Semitones) / 12);
  });
}

/**
 * Get ambient config for a biome name. Returns plains config as fallback.
 */
function getBiomeAmbientConfig(biomeName) {
  return BIOME_AMBIENT_CONFIG[biomeName] || BIOME_AMBIENT_CONFIG.plains;
}

/**
 * Calculate effective ambient volume considering day/night cycle.
 * @param {number} baseVolume - Biome's base volume
 * @param {number} timeOfDay - 0.0 (midnight) to 1.0 (next midnight), 0.5 = noon
 * @param {number} masterVolume - Master ambient volume multiplier
 * @returns {number} Effective volume (0-1)
 */
function calculateDayNightVolume(baseVolume, timeOfDay, masterVolume) {
  // Clamp inputs
  baseVolume = Math.max(0, baseVolume);
  masterVolume = Math.max(0, Math.min(1, masterVolume));

  const dawnStart = 0.20, dawnEnd = 0.30;   // Transition from night to day
  const duskStart = 0.70, duskEnd = 0.80;    // Transition from day to night

  let dayNightMult;

  // Check transition zones first
  if (timeOfDay >= dawnStart && timeOfDay < dawnEnd) {
    // Dawn: fade from night → day
    const t = (timeOfDay - dawnStart) / (dawnEnd - dawnStart);
    dayNightMult = DAY_NIGHT_VOLUMES.night +
      (DAY_NIGHT_VOLUMES.day - DAY_NIGHT_VOLUMES.night) * smoothstep(t);
  } else if (timeOfDay >= duskStart && timeOfDay < duskEnd) {
    // Dusk: fade from day → night
    const t = (timeOfDay - duskStart) / (duskEnd - duskStart);
    dayNightMult = DAY_NIGHT_VOLUMES.day +
      (DAY_NIGHT_VOLUMES.night - DAY_NIGHT_VOLUMES.day) * smoothstep(t);
  } else if (timeOfDay >= dawnEnd && timeOfDay < duskStart) {
    // Full daylight: 0.30 <= time < 0.70
    dayNightMult = DAY_NIGHT_VOLUMES.day;
  } else {
    // Nighttime: [0, 0.20) and [0.80, 1.0]
    dayNightMult = DAY_NIGHT_VOLUMES.night;
  }

  return Math.max(0, Math.min(1, baseVolume * dayNightMult * masterVolume));
}

/**
 * Smoothstep interpolation for smooth transitions.
 */
function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/**
 * Calculate swell volume at a given time point in the cycle.
 * Uses sine wave for natural breathing/swelling effect.
 * @param {number} elapsedSeconds - Time since ambient started (seconds)
 * @param {number} swellSpeed - Seconds per full swell cycle
 * @returns {number} Volume multiplier between 0.5 and 1.0
 */
function calculateSwellVolume(elapsedSeconds, swellSpeed) {
  // Sine wave: 0.5 to 1.0 (never fully silent)
  const phase = (elapsedSeconds / swellSpeed) * Math.PI * 2;
  return 0.5 + 0.5 * Math.sin(phase);
}

/**
 * Calculate detuned frequency for eerie effect (corrupt biome).
 * @param {number} baseFreq - Original frequency
 * @param {number} detuneCents - Detune amount in cents
 * @returns {number} Detuned frequency
 */
function calculateDetunedFrequency(baseFreq, detuneCents) {
  // Cents formula: f2 = f1 * 2^(cents/1200)
  return baseFreq * Math.pow(2, detuneCents / 1200);
}

/**
 * Get all biome names available in the config.
 */
function getAvailableBiomes() {
  return Object.keys(BIOME_AMBIENT_CONFIG);
}

/**
 * Validate that a biome config has all required fields.
 */
function validateBiomeConfig(biomeName) {
  const config = BIOME_AMBIENT_CONFIG[biomeName];
  if (!config) return { valid: false, error: `Unknown biome: ${biomeName}` };

  const required = ['rootNote', 'scale', 'chordDegrees', 'droneType', 'swellSpeed', 'baseVolume', 'mood'];
  const missing = required.filter(field => config[field] === undefined);
  if (missing.length > 0) {
    return { valid: false, error: `Missing fields: ${missing.join(', ')}` };
  }

  // Validate note exists
  if (!NOTE_FREQS[config.rootNote]) {
    return { valid: false, error: `Unknown root note: ${config.rootNote}` };
  }

  // Validate scale is known
  const scaleNames = Object.values(SCALES);
  const scaleKnown = scaleNames.some(s => s === config.scale);
  if (!scaleKnown) {
    return { valid: false, error: 'Unknown scale reference' };
  }

  // Validate drone type
  if (!['sine', 'triangle', 'sawtooth'].includes(config.droneType)) {
    return { valid: false, error: `Invalid drone type: ${config.droneType}` };
  }

  // Validate chord degrees reference valid scale indices
  for (const deg of config.chordDegrees) {
    if (deg < 0 || deg >= config.scale.length) {
      return { valid: false, error: `Chord degree ${deg} out of scale range [0, ${config.scale.length - 1}]` };
    }
  }

  return { valid: true };
}

// ============================================================
// AmbientManager Class — Browser Audio Playback
// ============================================================

/**
 * Manages procedural ambient soundscapes via Web Audio API.
 * Creates looping drone/chord layers that adapt to biome and time of day.
 */
class AmbientManager {
  constructor(options = {}) {
    this.ctx = null;
    this.masterGain = null;
    this.currentBiome = 'plains';
    this.timeOfDay = 0.5; // Default: noon
    this.volume = { ...DEFAULT_AMBIENT_VOLUME };
    this.enabled = options.enabled !== false;
    this._activeSources = []; // Track oscillators + noise sources for cleanup
    this._initialized = false;
    this._currentConfig = getBiomeAmbientConfig('plains');
    this._swellStartTime = 0;
    this._crossfadeActive = false;

    if (options.volume) {
      Object.assign(this.volume, options.volume);
    }
  }

  /**
   * Initialize the AudioContext. Must be called after user gesture in browsers.
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

      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      this._initialized = true;
      this._swellStartTime = this.ctx.currentTime;
      return true;
    } catch (e) {
      console.warn('AmbientManager init failed:', e.message);
      return false;
    }
  }

  /**
   * Set master ambient volume (0-1).
   */
  setMasterVolume(value) {
    this.volume.master = Math.max(0, Math.min(1, value));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume.master;
    }
  }

  /**
   * Get current master ambient volume.
   */
  getMasterVolume() {
    return this.volume.master;
  }

  /**
   * Set the time of day (0.0-1.0) and adjust volume accordingly.
   */
  setTimeOfDay(timeOfDay) {
    this.timeOfDay = Math.max(0, Math.min(1, timeOfDay));
    if (this._initialized && this.masterGain) {
      const config = this._currentConfig;
      const targetVol = calculateDayNightVolume(config.baseVolume, this.timeOfDay, this.volume.master);
      // Smooth ramp to new volume
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(targetVol, now, 0.5);
    }
  }

  /**
   * Change the ambient biome with smooth crossfade.
   */
  setBiome(biomeName) {
    if (biomeName === this.currentBiome) return;

    const newConfig = getBiomeAmbientConfig(biomeName);
    if (!newConfig) {
      console.warn(`Unknown biome for ambient: ${biomeName}, keeping ${this.currentBiome}`);
      return;
    }

    // Fade out current ambient
    this._fadeOutCurrent();

    // After crossfade, start new ambient
    setTimeout(() => {
      this.currentBiome = biomeName;
      this._currentConfig = newConfig;
      this._startAmbientForConfig(newConfig);
    }, CROSSFADE_DURATION * 1000);
  }

  /**
   * Get the current biome name.
   */
  getCurrentBiome() {
    return this.currentBiome;
  }

  /**
   * Get the effective volume for the current biome/time configuration.
   */
  getEffectiveVolume() {
    const config = this._currentConfig;
    return calculateDayNightVolume(config.baseVolume, this.timeOfDay, this.volume.master);
  }

  /**
   * Update swell effect each frame. Call from game loop.
   * @param {number} deltaTime - Seconds since last frame
   */
  update(deltaTime) {
    if (!this._initialized || !this.ctx) return;

    const config = this._currentConfig;
    const elapsed = this.ctx.currentTime - this._swellStartTime;
    const swellMult = calculateSwellVolume(elapsed, config.swellSpeed);

    // Apply swell to master gain (smoothly)
    const baseVol = calculateDayNightVolume(config.baseVolume, this.timeOfDay, this.volume.master);
    const targetVol = baseVol * swellMult;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(targetVol, now, 0.1);
  }

  /**
   * Get state summary for debugging/HUD.
   */
  getStateSummary() {
    return {
      initialized: this._initialized,
      enabled: this.enabled,
      currentBiome: this.currentBiome,
      timeOfDay: this.timeOfDay,
      masterVolume: this.volume.master,
      effectiveVolume: this._initialized ? this.getEffectiveVolume() : null,
      activeSources: this._activeSources.length,
    };
  }

  /**
   * Stop all ambient sounds.
   */
  stopAll() {
    for (const source of this._activeSources) {
      try {
        source.stop();
      } catch (_) {}
    }
    this._activeSources = [];
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

  // ----------------------------------------------------------
  // Internal methods
  // ----------------------------------------------------------

  /**
   * Fade out current ambient sounds.
   */
  _fadeOutCurrent() {
    if (!this._initialized || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(0.001, now, CROSSFADE_DURATION * 0.5);
    this.stopAll();
  }

  /**
   * Start ambient drone for the given biome config.
   */
  _startAmbientForConfig(config) {
    if (!this._initialized || !this.ctx) return;

    const chordFreqs = calculateChordFrequencies(
      config.rootNote,
      config.scale,
      config.chordDegrees
    );

    if (chordFreqs.length === 0) return;

    this._swellStartTime = this.ctx.currentTime;

    // Create one oscillator per chord tone
    for (const freq of chordFreqs) {
      const osc = this.ctx.createOscillator();
      osc.type = config.droneType || 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      // Apply detuning for corrupt biome
      if (config.detuneAmount) {
        osc.detune.setValueAtTime(config.detuneAmount * (Math.random() - 0.5), this.ctx.currentTime);
      }

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      // Fade in each voice slightly offset for natural feel
      const fadeInTime = 0.3 + Math.random() * 0.5;
      gain.gain.linearRampToValueAtTime(0.08, this.ctx.currentTime + fadeInTime);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();

      this._activeSources.push(osc);
    }

    // Add noise layer for ocean biome (wave wash effect)
    if (config.hasNoiseLayer) {
      this._addNoiseLayer(0.03);
    }
  }

  /**
   * Add filtered noise layer (used for ocean wave sound).
   */
  _addNoiseLayer(volume) {
    if (!this.ctx) return;

    const bufferSize = this.ctx.sampleRate * 2; // 2-second buffer
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2) - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);
    filter.Q.setValueAtTime(1.0, this.ctx.currentTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();

    this._activeSources.push(source);
  }
}

// ============================================================
// Exports — everything for testing in Node.js
// ============================================================

module.exports = {
  // Constants
  NOTE_FREQS,
  SCALES,
  BIOME_AMBIENT_CONFIG,
  DAY_NIGHT_VOLUMES,
  CROSSFADE_DURATION,
  DEFAULT_AMBIENT_VOLUME,

  // Pure utility functions (testable without AudioContext)
  getNoteFrequency,
  calculateChordFrequencies,
  getBiomeAmbientConfig,
  calculateDayNightVolume,
  smoothstep,
  calculateSwellVolume,
  calculateDetunedFrequency,
  getAvailableBiomes,
  validateBiomeConfig,

  // Browser class
  AmbientManager,
};
