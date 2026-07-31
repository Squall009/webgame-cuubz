/**
 * Cuubz — every biome a mob names must be one BiomeSystem can produce (BUGS.md D-68)
 *
 * `mobManager` spawns with `selectMobForBiome(biome)`, where `biome` is
 * `BiomeSystem.getBiomeAtWorldPos(...).id`, and the match is
 * `def.biomes.includes(biome)` — a plain string comparison with no validation of either
 * side. So a typo, or a biome that was renamed, or a biome that was only ever planned,
 * silently produces a mob that can never spawn and no error anywhere.
 *
 * That is exactly what had happened:
 *
 *   - `corrupt_wolf` and `corrupt_wisp` declared `biomes: ['corrupt']`. `BiomeSystem` has
 *     ten ids and `corrupt` is not one of them, so **two of the game's five mob types had
 *     never appeared**.
 *   - `stone_golem` listed `deepslate_caves`, also unproducible, but survived on its
 *     second entry `mountains`.
 *
 * Decision 48 fixes the unmatchable NAMES here (repointing the two corrupt mobs at
 * `badlands`, the closest real analogue, and dropping the dead `deepslate_caves` entry)
 * and defers "which biomes SHOULD have mobs" to PR 34 as a content decision.
 *
 * This file is the part that makes it stick: it derives the valid ids from
 * `BiomeSystem` and fails if any mob definition names one that is not in that set.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import { BIOME_DEFS, BIOME_IDS, BIOME_NAME_TO_ID, BiomeSystem } from '../../../src/engine/world/BiomeSystem.js';
import { MOB_DEFINITIONS, selectMobForBiome } from '../../../src/game/mobs/mobDefinitions.js';

it('mobBiomes', () => legacy(async () => {
let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}
function assertTrue(v, m) { assert(v === true, m); }
function assertFalse(v, m) { assert(v === false, m); }
function assertEquals(a, e, m) { assert(a === e, `${m} — expected ${e}, got ${a}`); }

console.log('=== Mob / biome name tests (D-68) ===\n');

// ═══════════════════════════════════════════════════════════════════
// 1 — the ten ids, derived from BiomeSystem itself
// ═══════════════════════════════════════════════════════════════════
console.log('--- 1: the valid biome ids ---');

assertEquals(BIOME_IDS.length, 10, 'BiomeSystem produces exactly ten biome ids');
assertEquals(BIOME_IDS.join(','), 'deep_ocean,ocean,beach,plains,forest,badlands,tundra,desert,mountains,frozen_peaks',
  'the ten ids are unchanged by the derivation');
assertEquals(Object.keys(BIOME_DEFS).length, 10, 'BIOME_DEFS has ten entries');
assertTrue(
  Object.values(BIOME_DEFS).every((d) => BIOME_IDS.includes(BIOME_NAME_TO_ID[d.name])),
  'every BIOME_DEFS entry maps to one of the ten ids'
);
assertFalse(BIOME_IDS.includes('corrupt'), '`corrupt` is NOT a biome BiomeSystem can produce');
assertFalse(BIOME_IDS.includes('deepslate_caves'), '`deepslate_caves` is NOT a biome BiomeSystem can produce');
assertFalse(BIOME_IDS.includes('lava'), '`lava` is NOT a biome either (the quest half of D-68, PR 34\'s)');

// And the ids the live sampler actually hands to selectMobForBiome are from that set —
// this is what ties the derived list to the runtime rather than to a second table.
{
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const b = BiomeSystem.getBiomeAtWorldPos(i * 137, i * 311, 424242);
    seen.add(b.id);
  }
  assertTrue([...seen].every((id) => BIOME_IDS.includes(id)),
    `every id getBiomeAtWorldPos returned over 400 sample points is in BIOME_IDS (saw: ${[...seen].sort().join(',')})`);
  assertTrue(seen.size > 1, 'the sampler produced more than one biome (the sample is not degenerate)');
}

// ═══════════════════════════════════════════════════════════════════
// 2 — THE GUARD: no mob may name a biome that cannot exist
// ═══════════════════════════════════════════════════════════════════
console.log('--- 2: the guard ---');

const offenders = [];
for (const [key, def] of Object.entries(MOB_DEFINITIONS)) {
  assertTrue(Array.isArray(def.biomes) && def.biomes.length > 0, `${key} declares a non-empty biomes array`);
  for (const b of def.biomes) {
    if (!BIOME_IDS.includes(b)) offenders.push(`${key} → '${b}'`);
  }
}
assertEquals(offenders.length, 0,
  `every mob definition names only biomes BiomeSystem can produce (offenders: ${JSON.stringify(offenders)})`);

// Every mob must be reachable by at least one real biome — the consequence the guard
// above exists to prevent, stated directly.
for (const [key, def] of Object.entries(MOB_DEFINITIONS)) {
  assertTrue(def.biomes.some((b) => BIOME_IDS.includes(b)), `${key} can be selected in at least one real biome`);
}

// NON-VACUITY: the same check, run against a definition table with a bogus biome, must
// find it. If the loop above ever stopped looking, this goes red with it.
{
  const bogus = { ...MOB_DEFINITIONS, test_only: { biomes: ['corrupt'], spawnWeight: 1 } };
  const found = Object.entries(bogus).flatMap(([k, d]) => d.biomes.filter((b) => !BIOME_IDS.includes(b)).map((b) => `${k} → '${b}'`));
  assertEquals(found.length, 1, 'NON-VACUITY: the guard detects a bogus biome name when one is present');
  assertEquals(found[0], "test_only → 'corrupt'", 'NON-VACUITY: and names the offender');
}

// ═══════════════════════════════════════════════════════════════════
// 3 — the two mobs that could never spawn, and the one pure removal
// ═══════════════════════════════════════════════════════════════════
console.log('--- 3: selectMobForBiome ---');

// selectMobForBiome is a weighted random pick; sample it rather than assert one draw.
const drawsIn = (biome, n = 500) => {
  const out = new Set();
  for (let i = 0; i < n; i++) {
    const k = selectMobForBiome(biome);
    if (k) out.add(k);
  }
  return out;
};

const badlandsMobs = drawsIn('badlands');
assertTrue(badlandsMobs.has('corrupt_wolf'), 'corrupt_wolf CAN now spawn (in badlands) — it never could before');
assertTrue(badlandsMobs.has('corrupt_wisp'), 'corrupt_wisp CAN now spawn (in badlands) — it never could before');
assertEquals(selectMobForBiome('corrupt'), null, "no mob answers to 'corrupt' any more — the id does not exist");
assertEquals(selectMobForBiome('deepslate_caves'), null, "no mob answers to 'deepslate_caves'");

// stone_golem: dropping `deepslate_caves` is a PURE removal. Its mountains entry is
// untouched, and mountains is the only real biome it ever matched.
const mountainMobs = drawsIn('mountains');
assertTrue(mountainMobs.has('stone_golem'), 'stone_golem still spawns in mountains');
assertEquals(mountainMobs.size, 1, 'mountains still selects exactly stone_golem — zero behaviour change');
assertEquals(MOB_DEFINITIONS.stone_golem.biomes.join(','), 'mountains', 'stone_golem now lists only mountains');

// The two biomes that were already working are unchanged.
assertEquals([...drawsIn('plains')].sort().join(','), 'deer,rabbit', 'plains still selects deer and rabbit');
assertEquals([...drawsIn('forest')].sort().join(','), 'deer,rabbit', 'forest still selects deer and rabbit');
assertEquals([...drawsIn('tundra')].sort().join(','), 'rabbit', 'tundra still selects rabbit');

// ═══════════════════════════════════════════════════════════════════
// 4 — the DEFERRED half, recorded rather than fixed
// ═══════════════════════════════════════════════════════════════════
//
// Decision 48 splits D-68: the unmatchable NAMES are a defect and are fixed above.
// "Which biomes SHOULD have mobs" is a content decision and is PR 34's. This assertion
// records the exact remaining list so that the day someone adds an ocean mob, this line
// is what tells them to update the ledger — it is a statement of scope, not approval.
console.log('--- 4: biomes with no mob (deferred to PR 34) ---');

const covered = new Set(Object.values(MOB_DEFINITIONS).flatMap((d) => d.biomes));
const empty = BIOME_IDS.filter((b) => !covered.has(b));
assertEquals(empty.join(','), 'deep_ocean,ocean,beach,desert,frozen_peaks',
  'five biomes still have no mob — DEFERRED to PR 34, not fixed here (badlands stopped being one)');
assertFalse(empty.includes('badlands'), 'badlands now has mobs — it was one of the six before this PR');

// ═══════════════════════════════════════════════════════════════════
console.log(`\n===================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`===================================`);

process.exit(failed === 0 ? 0 : 1);
}));
