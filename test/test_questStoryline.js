#!/usr/bin/env node
'use strict';

/**
 * Cuubz — Quest Storyline Tests
 * Tests the storyline design data: act grouping, title rewards, boss mechanics,
 * quest descriptions, and dungeon structure.
 */

let passCount = 0, failCount = 0;
const failures = [];

function assert(c, m) { if (c) { passCount++; console.log(`  ✅ ${m}`); } else { failCount++; failures.push(m); console.log(`  ❌ ${m}`); } }
function assertEquals(a, e, m) { assert(a === e, `${m}: expected ${e}, got ${a}`); }
function assertTrue(c, m) { assert(c === true, m); }
function assertFalse(c, m) { assert(c === false, m); }
function assertNotNull(v, m) { assert(v !== null && v !== undefined, m); }
function assertGreaterThan(a, t, m) { assert(a > t, `${m}: expected > ${t}, got ${a}`); }
function assertStringContains(str, sub, m) { assert(typeof str === 'string' && str.includes(sub), `${m}: "${str}" should contain "${sub}"`); }

const { QUEST_TYPES, REWARD_TYPES, QUEST_STATES, QUEST_REGISTRY, QuestSystem } = require('../js/systems/questSystem.js');

console.log('Quest Storyline Tests');
console.log('=====================\n');

// Test 1: Act Structure
console.log('--- Act Structure ---');
assertEquals(5, new Set(QUEST_REGISTRY.map(q => q.act)).size, 'All 5 acts represented');

const actCounts = {};
QUEST_REGISTRY.forEach(q => { actCounts[q.act] = (actCounts[q.act] || 0) + 1; });
assertEquals(6, actCounts[1], 'Act 1 has 6 quests (Q1-Q6)');
assertEquals(6, actCounts[2], 'Act 2 has 6 quests (Q7-Q12)');
assertEquals(5, actCounts[3], 'Act 3 has 5 quests (Q13-Q17)');
assertEquals(4, actCounts[4], 'Act 4 has 4 quests (Q18-Q21)');
assertEquals(4, actCounts[5], 'Act 5 has 4 quests (Q22-Q25)');

// Verify quests are in correct acts by stage
for (const q of QUEST_REGISTRY) {
  let expectedAct;
  if (q.stage <= 6) expectedAct = 1;
  else if (q.stage <= 12) expectedAct = 2;
  else if (q.stage <= 17) expectedAct = 3;
  else if (q.stage <= 21) expectedAct = 4;
  else expectedAct = 5;
  assertEquals(expectedAct, q.act, `${q.id} act=${q.act} matches stage ${q.stage}`);
}

// Test 2: Title Rewards
console.log('\n--- Title Rewards ---');
const titleQuests = QUEST_REGISTRY.filter(q => q.titleReward);
assertEquals(9, titleQuests.length, '9 quests grant titles');

const expectedTitles = {
  'quest_06': 'Survivor',
  'quest_08': 'Seeker',
  'quest_12': 'Warden Slayer',
  'quest_14': 'Firewalker',
  'quest_17': 'Titan Bane',
  'quest_19': 'Icebound',
  'quest_21': 'Serpent Slayer',
  'quest_23': 'Seal Master',
  'quest_25': 'World Saver',
};

for (const [qid, title] of Object.entries(expectedTitles)) {
  const quest = QUEST_REGISTRY.find(q => q.id === qid);
  assertNotNull(quest, `${qid} exists`);
  assertEquals(title, quest.titleReward, `${qid} grants title "${title}"`);
}

// Non-title quests should not have titleReward
for (const q of QUEST_REGISTRY) {
  if (!expectedTitles[q.id]) {
    assertFalse(!!q.titleReward, `${q.id} has no title reward`);
  }
}

// Test 3: Boss Mechanics
console.log('\n--- Boss Mechanics ---');
const bossQuests = QUEST_REGISTRY.filter(q => q.type === QUEST_TYPES.BOSS);
assertEquals(5, bossQuests.length, '5 boss quests');

for (const bq of bossQuests) {
  assertNotNull(bq.bossMechanics, `${bq.id} has bossMechanics array`);
  assertTrue(Array.isArray(bq.bossMechanics), `${bq.id} bossMechanics is array`);
  assertGreaterThan(bq.bossMechanics.length, 0, `${bq.id} has at least 1 mechanic`);
}

// Specific boss mechanics checks
const forestWarden = QUEST_REGISTRY.find(q => q.id === 'quest_12');
assertTrue(forestWarden.bossMechanics.includes('vine_lash'), 'Forest Warden has vine_lash');
assertTrue(forestWarden.bossMechanics.includes('poison_spores'), 'Forest Warden has poison_spores');
assertTrue(forestWarden.bossMechanics.includes('root_entangle'), 'Forest Warden has root_entangle');

const lavaTitan = QUEST_REGISTRY.find(q => q.id === 'quest_17');
assertTrue(lavaTitan.bossMechanics.includes('ground_slam'), 'Lava Titan has ground_slam');
assertTrue(lavaTitan.bossMechanics.includes('lava_pool_creation'), 'Lava Titan has lava_pool_creation');
assertTrue(lavaTitan.bossMechanics.includes('magma_projectile'), 'Lava Titan has magma_projectile');

const frostSerpent = QUEST_REGISTRY.find(q => q.id === 'quest_21');
assertTrue(frostSerpent.bossMechanics.includes('ice_breath'), 'Frost Serpent has ice_breath');
assertTrue(frostSerpent.bossMechanics.includes('tail_swipe'), 'Frost Serpent has tail_swipe');
assertTrue(frostSerpent.bossMechanics.includes('ice_wall_creation'), 'Frost Serpent has ice_wall_creation');

const corruptionOverlord = QUEST_REGISTRY.find(q => q.id === 'quest_24');
assertTrue(corruptionOverlord.bossMechanics.includes('summon_minions'), 'Corruption Overlord has summon_minions');
assertTrue(corruptionOverlord.bossMechanics.includes('crystal_shield'), 'Corruption Overlord has crystal_shield');
assertTrue(corruptionOverlord.bossMechanics.includes('corruption_beam'), 'Corruption Overlord has corruption_beam');
assertTrue(corruptionOverlord.bossMechanics.includes('dark_nova'), 'Corruption Overlord has dark_nova');

const finalSeal = QUEST_REGISTRY.find(q => q.id === 'quest_25');
assertEquals(4, finalSeal.bossMechanics.length, 'Final Seal has 4 mechanics (multi-phase)');
assertTrue(finalSeal.bossMechanics.includes('elemental_attacks'), 'Final Seal phase 1: elemental_attacks');
assertTrue(finalSeal.bossMechanics.includes('summon_minions'), 'Final Seal phase 2: summon_minions');
assertTrue(finalSeal.bossMechanics.includes('aoe_zones'), 'Final Seal phase 2: aoe_zones');
assertTrue(finalSeal.bossMechanics.includes('combined_pattern'), 'Final Seal phase 3: combined_pattern');

// Test 4: Quest Descriptions are Enriched
console.log('\n--- Quest Descriptions ---');
for (const q of QUEST_REGISTRY) {
  assertGreaterThan(q.description.length, 20, `${q.id} description is enriched (${q.description.length} chars)`);
}

// Check for narrative elements in descriptions
const allDescriptions = QUEST_REGISTRY.map(q => q.description).join(' ');
assertStringContains(allDescriptions, 'corruption', 'Storyline references corruption theme');
assertStringContains(allDescriptions, 'Seal', 'Storyline references Seals');
assertStringContains(allDescriptions, 'guardian', 'Storyline references guardians');

// Test 5: Dungeon/Biome Alignment
console.log('\n--- Dungeon/Biome Alignment ---');

// Act 2 quests should be in corrupt/mountains biomes
const act2Quests = QUEST_REGISTRY.filter(q => q.act === 2);
act2Quests.forEach(q => {
  assertTrue(['corrupt', 'mountains'].includes(q.markerBiome), `${q.id} marker in corrupt/mountains`);
});

// Act 3 quests should be in lava biome
const act3Quests = QUEST_REGISTRY.filter(q => q.act === 3);
act3Quests.forEach(q => {
  assertEquals('lava', q.markerBiome, `${q.id} marker in lava biome`);
});

// Act 4 quests should be in tundra biome
const act4Quests = QUEST_REGISTRY.filter(q => q.act === 4);
act4Quests.forEach(q => {
  assertEquals('tundra', q.markerBiome, `${q.id} marker in tundra biome`);
});

// Test 6: Quest Key Distribution (one per dungeon entrance + delivery quests)
console.log('\n--- Quest Key Distribution ---');
const keyQuests = QUEST_REGISTRY.filter(q => q.requirements.some(r => r.item === 'quest_key'));
assertEquals(6, keyQuests.length, '6 quests require quest_keys (find + deliver for each of 4 dungeons)');

// Each key quest should be in a different act/dungeon
const keyActs = keyQuests.map(q => q.act);
assertEquals(4, new Set(keyActs).size, 'Each quest_key is in a different act');

// Test 7: Boss Quest Positioning (at end of dungeon)
console.log('\n--- Boss Quest Positioning ---');
const bossIds = bossQuests.map(q => q.id);
assertTrue(bossIds.includes('quest_12'), 'Boss 1 at quest_12 (end of Act 2)');
assertTrue(bossIds.includes('quest_17'), 'Boss 2 at quest_17 (end of Act 3)');
assertTrue(bossIds.includes('quest_21'), 'Boss 3 at quest_21 (end of Act 4)');
assertTrue(bossIds.includes('quest_24'), 'Boss 4 at quest_24 (Act 5)');
assertTrue(bossIds.includes('quest_25'), 'Final boss at quest_25 (game end)');

// Test 8: QuestSystem Integration with new fields
console.log('\n--- QuestSystem Integration ---');
const qs = new QuestSystem({});

// getAllQuests should include act and titleReward fields
const allQuests = qs.getAllQuests();
const q6 = allQuests.find(q => q.id === 'quest_06');
assertEquals(1, q6.act, 'getAllQuests preserves act field');
assertEquals('Survivor', q6.titleReward, 'getAllQuests preserves titleReward');

// getQuest should return full quest data including new fields
const q12 = qs.getQuest('quest_12');
assertNotNull(q12.bossMechanics, 'getQuest returns bossMechanics');
assertEquals(3, q12.bossMechanics.length, 'Forest Warden has 3 mechanics');

// Serialization preserves new fields
qs.addProgress('wood_log', 5);
qs.addProgress('dirt', 10);
const serialized = qs.serialize();
assertEquals(true, serialized['quest_01'].completed, 'Serialized quest_01 is completed');
assertEquals(QUEST_STATES.COMPLETE, serialized['quest_01'].state, 'Serialized state is COMPLETE');
// Verify new fields survive serialization round-trip via getAllQuests
const deserializedQS = new QuestSystem({});
deserializedQS.deserialize(serialized);
assertEquals(1, deserializedQS.getCompletedCount(), 'Deserialized: 1 quest completed');

// Test 9: Marker Positions still deterministic
console.log('\n--- Marker Position Determinism ---');
const pos1 = qs.getMarkerPosition('quest_01', 'test_seed');
const pos2 = qs.getMarkerPosition('quest_01', 'test_seed');
assertEquals(pos1.x, pos2.x, 'Marker position x is deterministic');
assertEquals(pos1.z, pos2.z, 'Marker position z is deterministic');

// Different seeds produce different positions
const pos3 = qs.getMarkerPosition('quest_01', 'different_seed');
assertTrue(pos1.x !== pos3.x || pos1.z !== pos3.z, 'Different seeds → different marker positions');

// Test 10: Storyline Progression Logic
console.log('\n--- Storyline Progression ---');
const qs2 = new QuestSystem({});

// Complete Act 1 (Q1-Q6)
qs2.addProgress('wood_log', 5);
qs2.addProgress('dirt', 10); // Q1 complete, unlocks Q2
assertEquals('available', qs2.getProgress('quest_02').state, 'Q2 available after Q1');

qs2.addProgress('planks', 10); // Q2 complete, unlocks Q3
assertEquals('available', qs2.getProgress('quest_03').state, 'Q3 available after Q2');

// Q3 has ITEM reward (not UNLOCK_QUEST), but _rebuildChain still unlocks Q4 when Q3 completes
qs2.addProgress('apple', 3); // Q3 complete
assertEquals('available', qs2.getProgress('quest_04').state, 'Q4 available after Q3 completes (chain rebuild)');

// Now advance Q4 with coal
qs2.addProgress('coal', 10); // Q4 complete
assertEquals('complete', qs2.getProgress('quest_04').state, 'Q4 complete after coal');
assertEquals(4, qs2.getCompletedCount(), '4 quests completed (Q1-Q4)');

// Test 11: Final Quest Reward Structure
console.log('\n--- Final Quest Reward ---');
const finalQuest = QUEST_REGISTRY.find(q => q.id === 'quest_25');
assertEquals(REWARD_TYPES.TITLE, finalQuest.reward.type, 'Final quest reward type is TITLE');
assertEquals('World Saver', finalQuest.reward.value, 'Final quest title is "World Saver"');

// Verify game completion triggers correctly
const qs3 = new QuestSystem({});
// Simulate completing all 25 quests by setting them complete
for (const q of QUEST_REGISTRY) {
  const reqs = q.requirements.map(r => ({ item: r.item, count: r.count }));
  for (const req of reqs) {
    qs3.addProgress(req.item, req.count);
  }
}
assertTrue(qs3.isGameComplete(), 'Game is complete after all quests');
assertEquals(100, qs3.getCompletionPercentage(), '100% completion');

// Summary
console.log('\n========================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All storyline tests passing!');
  process.exit(0);
}
