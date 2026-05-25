#!/usr/bin/env node
/**
 * Cuubz — Biome Effects Tests
 * Tests for lava animation, toxic slime bubbling, corrupt fog, particle effects.
 */

const { BiomeEffects, ParticleEffect, LAVA_ANIMATION, TOXIC_SLIME_ANIMATION, CORRUPT_FOG } = require('../js/renderer/biomeEffects');

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

console.log('Testing Biome Effects System...\n');

// ============================================================
// Group 1: Configuration Constants
// ============================================================
console.log('Group 1: Configuration Constants');

assert(LAVA_ANIMATION.speed === 0.5, 'LAVA_ANIMATION.speed should be 0.5');
assert(LAVA_ANIMATION.bubbleFrequency === 2.0, 'LAVA_ANIMATION.bubbleFrequency should be 2.0');
assert(typeof LAVA_ANIMATION.colorBase === 'number', 'LAVA_ANIMATION.colorBase should be a number');
assert(typeof LAVA_ANIMATION.colorBright === 'number', 'LAVA_ANIMATION.colorBright should be a number');

assert(TOXIC_SLIME_ANIMATION.speed === 0.3, 'TOXIC_SLIME_ANIMATION.speed should be 0.3');
assert(TOXIC_SLIME_ANIMATION.bubbleFrequency === 1.5, 'TOXIC_SLIME_ANIMATION.bubbleFrequency should be 1.5');
assert(typeof TOXIC_SLIME_ANIMATION.colorBase === 'number', 'TOXIC_SLIME.colorBase should be a number');

assert(CORRUPT_FOG.densityBase === 0.015, 'CORRUPT_FOG.densityBase should be 0.015');
assert(CORRUPT_FOG.densityCorruptZone === 0.03, 'CORRUPT_FOG.densityCorruptZone should be 0.03');
assert(CORRUPT_FOG.pulseSpeed === 0.2, 'CORRUPT_FOG.pulseSpeed should be 0.2');
assert(CORRUPT_FOG.colorDay !== undefined, 'CORRUPT_FOG.colorDay should be defined');
assert(CORRUPT_FOG.colorNight !== undefined, 'CORRUPT_FOG.colorNight should be defined');

// ============================================================
// Group 2: ParticleEffect Constructor
// ============================================================
console.log('\nGroup 2: ParticleEffect Constructor');

const p = new ParticleEffect(10, 5, 10, 0xffaa00, 2.0);
assert(p.x === 10, 'Particle x position should be 10');
assert(p.y === 5, 'Particle y position should be 5');
assert(p.z === 10, 'Particle z position should be 10');
assert(p.color === 0xffaa00, 'Particle color should match constructor value');
assert(p.lifetime === 2.0, 'Particle lifetime should be 2.0');
assert(p.age === 0, 'Particle initial age should be 0');
assert(p.active === true, 'Particle should start active');
assert(p.velocity > 0 && p.velocity <= 1.0, 'Particle velocity should be between 0 and 1');
assert(p.size > 0 && p.size <= 0.2, 'Particle size should be between 0 and 0.2');

// ============================================================
// Group 3: ParticleEffect Update
// ============================================================
console.log('\nGroup 3: ParticleEffect Update');

const p2 = new ParticleEffect(0, 0, 0, 0xcc66ff, 1.0);
assert(p2.active === true, 'Particle should be active before update');

p2.update(0.5); // Half lifetime
assert(p2.age === 0.5, 'Age should increase by delta');
assert(p2.y > 0, 'Y position should increase (rise upward)');
assert(p2.active === true, 'Particle should still be active at half lifetime');

p2.update(0.6); // Total 1.1 > lifetime of 1.0
assert(p2.age >= 1.0, 'Age should exceed lifetime');
assert(p2.active === false, 'Particle should be inactive after lifetime expires');

// ============================================================
// Group 4: ParticleEffect Alpha & Scale
// ============================================================
console.log('\nGroup 4: ParticleEffect Alpha and Scale');

const p3 = new ParticleEffect(0, 0, 0, 0xff0000, 2.0);

// Fresh particle — alpha should be low (fading in)
p3.update(0.1);
let alpha = p3.getAlpha();
assert(alpha > 0 && alpha < 1, 'Fresh particle should have partial alpha (fading in)');

// Mid-life particle — alpha should be near 1
p3.update(0.9); // total age = 1.0
alpha = p3.getAlpha();
assert(alpha >= 0.8, 'Mid-life particle should have high alpha');

// Near death — alpha should fade out
p3.update(0.9); // total age = 1.9
alpha = p3.getAlpha();
assert(alpha < 0.5, 'Near-death particle should have low alpha (fading out)');

// Scale test
const scaleStart = p3.getScale();
p3.update(0.1); // age = 2.0 — fully expired
const scaleEnd = p3.getScale();
assert(scaleEnd <= scaleStart, 'Scale should decrease as particle nears end of life');

// ============================================================
// Group 5: BiomeEffects Constructor
// ============================================================
console.log('\nGroup 5: BiomeEffects Constructor');

const effects = new BiomeEffects();
assert(effects.time === 0, 'Initial time should be 0');
assert(effects.lavaOffset === 0, 'Initial lava offset should be 0');
assert(effects.toxicOffset === 0, 'Initial toxic offset should be 0');
assert(effects.particles.length === 0, 'Should start with no particles');
assert(effects.currentBiome === 'plains', 'Default biome should be plains');
assert(effects.inCorruptZone === false, 'Should not be in corrupt zone by default');
assert(effects.enabled === true, 'Effects should be enabled by default');
assert(effects.scene === null, 'Scene should be null initially');

// ============================================================
// Group 6: BiomeEffects Update Loop
// ============================================================
console.log('\nGroup 6: BiomeEffects Update Loop');

const effects2 = new BiomeEffects();
effects2.update(1.0); // 1 second of simulation

assert(effects2.time === 1.0, 'Time should advance by delta');
assert(effects2.lavaOffset >= 0 && effects2.lavaOffset < 1.0, 'Lava offset should be in [0, 1)');
assert(effects2.toxicOffset >= 0 && effects2.toxicOffset < 1.0, 'Toxic offset should be in [0, 1)');

// Lava offset after 1 second: speed * time = 0.5 * 1.0 = 0.5
assert(Math.abs(effects2.lavaOffset - 0.5) < 0.001, `Lava offset should be ~0.5, got ${effects2.lavaOffset}`);

// Toxic offset after 1 second: speed * time = 0.3 * 1.0 = 0.3
assert(Math.abs(effects2.toxicOffset - 0.3) < 0.001, `Toxic offset should be ~0.3, got ${effects2.toxicOffset}`);

// ============================================================
// Group 7: UV Offset Wrapping
// ============================================================
console.log('\nGroup 7: UV Offset Wrapping');

const effects3 = new BiomeEffects();
effects3.update(3.0); // 3 seconds — lava offset = 0.5 * 3 = 1.5, should wrap to 0.5
assert(Math.abs(effects3.lavaOffset - 0.5) < 0.001, `Lava offset should wrap: expected 0.5, got ${effects3.lavaOffset}`);

effects3.update(1.0); // Total 4 seconds — lava = 0.5 * 4 = 2.0 % 1 = 0
assert(effects3.lavaOffset < 0.001 || effects3.lavaOffset > 0.999, `Lava offset should wrap to ~0, got ${effects3.lavaOffset}`);

// ============================================================
// Group 8: Biome Setting
// ============================================================
console.log('\nGroup 8: Biome Setting');

const effects4 = new BiomeEffects();
effects4.setBiome('corrupt');
assert(effects4.currentBiome === 'corrupt', 'Biome should be set to corrupt');
assert(effects4.inCorruptZone === true, 'inCorruptZone should be true for corrupt biome');

effects4.setBiome('plains');
assert(effects4.currentBiome === 'plains', 'Biome should change to plains');
assert(effects4.inCorruptZone === false, 'inCorruptZone should be false for plains');

// Test all biomes
const biomes = ['plains', 'forest', 'desert', 'tundra', 'mountains', 'ocean', 'lava', 'corrupt'];
for (const biome of biomes) {
  effects4.setBiome(biome);
  assert(effects4.currentBiome === biome, `Biome should be set to ${biome}`);
  if (biome === 'corrupt') {
    assert(effects4.inCorruptZone === true, `${biome} should set inCorruptZone`);
  } else {
    assert(effects4.inCorruptZone === false, `${biome} should not set inCorruptZone`);
  }
}

// ============================================================
// Group 9: Fog Density with Corrupt Zone
// ============================================================
console.log('\nGroup 9: Fog Density');

const effects5 = new BiomeEffects();
effects5.update(0.1); // Small update to initialize pulse

let densityNormal = effects5.getFogDensity();
assert(densityNormal >= CORRUPT_FOG.densityBase - CORRUPT_FOG.pulseAmplitude, 'Normal fog density should be near base');
assert(densityNormal <= CORRUPT_FOG.densityBase + CORRUPT_FOG.pulseAmplitude, 'Normal fog density should not exceed base + amplitude');

effects5.setBiome('corrupt');
effects5.update(0.1);
let densityCorrupt = effects5.getFogDensity();
assert(densityCorrupt > densityNormal, 'Corrupt zone fog should be denser than normal');
assert(densityCorrupt >= CORRUPT_FOG.densityBase + CORRUPT_FOG.densityCorruptZone - 0.01, 'Corrupt fog should include zone boost');

// ============================================================
// Group 10: Fog Color Hex
// ============================================================
console.log('\nGroup 10: Fog Color');

const effects6 = new BiomeEffects();
assert(effects6.getFogColorHex() === null, 'Non-corrupt biome should return null fog color');

effects6.setBiome('corrupt');
let fogHex = effects6.getFogColorHex();
assert(fogHex !== null, 'Corrupt biome should return a fog color hex');
assert(typeof fogHex === 'number', 'Fog color hex should be a number');

// ============================================================
// Group 11: Day/Night Fraction
// ============================================================
console.log('\nGroup 11: Day/Night Fraction');

const effects7 = new BiomeEffects();
effects7.setBiome('corrupt');
// In Node.js, THREE is undefined — setDayNightFraction should not crash
effects7.setDayNightFraction(12); // Noon
assert(true, 'setDayNightFraction should not crash without Three.js');

effects7.setDayNightFraction(0); // Midnight
assert(true, 'setDayNightFraction at midnight should not crash');

// ============================================================
// Group 12: Particle Spawning
// ============================================================
console.log('\nGroup 12: Particle Spawning');

const effects8 = new BiomeEffects();
assert(effects8.getActiveParticles().length === 0, 'Should start with no particles');

effects8.spawnLavaBubbles(100, 5, 100);
let lavaParticles = effects8.getActiveParticles();
assert(lavaParticles.length >= 1, 'Should spawn at least 1 lava bubble');
assert(lavaParticles.length <= 2, 'Should spawn at most 2 lava bubbles per call');

for (const particle of lavaParticles) {
  assert(particle.color === LAVA_ANIMATION.colorBright, 'Lava particles should use bright color');
  assert(Math.abs(particle.x - 100) < 3, 'Particle X should be near pool center');
  assert(Math.abs(particle.z - 100) < 3, 'Particle Z should be near pool center');
}

effects8.spawnToxicBubbles(200, 3, 200);
let allParticles = effects8.getActiveParticles();
assert(allParticles.length > lavaParticles.length, 'Should have more particles after spawning toxic bubbles');

for (const particle of allParticles.slice(lavaParticles.length)) {
  assert(particle.color === TOXIC_SLIME_ANIMATION.colorBright, 'Toxic particles should use bright color');
}

// ============================================================
// Group 13: Particle Lifecycle in Effects Manager
// ============================================================
console.log('\nGroup 13: Particle Lifecycle');

const effects9 = new BiomeEffects();
effects9.spawnLavaBubbles(0, 0, 0);
assert(effects9.getActiveParticles().length >= 1, 'Should have particles after spawn');

// Advance time past particle lifetime (max ~2 seconds)
effects9.update(3.0);
let expired = effects9.getActiveParticles();
assert(expired.length === 0, 'All particles should be cleaned up after sufficient time');

// ============================================================
// Group 14: State Summary
// ============================================================
console.log('\nGroup 14: State Summary');

const effects10 = new BiomeEffects();
effects10.setBiome('lava');
effects10.update(2.5);
effects10.spawnLavaBubbles(0, 0, 0);

const summary = effects10.getStateSummary();
assert(summary.time === 2.5, 'Summary time should match current time');
assert(summary.biome === 'lava', 'Summary biome should be lava');
assert(summary.inCorruptZone === false, 'Summary corrupt zone should be false');
assert(typeof summary.lavaOffset === 'number', 'Summary should include lava offset');
assert(typeof summary.toxicOffset === 'number', 'Summary should include toxic offset');
assert(typeof summary.fogDensity === 'number', 'Summary should include fog density');
assert(typeof summary.particleCount === 'number', 'Summary should include particle count');
assert(summary.particleCount >= 1, 'Particle count should reflect spawned particles');

// ============================================================
// Group 15: Init and Dispose
// ============================================================
console.log('\nGroup 15: Init and Dispose');

const effects11 = new BiomeEffects();
let result = effects11.init(null, null); // No Three.js
assert(result === false, 'init should return false without Three.js');

effects11.spawnLavaBubbles(0, 0, 0);
assert(effects11.particles.length >= 1, 'Should have particles before dispose');

effects11.dispose();
assert(effects11.particles.length === 0, 'Dispose should clear particles');
assert(effects11.scene === null, 'Dispose should null scene');
assert(effects11.enabled === false, 'Dispose should disable effects');

// After dispose, update should be a no-op
effects11.update(1.0);
assert(effects11.particles.length === 0, 'Disabled effects should not accumulate particles');

// ============================================================
// Group 16: Edge Cases
// ============================================================
console.log('\nGroup 16: Edge Cases');

// Zero delta update
const effects12 = new BiomeEffects();
effects12.update(0);
assert(effects12.time === 0, 'Zero delta should not advance time');
assert(effects12.lavaOffset === 0, 'Zero delta should not change lava offset');

// Very large delta update
effects12.update(1000);
assert(effects12.lavaOffset >= 0 && effects12.lavaOffset < 1.0, 'Large delta should still wrap UV offset');

// Multiple biome changes
effects12.setBiome('forest');
effects12.setBiome('desert');
effects12.setBiome('ocean');
assert(effects12.currentBiome === 'ocean', 'Should track last set biome');

// Empty particle array operations
const emptyEffects = new BiomeEffects();
assert(emptyEffects.getActiveParticles().length === 0, 'Empty effects should return empty particles');
const emptySummary = emptyEffects.getStateSummary();
assert(emptySummary.particleCount === 0, 'Empty summary should have 0 particles');

// ============================================================
// Group 17: Animation Speed Verification
// ============================================================
console.log('\nGroup 17: Animation Speed Verification');

// Lava is faster than toxic slime
const speedTest = new BiomeEffects();
speedTest.update(2.0); // 2 seconds

// After 2 seconds: lava offset = (0.5 * 2) % 1 = 0, toxic offset = (0.3 * 2) % 1 = 0.6
const lavaOff = speedTest.getLavaUvOffset();
const toxicOff = speedTest.getToxicSlimeUvOffset();
assert(Math.abs(lavaOff) < 0.001 || Math.abs(lavaOff - 1.0) < 0.001, `Lava offset at t=2 should be ~0, got ${lavaOff}`);
assert(Math.abs(toxicOff - 0.6) < 0.001, `Toxic offset at t=2 should be ~0.6, got ${toxicOff}`);

// ============================================================
// Summary
// ============================================================
console.log(`\nBiome Effects Tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
