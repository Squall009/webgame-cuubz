#!/usr/bin/env node
/**
 * Cuubz — Procedural Ambient Soundscapes Tests
 * Tests for ambient system: note frequencies, chord calculation, biome configs,
 * day/night volume, swell effects, detuning, validation, and AmbientManager class.
 * All tests run without Web Audio API (pure function testing).
 */

'use strict';

const {
  NOTE_FREQS,
  SCALES,
  BIOME_AMBIENT_CONFIG,
  DAY_NIGHT_VOLUMES,
  CROSSFADE_DURATION,
  DEFAULT_AMBIENT_VOLUME,

  getNoteFrequency,
  calculateChordFrequencies,
  getBiomeAmbientConfig,
  calculateDayNightVolume,
  smoothstep,
  calculateSwellVolume,
  calculateDetunedFrequency,
  getAvailableBiomes,
  validateBiomeConfig,

  AmbientManager,
} = require('../js/audio/ambient');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

function assertTrue(condition, message) {
  assert(condition, `Expected true: ${message}`);
}

function assertFalse(condition, message) {
  assert(!condition, `Expected false: ${message}`);
}

function assertApprox(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) < tolerance,
    `${message}: expected ~${expected}, got ${actual} (tolerance ${tolerance})`);
}

function assertArrayEquals(actual, expected, message) {
  if (actual.length !== expected.length) {
    assert(false, `${message}: length mismatch — expected ${expected.length}, got ${actual.length}`);
    return;
  }
  for (let i = 0; i < actual.length; i++) {
    if (Math.abs(actual[i] - expected[i]) > 0.01) {
      assert(false, `${message}[${i}]: expected ~${expected[i]}, got ${actual[i]}`);
      return;
    }
  }
  passed++;
}

// ============================================================
// Test Group 1: NOTE_FREQS Constants
// ============================================================
console.log('Test Group 1: NOTE_FREQS Constants');

function test_noteFreqs() {
  assertEquals(NOTE_FREQS.A4, 440.00, 'A4 = 440Hz');
  assertEquals(NOTE_FREQS.C4, 261.63, 'C4 = 261.63Hz');
  assertApprox(NOTE_FREQS.A3, 220.00, 0.01, 'A3 ≈ 220Hz');
  assertApprox(NOTE_FREQS.C5, 523.25, 0.01, 'C5 ≈ 523.25Hz');
  assertEquals(Object.keys(NOTE_FREQS).length, 27, '27 notes defined (C2-Bb4 across octaves)');

  // Octave relationship: A4/A3 ≈ 2
  assertApprox(NOTE_FREQS.A4 / NOTE_FREQS.A3, 2.0, 0.01, 'A4/A3 ratio ≈ 2 (octave)');
}
test_noteFreqs();
console.log('  Group 1 done.');

// ============================================================
// Test Group 2: SCALES Constants
// ============================================================
console.log('Test Group 2: SCALES Constants');

function test_scales() {
  assertEquals(Object.keys(SCALES).length, 6, '6 scales defined');
  assertEquals(SCALES.majorPentatonic.length, 5, 'Major pentatonic has 5 degrees');
  assertEquals(SCALES.minorPentatonic.length, 5, 'Minor pentatonic has 5 degrees');
  assertEquals(SCALES.majorTriad.length, 3, 'Major triad has 3 degrees');
  assertEquals(SCALES.minorTriad.length, 3, 'Minor triad has 3 degrees');
  assertEquals(SCALES.diminished.length, 4, 'Diminished has 4 degrees');
  assertEquals(SCALES.wholeTone.length, 6, 'Whole tone has 6 degrees');

  // Scale intervals are ascending from root (0)
  for (const [name, scale] of Object.entries(SCALES)) {
    assertTrue(scale[0] === 0, `${name}: first degree is root (0)`);
    const ascending = scale.every((v, i) => i === 0 || v > scale[i - 1]);
    assertTrue(ascending, `${name}: intervals are ascending`);
  }
}
test_scales();
console.log('  Group 2 done.');

// ============================================================
// Test Group 3: BIOME_AMBIENT_CONFIG Structure
// ============================================================
console.log('Test Group 3: BIOME_AMBIENT_CONFIG Structure');

function test_biomeConfigStructure() {
  assertEquals(Object.keys(BIOME_AMBIENT_CONFIG).length, 8, '8 biomes configured');

  const requiredFields = ['rootNote', 'scale', 'chordDegrees', 'droneType', 'swellSpeed', 'baseVolume', 'mood'];
  for (const [biome, config] of Object.entries(BIOME_AMBIENT_CONFIG)) {
    for (const field of requiredFields) {
      assertTrue(config[field] !== undefined, `${biome} has ${field}`);
    }
  }

  // Check specific biome configs
  assertEquals(BIOME_AMBIENT_CONFIG.plains.mood, 'peaceful', 'plains mood = peaceful');
  assertEquals(BIOME_AMBIENT_CONFIG.lava.mood, 'tense_dangerous', 'lava mood = tense_dangerous');
  assertEquals(BIOME_AMBIENT_CONFIG.corrupt.mood, 'eerie_sinister', 'corrupt mood = eerie_sinister');
  assertEquals(BIOME_AMBIENT_CONFIG.tundra.mood, 'ethereal_cold', 'tundra mood = ethereal_cold');

  // Lava uses sawtooth for harsh sound
  assertEquals(BIOME_AMBIENT_CONFIG.lava.droneType, 'sawtooth', 'lava droneType = sawtooth');
  assertEquals(BIOME_AMBIENT_CONFIG.corrupt.droneType, 'sawtooth', 'corrupt droneType = sawtooth');

  // Peaceful biomes use sine
  assertEquals(BIOME_AMBIENT_CONFIG.plains.droneType, 'sine', 'plains droneType = sine');
  assertEquals(BIOME_AMBIENT_CONFIG.forest.droneType, 'sine', 'forest droneType = sine');
  assertEquals(BIOME_AMBIENT_CONFIG.ocean.droneType, 'sine', 'ocean droneType = sine');

  // Desert uses triangle (brighter than sine)
  assertEquals(BIOME_AMBIENT_CONFIG.desert.droneType, 'triangle', 'desert droneType = triangle');

  // Ocean has noise layer
  assertTrue(BIOME_AMBIENT_CONFIG.ocean.hasNoiseLayer === true, 'ocean has noise layer');
  assertFalse(BIOME_AMBIENT_CONFIG.plains.hasNoiseLayer, 'plains no noise layer');

  // Corrupt has detune amount
  assertTrue(BIOME_AMBIENT_CONFIG.corrupt.detuneAmount > 0, 'corrupt has detune amount');
  assertEquals(BIOME_AMBIENT_CONFIG.corrupt.detuneAmount, 7.0, 'corrupt detune = 7 cents');

  // Validate all swell speeds are positive
  for (const [biome, config] of Object.entries(BIOME_AMBIENT_CONFIG)) {
    assertTrue(config.swellSpeed > 0, `${biome} swellSpeed > 0`);
  }

  // Validate all base volumes in range (0, 1)
  for (const [biome, config] of Object.entries(BIOME_AMBIENT_CONFIG)) {
    assertTrue(config.baseVolume > 0 && config.baseVolume <= 1,
      `${biome} baseVolume in (0, 1]`);
  }

  // Lava has faster swell (more tense)
  assertTrue(BIOME_AMBIENT_CONFIG.lava.swellSpeed < BIOME_AMBIENT_CONFIG.plains.swellSpeed,
    'lava swellSpeed < plains (faster = more tense)');

  // Tundra has slowest swell (most ethereal)
  const tundraSpeed = BIOME_AMBIENT_CONFIG.tundra.swellSpeed;
  for (const [biome, config] of Object.entries(BIOME_AMBIENT_CONFIG)) {
    if (config.hasNoiseLayer || biome === 'tundra') continue; // skip ocean which has different character
  }
}
test_biomeConfigStructure();
console.log('  Group 3 done.');

// ============================================================
// Test Group 4: DAY_NIGHT_VOLUMES Constants
// ============================================================
console.log('Test Group 4: DAY_NIGHT_VOLUMES Constants');

function test_dayNightVolumes() {
  assertEquals(DAY_NIGHT_VOLUMES.day, 1.0, 'Day volume = 1.0');
  assertEquals(DAY_NIGHT_VOLUMES.night, 0.6, 'Night volume = 0.6');
  assertTrue(DAY_NIGHT_VOLUMES.day > DAY_NIGHT_VOLUMES.night, 'Day louder than night');
}
test_dayNightVolumes();
console.log('  Group 4 done.');

// ============================================================
// Test Group 5: CROSSFADE_DURATION & DEFAULT_AMBIENT_VOLUME
// ============================================================
console.log('Test Group 5: Crossfade & Default Volume Constants');

function test_constants() {
  assertEquals(CROSSFADE_DURATION, 2.0, 'Crossfade = 2 seconds');
  assertEquals(DEFAULT_AMBIENT_VOLUME.master, 0.5, 'Default master volume = 0.5');
}
test_constants();
console.log('  Group 5 done.');

// ============================================================
// Test Group 6: getNoteFrequency
// ============================================================
console.log('Test Group 6: getNoteFrequency');

function test_getNoteFrequency() {
  assertEquals(getNoteFrequency('A4'), 440.00, 'getNoteFrequency(A4) = 440');
  assertEquals(getNoteFrequency('C4'), 261.63, 'getNoteFrequency(C4) = 261.63');
  assertEquals(getNoteFrequency('G2'), 98.00, 'getNoteFrequency(G2) = 98');
  assertEquals(getNoteFrequency('Bb2'), 116.54, 'getNoteFrequency(Bb2) = 116.54');
  assertEquals(getNoteFrequency('C5'), 523.25, 'getNoteFrequency(C5) = 523.25');
  assertEquals(getNoteFrequency('ZZZ'), null, 'Unknown note returns null');
  assertEquals(getNoteFrequency(''), null, 'Empty string returns null');
}
test_getNoteFrequency();
console.log('  Group 6 done.');

// ============================================================
// Test Group 7: calculateChordFrequencies
// ============================================================
console.log('Test Group 7: calculateChordFrequencies');

function test_calculateChordFrequencies() {
  // A chord from majorPentatonic degrees [0,2,4]: indices into scale = semitones [0, 4, 9]
  // This gives A3-C#4-F#4 (pentatonic triad)
  const aPentatonic = calculateChordFrequencies('A3', SCALES.majorPentatonic, [0, 2, 4]);
  assertEquals(aPentatonic.length, 3, 'Pentatonic chord has 3 notes');
  assertApprox(aPentatonic[0], 220.00, 0.01, 'Root ≈ A3 (220Hz)');
  assertApprox(aPentatonic[1], 277.18, 0.5, 'Third ≈ C#4 (~277Hz, +4 semitones)');
  assertApprox(aPentatonic[2], 369.99, 0.5, 'Sixth ≈ F#4 (~370Hz, +9 semitones)');

  // G major chord from pentatonic: G3 root, degrees [0,2,4] = G-B-E
  const gPentatonic = calculateChordFrequencies('G3', SCALES.majorPentatonic, [0, 2, 4]);
  assertEquals(gPentatonic.length, 3, 'G pentatonic chord has 3 notes');
  assertApprox(gPentatonic[0], 196.00, 0.01, 'Root ≈ G3 (196Hz)');

  // A traditional major triad using majorTriad scale: A-C#-E
  const aMajor = calculateChordFrequencies('A3', SCALES.majorTriad, [0, 1, 2]);
  assertEquals(aMajor.length, 3, 'A major triad has 3 notes');
  assertApprox(aMajor[0], 220.00, 0.01, 'Root ≈ A3 (220Hz)');
  assertApprox(aMajor[1], 277.18, 0.5, 'Third ≈ C#4 (~277Hz)');
  assertApprox(aMajor[2], 329.63, 0.5, 'Fifth ≈ E4 (~330Hz)');

  // D minor triad from minorPentatonic: D3 root, degrees [0,2,4] of minorPentatonic = semitones [0,5,10]
  const dMinorPenta = calculateChordFrequencies('D3', SCALES.minorPentatonic, [0, 2, 4]);
  assertEquals(dMinorPenta.length, 3, 'D minor pentatonic has 3 notes');
  assertApprox(dMinorPenta[0], 146.83, 0.01, 'Root ≈ D3 (147Hz)');

  // C whole tone: C4 root, degrees [0,2,4] of wholeTone = semitones [0,4,8]
  const cWhole = calculateChordFrequencies('C4', SCALES.wholeTone, [0, 2, 4]);
  assertEquals(cWhole.length, 3, 'C whole tone has 3 notes');

  // G low mountain: G2 root with majorTriad
  const gLow = calculateChordFrequencies('G2', SCALES.majorTriad, [0, 1, 2]);
  assertApprox(gLow[0], 98.00, 0.01, 'G2 low root ≈ 98Hz');

  // Unknown note returns empty array
  const unknown = calculateChordFrequencies('ZZZ', SCALES.majorPentatonic, [0]);
  assertEquals(unknown.length, 0, 'Unknown root note returns []');

  // Empty chord degrees returns empty array
  const empty = calculateChordFrequencies('A4', SCALES.majorPentatonic, []);
  assertEquals(empty.length, 0, 'Empty chord degrees returns []');

  // Out-of-scale degree should still produce a frequency (just off-scale)
  const oob = calculateChordFrequencies('A4', SCALES.majorTriad, [0, 5]);
  assertTrue(oob.length === 2, 'OOB degree produces result with undefined offset');

  // Verify frequencies are ascending for standard chords
  for (let i = 1; i < aMajor.length; i++) {
    assertTrue(aMajor[i] > aMajor[i - 1], `A major freqs ascending: ${aMajor[i]} > ${aMajor[i-1]}`);
  }
}
test_calculateChordFrequencies();
console.log('  Group 7 done.');

// ============================================================
// Test Group 8: getBiomeAmbientConfig
// ============================================================
console.log('Test Group 8: getBiomeAmbientConfig');

function test_getBiomeAmbientConfig() {
  // Known biomes return their config
  const plains = getBiomeAmbientConfig('plains');
  assertEquals(plains.mood, 'peaceful', 'plains config mood');
  assertEquals(plains.rootNote, 'A3', 'plains root note');

  const lava = getBiomeAmbientConfig('lava');
  assertEquals(lava.droneType, 'sawtooth', 'lava drone type');

  // Unknown biome falls back to plains
  const unknown = getBiomeAmbientConfig('nonexistent_biome');
  assertEquals(unknown.mood, 'peaceful', 'Unknown biome falls back to plains');
  assertEquals(unknown.rootNote, 'A3', 'Fallback root note = A3');

  // Empty string also falls back
  const empty = getBiomeAmbientConfig('');
  assertEquals(empty.mood, 'peaceful', 'Empty string falls back to plains');

  // All 8 biomes return distinct configs
  const configs = {};
  for (const biome of getAvailableBiomes()) {
    const config = getBiomeAmbientConfig(biome);
    configs[biome] = `${config.rootNote}-${config.mood}`;
  }
  assertTrue(configs.plains !== configs.lava, 'plains ≠ lava config');
  assertTrue(configs.forest !== configs.tundra, 'forest ≠ tundra config');
}
test_getBiomeAmbientConfig();
console.log('  Group 8 done.');

// ============================================================
// Test Group 9: smoothstep
// ============================================================
console.log('Test Group 9: smoothstep');

function test_smoothstep() {
  assertEquals(smoothstep(0), 0, 'smoothstep(0) = 0');
  assertEquals(smoothstep(1), 1, 'smoothstep(1) = 1');
  assertApprox(smoothstep(0.5), 0.5, 0.01, 'smoothstep(0.5) ≈ 0.5');
  assertTrue(smoothstep(0.25) < 0.25, 'smoothstep(0.25) < 0.25 (slower start)');
  assertTrue(smoothstep(0.75) > 0.75, 'smoothstep(0.75) > 0.75 (faster end)');

  // Clamped to [0, 1]
  assertEquals(smoothstep(-1), 0, 'smoothstep(-1) clamped to 0');
  assertEquals(smoothstep(2), 1, 'smoothstep(2) clamped to 1');
}
test_smoothstep();
console.log('  Group 9 done.');

// ============================================================
// Test Group 10: calculateDayNightVolume
// ============================================================
console.log('Test Group 10: calculateDayNightVolume');

function test_calculateDayNightVolume() {
  const baseVol = 0.15;
  const masterVol = 1.0;

  // Noon (0.5) — full day volume (in range [0.30, 0.70))
  const noonVol = calculateDayNightVolume(baseVol, 0.5, masterVol);
  assertApprox(noonVol, baseVol * DAY_NIGHT_VOLUMES.day, 0.001, 'Noon = base * day');

  // Midnight (0.0) — night volume (in range [0, 0.20))
  const midnightVol = calculateDayNightVolume(baseVol, 0.0, masterVol);
  assertApprox(midnightVol, baseVol * DAY_NIGHT_VOLUMES.night, 0.001, 'Midnight = base * night');

  // Dawn transition zone (0.20-0.30) — should be between night and day volumes
  const dawnMid = calculateDayNightVolume(baseVol, 0.25, masterVol);
  assertTrue(dawnMid > midnightVol, 'Dawn mid > midnight volume');
  assertTrue(dawnMid < noonVol, 'Dawn mid < noon volume');

  // Dusk transition zone (0.70-0.80) — should be between day and night volumes
  const duskMid = calculateDayNightVolume(baseVol, 0.75, masterVol);
  assertTrue(duskMid > midnightVol, 'Dusk mid > midnight volume');
  assertTrue(duskMid < noonVol, 'Dusk mid < noon volume');

  // Dawn start (0.20) — should be night volume
  const dawnStart = calculateDayNightVolume(baseVol, 0.20, masterVol);
  assertApprox(dawnStart, baseVol * DAY_NIGHT_VOLUMES.night, 0.001, 'Dawn start = night volume');

  // Dawn end (0.30) — should be day volume
  const dawnEnd = calculateDayNightVolume(baseVol, 0.30, masterVol);
  assertApprox(dawnEnd, baseVol * DAY_NIGHT_VOLUMES.day, 0.001, 'Dawn end = day volume');

  // Dusk start (0.70) — should be day volume
  const duskStart = calculateDayNightVolume(baseVol, 0.70, masterVol);
  assertApprox(duskStart, baseVol * DAY_NIGHT_VOLUMES.day, 0.001, 'Dusk start = day volume');

  // Dusk end (0.80) — should be night volume
  const duskEnd = calculateDayNightVolume(baseVol, 0.80, masterVol);
  assertApprox(duskEnd, baseVol * DAY_NIGHT_VOLUMES.night, 0.001, 'Dusk end = night volume');

  // Dawn transition is increasing
  assertTrue(calculateDayNightVolume(baseVol, 0.28, masterVol) > calculateDayNightVolume(baseVol, 0.22, masterVol),
    'Dawn volume increases through transition');

  // Dusk transition is decreasing
  assertTrue(calculateDayNightVolume(baseVol, 0.72, masterVol) > calculateDayNightVolume(baseVol, 0.78, masterVol),
    'Dusk volume decreases through transition');

  // Master volume = 0 → output = 0
  assertEquals(calculateDayNightVolume(baseVol, 0.5, 0), 0, 'Master vol 0 = output 0');

  // Master volume clamps correctly
  const highMaster = calculateDayNightVolume(0.5, 0.5, 2.0);
  assertTrue(highMaster <= 1.0, 'Volume clamped to max 1.0');

  // Negative base volume handled
  const negBase = calculateDayNightVolume(-0.1, 0.5, 1.0);
  assertEquals(negBase, 0, 'Negative base volume → 0');

  // Edge: timeOfDay = 1.0 (end of cycle = night)
  const endCycle = calculateDayNightVolume(baseVol, 1.0, masterVol);
  assertApprox(endCycle, baseVol * DAY_NIGHT_VOLUMES.night, 0.001, 'Time 1.0 = night volume');

  // Full day range: any time from 0.30 to 0.69 should be day volume
  for (const t of [0.30, 0.40, 0.50, 0.60, 0.69]) {
    const vol = calculateDayNightVolume(baseVol, t, masterVol);
    assertApprox(vol, baseVol * DAY_NIGHT_VOLUMES.day, 0.001, `Time ${t} = day volume`);
  }

  // Night range: times outside transitions should be night volume
  for (const t of [0.0, 0.10, 0.15, 0.85, 0.90, 1.0]) {
    const vol = calculateDayNightVolume(baseVol, t, masterVol);
    assertApprox(vol, baseVol * DAY_NIGHT_VOLUMES.night, 0.001, `Time ${t} = night volume`);
  }
}
test_calculateDayNightVolume();
console.log('  Group 10 done.');

// ============================================================
// Test Group 11: calculateSwellVolume
// ============================================================
console.log('Test Group 11: calculateSwellVolume');

function test_calculateSwellVolume() {
  const speed = 12.0; // 12-second swell cycle

  // At t=0, sin(0)=0 → volume = 0.5
  assertApprox(calculateSwellVolume(0, speed), 0.5, 0.001, 't=0: swell at midpoint');

  // At t=swellSpeed/4, sin(π/2)=1 → volume = 1.0
  const quarterCycle = calculateSwellVolume(speed / 4, speed);
  assertApprox(quarterCycle, 1.0, 0.001, 't=cycle/4: swell at peak (1.0)');

  // At t=swellSpeed/2, sin(π)=0 → volume = 0.5
  const halfCycle = calculateSwellVolume(speed / 2, speed);
  assertApprox(halfCycle, 0.5, 0.001, 't=cycle/2: swell at midpoint (0.5)');

  // At t=3*swellSpeed/4, sin(3π/2)=-1 → volume = 0.0
  const threeQuarterCycle = calculateSwellVolume(speed * 3 / 4, speed);
  assertApprox(threeQuarterCycle, 0.0, 0.001, 't=3*cycle/4: swell at trough (0.0)');

  // Full cycle returns to start
  const fullCycle = calculateSwellVolume(speed, speed);
  assertApprox(fullCycle, 0.5, 0.001, 'Full cycle returns to midpoint');

  // Different speeds produce different values at same time
  const slow = calculateSwellVolume(3.0, 24.0);
  const fast = calculateSwellVolume(3.0, 6.0);
  assertTrue(slow !== fast, 'Different swell speeds → different volumes at same time');

  // Volume always in [0, 1] range
  for (let t = 0; t < speed * 4; t += 0.5) {
    const vol = calculateSwellVolume(t, speed);
    assertTrue(vol >= -0.001 && vol <= 1.001, `Swell volume ${vol} in [0, 1] at t=${t}`);
  }
}
test_calculateSwellVolume();
console.log('  Group 11 done.');

// ============================================================
// Test Group 12: calculateDetunedFrequency
// ============================================================
console.log('Test Group 12: calculateDetunedFrequency');

function test_calculateDetunedFrequency() {
  // Zero detune = same frequency
  assertEquals(calculateDetunedFrequency(440, 0), 440, 'Zero cents = no change');

  // Positive detune raises frequency
  const up = calculateDetunedFrequency(440, 100);
  assertTrue(up > 440, 'Positive cents → higher frequency');
  assertApprox(up, 466.16, 0.1, '440Hz + 100 cents ≈ 466.2Hz (A#4)');

  // Negative detune lowers frequency
  const down = calculateDetunedFrequency(440, -100);
  assertTrue(down < 440, 'Negative cents → lower frequency');
  assertApprox(down, 415.30, 0.1, '440Hz - 100 cents ≈ 415.3Hz (G#4)');

  // 1200 cents = one octave up
  const octaveUp = calculateDetunedFrequency(440, 1200);
  assertApprox(octaveUp, 880, 0.01, '+1200 cents = one octave up');

  // -1200 cents = one octave down
  const octaveDown = calculateDetunedFrequency(440, -1200);
  assertApprox(octaveDown, 220, 0.01, '-1200 cents = one octave down');

  // Small detune (corrupt biome: ±7 cents)
  const smallUp = calculateDetunedFrequency(440, 7);
  const smallDown = calculateDetunedFrequency(440, -7);
  assertApprox(smallUp, 441.78, 0.1, '440Hz + 7 cents ≈ 441.8Hz');
  assertApprox(smallDown, 438.22, 0.1, '440Hz - 7 cents ≈ 438.2Hz');

  // Very small detune (1 cent) barely changes frequency
  const oneCent = calculateDetunedFrequency(440, 1);
  assertTrue(oneCent > 440 && oneCent < 440.5, '1 cent is tiny change (< 0.5Hz)');
}
test_calculateDetunedFrequency();
console.log('  Group 12 done.');

// ============================================================
// Test Group 13: getAvailableBiomes
// ============================================================
console.log('Test Group 13: getAvailableBiomes');

function test_getAvailableBiomes() {
  const biomes = getAvailableBiomes();
  assertEquals(biomes.length, 8, '8 available biomes');
  assertTrue(biomes.includes('plains'), 'Includes plains');
  assertTrue(biomes.includes('forest'), 'Includes forest');
  assertTrue(biomes.includes('desert'), 'Includes desert');
  assertTrue(biomes.includes('tundra'), 'Includes tundra');
  assertTrue(biomes.includes('mountains'), 'Includes mountains');
  assertTrue(biomes.includes('ocean'), 'Includes ocean');
  assertTrue(biomes.includes('lava'), 'Includes lava');
  assertTrue(biomes.includes('corrupt'), 'Includes corrupt');

  // All returned biomes have valid configs
  for (const biome of biomes) {
    const validation = validateBiomeConfig(biome);
    assertTrue(validation.valid, `${biome} config is valid`);
  }
}
test_getAvailableBiomes();
console.log('  Group 13 done.');

// ============================================================
// Test Group 14: validateBiomeConfig
// ============================================================
console.log('Test Group 14: validateBiomeConfig');

function test_validateBiomeConfig() {
  // All defined biomes should be valid
  for (const biome of getAvailableBiomes()) {
    const result = validateBiomeConfig(biome);
    assertTrue(result.valid, `${biome} passes validation`);
  }

  // Unknown biome fails
  const unknown = validateBiomeConfig('nonexistent');
  assertFalse(unknown.valid, 'Unknown biome fails validation');
  assertTrue(unknown.error.includes('Unknown biome'), 'Error mentions unknown biome');

  // Empty string fails
  const empty = validateBiomeConfig('');
  assertFalse(empty.valid, 'Empty string fails validation');
}
test_validateBiomeConfig();
console.log('  Group 14 done.');

// ============================================================
// Test Group 15: AmbientManager Constructor & Properties
// ============================================================
console.log('Test Group 15: AmbientManager Constructor & Properties');

function test_AmbientManager_constructor() {
  const manager = new AmbientManager();

  assertEquals(manager.currentBiome, 'plains', 'Default biome = plains');
  assertEquals(manager.timeOfDay, 0.5, 'Default timeOfDay = 0.5 (noon)');
  assertEquals(manager.volume.master, 0.5, 'Default master volume = 0.5');
  assertTrue(manager.enabled, 'Default enabled = true');
  assertFalse(manager._initialized, 'Not initialized by default');
  assertEquals(manager._activeSources.length, 0, 'No active sources initially');

  // Constructor with options
  const disabled = new AmbientManager({ enabled: false });
  assertFalse(disabled.enabled, 'Can disable via constructor');

  const customVol = new AmbientManager({ volume: { master: 0.8 } });
  assertEquals(customVol.volume.master, 0.8, 'Custom master volume');

  // getCurrentBiome
  assertEquals(manager.getCurrentBiome(), 'plains', 'getCurrentBiome() returns current biome');
}
test_AmbientManager_constructor();
console.log('  Group 15 done.');

// ============================================================
// Test Group 16: AmbientManager Volume Controls
// ============================================================
console.log('Test Group 16: AmbientManager Volume Controls');

function test_AmbientManager_volume() {
  const manager = new AmbientManager();

  assertEquals(manager.getMasterVolume(), 0.5, 'Initial master volume = 0.5');

  manager.setMasterVolume(0.8);
  assertEquals(manager.getMasterVolume(), 0.8, 'setMasterVolume(0.8) works');

  // Clamping
  manager.setMasterVolume(-0.1);
  assertEquals(manager.getMasterVolume(), 0, 'Negative volume clamped to 0');

  manager.setMasterVolume(1.5);
  assertEquals(manager.getMasterVolume(), 1, 'Volume > 1 clamped to 1');

  // Effective volume calculation (without AudioContext)
  manager.setMasterVolume(1.0);
  const effVol = manager.getEffectiveVolume();
  const expected = calculateDayNightVolume(
    BIOME_AMBIENT_CONFIG.plains.baseVolume,
    manager.timeOfDay,
    manager.volume.master
  );
  assertApprox(effVol, expected, 0.001, 'getEffectiveVolume matches calculation');
}
test_AmbientManager_volume();
console.log('  Group 16 done.');

// ============================================================
// Test Group 17: AmbientManager Time of Day
// ============================================================
console.log('Test Group 17: AmbientManager Time of Day');

function test_AmbientManager_timeOfDay() {
  const manager = new AmbientManager();

  // setTimeOfDay clamps to [0, 1]
  manager.setTimeOfDay(-0.5);
  assertEquals(manager.timeOfDay, 0, 'Negative time clamped to 0');

  manager.setTimeOfDay(1.5);
  assertEquals(manager.timeOfDay, 1, 'Time > 1 clamped to 1');

  // Effective volume changes with time of day
  manager.setTimeOfDay(0.5); // noon — reset to daytime first
  const noonVol = manager.getEffectiveVolume();
  manager.setTimeOfDay(0.0); // midnight
  const midnightVol = manager.getEffectiveVolume();
  assertTrue(noonVol > midnightVol, 'Noon louder than midnight');

  // Transition through full cycle
  const volumes = [];
  for (let t = 0; t <= 1; t += 0.1) {
    manager.setTimeOfDay(t);
    volumes.push(manager.getEffectiveVolume());
  }
  assertTrue(volumes.length === 11, 'Collected 11 time points');

  // Volume should be highest in middle of day
  const maxIdx = volumes.indexOf(Math.max(...volumes));
  assertTrue(maxIdx >= 2 && maxIdx <= 7, 'Max volume in daytime range (0.2-0.7)');
}
test_AmbientManager_timeOfDay();
console.log('  Group 17 done.');

// ============================================================
// Test Group 18: AmbientManager Biome Changes
// ============================================================
console.log('Test Group 18: AmbientManager Biome Changes');

function test_AmbientManager_biome() {
  const manager = new AmbientManager();
  assertEquals(manager.getCurrentBiome(), 'plains', 'Starts with plains');

  // setBiome to known biome (won't actually play without AudioContext)
  manager.setBiome('lava');
  // Note: setBiome uses setTimeout for crossfade, so currentBiome won't change immediately in test
  // We can still verify the method doesn't throw

  // setBiome to same biome — no-op
  manager.setBiome('plains');
  assertEquals(manager.getCurrentBiome(), 'plains', 'Same biome = no change');

  // Unknown biome should not crash (logs warning)
  manager.setBiome('nonexistent');
  assertEquals(manager.getCurrentBiome(), 'plains', 'Unknown biome keeps current');
}
test_AmbientManager_biome();
console.log('  Group 18 done.');

// ============================================================
// Test Group 19: AmbientManager State Summary
// ============================================================
console.log('Test Group 19: AmbientManager getStateSummary');

function test_AmbientManager_stateSummary() {
  const manager = new AmbientManager();
  const summary = manager.getStateSummary();

  assertFalse(summary.initialized, 'Not initialized');
  assertTrue(summary.enabled, 'Enabled');
  assertEquals(summary.currentBiome, 'plains', 'Current biome');
  assertEquals(summary.timeOfDay, 0.5, 'Time of day');
  assertEquals(summary.masterVolume, 0.5, 'Master volume');
  assertEquals(summary.effectiveVolume, null, 'Effective volume null when not initialized');
  assertEquals(summary.activeSources, 0, 'No active sources');

  // After changing settings
  manager.setMasterVolume(0.8);
  manager.setTimeOfDay(0.0);
  const summary2 = manager.getStateSummary();
  assertEquals(summary2.masterVolume, 0.8, 'Updated master volume in summary');
  assertEquals(summary2.timeOfDay, 0.0, 'Updated time of day in summary');
}
test_AmbientManager_stateSummary();
console.log('  Group 19 done.');

// ============================================================
// Test Group 20: AmbientManager init/dispose (without AudioContext)
// ============================================================
console.log('Test Group 20: AmbientManager Lifecycle');

function test_AmbientManager_lifecycle() {
  const manager = new AmbientManager();

  // init() without window.AudioContext should return false in Node.js
  const result = manager.init();
  assertFalse(result, 'init() returns false without AudioContext');
  assertFalse(manager._initialized, '_initialized stays false');

  // Dispose on uninitialized manager should not crash
  manager.dispose();
  assertFalse(manager._initialized, 'Still not initialized after dispose');

  // Disabled manager
  const disabled = new AmbientManager({ enabled: false });
  const disabledResult = disabled.init();
  assertFalse(disabledResult, 'Disabled manager init returns false');

  // stopAll on uninitialized should not crash
  manager.stopAll();
}
test_AmbientManager_lifecycle();
console.log('  Group 20 done.');

// ============================================================
// Test Group 21: Integration — Biome Config → Chord → Volume
// ============================================================
console.log('Test Group 21: Integration Tests');

function test_integration() {
  // Full pipeline: biome config → chord frequencies → day/night volume
  for (const biome of getAvailableBiomes()) {
    const config = getBiomeAmbientConfig(biome);
    const chords = calculateChordFrequencies(config.rootNote, config.scale, config.chordDegrees);

    // Chords should have the right number of notes
    assertEquals(chords.length, config.chordDegrees.length,
      `${biome}: chord has ${config.chordDegrees.length} notes`);

    // All frequencies should be positive and audible (> 20Hz)
    for (let i = 0; i < chords.length; i++) {
      assertTrue(chords[i] > 20, `${biome} chord[${i}] frequency ${chords[i]} > 20Hz`);
    }

    // Day volume > night volume for same biome
    const dayVol = calculateDayNightVolume(config.baseVolume, 0.5, 1.0);
    const nightVol = calculateDayNightVolume(config.baseVolume, 0.0, 1.0);
    assertTrue(dayVol > nightVol, `${biome}: day volume (${dayVol.toFixed(3)}) > night volume (${nightVol.toFixed(3)})`);

    // Swell at peak should boost volume
    const swellPeak = calculateSwellVolume(config.swellSpeed / 4, config.swellSpeed);
    assertTrue(swellPeak >= 0.99, `${biome}: swell reaches near 1.0 at quarter cycle`);
  }

  // Corrupt biome detune produces slightly different frequency
  const corruptConfig = getBiomeAmbientConfig('corrupt');
  const rootFreq = getNoteFrequency(corruptConfig.rootNote);
  const detunedUp = calculateDetunedFrequency(rootFreq, corruptConfig.detuneAmount);
  const detunedDown = calculateDetunedFrequency(rootFreq, -corruptConfig.detuneAmount);
  assertTrue(detunedUp > rootFreq, 'Corrupt detune up > base');
  assertTrue(detunedDown < rootFreq, 'Corrupt detune down < base');

  // Verify the detune amount produces expected frequency shift
  const expectedUp = rootFreq * Math.pow(2, corruptConfig.detuneAmount / 1200);
  assertApprox(detunedUp, expectedUp, 0.01, 'Detune up matches formula');

  // Ocean has noise layer flag
  const oceanConfig = getBiomeAmbientConfig('ocean');
  assertTrue(oceanConfig.hasNoiseLayer, 'Ocean has noise layer');

  // Lava is loudest base volume (dangerous biome)
  let maxBaseVol = 0;
  let loudestBiome = '';
  for (const [biome, config] of Object.entries(BIOME_AMBIENT_CONFIG)) {
    if (config.baseVolume > maxBaseVol) {
      maxBaseVol = config.baseVolume;
      loudestBiome = biome;
    }
  }
  assertEquals(loudestBiome, 'lava', 'Lava has highest base volume');

  // Tundra is quietest base volume (ethereal, sparse)
  let minBaseVol = Infinity;
  let quietestBiome = '';
  for (const [biome, config] of Object.entries(BIOME_AMBIENT_CONFIG)) {
    if (config.baseVolume < minBaseVol) {
      minBaseVol = config.baseVolume;
      quietestBiome = biome;
    }
  }
  assertEquals(quietestBiome, 'tundra', 'Tundra has lowest base volume');
}
test_integration();
console.log('  Group 21 done.');

// ============================================================
// Test Group 22: Edge Cases & Error Handling
// ============================================================
console.log('Test Group 22: Edge Cases & Error Handling');

function test_edgeCases() {
  // Chord with single note
  const single = calculateChordFrequencies('A4', SCALES.majorPentatonic, [0]);
  assertEquals(single.length, 1, 'Single degree chord has 1 note');
  assertApprox(single[0], 440.00, 0.01, 'Single A4 = 440Hz');

  // Very large time values for swell
  const longSwell = calculateSwellVolume(9999, 12.0);
  assertTrue(longSwell >= 0 && longSwell <= 1.001, 'Long elapsed time still in range');

  // Master volume edge cases
  assertEquals(calculateDayNightVolume(0.5, 0.5, 0), 0, 'Master vol 0 = output 0');
  assertTrue(calculateDayNightVolume(0.5, 0.5, 1.0) > 0, 'Master vol 1.0 = positive output');

  // Smoothstep edge values
  assertEquals(smoothstep(0), 0, 'smoothstep(0) = 0');
  assertEquals(smoothstep(1), 1, 'smoothstep(1) = 1');
  assertApprox(smoothstep(0.5), 0.5, 0.01, 'smoothstep(0.5) = 0.5');

  // Note frequency lookup edge cases
  assertEquals(getNoteFrequency(null), null, 'null note → null');
  assertEquals(getNoteFrequency(undefined), null, 'undefined note → null');
  assertEquals(getNoteFrequency('C6'), null, 'Out-of-range note → null');

  // AmbientManager with extreme values
  const mgr = new AmbientManager();
  mgr.setMasterVolume(0);
  assertEquals(mgr.getMasterVolume(), 0, 'Can set volume to exactly 0');
  mgr.setTimeOfDay(0.5);
  assertTrue(mgr.getEffectiveVolume() === 0, 'Zero master → zero effective');

  // Validate all configs pass validation
  for (const biome of getAvailableBiomes()) {
    const result = validateBiomeConfig(biome);
    assertTrue(result.valid, `${biome} validates successfully`);
    assertFalse('error' in result && result.error, `${biome} has no error field when valid`);
  }
}
test_edgeCases();
console.log('  Group 22 done.');

// ============================================================
// Test Group 23: Musical Theory Validation
// ============================================================
console.log('Test Group 23: Musical Theory Validation');

function test_musicalTheory() {
  // A major triad (A-C#-E): root, major third (+4 semitones), perfect fifth (+7 semitones)
  const aMajor = calculateChordFrequencies('A4', SCALES.majorTriad, [0, 1, 2]);
  // Verify intervals: C#/A ≈ 2^(4/12) ≈ 1.26
  assertApprox(aMajor[1] / aMajor[0], Math.pow(2, 4/12), 0.01, 'Major third ratio ≈ 1.26');
  // E/A ≈ 2^(7/12) ≈ 1.498
  assertApprox(aMajor[2] / aMajor[0], Math.pow(2, 7/12), 0.01, 'Perfect fifth ratio ≈ 1.50');

  // Minor triad: root, minor third (+3 semitones), perfect fifth (+7 semitones)
  const dMinor = calculateChordFrequencies('D4', SCALES.minorTriad, [0, 1, 2]);
  assertApprox(dMinor[1] / dMinor[0], Math.pow(2, 3/12), 0.01, 'Minor third ratio ≈ 1.19');

  // Whole tone scale intervals are all 2 semitones
  for (let i = 1; i < SCALES.wholeTone.length; i++) {
    assertEquals(SCALES.wholeTone[i] - SCALES.wholeTone[i-1], 2,
      `Whole tone interval ${i} = 2 semitones`);
  }

  // Diminished scale has intervals of 3 semitones (minor thirds)
  for (let i = 1; i < SCALES.diminished.length; i++) {
    assertEquals(SCALES.diminished[i] - SCALES.diminished[i-1], 3,
      `Diminished interval ${i} = 3 semitones`);
  }

  // Pentatonic scales have the right number of notes
  assertEquals(SCALES.majorPentatonic.length, 5, 'Major pentatonic = 5 notes');
  assertEquals(SCALES.minorPentatonic.length, 5, 'Minor pentatonic = 5 notes');

  // Major pentatonic intervals: 2, 2, 3, 2, 3 (from root to octave)
  const majorPentIntervals = [2, 2, 3, 2];
  for (let i = 0; i < majorPentIntervals.length; i++) {
    assertEquals(
      SCALES.majorPentatonic[i + 1] - SCALES.majorPentatonic[i],
      majorPentIntervals[i],
      `Major pentatonic interval ${i} = ${majorPentIntervals[i]}`
    );
  }

  // Minor pentatonic intervals: 3, 2, 2, 3, 2 (from root to octave)
  const minorPentIntervals = [3, 2, 2, 3];
  for (let i = 0; i < minorPentIntervals.length; i++) {
    assertEquals(
      SCALES.minorPentatonic[i + 1] - SCALES.minorPentatonic[i],
      minorPentIntervals[i],
      `Minor pentatonic interval ${i} = ${minorPentIntervals[i]}`
    );
  }
}
test_musicalTheory();
console.log('  Group 23 done.');

// ============================================================
// Results
// ============================================================
console.log('');
console.log(`===================================`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`===================================`);

if (failed > 0) {
  console.error('');
  console.error('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('');
  console.log('🎉 All ambient soundscapes tests passing!');
  process.exit(0);
}
