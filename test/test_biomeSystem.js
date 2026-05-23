#!/usr/bin/env node
/**
 * Cuubz — Biome System Tests
 */

'use strict';

const NoiseGenerator = require('../js/world/noise');
const { BiomeSystem, BIOMES, BIOME_LIST } = require('../js/world/biomeSystem');

let passCount = 0, failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passCount++; console.log(`  ✅ ${message}`); }
  else { failCount++; failures.push(message); console.log(`  ❌ ${message}`); }
}

console.log('Biome System Tests');
console.log('==================\n');

// Biome definitions
console.log('[Biome Definitions]');
assert(BIOME_LIST.length === 8, `8 biomes defined: ${BIOME_LIST.length}`);
assert(!!BIOMES.PLAINS, 'PLAINS biome exists');
assert(!!BIOMES.FOREST, 'FOREST biome exists');
assert(!!BIOMES.DESERT, 'DESERT biome exists');
assert(!!BIOMES.TUNDRA, 'TUNDRA biome exists');
assert(!!BIOMES.MOUNTAINS, 'MOUNTAINS biome exists');
assert(!!BIOMES.OCEAN, 'OCEAN biome exists');
assert(!!BIOMES.LAVA, 'LAVA biome exists');
assert(!!BIOMES.CORRUPT, 'CORRUPT biome exists');

// Biome properties
console.log('\n[Biome Properties]');
assert(BIOMES.PLAINS.surfaceBlocks.length > 0, 'PLAINS has surface blocks');
assert(BIOMES.DESERT.temperature === 0.9, 'DESERT is hot (temp=0.9)');
assert(BIOMES.TUNDRA.temperature === 0.1, 'TUNDRA is cold (temp=0.1)');

// Biome system
console.log('\n[Biome System]');
const tempNoise = new NoiseGenerator(42);
const moistNoise = new NoiseGenerator(43);
const biomeSystem = new BiomeSystem(tempNoise, moistNoise);

const biome = biomeSystem.getBiome(100, 200);
assert(!!biome, 'getBiome returns a biome');
assert(!!biome.id, 'Biome has id property');

// Blended biome
console.log('\n[Blended Biome]');
const blended = biomeSystem.getBlendedBiome(100, 200);
assert(!!blended.primary, 'Has primary biome');
assert(!!blended.secondary, 'Has secondary biome');
assert(typeof blended.blend === 'boolean', 'Has blend flag');

// Surface blocks
console.log('\n[Surface Blocks]');
const surfaceBlock = biomeSystem.getSurfaceBlock(BIOMES.PLAINS, 5);
assert(surfaceBlock !== undefined, 'Returns a surface block type');

// Biome distribution sanity check
console.log('\n[Biome Distribution]');
const biomeCounts = {};
for (let x = 0; x < 100; x += 16) {
  for (let z = 0; z < 100; z += 16) {
    const b = biomeSystem.getBiome(x, z).id;
    biomeCounts[b] = (biomeCounts[b] || 0) + 1;
  }
}
const totalSamples = Object.values(biomeCounts).reduce((a, b) => a + b, 0);
assert(totalSamples === 49, `Sampled ${totalSamples} positions`);

// Multiple biomes should be present in a reasonable sample
const uniqueBiomes = Object.keys(biomeCounts).length;
assert(uniqueBiomes >= 2, `Multiple biomes present: ${uniqueBiomes} unique`);

console.log('\n==================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) { failures.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
else { console.log('🎉 All biome tests passing!'); process.exit(0); }
