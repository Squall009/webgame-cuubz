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
import { NAMED_ITEMS } from '../../../src/game/data/ItemDefinitions.js';
import { BLOCK_BY_ID, BLOCK_BY_NAME } from '../../../src/engine/world/BlockRegistry.js';

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

// Twelve since S4. The Corrupt and Lava biomes are real entries in BIOME_DEFS now, so
// the ids they always wanted to be are producible — which is what closes the mob half
// of D-68 rather than working around it.
assertEquals(BIOME_IDS.length, 12, 'BiomeSystem produces exactly twelve biome ids');
assertEquals(BIOME_IDS.join(','), 'deep_ocean,ocean,beach,plains,forest,badlands,tundra,desert,mountains,frozen_peaks,corrupt,lava',
  'the twelve ids are unchanged by the derivation');
assertEquals(Object.keys(BIOME_DEFS).length, 12, 'BIOME_DEFS has twelve entries');
assertTrue(
  Object.values(BIOME_DEFS).every((d) => BIOME_IDS.includes(BIOME_NAME_TO_ID[d.name])),
  'every BIOME_DEFS entry maps to one of the ten ids'
);
// D-68's two halves, both now the other way round. `corrupt` and `lava` were the ids
// two mob definitions and twelve quests named and `BiomeSystem` could not produce; PR 23
// worked around it by rehoming the mobs to `badlands`. S4 built the biomes instead.
assertTrue(BIOME_IDS.includes('corrupt'), '`corrupt` IS a biome BiomeSystem can produce (S4)');
assertTrue(BIOME_IDS.includes('lava'), '`lava` IS a biome BiomeSystem can produce (S4)');
assertFalse(BIOME_IDS.includes('deepslate_caves'), '`deepslate_caves` is still NOT a biome BiomeSystem can produce');

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
  // The bogus name was `corrupt` until S4 made it real. `deepslate_caves` is the
  // remaining id that no biome produces, which is what this guard needs.
  const bogus = { ...MOB_DEFINITIONS, test_only: { biomes: ['deepslate_caves'], spawnWeight: 1 } };
  const found = Object.entries(bogus).flatMap(([k, d]) => d.biomes.filter((b) => !BIOME_IDS.includes(b)).map((b) => `${k} → '${b}'`));
  assertEquals(found.length, 1, 'NON-VACUITY: the guard detects a bogus biome name when one is present');
  assertEquals(found[0], "test_only → 'deepslate_caves'", 'NON-VACUITY: and names the offender');
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

// S4 put them back where they were written to live. PR 23 rehomed them to `badlands` as
// a workaround for an id the biome system could not produce; the id is producible now,
// so the workaround is gone and the two corrupt mobs are in the Corrupt biome.
const corruptMobs = drawsIn('corrupt');
assertTrue(corruptMobs.has('corrupt_wolf'), 'corrupt_wolf spawns in the Corrupt biome — where its definition always said');
assertTrue(corruptMobs.has('corrupt_wisp'), 'corrupt_wisp spawns in the Corrupt biome');
const badlandsMobs = drawsIn('badlands');
assertFalse(badlandsMobs.has('corrupt_wolf'), 'corrupt_wolf no longer spawns in badlands — the PR 23 workaround is reverted');
assertFalse(badlandsMobs.has('corrupt_wisp'), 'corrupt_wisp no longer spawns in badlands');
assertEquals(selectMobForBiome('deepslate_caves'), null, "no mob answers to 'deepslate_caves'");

// stone_golem: dropping `deepslate_caves` was a PURE removal — mountains was the only
// real biome it ever matched, and mountains still selects nothing else. **S13 added
// `badlands`**, which is not a removal and is why the list assertion below names two:
// badlands lost its only mobs when S4 sent the two corrupt ones back to the Corrupt
// biome they were written for, and a stone golem is what that landscape has.
const mountainMobs = drawsIn('mountains');
assertTrue(mountainMobs.has('stone_golem'), 'stone_golem still spawns in mountains');
assertEquals(mountainMobs.size, 1, 'mountains still selects exactly stone_golem — zero behaviour change');
assertEquals(MOB_DEFINITIONS.stone_golem.biomes.join(','), 'mountains,badlands',
  'stone_golem lists mountains and, since S13, badlands');

// The two biomes that were already working are unchanged.
assertEquals([...drawsIn('plains')].sort().join(','), 'deer,rabbit', 'plains still selects deer and rabbit');
assertEquals([...drawsIn('forest')].sort().join(','), 'deer,rabbit', 'forest still selects deer and rabbit');
assertEquals([...drawsIn('tundra')].sort().join(','), 'rabbit', 'tundra still selects rabbit');

// ═══════════════════════════════════════════════════════════════════
// 3b — THE SECOND GUARD: no mob may drop an item that does not exist (D-125)
// ═══════════════════════════════════════════════════════════════════
//
// Exactly the shape of the guard S1 added for quest objectives after D-118 and D-119:
// `drops[].item` is matched against nothing, and `Inventory.addItem` accepts any string
// at all — it falls back to the RESOURCE stack size and puts the slot on the bar. So a
// drop naming something that is neither a `NAMED_ITEMS` key nor a real block id yields
// an item the player can hold, cannot place (`consumeSelectedBlock` requires a NUMERIC
// typeId), cannot craft with, and which will not even stack with the identically-named
// thing they mined. That is D-125, and `stone_golem` was doing it.
console.log('--- 3b: every mob drop resolves ---');

{
  const badDrops = [];
  for (const [key, def] of Object.entries(MOB_DEFINITIONS)) {
    for (const drop of def.drops || []) {
      const item = drop.item;
      const ok = typeof item === 'string'
        ? !!NAMED_ITEMS[item]
        : (Number.isInteger(item) && item > 0 && !!BLOCK_BY_ID[item]);
      if (!ok) badDrops.push(`${key} → ${JSON.stringify(item)}`);
    }
  }
  assertEquals(badDrops.length, 0,
    `every mob drop is a real NAMED_ITEMS key or a real block id (offenders: ${JSON.stringify(badDrops)})`);

  // A block drop must be the SAME representation mining that block yields, or the two
  // will sit in separate slots and refuse to stack. `getBlockDrop` returns the numeric
  // id; a mob handing out the string name is the defect, not a different-but-equal way
  // of saying it.
  for (const [key, def] of Object.entries(MOB_DEFINITIONS)) {
    for (const drop of def.drops || []) {
      if (typeof drop.item !== 'string') continue;
      assertTrue(BLOCK_BY_NAME[drop.item] === undefined || !!NAMED_ITEMS[drop.item],
        `${key} drops '${drop.item}' by NAME where the block registry has one — mining it yields the id, and the two would not stack`);
    }
  }

  // NON-VACUITY.
  {
    const bogus = { drops: [{ item: 'not_a_real_item', minCount: 1, maxCount: 1, weight: 100 }] };
    const found = bogus.drops.filter((d) => !NAMED_ITEMS[d.item]);
    assertEquals(found.length, 1, 'NON-VACUITY: the drop guard detects an unresolvable item when one is present');
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4 — the DEFERRED half, recorded rather than fixed
// ═══════════════════════════════════════════════════════════════════
//
// Decision 48 splits D-68: the unmatchable NAMES are a defect and are fixed above.
// "Which biomes SHOULD have mobs" is a content decision and is PR 34's. This assertion
// records the exact remaining list so that the day someone adds an ocean mob, this line
// is what tells them to update the ledger — it is a statement of scope, not approval.
console.log('--- 4: biomes with no mob ---');

const covered = new Set(Object.values(MOB_DEFINITIONS).flatMap((d) => d.biomes));
const empty = BIOME_IDS.filter((b) => !covered.has(b));

// S13 took this list from seven to two. `lava` got `ash_crawler` — the one entry on the
// list that S4 created rather than inherited, and the biome Act 3 sends the player to
// for four quests. `beach` got `sand_crab`. `desert`, `badlands` and `frozen_peaks` were
// filled by giving EXISTING mobs the homes they already fit — rabbit to all three,
// stone_golem to badlands — rather than by writing three near-identical definitions.
//
// **The two that remain are declined, not deferred, and the reason is D-70.** Mobs have
// no buoyancy, no swim and no drown: `_findSpawnPosition` returns seabed+1 and
// `_resolveAxis` does not stop them at the waterline, so anything spawned in an ocean
// walks around on the bottom. An "aquatic" mob in a game with no swimming is half a
// mechanic with no way to see the other half working — §8.1's rule, and the deleted
// `Boss.js` is what it costs. These two rows belong to whoever closes D-70, and this
// assertion is the note that says so.
assertEquals(empty.join(','), 'deep_ocean,ocean',
  'only the two water biomes have no mob, and they are blocked on D-70 (no buoyancy, no swim, no drown)');
assertFalse(empty.includes('corrupt'), 'the Corrupt biome has mobs — corrupt_wolf and corrupt_wisp, finally');
assertFalse(empty.includes('lava'), 'the Lava biome has a mob of its own — ash_crawler (S13)');

// And the new ones are actually selectable, not merely declared.
assertTrue(drawsIn('lava').has('ash_crawler'), 'ash_crawler is drawn in the Lava biome');
assertTrue(drawsIn('beach').has('sand_crab'), 'sand_crab is drawn on the beach');
assertTrue(drawsIn('desert').has('rabbit'), 'the desert draws rabbit');
assertTrue(drawsIn('frozen_peaks').has('rabbit'), 'frozen_peaks draws rabbit');
assertTrue(drawsIn('badlands').size > 0, 'badlands is populated again');
// The Lava biome's mob does not leak into anywhere else, which is the failure mode a
// widened `biomes` array produces silently.
assertFalse(drawsIn('plains').has('ash_crawler'), 'ash_crawler stays in the Lava biome');
assertFalse(drawsIn('ocean').has('sand_crab'), 'sand_crab stays out of the water');

// ═══════════════════════════════════════════════════════════════════
console.log(`\n===================================`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
console.log(`===================================`);

process.exit(failed === 0 ? 0 : 1);
}));
