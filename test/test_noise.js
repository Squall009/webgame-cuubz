#!/usr/bin/env node
/**
 * Cuubz — Noise Function Tests
 * Tests Perlin/Simplex noise, octave noise, ridge noise.
 */

'use strict';

const NoiseGenerator = require('../js/world/noise');

// ============================================================
// Test Framework (embedded)
// ============================================================

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ❌ ${message}`);
  }
}

function assertInRange(value, min, max, message) {
  assert(value >= min && value <= max, `${message}: expected [${min}, ${max}], got ${value.toFixed(6)}`);
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message}: expected ~${expected}, got ${actual}`);
}

// ============================================================
// Tests
// ============================================================

console.log('Noise Function Tests');
console.log('====================\n');

// --- Test: Constructor and seed ---
console.log('[Constructor & Seed]');

const noise1 = new NoiseGenerator(42);
assert(noise1.seed === 42, 'Seed is stored correctly');
assert(noise1.perm.length === 512, 'Permutation table has 512 entries (doubled for wrapping)');

const noise2 = new NoiseGenerator(0);
assert(noise2.perm.length === 512, 'Default seed creates valid permutation table');

// --- Test: Perlin 2D ---
console.log('\n[Perlin 2D]');

const val = noise1.perlin2(0, 0);
assertInRange(val, -1, 1, `perlin2(0,0) in [-1, 1]: ${val}`);

// Deterministic: same input → same output
const valA = noise1.perlin2(1.5, 2.5);
const valB = noise1.perlin2(1.5, 2.5);
assert(valA === valB, 'Deterministic output for same input');

// Different seeds → different output
const noiseOther = new NoiseGenerator(999);
const valC = noiseOther.perlin2(1.5, 2.5);
assert(valC !== valA || Math.abs(valC - valA) > 0.001, 'Different seeds produce different output');

// --- Test: Perlin 3D ---
console.log('\n[Perlin 3D]');

const val3d = noise1.perlin3(1, 2, 3);
assertInRange(val3d, -1, 1, `perlin3(1,2,3) in [-1, 1]: ${val3d}`);

// 2D is equivalent to 3D with z=0
const val2d = noise1.perlin2(5, 7);
const val3dz0 = noise1.perlin3(5, 7, 0);
assertApprox(val2d, val3dz0, 0.0001, 'perlin2(x,y) ≈ perlin3(x,y,0)');

// --- Test: Octave Noise ---
console.log('\n[Octave Noise]');

const octVal = noise1.octaveNoise2(10, 20, 4, 0.5);
assertInRange(octVal, -1, 1, `octaveNoise2 in [-1, 1]: ${octVal}`);

// More octaves → more detail (different output)
const oct1 = noise1.octaveNoise2(10.37, 20.53, 1, 0.5);
const oct4 = noise1.octaveNoise2(10.37, 20.53, 4, 0.5);
assert(Math.abs(oct4 - oct1) > 0.001, 'More octaves change output');

// Persistence affects amplitude
const lowPers = noise1.octaveNoise2(10, 20, 4, 0.2);
const highPers = noise1.octaveNoise2(10, 20, 4, 0.8);
assert(Math.abs(highPers) >= Math.abs(lowPers), 'Higher persistence → larger amplitude (generally)');

// --- Test: Ridge Noise ---
console.log('\n[Ridge Noise]');

const ridgeVal = noise1.ridgeNoise(5, 10, 15, 4, 0.5);
assertInRange(ridgeVal, -1, 1, `ridgeNoise in [-1, 1]: ${ridgeVal}`);

// Ridge noise should be different from regular noise
const regular = noise1.octaveNoise3(5, 10, 15, 4, 0.5);
assert(Math.abs(ridgeVal - regular) > 0.001, 'Ridge noise differs from octave noise');

// --- Test: Normalized Output ---
console.log('\n[Normalized Output]');

const normVal = noise1.normalized(3, 7, 12);
assertInRange(normVal, 0, 1, `normalized in [0, 1]: ${normVal}`);

// Verify normalized = (perlin + 1) / 2
const rawVal = noise1.perlin3(3, 7, 12);
const expectedNorm = (rawVal + 1) / 2;
assertApprox(normVal, expectedNorm, 0.0001, 'normalized = (perlin + 1) / 2');

// --- Test: Edge Cases ---
console.log('\n[Edge Cases]');

// Large coordinates should still work
const largeVal = noise1.perlin3(10000, 20000, 30000);
assertInRange(largeVal, -1, 1, 'Large coordinates produce valid output');

// Negative coordinates
const negVal = noise1.perlin3(-100, -200, -300);
assertInRange(negVal, -1, 1, 'Negative coordinates produce valid output');

// Floating point coordinates
const floatVal = noise1.perlin3(0.5, 0.75, 0.25);
assertInRange(floatVal, -1, 1, 'Floating point coordinates work');

// --- Test: Statistical Distribution ---
console.log('\n[Statistical Distribution]');

// Sample many points — should be roughly uniform in [-1, 1]
const samples = [];
for (let i = 0; i < 1000; i++) {
  samples.push(noise1.perlin2(i * 0.1, i * 0.07));
}

// Mean should be close to 0
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
assertApprox(mean, 0, 0.05, `Mean of 1000 samples ≈ 0: ${mean.toFixed(4)}`);

// Std dev should be reasonable (not all zeros or all extremes)
const variance = samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
const stdDev = Math.sqrt(variance);
assert(stdDev > 0.1 && stdDev < 1, `Std dev in reasonable range: ${stdDev.toFixed(4)}`);

// --- Test: Hash Function (uniform distribution for placement decisions) ---
console.log('\n[Hash Function]');

// hash() returns value in [0, 1)
const h1 = noise1.hash(0, 0);
assertInRange(h1, 0, 1, `hash(0,0) in [0, 1): ${h1.toFixed(6)}`);

// Deterministic: same input → same output
assert(noise1.hash(42, 99) === noise1.hash(42, 99), 'Deterministic hash for same input');

// Different seeds → different hash
const noise3 = new NoiseGenerator(999);
assert(noise1.hash(42, 99) !== noise3.hash(42, 99), 'Different seeds produce different hash');

// Uniform distribution test: sample 6400 positions (25 chunks × 256 blocks)
let below002 = 0, below01 = 0, below05 = 0;
for (let i = 0; i < 80; i++) {
  for (let j = 0; j < 80; j++) {
    const v = noise1.hash(i, j);
    if (v < 0.02) below002++;
    if (v < 0.1) below01++;
    if (v < 0.5) below05++;
  }
}
// Expected: ~128 at 0.02, ~640 at 0.1, ~3200 at 0.5 for 6400 samples
assert(below002 > 80 && below002 < 180, `Hash uniformity at 0.02: ${below002}/6400 (expected ~128)`);
assert(below01 > 450 && below01 < 830, `Hash uniformity at 0.1: ${below01}/6400 (expected ~640)`);
assert(below05 > 2700 && below05 < 3700, `Hash uniformity at 0.5: ${below05}/6400 (expected ~3200)`);

// No clustering: nearby positions should have different hashes
const h_nearby = [noise1.hash(10, 10), noise1.hash(10, 11), noise1.hash(11, 10), noise1.hash(11, 11)];
const allDifferent = new Set(h_nearby).size === 4;
assert(allDifferent, 'Nearby positions produce different hashes (no spatial clustering)');

// --- Test: createPRNG (seeded pseudo-random generator) ---
console.log('\n[createPRNG]');

const rng1 = noise1.createPRNG(42);
const rng2 = noise1.createPRNG(42); // Same sub-seed → same sequence

// First call should be identical
assert(rng1() === rng2(), 'Same sub-seed produces identical first value');
assert(rng1() === rng2(), 'Same sub-seed produces identical second value');
assert(rng1() === rng2(), 'Same sub-seed produces identical third value');

// Different sub-seeds → different sequences
const rng3 = noise1.createPRNG(99);
const first1 = noise1.createPRNG(42)();
const first2 = noise1.createPRNG(99)();
assert(first1 !== first2, 'Different sub-seeds produce different values');

// PRNG values in [0, 1)
let prngInRange = true;
const rng4 = noise1.createPRNG(123);
for (let i = 0; i < 100; i++) {
  const v = rng4();
  if (v < 0 || v >= 1) prngInRange = false;
}
assert(prngInRange, 'All PRNG values in [0, 1)');

// PRNG produces different values on each call (not stuck)
const rng5 = noise1.createPRNG(42);
const prngValues = new Set();
for (let i = 0; i < 50; i++) {
  prngValues.add(rng5());
}
assert(prngValues.size > 40, `PRNG produces varied output: ${prngValues.size}/50 unique values`);

// ============================================================
// Report
// ============================================================

console.log('\n====================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All noise tests passing!');
  process.exit(0);
}
