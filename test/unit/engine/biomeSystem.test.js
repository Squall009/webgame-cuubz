/**
 * Cuubz — Biome System Tests
 * Tests the VoxelGen-overhauled biome system (biomeSystem.js).
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { BLOCK_TYPES } from '../../../src/engine/world/BlockRegistry.js';
import { BIOME_DEFS, CONT_SPLINE, selectBiome, sampleBiomeParams, computeHumidityMap, BiomeSystem } from '../../../src/engine/world/BiomeSystem.js';

it('biomeSystem', () => legacy(async () => {
let passCount = 0, failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passCount++; console.log(`  ✅ ${message}`); }
  else { failCount++; failures.push(message); console.log(`  ❌ ${message}`); }
}

console.log('Biome System Tests');
console.log('==================\n');

// ── Biome definitions ────────────────────────────────────────────────
console.log('[Biome Definitions]');
const biomeKeys = Object.keys(BIOME_DEFS);
assert(biomeKeys.length === 10, `10 biomes defined: ${biomeKeys.length}`);
assert(!!BIOME_DEFS.PLAINS, 'PLAINS biome exists');
assert(!!BIOME_DEFS.FOREST, 'FOREST biome exists');
assert(!!BIOME_DEFS.DESERT, 'DESERT biome exists');
assert(!!BIOME_DEFS.TUNDRA, 'TUNDRA biome exists');
assert(!!BIOME_DEFS.MOUNTAINS, 'MOUNTAINS biome exists');
assert(!!BIOME_DEFS.FROZEN_PEAKS, 'FROZEN_PEAKS biome exists');
assert(!!BIOME_DEFS.OCEAN, 'OCEAN biome exists');
assert(!!BIOME_DEFS.DEEP_OCEAN, 'DEEP_OCEAN biome exists');
assert(!!BIOME_DEFS.BEACH, 'BEACH biome exists');
assert(!!BIOME_DEFS.BADLANDS, 'BADLANDS biome exists');

// ── Biome properties ─────────────────────────────────────────────────
console.log('\n[Biome Properties]');
assert(BIOME_DEFS.PLAINS.surfaceVariants.length > 0, 'PLAINS has surface variants');
assert(BIOME_DEFS.TUNDRA.surfaceBlock !== undefined, 'TUNDRA has surfaceBlock');
assert(BIOME_DEFS.TUNDRA.name === 'Tundra', 'TUNDRA name is "Tundra"');
assert(BIOME_DEFS.DESERT.name === 'Desert', 'DESERT name is "Desert"');
assert(BIOME_DEFS.FROZEN_PEAKS.baseY > BIOME_DEFS.MOUNTAINS.baseY,
  'FROZEN_PEAKS baseY > MOUNTAINS baseY');

// ── Continentalness spline ───────────────────────────────────────────
console.log('\n[Continentalness Spline]');
assert(Array.isArray(CONT_SPLINE), 'CONT_SPLINE is an array');
assert(CONT_SPLINE.length > 0, 'CONT_SPLINE has points');
assert(CONT_SPLINE[0][0] === -1.0, 'First point x = -1.0');
assert(CONT_SPLINE[CONT_SPLINE.length - 1][0] === 1.0, 'Last point x = 1.0');

// ── selectBiome ──────────────────────────────────────────────────────
console.log('\n[selectBiome]');

// Ocean biomes (low continentalness)
assert(selectBiome(-0.8, 0, 0, 0).name === 'Deep Ocean', 'Very low cont → Deep Ocean');
assert(selectBiome(-0.2, 0, 0, 0).name === 'Ocean', 'Low cont → Ocean');
assert(selectBiome(0.01, 0, 0, 0).name === 'Beach', 'Near-zero cont → Beach');

// Hot biomes
assert(selectBiome(0.2, 0, 0.8, -0.3).name === 'Desert', 'Hot + dry → Desert');
assert(selectBiome(0.2, 0, 0.8, 0.3).name === 'Badlands', 'Hot + humid → Badlands');

// Cold biomes (TUNDRA)
assert(selectBiome(0.2, 0, -0.3, 0).name === 'Tundra', 'Cold land → Tundra');
assert(selectBiome(0.2, 0, -0.25, 0).name === 'Tundra', 'Slightly cold → Tundra');

// Mountain / Frozen Peaks
assert(selectBiome(0.6, -0.2, 0, 0).name === 'Mountains', 'High cont + low eros → Mountains');
assert(selectBiome(0.6, -0.2, -0.3, 0).name === 'Frozen Peaks', 'High cont + low eros + cold → Frozen Peaks');

// Default land biomes
assert(selectBiome(0.2, 0, 0, 0.3).name === 'Forest', 'Humid land → Forest');
assert(selectBiome(0.2, 0, 0, -0.3).name === 'Badlands', 'Semi-arid land → Badlands');
assert(selectBiome(0.2, 0, 0, -0.05).name === 'Plains', 'Default land → Plains');

// Frozen water flag on ocean biomes
const coldOcean = selectBiome(-0.2, 0, -0.3, 0);
assert(coldOcean.frozenWater === true, 'Ocean in cold zone has frozenWater=true');
const warmOcean = selectBiome(-0.2, 0, 0.3, 0);
assert(warmOcean.frozenWater === false, 'Ocean in warm zone has frozenWater=false');

// ── BiomeSystem (main-thread helper) ─────────────────────────────────
console.log('\n[BiomeSystem]');
assert(!!BiomeSystem, 'BiomeSystem object exists');
assert(typeof BiomeSystem.getBiomeAtWorldPos === 'function', 'BiomeSystem.getBiomeAtWorldPos is a function');

const biomeData = BiomeSystem.getBiomeAtWorldPos(100, 200, 42);
assert(!!biomeData, 'getBiomeAtWorldPos returns data');
assert(!!biomeData.id, 'Biome data has id property');
assert(!!biomeData.name, 'Biome data has name property');
assert(typeof biomeData.isCold === 'boolean', 'Biome data has isCold boolean');
assert(biomeData.id === biomeData.name.toLowerCase().replace(/\s+/g, '_'),
  'Biome id matches lowercase name with underscores');

// ── Biome distribution sanity check ──────────────────────────────────
console.log('\n[Biome Distribution]');
const biomeCounts = {};
// Sample a wide area (1000x1000) to ensure all biomes including TUNDRA appear
for (let x = -500; x < 500; x += 32) {
  for (let z = -500; z < 500; z += 32) {
    const bd = BiomeSystem.getBiomeAtWorldPos(x, z, 42);
    biomeCounts[bd.name] = (biomeCounts[bd.name] || 0) + 1;
  }
}
const totalSamples = Object.values(biomeCounts).reduce((a, b) => a + b, 0);
assert(totalSamples > 200, `Sampled ${totalSamples} positions`);

// Multiple biomes should be present in a reasonable sample
const uniqueBiomes = Object.keys(biomeCounts).length;
assert(uniqueBiomes >= 5, `Multiple biomes present: ${uniqueBiomes} unique`);

// TUNDRA should appear with the lowered threshold (-0.20)
const hasTundra = biomeCounts['Tundra'] > 0;
assert(hasTundra, `TUNDRA present in distribution: ${biomeCounts['Tundra'] || 0} samples`);

console.log('\n==================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) { failures.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
else { console.log('🎉 All biome tests passing!'); process.exit(0); }
}));
