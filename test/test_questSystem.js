#!/usr/bin/env node
/**
 * Cuubz - Quest System Tests (NEW)
 * Tests quest data structures, progression chain, completion logic, serialization, and edge cases.
 */

'use strict';

const { QUEST_TYPES, QUEST_DIFFICULTY, REWARD_TYPES, QUEST_CATALOG, BOSS_DEFINITIONS, QuestTracker } = require('../js/systems/questSystem');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }

console.log('Quest System Tests\n==================\n');

// Constants & Enums
console.log('--- Constants & Enums ---');
assert(Object.keys(QUEST_TYPES).length === 7, 'QUEST_TYPES has 7 types');
assert(QUEST_TYPES.COLLECT === 'collect', 'COLLECT type value');
assert(QUEST_TYPES.EXPLORE === 'explore', 'EXPLORE type value');
assert(QUEST_TYPES.KILL === 'kill', 'KILL type value');
assert(QUEST_TYPES.CRAFT === 'craft', 'CRAFT type value');
assert(QUEST_TYPES.PLACE === 'place', 'PLACE type value');
assert(QUEST_TYPES.DIALOGUE === 'dialogue', 'DIALOGUE type value');
assert(QUEST_TYPES.BOSS === 'boss', 'BOSS type value');

assert(Object.keys(QUEST_DIFFICULTY).length === 5, 'QUEST_DIFFICULTY has 5 levels');
assert(QUEST_DIFFICULTY.TRIVIAL === 1, 'TRIVIAL = 1');
assert(QUEST_DIFFICULTY.EASY === 2, 'EASY = 2');
assert(QUEST_DIFFICULTY.MEDIUM === 3, 'MEDIUM = 3');
assert(QUEST_DIFFICULTY.HARD === 4, 'HARD = 4');
assert(QUEST_DIFFICULTY.LEGENDARY === 5, 'LEGENDARY = 5');

assert(Object.keys(REWARD_TYPES).length === 4, 'REWARD_TYPES has 4 types');
assert(REWARD_TYPES.ITEM === 'item', 'ITEM reward type');
assert(REWARD_TYPES.UNLOCK === 'unlock', 'UNLOCK reward type');
assert(REWARD_TYPES.XP === 'xp', 'XP reward type');
assert(REWARD_TYPES.ACHIEVEMENT === 'achievement', 'ACHIEVEMENT reward type');

// Quest Catalog Structure
console.log('\n--- Quest Catalog Structure ---');
assert(Object.keys(QUEST_CATALOG).length === 25, 'Exactly 25 quests defined');
for (let i = 1; i <= 25; i++) {
  const qid = 'Q' + String(i).padStart(2, '0');
  assert(QUEST_CATALOG[qid] !== undefined, 'Quest ' + qid + ' exists');
}
for (const qid of Object.keys(QUEST_CATALOG)) {
  const q = QUEST_CATALOG[qid];
  assert(typeof q.id === 'string', qid + ' has id');
  assert(typeof q.name === 'string' && q.name.length > 0, qid + ' has name');
  assert(typeof q.description === 'string' && q.description.length > 0, qid + ' has description');
  assert(typeof q.type === 'string', qid + ' has type');
  assert(typeof q.difficulty === 'number' && q.difficulty >= 1 && q.difficulty <= 5, qid + ' difficulty valid');
  assert(typeof q.requirements === 'object', qid + ' has requirements');
  assert(typeof q.reward === 'object', qid + ' has reward');
  assert(typeof q.nextQuest === 'string' || q.nextQuest === null, qid + ' nextQuest valid');
  assert(typeof q.markerBiome === 'string', qid + ' has markerBiome');
}
assert(QUEST_CATALOG.Q25.nextQuest === null, 'Q25 is final quest');
for (let i = 1; i <= 24; i++) {
  const cur = 'Q' + String(i).padStart(2, '0');
  const nxt = 'Q' + String(i + 1).padStart(2, '0');
  assert(QUEST_CATALOG[cur].nextQuest === nxt, cur + ' chains to ' + nxt);
}

// Boss Definitions
console.log('\n--- Boss Definitions ---');
assert(Object.keys(BOSS_DEFINITIONS).length === 5, '5 bosses defined');
const bossIds = ['forest_guardian', 'sand_wraith', 'frost_titan', 'corruption_overlord', 'world_ender'];
for (const bid of bossIds) {
  assert(BOSS_DEFINITIONS[bid] !== undefined, 'Boss ' + bid + ' defined');
  const b = BOSS_DEFINITIONS[bid];
  assert(typeof b.name === 'string' && b.name.length > 0, bid + ' has name');
  assert(typeof b.health === 'number' && b.health > 0, bid + ' health > 0');
  assert(typeof b.attackDamage === 'number' && b.attackDamage > 0, bid + ' attackDamage > 0');
  assert(typeof b.phases === 'number' && b.phases >= 2, bid + ' phases >= 2');
  assert(Array.isArray(b.attacks) && b.attacks.length > 0, bid + ' has attacks');
  for (const atk of b.attacks) {
    assert(typeof atk.name === 'string', bid + ' attack has name');
    assert(typeof atk.damage === 'number', bid + ' attack has damage');
    assert(typeof atk.cooldown === 'number' && atk.cooldown > 0, bid + ' attack cooldown > 0');
    assert(typeof atk.range === 'number' && atk.range >= 0, bid + ' attack range >= 0');
  }
}
const bossOrder = ['forest_guardian', 'sand_wraith', 'frost_titan', 'corruption_overlord', 'world_ender'];
for (let i = 1; i < bossOrder.length; i++) {
  assert(BOSS_DEFINITIONS[bossOrder[i]].health > BOSS_DEFINITIONS[bossOrder[i-1]].health, 'Boss health scales');
}

// QuestTracker Construction
console.log('\n--- QuestTracker Construction ---');
const tr = new QuestTracker('test-world');
assert(tr.worldId === 'test-world', 'World ID set');
assert(Object.keys(tr.progress).length === 25, 'All 25 quests initialized');
assert(tr.totalXP === 0, 'Starting XP is 0');
assert(tr.unlocks.size === 0, 'No initial unlocks');
assert(tr.achievements.size === 0, 'No initial achievements');
for (const qid of Object.keys(QUEST_CATALOG)) {
  const p = tr.progress[qid];
  assert(p.stage === 0 && !p.completed && p.completedAt === null, qid + ' starts incomplete');
}

// Static Methods
console.log('\n--- Static Methods ---');
assert(QuestTracker.getQuestDefinition('Q01') !== null, 'getQuestDefinition Q01');
assert(QuestTracker.getQuestDefinition('Q99') === null, 'getQuestDefinition invalid returns null');
assert(QuestTracker.getAllQuests().length === 25, 'getAllQuests returns 25');
assert(QuestTracker.getQuestCount() === 25, 'getQuestCount returns 25');

// Q01: Explore Plains
console.log('\n--- Q01: Explore Plains ---');
const t1 = new QuestTracker('q01');
assert(!t1.progress.Q01.completed, 'Q01 not complete initially');
t1.recordBiomeExplored('Plains');
assert(t1.progress.Q01.completed, 'Q01 completes after exploring Plains');
assert(t1.progress.Q01.stage === 1, 'Q01 stage advances');
assert(t1.progress.Q01.completedAt !== null, 'Q01 has timestamp');
const r1 = t1.pendingItemRewards.find(r => r.questId === 'Q01');
assert(r1 && r1.itemId === 'apple' && r1.count === 3, 'Q01 reward: 3 apples');

// Q02: Collect Wood Logs
console.log('\n--- Q02: Collect Items ---');
const t2 = new QuestTracker('q02');
t2.recordBiomeExplored('Plains'); // Complete Q01
assert(!t2.progress.Q02.completed, 'Q02 not complete initially');
t2.recordItemCollected('wood_log', 5);
assert(!t2.progress.Q02.completed, 'Q02 needs 10, only 5 collected');
const rp = t2.getRequirementProgress('Q02');
assert(rp.current === 5 && rp.required === 10 && rp.percentage === 50, 'Q02 progress 50%');
t2.recordItemCollected('wood_log', 5);
assert(t2.progress.Q02.completed, 'Q02 completes with 10/10');

// Q03: Collect Stone
console.log('\n--- Q03: Collect Stone ---');
const t3 = new QuestTracker('q03');
t3.recordBiomeExplored('Plains'); t3.recordItemCollected('wood_log', 10);
assert(!t3.progress.Q03.completed, 'Q03 not complete initially');
t3.recordItemCollected('stone', 7);
assert(!t3.progress.Q03.completed, 'Q03 needs 20, only 7');
t3.recordItemCollected('stone', 13);
assert(t3.progress.Q03.completed, 'Q03 completes with 20/20');
assert(t3.hasUnlock('stone_tools'), 'Q03 grants stone_tools unlock');

// Q04: Craft Bed
console.log('\n--- Q04: Craft Item ---');
const t4 = new QuestTracker('q04');
t4.recordBiomeExplored('Plains'); t4.recordItemCollected('wood_log', 10); t4.recordItemCollected('stone', 20);
assert(!t4.progress.Q04.completed, 'Q04 not complete initially');
t4.recordItemCrafted('bed', 1);
assert(t4.progress.Q04.completed, 'Q04 completes after crafting bed');

// Q07: Explore Corrupt
console.log('\n--- Q07: Explore Corrupt ---');
const t7 = new QuestTracker('q07');
t7.recordBiomeExplored('Plains'); t7.recordItemCollected('wood_log', 10);
t7.recordItemCollected('stone', 20); t7.recordItemCrafted('bed', 1);
t7.recordItemCollected('coal_ore', 10); t7.recordItemCollected('iron_ore', 15);
assert(!t7.progress.Q07.completed, 'Q07 not complete initially');
t7.recordBiomeExplored('Corrupt');
assert(t7.progress.Q07.completed, 'Q07 completes after exploring Corrupt');

// Q09: Multi-requirement
console.log('\n--- Q09: Multi-requirement ---');
const t9 = new QuestTracker('q09');
t9.recordBiomeExplored('Plains'); t9.recordItemCollected('wood_log', 10);
t9.recordItemCollected('stone', 20); t9.recordItemCrafted('bed', 1);
t9.recordItemCollected('coal_ore', 10); t9.recordItemCollected('iron_ore', 15);
t9.recordBiomeExplored('Corrupt'); t9.recordItemCollected('apple', 10);
assert(!t9.progress.Q09.completed, 'Q09 not complete initially');
t9.recordBiomeExplored('Corrupt'); // Already explored but record again
t9.recordItemCollected('corrupt_crystal', 1);
assert(!t9.progress.Q09.completed, 'Q09 needs 3 crystals, only 1');
t9.recordItemCollected('corrupt_crystal', 2);
assert(t9.progress.Q09.completed, 'Q09 completes with 3/3 + Corrupt explored');

// Q11: Boss Kill
console.log('\n--- Q11: Boss Kill ---');
const t11 = new QuestTracker('q11');
t11.recordBiomeExplored('Plains'); t11.recordItemCollected('wood_log', 10);
t11.recordItemCollected('stone', 20); t11.recordItemCrafted('bed', 1);
t11.recordItemCollected('coal_ore', 10); t11.recordItemCollected('iron_ore', 15);
t11.recordBiomeExplored('Corrupt'); t11.recordItemCollected('apple', 10);
t11.recordItemCollected('corrupt_crystal', 5); t11.recordItemCollected('quest_key', 3);
assert(!t11.progress.Q11.completed, 'Q11 not complete initially');
t11.recordBossKilled('forest_guardian');
assert(t11.progress.Q11.completed, 'Q11 completes after boss kill');
assert(t11.progress.Q11.bossesKilled.has('forest_guardian'), 'Boss recorded');

// Quest Availability
console.log('\n--- Quest Availability ---');
const ta = new QuestTracker('avail');
assert(ta.isQuestAvailable('Q01'), 'Q01 always available');
assert(!ta.isQuestAvailable('Q02'), 'Q02 not available yet');
ta.recordBiomeExplored('Plains');
assert(ta.isQuestAvailable('Q02'), 'Q02 available after Q01');

// getCurrentQuest
console.log('\n--- getCurrentQuest ---');
const tc = new QuestTracker('curr');
let cq = tc.getCurrentQuest();
assert(cq && cq.definition.id === 'Q01', 'First quest is Q01');
tc.recordBiomeExplored('Plains');
cq = tc.getCurrentQuest();
assert(cq && cq.definition.id === 'Q02', 'Advances to Q02');

// getCompletionPercentage
console.log('\n--- getCompletionPercentage ---');
const tp = new QuestTracker('pct');
assert(tp.getCompletionPercentage() === 0, 'Starts at 0%');
tp.recordBiomeExplored('Plains');
assert(tp.getCompletionPercentage() > 0, '>0% after Q01 complete');

// getCompletedQuests
console.log('\n--- getCompletedQuests ---');
const td = new QuestTracker('done');
td.recordBiomeExplored('Plains');
const done = td.getCompletedQuests();
assert(Array.isArray(done) && done.length >= 1, 'Returns array with completed quests');
assert(done.some(q => q.id === 'Q01'), 'Q01 in list');

// Callbacks
console.log('\n--- Callbacks ---');
let cbFired = false, cbData = null;
const tcb = new QuestTracker('cb', {
  onQuestComplete(id) { cbFired = true; },
  onProgressUpdate(id, data) { cbData = id; },
});
tcb.recordBiomeExplored('Plains');
assert(cbFired, 'onQuestComplete fired');
assert(cbData === 'Q01', 'onProgressUpdate fired for Q01');

// Serialization
console.log('\n--- Serialization ---');
const ts = new QuestTracker('ser');
ts.recordBiomeExplored('Plains'); ts.recordItemCollected('wood_log', 7);
const sd = ts.serialize();
assert(sd.worldId === 'ser', 'worldId serialized');
assert(sd.progress.Q01.completed, 'Q01 completed serialized');
assert(sd.progress.Q02.collectedItems.wood_log === 7, 'Partial progress serialized');

const tds = QuestTracker.deserialize('ser', sd);
assert(tds.progress.Q01.completed, 'Q01 restored');
assert(tds.progress.Q02.collectedItems.wood_log === 7, 'Progress restored');
assert(!tds.progress.Q02.completed, 'Incomplete quest stays incomplete');

let cbRestored = false;
const tds2 = QuestTracker.deserialize('ser', sd, { onQuestComplete() { cbRestored = true; } });
tds2.recordItemCollected('wood_log', 3);
assert(cbRestored, 'Callbacks work on deserialized tracker');

// Edge Cases
console.log('\n--- Edge Cases ---');
const te = new QuestTracker('edge');
te.recordItemCollected('wood_log', 0);
assert(te.progress.Q02.collectedItems.wood_log === undefined, 'Zero count ignored');
te.recordItemCollected('wood_log', -5);
assert(te.progress.Q02.collectedItems.wood_log === undefined, 'Negative count ignored');
te.recordItemCrafted('bed', 0);
assert(te.progress.Q04.craftedItems.bed === undefined, 'Zero craft ignored');
assert(te.getProgress('Q99') === null, 'Invalid questId returns null');

// Immutability
console.log('\n--- Immutability ---');
const ti = new QuestTracker('imm');
ti.recordBiomeExplored('Plains');
const p1 = ti.getProgress('Q01');
p1.completed = false;
assert(ti.getProgress('Q01').completed, 'getProgress returns copy');

// getNextQuest
console.log('\n--- getNextQuest ---');
const tn = new QuestTracker('next');
tn.recordBiomeExplored('Plains');
const nq = tn.getNextQuest('Q01');
assert(nq && nq.definition.id === 'Q02', 'Next after Q01 is Q02');
assert(tn.getNextQuest('Q25') === null, 'Q25 has no next');

// World Ender Boss
console.log('\n--- World Ender ---');
const we = BOSS_DEFINITIONS.world_ender;
assert(we.health === 2500 && we.phases === 5, 'World Ender stats correct');
assert(we.attacks.find(a => a.type === 'ultimate'), 'Has ultimate attack');

// Summary
console.log('\n--- Results ---');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('  Total: ' + (passed + failed));
if (failed > 0) { console.error('\nSome tests FAILED'); process.exit(1); }
else { console.log('\nAll quest system tests passed!'); process.exit(0); }
