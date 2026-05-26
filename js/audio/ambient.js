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
// Biome Atmospheric Sound Layers
// ============================================================

/**
 * Biome-specific atmospheric sound layer definitions.
 * Each biome can have multiple atmospheric layers beyond the base drone.
 * These are procedural sound parameters — no external audio files needed.
 *
 * Layer types:
 * - 'crackle': Short noise bursts (lava bubbles popping, fire crackle)
 * - 'whisper': Low-frequency modulated noise with detuning (eerie ambient)
 * - 'birds': Periodic short chirps using sine sweeps (healthy biomes)
 * - 'wind': Filtered noise sweep with amplitude modulation (tundra/desert/ocean)
 * - 'bubbles': Subtle periodic tone pulses (lava, toxic slime pools)
 */
const BIOME_SOUND_LAYERS = {
  plains: [
    { type: 'birds', volume: 0.04, rate: 3.0, chirpCount: 2, pitchRange: [800, 1600] },
    { type: 'wind', volume: 0.02, filterFreq: 600, windStrength: 0.3 },
  ],
  forest: [
    { type: 'birds', volume: 0.05, rate: 2.5, chirpCount: 3, pitchRange: [700, 1800] },
    { type: 'wind', volume: 0.015, filterFreq: 400, windStrength: 0.2 },
  ],
  desert: [
    { type: 'wind', volume: 0.06, filterFreq: 300, windStrength: 0.7 },
  ],
  tundra: [
    { type: 'wind', volume: 0.05, filterFreq: 200, windStrength: 0.8 },
  ],
  mountains: [
    { type: 'wind', volume: 0.04, filterFreq: 350, windStrength: 0.6 },
  ],
  ocean: [
    // Ocean already has noiseLayer from base config; add wind for surface effect
    { type: 'wind', volume: 0.03, filterFreq: 500, windStrength: 0.4 },
  ],
  lava: [
    { type: 'crackle', volume: 0.06, burstDuration: 0.08, rate: 0.5, noiseRatio: 0.9 },
    { type: 'bubbles', volume: 0.04, freqBase: 120, freqRange: 40, rate: 1.2, pulseWidth: 0.15 },
  ],
  corrupt: [
    { type: 'whisper', volume: 0.05, baseFreq: 80, modRate: 0.3, detuneCents: 15 },
    { type: 'bubbles', volume: 0.03, freqBase: 60, freqRange: 20, rate: 2.0, pulseWidth: 0.3 },
  ],
};

/**
 * Default parameters for each atmospheric layer type.
 */
const LAYER_DEFAULTS = {
  crackle: { volume: 0.05, burstDuration: 0.1, rate: 1.0, noiseRatio: 0.9 },
  whisper: { volume: 0.04, baseFreq: 60, modRate: 0.2, detuneCents: 10 },
  birds:   { volume: 0.03, rate: 2.0, chirpCount: 2, pitchRange: [800, 1500] },
  wind:    { volume: 0.03, filterFreq: 400, windStrength: 0.5 },
  bubbles: { volume: 0.03, freqBase: 100, freqRange: 30, rate: 1.0, pulseWidth: 0.2 },
};

/** All valid atmospheric layer types */
const VALID_LAYER_TYPES = ['crackle', 'whisper', 'birds', 'wind', 'bubbles'];

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
// Atmospheric Sound Layer Utilities (testable without AudioContext)
// ============================================================

/**
 * Get atmospheric sound layers for a biome. Returns empty array if none defined.
 */
function getBiomeSoundLayers(biomeName) {
  return BIOME_SOUND_LAYERS[biomeName] || [];
}

/**
 * Validate an atmospheric layer definition has all required fields for its type.
 */
function validateSoundLayer(layer) {
  if (!layer || !layer.type) {
    return { valid: false, error: 'Missing layer type' };
  }

  if (!VALID_LAYER_TYPES.includes(layer.type)) {
    return { valid: false, error: `Invalid layer type: ${layer.type}` };
  }

  const defaults = LAYER_DEFAULTS[layer.type];
  if (!defaults) {
    return { valid: false, error: `Unknown defaults for type: ${layer.type}` };
  }

  // Check required fields per type
  switch (layer.type) {
    case 'crackle':
      if (layer.burstDuration === undefined && !layer.burstDuration) {
        return { valid: false, error: 'crackle layer requires burstDuration' };
      }
      break;
    case 'whisper':
      if (layer.baseFreq === undefined || layer.baseFreq <= 0) {
        return { valid: false, error: 'whisper layer requires positive baseFreq' };
      }
      break;
    case 'birds':
      if (!layer.pitchRange || layer.pitchRange.length !== 2 || layer.pitchRange[0] >= layer.pitchRange[1]) {
        return { valid: false, error: 'birds layer requires valid pitchRange [min, max]' };
      }
      break;
    case 'wind':
      if (layer.filterFreq === undefined || layer.filterFreq <= 0) {
        return { valid: false, error: 'wind layer requires positive filterFreq' };
      }
      break;
    case 'bubbles':
      if (layer.freqBase === undefined || layer.freqBase <= 0) {
        return { valid: false, error: 'bubbles layer requires positive freqBase' };
      }
      break;
  }

  // Validate volume range
  const vol = layer.volume !== undefined ? layer.volume : defaults.volume;
  if (vol < 0 || vol > 1) {
    return { valid: false, error: `Volume ${vol} out of range [0, 1]` };
  }

  return { valid: true };
}

/**
 * Merge a sound layer with its type defaults. Missing fields get default values.
 */
function resolveSoundLayer(layer) {
  const defaults = LAYER_DEFAULTS[layer.type];
  if (!defaults) return layer;

  const resolved = { ...defaults, ...layer };

  // Ensure pitchRange is always an array of 2 elements for birds
  if (resolved.type === 'birds' && Array.isArray(resolved.pitchRange)) {
    resolved.pitchRange = [
      Math.max(20, resolved.pitchRange[0] || defaults.pitchRange[0]),
      Math.min(8000, resolved.pitchRange[1] || defaults.pitchRange[1]),
    ];
  }

  return resolved;
}

/**
 * Calculate crackle burst timing schedule.
 * Returns array of { time, duration, volume } events for a given duration window.
 * Uses seeded PRNG for deterministic scheduling.
 */
function calculateCrackleSchedule(rate, burstDuration, windowSeconds, seed) {
  const events = [];
  let rng = seed || 42;

  // Simple LCG PRNG for determinism
  function nextRand() {
    rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (rng >>> 0) / 0xFFFFFFFF;
  }

  let time = 0;
  while (time < windowSeconds) {
    // Exponential inter-arrival: mean = rate seconds between bursts
    const interval = -Math.log(1 - nextRand()) * rate;
    time += interval;
    if (time >= windowSeconds) break;

    events.push({
      time,
      duration: burstDuration * (0.5 + 0.5 * nextRand()), // Vary within 50%-100%
      volume: 0.7 + 0.3 * nextRand(), // Vary within 70%-100%
    });
  }

  return events;
}

/**
 * Calculate bird chirp timing and pitch schedule.
 */
function calculateBirdSchedule(rate, chirpCount, pitchRange, windowSeconds, seed) {
  const events = [];
  let rng = seed || 123;

  function nextRand() {
    rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (rng >>> 0) / 0xFFFFFFFF;
  }

  let time = 0;
  while (time < windowSeconds) {
    // Bird calls happen in bursts — exponential interval
    const interval = -Math.log(1 - nextRand()) * rate + 0.5;
    time += interval;
    if (time >= windowSeconds) break;

    // Generate chirpCount chirps in a short burst
    for (let i = 0; i < chirpCount; i++) {
      const chirpTime = time + i * 0.15 * nextRand();
      const pitchMin = pitchRange[0];
      const pitchMax = pitchRange[1];
      const pitch = pitchMin + (pitchMax - pitchMin) * nextRand();

      events.push({
        time: chirpTime,
        frequency: Math.round(pitch),
        duration: 0.05 + 0.05 * nextRand(), // 50-100ms chirp
      });
    }
  }

  return events;
}

/**
 * Calculate bubble pulse schedule for lava/corrupt biomes.
 */
function calculateBubbleSchedule(freqBase, freqRange, rate, pulseWidth, windowSeconds, seed) {
  const events = [];
  let rng = seed || 777;

  function nextRand() {
    rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (rng >>> 0) / 0xFFFFFFFF;
  }

  let time = 0;
  while (time < windowSeconds) {
    const interval = -Math.log(1 - nextRand()) * rate;
    time += interval;
    if (time >= windowSeconds) break;

    events.push({
      time,
      frequency: freqBase + (freqRange * (nextRand() * 2 - 1)), // ±range from base
      duration: pulseWidth * (0.5 + 0.5 * nextRand()),
    });
  }

  return events;
}

/**
 * Calculate effective atmospheric volume considering day/night cycle and master volume.
 */
function calculateAtmosphericVolume(layerVolume, timeOfDay, masterVolume) {
  const dawnStart = 0.20, dawnEnd = 0.30;
  const duskStart = 0.70, duskEnd = 0.80;

  let dayNightMult;

  if (timeOfDay >= dawnStart && timeOfDay < dawnEnd) {
    const t = (timeOfDay - dawnStart) / (dawnEnd - dawnStart);
    dayNightMult = DAY_NIGHT_VOLUMES.night +
      (DAY_NIGHT_VOLUMES.day - DAY_NIGHT_VOLUMES.night) * smoothstep(t);
  } else if (timeOfDay >= duskStart && timeOfDay < duskEnd) {
    const t = (timeOfDay - duskStart) / (duskEnd - duskStart);
    dayNightMult = DAY_NIGHT_VOLUMES.day +
      (DAY_NIGHT_VOLUMES.night - DAY_NIGHT_VOLUMES.day) * smoothstep(t);
  } else if (timeOfDay >= dawnEnd && timeOfDay < duskStart) {
    dayNightMult = DAY_NIGHT_VOLUMES.day;
  } else {
    dayNightMult = DAY_NIGHT_VOLUMES.night;
  }

  // Atmospheric sounds are quieter than base drone — apply 0.6 multiplier
  const atmosphericMultiplier = 0.6;
  return Math.max(0, Math.min(1, layerVolume * dayNightMult * masterVolume * atmosphericMultiplier));
}

/**
 * Get all unique sound layer types used across all biomes.
 */
function getAllUsedLayerTypes() {
  const types = new Set();
  for (const layers of Object.values(BIOME_SOUND_LAYERS)) {
    for (const layer of layers) {
      types.add(layer.type);
    }
  }
  return Array.from(types);
}

/**
 * Get biomes that use a specific layer type.
 */
function getBiomesUsingLayerType(type) {
  return Object.keys(BIOME_SOUND_LAYERS).filter(biome =>
    BIOME_SOUND_LAYERS[biome].some(l => l.type === type)
  );
}

/**
 * Validate all biome sound layer configs.
 */
function validateAllSoundLayers() {
  const errors = [];
  for (const [biome, layers] of Object.entries(BIOME_SOUND_LAYERS)) {
    for (let i = 0; i < layers.length; i++) {
      const result = validateSoundLayer(layers[i]);
      if (!result.valid) {
        errors.push(`${biome}[${i}]: ${result.error}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
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
    this.atmosphericGain = null; // Separate gain node for atmospheric layers
    this.currentBiome = 'plains';
    this.timeOfDay = 0.5; // Default: noon
    this.volume = { ...DEFAULT_AMBIENT_VOLUME };
    this.enabled = options.enabled !== false;
    this._activeSources = []; // Track oscillators + noise sources for cleanup
    this._initialized = false;
    this._currentConfig = getBiomeAmbientConfig('plains');
    this._swellStartTime = 0;
    this._crossfadeActive = false;
    this._atmosphericLayers = []; // Active atmospheric layer nodes
    this._atmosphericIntervals = []; // Scheduled interval IDs for periodic sounds

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

      // Separate gain node for atmospheric layers (quieter than base drone)
      this.atmosphericGain = this.ctx.createGain();
      this.atmosphericGain.gain.value = 0.6;
      this.atmosphericGain.connect(this.ctx.destination);

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

    // Fade out current ambient + atmospheric layers
    this._fadeOutCurrent();
    this._stopAtmosphericLayers();

    // After crossfade, start new ambient + atmospheric layers
    setTimeout(() => {
      this.currentBiome = biomeName;
      this._currentConfig = newConfig;
      this._startAmbientForConfig(newConfig);
      this._startAtmosphericLayers(biomeName);
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
    const layers = getBiomeSoundLayers(this.currentBiome);
    return {
      initialized: this._initialized,
      enabled: this.enabled,
      currentBiome: this.currentBiome,
      timeOfDay: this.timeOfDay,
      masterVolume: this.volume.master,
      effectiveVolume: this._initialized ? this.getEffectiveVolume() : null,
      activeSources: this._activeSources.length,
      atmosphericLayers: layers.map(l => l.type),
      atmosphericLayerCount: layers.length,
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

  // ----------------------------------------------------------
  // Atmospheric Layer Methods
  // ----------------------------------------------------------

  /**
   * Stop all atmospheric layer sounds and clear scheduled intervals.
   */
  _stopAtmosphericLayers() {
    // Clear periodic sound intervals
    for (const id of this._atmosphericIntervals) {
      clearInterval(id);
    }
    this._atmosphericIntervals = [];

    // Stop atmospheric sources
    for (const layer of this._atmosphericLayers) {
      try {
        if (layer.source) layer.source.stop();
      } catch (_) {}
    }
    this._atmosphericLayers = [];
  }

  /**
   * Start atmospheric sound layers for the given biome.
   */
  _startAtmosphericLayers(biomeName) {
    if (!this._initialized || !this.ctx || !this.atmosphericGain) return;

    const layers = getBiomeSoundLayers(biomeName);
    if (layers.length === 0) return;

    for (const layerDef of layers) {
      const resolved = resolveSoundLayer(layerDef);
      try {
        switch (resolved.type) {
          case 'crackle':
            this._startCrackleLayer(resolved);
            break;
          case 'whisper':
            this._startWhisperLayer(resolved);
            break;
          case 'birds':
            this._startBirdsLayer(resolved);
            break;
          case 'wind':
            this._startWindLayer(resolved);
            break;
          case 'bubbles':
            this._startBubblesLayer(resolved);
            break;
        }
      } catch (e) {
        console.warn(`Failed to start ${resolved.type} layer for ${biomeName}:`, e.message);
      }
    }
  }

  /**
   * Start crackle layer — periodic short noise bursts.
   */
  _startCrackleLayer(config) {
    const intervalMs = (config.rate || 1) * 1000;
    const id = setInterval(() => {
      if (!this._initialized || !this.ctx) return;

      const bufferSize = this.ctx.sampleRate * config.burstDuration;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2) - 1;
      }

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(config.volume * config.noiseRatio, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + config.burstDuration);

      source.connect(gain);
      gain.connect(this.atmosphericGain);
      source.start();
    }, intervalMs);

    this._atmosphericIntervals.push(id);
  }

  /**
   * Start whisper layer — low-frequency modulated noise with detuning.
   */
  _startWhisperLayer(config) {
    if (!this.ctx) return;

    // Create a low oscillator for the drone base
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(config.baseFreq, this.ctx.currentTime);

    // LFO modulation for eerie wobble
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(config.modRate, this.ctx.currentTime);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(config.detuneCents || 10, this.ctx.currentTime);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);

    // Apply additional detuning for unease
    osc.detune.setValueAtTime((config.detuneCents || 10) * (Math.random() - 0.5), this.ctx.currentTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(config.volume, this.ctx.currentTime);

    osc.connect(gain);
    gain.connect(this.atmosphericGain);
    osc.start();
    lfo.start();

    this._atmosphericLayers.push({ source: osc, type: 'whisper' });
    this._atmosphericLayers.push({ source: lfo, type: 'whisper-lfo' });
  }

  /**
   * Start birds layer — periodic short chirps using sine sweeps.
   */
  _startBirdsLayer(config) {
    const intervalMs = (config.rate || 2) * 1000;
    const id = setInterval(() => {
      if (!this._initialized || !this.ctx) return;

      const chirpCount = config.chirpCount || 2;
      for (let i = 0; i < chirpCount; i++) {
        const chirpTime = this.ctx.currentTime + i * 0.15;
        const pitchMin = config.pitchRange[0] || 800;
        const pitchMax = config.pitchRange[1] || 1500;
        const freq = pitchMin + (pitchMax - pitchMin) * Math.random();

        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, chirpTime);
        // Quick pitch sweep upward for natural chirp feel
        osc.frequency.exponentialRampToValueAtTime(freq * 1.3, chirpTime + 0.04);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, chirpTime);
        gain.gain.linearRampToValueAtTime(config.volume, chirpTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, chirpTime + 0.08);

        osc.connect(gain);
        gain.connect(this.atmosphericGain);
        osc.start(chirpTime);
        osc.stop(chirpTime + 0.1);
      }
    }, intervalMs);

    this._atmosphericIntervals.push(id);
  }

  /**
   * Start wind layer — filtered noise with amplitude modulation.
   */
  _startWindLayer(config) {
    if (!this.ctx) return;

    const bufferSize = this.ctx.sampleRate * 4; // 4-second buffer for looping
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2) - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Bandpass filter for wind character
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(config.filterFreq, this.ctx.currentTime);
    filter.Q.setValueAtTime(0.5 + config.windStrength * 0.5, this.ctx.currentTime);

    // Amplitude modulation for gusts
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.1 + config.windStrength * 0.1, this.ctx.currentTime);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(config.volume * config.windStrength, this.ctx.currentTime);
    lfo.connect(lfoGain);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(config.volume, this.ctx.currentTime);
    lfoGain.connect(gain.gain);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.atmosphericGain);
    source.start();
    lfo.start();

    this._atmosphericLayers.push({ source, type: 'wind' });
    this._atmosphericLayers.push({ source: lfo, type: 'wind-lfo' });
  }

  /**
   * Start bubbles layer — periodic low-frequency tone pulses.
   */
  _startBubblesLayer(config) {
    const intervalMs = (config.rate || 1) * 1000;
    const id = setInterval(() => {
      if (!this._initialized || !this.ctx) return;

      const freq = config.freqBase + (config.freqRange || 30) * (Math.random() * 2 - 1);
      const duration = config.pulseWidth * (0.5 + 0.5 * Math.random());

      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(config.volume, this.ctx.currentTime + duration * 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.atmosphericGain);
      osc.start();
      osc.stop(this.ctx.currentTime + duration + 0.01);
    }, intervalMs);

    this._atmosphericIntervals.push(id);
  }
}

// ============================================================
// Exports — everything for testing in Node.js
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Constants
    NOTE_FREQS,
    SCALES,
    BIOME_AMBIENT_CONFIG,
    DAY_NIGHT_VOLUMES,
    CROSSFADE_DURATION,
    DEFAULT_AMBIENT_VOLUME,
    BIOME_SOUND_LAYERS,
    LAYER_DEFAULTS,
    VALID_LAYER_TYPES,

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

    // Atmospheric sound layer utilities
    getBiomeSoundLayers,
    validateSoundLayer,
    resolveSoundLayer,
    calculateCrackleSchedule,
    calculateBirdSchedule,
    calculateBubbleSchedule,
    calculateAtmosphericVolume,
    getAllUsedLayerTypes,
    getBiomesUsingLayerType,
    validateAllSoundLayers,

    // Browser class
    AmbientManager,
  };

}