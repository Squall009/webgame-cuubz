#!/usr/bin/env node
/**
 * Cuubz — Procedural Sound Effects Tests
 * Tests for SFX system: material params, block mapping, footstep surfaces,
 * volume calculation, noise generation, and SoundManager class behavior.
 * All tests run without Web Audio API (pure function testing).
 */

'use strict';

const {
  SFX_CATEGORY,
  BLOCK_MATERIALS,
  MATERIAL_SOUND_PARAMS,
  FOOTSTEP_SURFACES,
  FOOTSTEP_PARAMS,
  SPECIAL_SFX_PARAMS,
  DEFAULT_VOLUME,

  getMaterialParams,
  getFootstepParams,
  getSpecialSfxParams,
  calculateVolume,
  blockIdToMaterial,
  biomeToFootstepSurface,

  generateNoiseBuffer,
  rms,
  sampleRange,

  SoundManager,
} = require('../js/audio/sfx');

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
  assert(condition === true, message);
}

function assertFalse(condition, message) {
  assert(condition === false, message);
}

function assertNotNull(value, message) {
  assert(value !== null && value !== undefined, message);
}

function assertInRange(value, min, max, message) {
  assert(value >= min && value <= max, `${message}: expected ${min}-${max}, got ${value}`);
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message}: expected ~${expected}, got ${actual} (diff: ${diff.toFixed(4)})`);
}

console.log('Testing procedural sound effects system...\n');

// ============================================================
// Test Group 1: Constants Structure
// ============================================================
console.log('--- SFX_CATEGORY constants ---');
assertEquals(SFX_CATEGORY.BLOCK_BREAK, 'block_break', 'BLOCK_BREAK category');
assertEquals(SFX_CATEGORY.BLOCK_PLACE, 'block_place', 'BLOCK_PLACE category');
assertEquals(SFX_CATEGORY.FOOTSTEP, 'footstep', 'FOOTSTEP category');
assertEquals(SFX_CATEGORY.JUMP, 'jump', 'JUMP category');
assertEquals(SFX_CATEGORY.LAND, 'land', 'LAND category');
assertEquals(SFX_CATEGORY.DAMAGE, 'damage', 'DAMAGE category');
assertEquals(SFX_CATEGORY.UI_CLICK, 'ui_click', 'UI_CLICK category');
assertEquals(SFX_CATEGORY.UI_HOVER, 'ui_hover', 'UI_HOVER category');
assertEquals(SFX_CATEGORY.EATING, 'eating', 'EATING category');
assertEquals(SFX_CATEGORY.DRINKING, 'drinking', 'DRINKING category');
assertEquals(Object.keys(SFX_CATEGORY).length, 10, '10 SFX categories defined');

console.log('--- BLOCK_MATERIALS constants ---');
assertTrue(BLOCK_MATERIALS.GRASS === 'grass', 'GRASS material name');
assertTrue(BLOCK_MATERIALS.STONE === 'stone', 'STONE material name');
assertTrue(BLOCK_MATERIALS.METAL === 'metal', 'METAL material name');
assertTrue(BLOCK_MATERIALS.CORRUPT === 'corrupt', 'CORRUPT material name');
assertEquals(Object.keys(BLOCK_MATERIALS).length, 17, '17 block materials defined');

console.log('--- FOOTSTEP_SURFACES constants ---');
assertEquals(FOOTSTEP_SURFACES.GRASS, 'grass', 'GRASS footstep surface');
assertEquals(FOOTSTEP_SURFACES.ICE, 'ice', 'ICE footstep surface');
assertEquals(FOOTSTEP_SURFACES.SAND, 'sand', 'SAND footstep surface');
assertEquals(Object.keys(FOOTSTEP_SURFACES).length, 9, '9 footstep surfaces defined');

console.log('--- DEFAULT_VOLUME structure ---');
assertInRange(DEFAULT_VOLUME.master, 0, 1, 'Master volume in range');
assertInRange(DEFAULT_VOLUME.sfx, 0, 1, 'SFX volume in range');
assertEquals(DEFAULT_VOLUME.master, 0.7, 'Default master volume is 0.7');
assertEquals(DEFAULT_VOLUME.sfx, 0.6, 'Default SFX volume is 0.6');

// ============================================================
// Test Group 2: Material Sound Parameters
// ============================================================
console.log('\n--- MATERIAL_SOUND_PARAMS structure ---');

// All materials must be defined
for (const mat of Object.values(BLOCK_MATERIALS)) {
  assertNotNull(MATERIAL_SOUND_PARAMS[mat], `Params exist for material ${mat}`);
}

// Each param must have required fields
for (const [mat, params] of Object.entries(MATERIAL_SOUND_PARAMS)) {
  assertNotNull(params.freq, `${mat}: has freq`);
  assertNotNull(params.noiseRatio, `${mat}: has noiseRatio`);
  assertNotNull(params.duration, `${mat}: has duration`);
  assertNotNull(params.volume, `${mat}: has volume`);
  assert(params.freq > 0, `${mat}: freq positive (${params.freq})`);
  assertInRange(params.noiseRatio, 0, 1, `${mat}: noiseRatio 0-1`);
  assert(params.duration > 0, `${mat}: duration positive (${params.duration})`);
  assertInRange(params.volume, 0, 1, `${mat}: volume 0-1`);
}

// Specific material characteristics
console.log('\n--- Material sound characteristics ---');
const stone = MATERIAL_SOUND_PARAMS[BLOCK_MATERIALS.STONE];
const sand = MATERIAL_SOUND_PARAMS[BLOCK_MATERIALS.SAND];
const ice = MATERIAL_SOUND_PARAMS[BLOCK_MATERIALS.ICE];
const metal = MATERIAL_SOUND_PARAMS[BLOCK_MATERIALS.METAL];

assertTrue(stone.freq > sand.freq, 'Stone freq > sand freq (harder material = higher pitch)');
assertTrue(ice.freq > stone.freq, 'Ice freq > stone freq');
assertTrue(metal.freq > ice.freq, 'Metal freq highest (metallic ring)');
assertTrue(sand.noiseRatio > stone.noiseRatio, 'Sand has more noise than stone (granular vs solid)');
assertInRange(stone.duration, 0.05, 0.3, 'Stone duration reasonable');

// ============================================================
// Test Group 3: getMaterialParams()
// ============================================================
console.log('\n--- getMaterialParams() ---');

const grassBreak = getMaterialParams(BLOCK_MATERIALS.GRASS, false);
const grassPlace = getMaterialParams(BLOCK_MATERIALS.GRASS, true);
assertEquals(grassBreak.freq, 180, 'Grass break freq is 180');
assertTrue(grassPlace.freq > grassBreak.freq, 'Place freq > break freq (higher pitch on place)');
assertApprox(grassPlace.freq, Math.round(180 * 1.2), 1, 'Place freq ~1.2x break freq');
assertTrue(grassPlace.duration < grassBreak.duration, 'Place duration < break duration');
assertTrue(grassPlace.volume < grassBreak.volume, 'Place volume slightly lower');

// Unknown material falls back to stone
const unknown = getMaterialParams('unknown_material', false);
assertEquals(unknown.freq, MATERIAL_SOUND_PARAMS[BLOCK_MATERIALS.STONE].freq, 'Unknown material defaults to stone freq');

// ============================================================
// Test Group 4: Footstep Parameters
// ============================================================
console.log('\n--- FOOTSTEP_PARAMS structure ---');

for (const [surface, params] of Object.entries(FOOTSTEP_PARAMS)) {
  assertNotNull(params.freq, `${surface}: has freq`);
  assertNotNull(params.noiseRatio, `${surface}: has noiseRatio`);
  assertNotNull(params.duration, `${surface}: has duration`);
  assertNotNull(params.volume, `${surface}: has volume`);
  assertInRange(params.volume, 0, 1, `${surface}: volume 0-1`);
}

// getFootstepParams returns correct params
const snowStep = getFootstepParams(FOOTSTEP_SURFACES.SNOW);
assertEquals(snowStep.freq, 90, 'Snow footstep freq is 90');
assertTrue(snowStep.noiseRatio > 0.9, 'Snow footstep high noise ratio (crunchy)');

const iceStep = getFootstepParams(FOOTSTEP_SURFACES.ICE);
assertTrue(iceStep.freq > snowStep.freq, 'Ice footstep freq > snow (harder surface)');

// Unknown surface falls back to dirt
const unknownSurface = getFootstepParams('unknown_surface');
assertEquals(unknownSurface.freq, FOOTSTEP_PARAMS[FOOTSTEP_SURFACES.DIRT].freq, 'Unknown surface defaults to dirt');

// ============================================================
// Test Group 5: Special SFX Parameters
// ============================================================
console.log('\n--- SPECIAL_SFX_PARAMS ---');

assertTrue(SPECIAL_SFX_PARAMS.JUMP !== null, 'JUMP params exist');
assertTrue(SPECIAL_SFX_PARAMS.LAND !== null, 'LAND params exist');
assertTrue(SPECIAL_SFX_PARAMS.DAMAGE !== null, 'DAMAGE params exist');
assertTrue(SPECIAL_SFX_PARAMS.UI_CLICK !== null, 'UI_CLICK params exist');
assertTrue(SPECIAL_SFX_PARAMS.UI_HOVER !== null, 'UI_HOVER params exist');
assertTrue(SPECIAL_SFX_PARAMS.EATING !== null, 'EATING params exist');
assertTrue(SPECIAL_SFX_PARAMS.DRINKING !== null, 'DRINKING params exist');

// JUMP is a sweep (rising frequency)
assertTrue(SPECIAL_SFX_PARAMS.JUMP.targetFreq > SPECIAL_SFX_PARAMS.JUMP.freq, 'Jump sweeps upward');
assertEquals(SPECIAL_SFX_PARAMS.JUMP.type, 'sweep', 'Jump type is sweep');

// DAMAGE is a sweep (falling frequency)
assertTrue(SPECIAL_SFX_PARAMS.DAMAGE.targetFreq < SPECIAL_SFX_PARAMS.DAMAGE.freq, 'Damage sweeps downward');

// UI sounds are short
assertInRange(SPECIAL_SFX_PARAMS.UI_CLICK.duration, 0.01, 0.1, 'UI click duration short');
assertInRange(SPECIAL_SFX_PARAMS.UI_HOVER.duration, 0.01, 0.05, 'UI hover duration very short');

// getSpecialSfxParams returns correct data
const jumpParams = getSpecialSfxParams('JUMP');
assertEquals(jumpParams.freq, 300, 'Jump start freq is 300');
const unknownSfx = getSpecialSfxParams('NONEXISTENT');
assert(unknownSfx === null, 'Unknown SFX returns null');

// ============================================================
// Test Group 6: Volume Calculation
// ============================================================
console.log('\n--- calculateVolume() ---');

// Normal case
const vol1 = calculateVolume(0.3, 0.7, 0.6);
assertApprox(vol1, 0.3 * 0.7 * 0.6, 0.001, 'Normal volume calculation');

// Master at 0 mutes everything
assertEquals(calculateVolume(0.5, 0, 0.6), 0, 'Master=0 mutes sound');

// Category at 0 mutes
assertEquals(calculateVolume(0.5, 0.7, 0), 0, 'Category=0 mutes sound');

// Max values don't exceed 1
assertInRange(calculateVolume(1, 1, 1), 0, 1, 'Max volume capped at 1');

// Negative values clamped to 0
assertEquals(calculateVolume(-0.5, 0.7, 0.6), 0, 'Negative sound volume clamped to 0');
assertEquals(calculateVolume(0.5, -1, 0.6), 0, 'Negative master volume clamped to 0');

// Values > 1 clamped
assertInRange(calculateVolume(2, 2, 2), 0, 1, 'Over-unity volumes clamped to 0-1');

// Undefined uses defaults
const defaultVol = calculateVolume(0.5);
assert(defaultVol > 0, 'Undefined master/category uses defaults');

// ============================================================
// Test Group 7: Block ID to Material Mapping
// ============================================================
console.log('\n--- blockIdToMaterial() ---');

assertEquals(blockIdToMaterial(0), BLOCK_MATERIALS.STONE, 'Air (0) → stone default');
assertEquals(blockIdToMaterial(1), BLOCK_MATERIALS.GRASS, 'Grass (1) → grass');
assertEquals(blockIdToMaterial(2), BLOCK_MATERIALS.DIRT, 'Dirt (2) → dirt');
assertEquals(blockIdToMaterial(3), BLOCK_MATERIALS.STONE, 'Stone (3) → stone');
assertEquals(blockIdToMaterial(4), BLOCK_MATERIALS.SAND, 'Sand (4) → sand');
assertEquals(blockIdToMaterial(5), BLOCK_MATERIALS.GRAVEL, 'Gravel (5) → gravel');
assertEquals(blockIdToMaterial(6), BLOCK_MATERIALS.WATER, 'Water (6) → water');
assertEquals(blockIdToMaterial(7), BLOCK_MATERIALS.WOOD, 'Wood Log (7) → wood');
assertEquals(blockIdToMaterial(8), BLOCK_MATERIALS.LEAVES, 'Leaves (8) → leaves');
assertEquals(blockIdToMaterial(9), BLOCK_MATERIALS.SNOW, 'Snow (9) → snow');
assertEquals(blockIdToMaterial(10), BLOCK_MATERIALS.ICE, 'Ice (10) → ice');
assertEquals(blockIdToMaterial(11), BLOCK_MATERIALS.BEDROCK, 'Bedrock (11) → bedrock');
assertEquals(blockIdToMaterial(12), BLOCK_MATERIALS.PLANKS, 'Planks (12) → planks');
assertEquals(blockIdToMaterial(13), BLOCK_MATERIALS.OBSIDIAN, 'Obsidian (13) → obsidian');
assertEquals(blockIdToMaterial(14), BLOCK_MATERIALS.STONE, 'Blackstone (14) → stone');
assertEquals(blockIdToMaterial(15), BLOCK_MATERIALS.LAVA, 'Lava (15) → lava');
assertEquals(blockIdToMaterial(16), BLOCK_MATERIALS.CORRUPT, 'Corrupt Stone (16) → corrupt');
assertEquals(blockIdToMaterial(17), BLOCK_MATERIALS.CORRUPT, 'Toxic Slime (17) → corrupt');

// Ores map to metal
assertEquals(blockIdToMaterial(18), BLOCK_MATERIALS.METAL, 'Coal Ore (18) → metal');
assertEquals(blockIdToMaterial(19), BLOCK_MATERIALS.METAL, 'Iron Ore (19) → metal');
assertEquals(blockIdToMaterial(20), BLOCK_MATERIALS.METAL, 'Gold Ore (20) → metal');
assertEquals(blockIdToMaterial(21), BLOCK_MATERIALS.METAL, 'Diamond Ore (21) → metal');

// Special blocks
assertEquals(blockIdToMaterial(22), BLOCK_MATERIALS.CORRUPT, 'Corrupt Crystal (22) → corrupt');
assertEquals(blockIdToMaterial(23), BLOCK_MATERIALS.WOOD, 'Bed (23) → wood');
assertEquals(blockIdToMaterial(24), BLOCK_MATERIALS.GRASS, 'Apple (24) → grass');
assertEquals(blockIdToMaterial(25), BLOCK_MATERIALS.METAL, 'Quest Key (25) → metal');
assertEquals(blockIdToMaterial(26), BLOCK_MATERIALS.STONE, 'Boss Spawn (26) → stone');

// Unknown block ID defaults to stone
assertEquals(blockIdToMaterial(999), BLOCK_MATERIALS.STONE, 'Unknown block ID → stone default');
assertEquals(blockIdToMaterial(-1), BLOCK_MATERIALS.STONE, 'Negative block ID → stone default');

// ============================================================
// Test Group 8: Biome to Footstep Surface Mapping
// ============================================================
console.log('\n--- biomeToFootstepSurface() ---');

assertEquals(biomeToFootstepSurface('plains'), FOOTSTEP_SURFACES.GRASS, 'Plains → grass footstep');
assertEquals(biomeToFootstepSurface('forest'), FOOTSTEP_SURFACES.GRASS, 'Forest → grass footstep');
assertEquals(biomeToFootstepSurface('desert'), FOOTSTEP_SURFACES.SAND, 'Desert → sand footstep');
assertEquals(biomeToFootstepSurface('tundra'), FOOTSTEP_SURFACES.SNOW, 'Tundra → snow footstep');
assertEquals(biomeToFootstepSurface('mountains'), FOOTSTEP_SURFACES.STONE, 'Mountains → stone footstep');
assertEquals(biomeToFootstepSurface('ocean'), FOOTSTEP_SURFACES.WATER, 'Ocean → water footstep');
assertEquals(biomeToFootstepSurface('lava'), FOOTSTEP_SURFACES.STONE, 'Lava → stone footstep');
assertEquals(biomeToFootstepSurface('corrupt'), FOOTSTEP_SURFACES.STONE, 'Corrupt → stone footstep');

// Unknown biome defaults to dirt
assertEquals(biomeToFootstepSurface('unknown_biome'), FOOTSTEP_SURFACES.DIRT, 'Unknown biome → dirt default');

// ============================================================
// Test Group 9: Noise Buffer Generation
// ============================================================
console.log('\n--- generateNoiseBuffer() ---');

// Correct length
const buf1 = generateNoiseBuffer(100);
assertEquals(buf1.length, 100, 'Buffer has correct length');
assert(buf1 instanceof Float32Array, 'Returns Float32Array');

// Values in range [-1, 1]
const range1 = sampleRange(buf1);
assertTrue(range1.min >= -1, 'Noise min >= -1');
assertTrue(range1.max <= 1, 'Noise max <= 1');

// Deterministic with same seed
const buf2 = generateNoiseBuffer(100, 42);
const buf3 = generateNoiseBuffer(100, 42);
assertTrue(buf2.every((v, i) => v === buf3[i]), 'Same seed produces identical buffer');

// Different seeds produce different buffers
const buf4 = generateNoiseBuffer(100, 99);
assertFalse(buf2.every((v, i) => v === buf4[i]), 'Different seeds produce different buffers');

// Seed 0 handled (not all zeros)
const buf5 = generateNoiseBuffer(100, 0);
const nonZero = buf5.some(v => v !== 0);
assertTrue(nonZero, 'Seed 0 produces non-zero noise (LCG fix)');

// RMS of white noise should be ~1/sqrt(3) ≈ 0.577 for uniform [-1,1]
const largeBuf = generateNoiseBuffer(10000, 12345);
const rmsVal = rms(largeBuf);
assertInRange(rmsVal, 0.4, 0.8, `RMS of white noise ~0.577, got ${rmsVal.toFixed(3)}`);

// ============================================================
// Test Group 10: RMS and Sample Range Utilities
// ============================================================
console.log('\n--- rms() utility ---');

const zeros = new Float32Array([0, 0, 0]);
assertEquals(rms(zeros), 0, 'RMS of zeros is 0');

const ones = new Float32Array([1, 1, 1]);
assertApprox(rms(ones), 1, 0.001, 'RMS of all ones is 1');

const mixed = new Float32Array([1, -1, 1, -1]);
assertApprox(rms(mixed), 1, 0.001, 'RMS of alternating ±1 is 1');

console.log('\n--- sampleRange() utility ---');

const rangeZeros = sampleRange(new Float32Array([0, 0, 0]));
assertEquals(rangeZeros.min, 0, 'Range min of zeros is 0');
assertEquals(rangeZeros.max, 0, 'Range max of zeros is 0');

const rangeMixed = sampleRange(new Float32Array([-0.5, 0.3, 0.8, -0.9]));
assertApprox(rangeMixed.min, -0.9, 0.001, 'Range min correct');
assertApprox(rangeMixed.max, 0.8, 0.001, 'Range max correct');

// ============================================================
// Test Group 11: SoundManager Constructor & Basic Properties
// ============================================================
console.log('\n--- SoundManager constructor ---');

const sm = new SoundManager();
assert(sm.ctx === null, 'ctx is null before init');
assert(sm.masterGain === null, 'masterGain is null before init');
assert(sm.sfxGain === null, 'sfxGain is null before init');
assertTrue(sm.enabled === true, 'enabled defaults to true');
assertFalse(sm._initialized, '_initialized defaults to false');

const smDisabled = new SoundManager({ enabled: false });
assertFalse(smDisabled.enabled, 'Can disable via constructor');

// ============================================================
// Test Group 12: SoundManager Volume Methods (no AudioContext)
// ============================================================
console.log('\n--- SoundManager volume methods ---');

sm.setMasterVolume(0.5);
assertEquals(sm.volume.master, 0.5, 'setMasterVolume sets value');

sm.setMasterVolume(0);
assertEquals(sm.volume.master, 0, 'setMasterVolume allows 0');

sm.setMasterVolume(1);
assertEquals(sm.volume.master, 1, 'setMasterVolume allows 1');

// Clamping
sm.setMasterVolume(-0.5);
assertEquals(sm.volume.master, 0, 'Negative master volume clamped to 0');

sm.setMasterVolume(2.0);
assertEquals(sm.volume.master, 1, 'Over-unity master volume clamped to 1');

sm.setSfxVolume(0.3);
assertEquals(sm.volume.sfx, 0.3, 'setSfxVolume sets value');

// getEffectiveVolume without AudioContext
sm.volume.master = 0.7;
sm.volume.sfx = 0.6;
const effVol = sm.getEffectiveVolume(0.5);
assertApprox(effVol, calculateVolume(0.5, 0.7, 0.6), 0.001, 'getEffectiveVolume matches calculateVolume');

// ============================================================
// Test Group 13: SoundManager init without AudioContext (Node.js)
// ============================================================
console.log('\n--- SoundManager.init() in Node.js ---');

const result = sm.init();
assertFalse(result, 'init returns false without window.AudioContext');
assertFalse(sm._initialized, '_initialized stays false in Node.js');

// ============================================================
// Test Group 14: SoundManager playback methods return false when not initialized
// ============================================================
console.log('\n--- Playback methods before init ---');

assertFalse(sm.playBlockBreak(3), 'playBlockBreak returns false before init');
assertFalse(sm.playBlockPlace(1), 'playBlockPlace returns false before init');
assertFalse(sm.playFootstep('grass'), 'playFootstep returns false before init');
assertFalse(sm.playJump(), 'playJump returns false before init');
assertFalse(sm.playLand(), 'playLand returns false before init');
assertFalse(sm.playDamage(), 'playDamage returns false before init');
assertFalse(sm.playUiClick(), 'playUiClick returns false before init');
assertFalse(sm.playUiHover(), 'playUiHover returns false before init');
assertFalse(sm.playEating(), 'playEating returns false before init');
assertFalse(sm.playDrinking(), 'playDrinking returns false before init');

// ============================================================
// Test Group 15: Disabled SoundManager
// ============================================================
console.log('\n--- Disabled SoundManager ---');

const smOff = new SoundManager({ enabled: false });
assertFalse(smOff.playBlockBreak(3), 'Disabled manager rejects block break');
assertFalse(smOff.playJump(), 'Disabled manager rejects jump');
assertFalse(smOff.init(), 'Disabled manager init returns false');

// ============================================================
// Test Group 16: SoundManager dispose
// ============================================================
console.log('\n--- SoundManager.dispose() ---');

sm.dispose();
assert(sm.ctx === null, 'ctx cleared after dispose');
assertFalse(sm._initialized, '_initialized reset after dispose');

// Calling dispose again shouldn't error
sm.dispose();
assertFalse(sm._initialized, 'Double dispose is safe');

// ============================================================
// Test Group 17: stopAll without context
// ============================================================
console.log('\n--- SoundManager.stopAll() without init ---');

const smFresh = new SoundManager();
smFresh.stopAll(); // Should not throw
assertTrue(true, 'stopAll without init does not throw');

// ============================================================
// Test Group 18: Integration — Material → Params → Volume pipeline
// ============================================================
console.log('\n--- Integration: full sound pipeline ---');

// Simulate breaking a stone block (ID=3)
const mat = blockIdToMaterial(3);
assertEquals(mat, BLOCK_MATERIALS.STONE, 'Block 3 maps to STONE material');

const breakParams = getMaterialParams(mat, false);
assertTrue(breakParams.freq === 440, 'Stone break freq is 440 Hz');

const placeParams = getMaterialParams(mat, true);
assertTrue(placeParams.freq > breakParams.freq, 'Place freq higher than break');
assertTrue(placeParams.duration < breakParams.duration, 'Place shorter than break');

const effectiveVol = calculateVolume(breakParams.volume, 0.7, 0.6);
assert(effectiveVol > 0 && effectiveVol < 1, `Effective volume ${effectiveVol.toFixed(3)} in valid range`);

// Simulate walking on snow biome
const snowSurface = biomeToFootstepSurface('tundra');
assertEquals(snowSurface, FOOTSTEP_SURFACES.SNOW, 'Tundra maps to snow footstep surface');
const stepParams = getFootstepParams(snowSurface);
assertTrue(stepParams.noiseRatio > 0.9, 'Snow footsteps are mostly noise (crunchy)');

// ============================================================
// Test Group 19: Edge Cases
// ============================================================
console.log('\n--- Edge cases ---');

// Empty buffer
const emptyRms = rms(new Float32Array(0));
assert(emptyRms === 0 || isNaN(emptyRms), 'RMS of empty buffer is 0 or NaN');

// Single sample
const singleRange = sampleRange(new Float32Array([0.5]));
assertEquals(singleRange.min, 0.5, 'Single sample min equals value');
assertEquals(singleRange.max, 0.5, 'Single sample max equals value');

// Very large buffer
const bigBuf = generateNoiseBuffer(100000, 999);
assertEquals(bigBuf.length, 100000, 'Large buffer correct length');
assertTrue(sampleRange(bigBuf).min >= -1, 'Large buffer values in range [-1]');
assertTrue(sampleRange(bigBuf).max <= 1, 'Large buffer values in range [1]');

// ============================================================
// Summary
// ============================================================
console.log('\n===================================');
const total = passed + failed;
console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
console.log('===================================');

if (failed > 0) {
  console.log('  ❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('  🎉 All SFX tests passing!');
  process.exit(0);
}
