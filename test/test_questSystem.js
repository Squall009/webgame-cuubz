#!/usr/bin/env node
'use strict';

let passCount = 0, failCount = 0;
const failures = [];

function assert(c, m) { if (c) { passCount++; console.log(`  ✅ ${m}`); } else { failCount++; failures.push(m); console.log(`  ❌ ${m}`); } }
function assertEquals(a, e, m) { assert(a === e, `${m}: expected ${e}, got ${a}`); }
function assertTrue(c, m) { assert(c === true, m); }
function assertFalse(c, m) { assert(c === false, m); }
function assertNotNull(v, m) { assert(v !== null && v !== undefined, m); }
function assertGreaterThan(a, t, m) { assert(a > t, `${m}: expected > ${t}, got ${a}`); }

const { QUEST_TYPES, REWARD_TYPES, QUEST_STATES, QUEST_REGISTRY, QuestSystem } = require('../js/systems/questSystem.js');

console.log('Quest System Tests');
console.log('==================\n');

// Test 1: Constants & Enums
console.log('--- Constants & Enums ---');
assertEquals(6, Object.keys(QUEST_TYPES).length, 'QUEST_TYPES has 6 types');
assertEquals('collect', QUEST_TYPES.COLLECT, 'COLLECT type');
assertEquals('kill', QUEST_TYPES.KILL, 'KILL type');
assertEquals('explore', QUEST_TYPES.EXPLORE, 'EXPLORE type');
assertEquals('craft', QUEST_TYPES.CRAFT, 'CRAFT type');
assertEquals('deliver', QUEST_TYPES.DELIVER, 'DELIVER type');
assertEquals('boss', QUEST_TYPES.BOSS, 'BOSS type');
assertEquals(5, Object.keys(REWARD_TYPES).length, 'REWARD_TYPES has 5 types');
assertEquals(4, Object.keys(QUEST_STATES).length, 'QUEST_STATES has 4 states');
assertEquals('locked', QUEST_STATES.LOCKED, 'LOCKED state');
assertEquals('available', QUEST_STATES.AVAILABLE, 'AVAILABLE state');
assertEquals('in_progress', QUEST_STATES.IN_PROGRESS, 'IN_PROGRESS state');
assertEquals('complete', QUEST_STATES.COMPLETE, 'COMPLETE state');

// Test 2: Quest Registry
console.log('\n--- Quest Registry ---');
assertEquals(25, QUEST_REGISTRY.length, 'Registry has 25 quests');
let allHaveFields = true;
for (const q of QUEST_REGISTRY) { if (!q.id || !q.name || !q.description || !q.type || !q.requirements || !q.reward || !Array.isArray(q.requirements) || q.requirements.length === 0) allHaveFields = false; }
assertTrue(allHaveFields, 'All quests have required fields');
assertEquals(25, new Set(QUEST_REGISTRY.map(q => q.id)).size, 'All quest IDs unique');
const stages = QUEST_REGISTRY.map(q => q.stage).sort((a,b) => a-b);
assertEquals([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25].join(','), stages.join(','), 'Stages sequential 1-25');
const tc = {}; QUEST_REGISTRY.forEach(q => { tc[q.type] = (tc[q.type]||0)+1; });
assertGreaterThan(tc['collect']||0, 3, 'Multiple COLLECT quests');
assertGreaterThan(tc['boss']||0, 2, 'Multiple BOSS quests');
assertTrue(QUEST_REGISTRY.filter(q=>q.type===QUEST_TYPES.BOSS).every(q=>q.bossId), 'All BOSS quests have bossId');
for (let i=0; i<QUEST_REGISTRY.length-1; i++) { const q=QUEST_REGISTRY[i]; if(q.reward.type===REWARD_TYPES.UNLOCK_QUEST) assertEquals(QUEST_REGISTRY[i+1].id, q.reward.target, `Quest ${q.id} unlocks next`); }

// Test 3: Constructor & Init
console.log('\n--- Constructor & Initialization ---');
const qs1 = new QuestSystem({});
assertNotNull(qs1, 'Creates instance');
assertEquals(0, qs1.getCompletedCount(), '0 completed at start');
assertFalse(qs1.isGameComplete(), 'Not complete at start');
assertEquals('quest_01', qs1.getCurrentQuest().id, 'First quest is current');
assertEquals(QUEST_STATES.AVAILABLE, qs1.worldState['quest_01'].state, 'Quest 1 AVAILABLE');
for (let i=1; i<qs1.getAllQuests().length; i++) assertEquals(QUEST_STATES.LOCKED, qs1.getAllQuests()[i].state, `Quest ${i+1} LOCKED`);

// Test 4: Progression Chain
console.log('\n--- Progression Chain ---');
const qs2 = new QuestSystem({});
assertTrue(qs2.startQuest('quest_01'), 'Can start quest_01');
assertEquals(QUEST_STATES.IN_PROGRESS, qs2.worldState['quest_01'].state, 'IN_PROGRESS after start');
qs2.addProgress('wood_log', 5);
qs2.addProgress('dirt', 10);
assertEquals(QUEST_STATES.COMPLETE, qs2.worldState['quest_01'].state, 'Auto-completes');
assertTrue(qs2.worldState['quest_01'].completed, 'completed flag set');
assertNotNull(qs2.worldState['quest_01'].completedAt, 'Has completedAt');
assertEquals(QUEST_STATES.AVAILABLE, qs2.worldState['quest_02'].state, 'Quest 2 unlocked');
assertEquals(1, qs2.getCompletedCount(), 'Exactly 1 completed');

// Test 5: addProgress partial
console.log('\n--- Partial Progress ---');
const qs3 = new QuestSystem({});
qs3.startQuest('quest_01');
assertFalse(qs3.addProgress('wood_log', 3) !== null, 'Partial progress returns null');
assertEquals(3, qs3.getProgress('quest_01').objectives.find(o=>o.item==='wood_log').collected, 'Collected 3 wood_logs');
qs3.addProgress('wood_log', 2); // Now 5/5
assertTrue(qs3.getProgress('quest_01').objectives.find(o=>o.item==='wood_log').met, 'Wood log requirement met');
assertFalse(qs3.worldState['quest_01'].completed, 'Still needs dirt');
assertTrue(qs3.addProgress('dirt', 10) !== null, 'Final items complete quest');
assertEquals(QUEST_STATES.COMPLETE, qs3.worldState['quest_01'].state, 'Complete after all requirements met');

// Test 6: Progress Capping
console.log('\n--- Progress Capping ---');
const qs4 = new QuestSystem({});
qs4.startQuest('quest_01');
qs4.addProgress('wood_log', 100);
assertEquals(5, qs4.getProgress('quest_01').objectives.find(o=>o.item==='wood_log').collected, 'Capped at 5');

// Test 7: Auto-Start
console.log('\n--- Auto-Start ---');
const qs5 = new QuestSystem({});
qs5.startQuest('quest_01'); qs5.addProgress('wood_log', 5); qs5.addProgress('dirt', 10);
assertEquals(QUEST_STATES.AVAILABLE, qs5.worldState['quest_02'].state, 'Quest 2 unlocked');
qs5.addProgress('planks', 5);
assertEquals(QUEST_STATES.IN_PROGRESS, qs5.worldState['quest_02'].state, 'Auto-started on relevant item');

// Test 8: getCurrentQuest & getNextObjective
console.log('\n--- getCurrentQuest & getNextObjective ---');
const qs6 = new QuestSystem({});
qs6.startQuest('quest_01');
assertEquals('quest_01', qs6.getCurrentQuest().id, 'Current quest correct');
const obj = qs6.getNextObjective('quest_01');
assertNotNull(obj, 'Has objective');
assertEquals('wood_log', obj.item, 'Next item wood_log');
assertEquals(5, obj.needed, 'Need 5');
assertEquals(0, obj.collected, 'Collected 0');
qs6.addProgress('wood_log', 3);
assertEquals(3, qs6.getNextObjective('quest_01').collected, 'Shows 3 collected');

// Test 9: getProgress Report
console.log('\n--- getProgress Report ---');
const qs7 = new QuestSystem({});
qs7.startQuest('quest_01'); qs7.addProgress('wood_log', 3); qs7.addProgress('dirt', 5);
const report = qs7.getProgress('quest_01');
assertEquals(15, report.totalNeeded, 'Total needed = 15');
assertEquals(8, report.totalCollected, 'Total collected = 8');
assertGreaterThan(report.percentage, 50, 'Percentage ~53%');

// Test 10: Serialization
console.log('\n--- Serialization ---');
const qs8 = new QuestSystem({});
qs8.startQuest('quest_01'); qs8.addProgress('wood_log', 5); qs8.addProgress('dirt', 10);
assertEquals(1, qs8.getCompletedCount(), '1 completed before serialize');
const serialized = qs8.serialize();
assertTrue(serialized['quest_01'].completed, 'Serialized quest complete');
const qs9 = new QuestSystem({}, {});
qs9.deserialize(serialized);
assertEquals(1, qs9.getCompletedCount(), 'Deserialized: 1 completed');
assertEquals(QUEST_STATES.COMPLETE, qs9.worldState['quest_01'].state, 'State preserved');
assertEquals(QUEST_STATES.AVAILABLE, qs9.worldState['quest_02'].state, 'Chain rebuilt');

// Test 11: Callbacks
console.log('\n--- Callbacks ---');
let cb = { s: 0, c: 0, p: 0 };
const qs10 = new QuestSystem({}, { onQuestStart: ()=>cb.s++, onQuestComplete: ()=>cb.c++, onProgressUpdate: ()=>cb.p++ });
qs10.startQuest('quest_01'); assertEquals(1, cb.s, 'onQuestStart fired');
cb.p = 0; qs10.addProgress('wood_log', 5); assertGreaterThan(cb.p, 0, 'onProgressUpdate fired');
const beforeC = cb.c; qs10.addProgress('dirt', 10); assertEquals(beforeC+1, cb.c, 'onQuestComplete fired');

// Test 12: Game Completion
console.log('\n--- Game Completion ---');
const qs11 = new QuestSystem({});
assertFalse(qs11.isGameComplete(), 'Not complete at start');
assertEquals(0, qs11.getCompletionPercentage(), '0% at start');
QUEST_REGISTRY.forEach(q => { qs11.worldState[q.id] = { state: QUEST_STATES.COMPLETE, completed: true, completedAt: Date.now(), progress: {} }; });
assertTrue(qs11.isGameComplete(), 'All complete = game complete');
assertEquals(100, qs11.getCompletionPercentage(), '100% completion');

// Test 13: Reset
console.log('\n--- Reset ---');
const qs12 = new QuestSystem({});
qs12.startQuest('quest_01'); qs12.addProgress('wood_log', 5); qs12.addProgress('dirt', 10);
assertEquals(1, qs12.getCompletedCount(), '1 before reset');
qs12.reset();
assertEquals(0, qs12.getCompletedCount(), 'Reset clears progress');
assertEquals(QUEST_STATES.AVAILABLE, qs12.worldState['quest_01'].state, 'Quest 1 available after reset');

// Test 14: Marker Positions
console.log('\n--- Marker Positions ---');
const qs13 = new QuestSystem({});
const m1 = qs13.getMarkerPosition('quest_01', 'seed123');
assertNotNull(m1, 'Has marker position');
assertEquals('plains', m1.biome, 'Correct biome');
const m2 = qs13.getMarkerPosition('quest_01', 'seed123');
assertEquals(m1.x, m2.x, 'Deterministic x');
assertEquals(m1.z, m2.z, 'Deterministic z');
assertEquals(null, qs13.getMarkerPosition('nonexistent', 'seed'), 'Null for nonexistent');

// Test 15: Dungeon Grouping
console.log('\n--- Dungeon Grouping ---');
const qs14 = new QuestSystem({});
const dungeons = qs14.getQuestsByDungeon();
assertEquals(6, dungeons.introduction.length, 'Intro: 6 quests');
assertEquals(6, dungeons.dungeon1_forest_warden.length, 'D1: 6 quests');
assertEquals(5, dungeons.dungeon2_lava_titan.length, 'D2: 5 quests');
assertEquals(4, dungeons.dungeon3_frost_serpent.length, 'D3: 4 quests');
assertEquals(4, dungeons.dungeon4_corruption_overlord.length, 'D4: 4 quests');
assertEquals('introduction', qs14.getCurrentDungeon(), 'Start in intro');

// Test 16: Edge Cases
console.log('\n--- Edge Cases ---');
const qs15 = new QuestSystem({});
assertFalse(qs15.startQuest('quest_02'), 'Cannot start locked quest');
qs15.startQuest('quest_01'); assertFalse(qs15.startQuest('quest_01'), 'Cannot restart in_progress');

const qs16 = new QuestSystem({});
qs16.startQuest('quest_01');
assertFalse(qs16.addProgress('nonexistent_item', 99) !== null, 'Non-existent item returns null');
assertEquals(null, qs16.getProgress('nonexistent'), 'Null progress for nonexistent quest');
assertEquals(null, qs16.getQuest('nonexistent'), 'Null quest for nonexistent id');

qs16.addProgress('wood_log', 5); qs16.addProgress('dirt', 10);
assertEquals(null, qs16.getNextObjective('quest_01'), 'Null objective for completed quest');

const qs17 = new QuestSystem({});
qs17.deserialize(null); assertEquals(QUEST_STATES.AVAILABLE, qs17.worldState['quest_01'].state, 'Deserialize null OK');

// Test 17: Multi-Quest Progression
console.log('\n--- Multi-Quest Progression ---');
const qs18 = new QuestSystem({});
function completeQ(qs, id) { const q=qs.getQuest(id); if(!q)return; if(qs.worldState[id].state===QUEST_STATES.AVAILABLE) qs.startQuest(id); for(const r of q.requirements) qs.addProgress(r.item, r.count); }
completeQ(qs18, 'quest_01'); assertEquals(QUEST_STATES.COMPLETE, qs18.worldState['quest_01'].state, 'Q1 complete');
completeQ(qs18, 'quest_02'); assertEquals(QUEST_STATES.COMPLETE, qs18.worldState['quest_02'].state, 'Q2 complete');
assertEquals(2, qs18.getCompletedCount(), '2 completed');
assertEquals('quest_03', qs18.getCurrentQuest().id, 'Current is quest_03');

// Test 18: Three-Pass Prevents Cascading
console.log('\n--- Three-Pass addProgress ---');
const qs19 = new QuestSystem({});
qs19.startQuest('quest_01');
assertFalse(qs19.addProgress('wood_log', 5) !== null, 'Partial does not complete');
assertFalse(qs19.worldState['quest_01'].completed, 'Still in progress');
assertTrue(qs19.addProgress('dirt', 10) !== null, 'Final requirement completes quest');

console.log('\n========================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) { console.log('\nFailures:'); failures.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
else { console.log('🎉 All quest system tests passing!'); process.exit(0); }
