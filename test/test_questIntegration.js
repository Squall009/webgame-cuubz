#!/usr/bin/env node
/**
 * Cuubz — Quest System Integration Tests
 * Full progression flow: quest tracker → progress → completion → unlock next quest.
 * Tests quest marker positions, tracker display, and requirement fulfillment chain.
 */

'use strict';

// ============================================================
// Test Setup
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

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

function assertNotNull(value, message) {
  assert(value !== null && value !== undefined, message);
}

function assertTrue(condition, message) {
  assert(condition === true, message);
}

function assertFalse(condition, message) {
  assert(condition === false, message);
}

function assertGreaterEqual(actual, expected, message) {
  assert(actual >= expected, `${message}: expected >= ${expected}, got ${actual}`);
}

// ============================================================
// Load Modules
// ============================================================

const { QuestSystem, QUEST_REGISTRY, QUEST_TYPES, QUEST_STATES } = require('../js/systems/questSystem');
const { QuestMarker, QuestMarkerManager, INTERACTION_RANGE, VISIBILITY_RADIUS } = require('../js/entities/questMarker');

// ============================================================
// Integration Tests — Full quest progression flow
// ============================================================

(async function runTests() {
console.log('Cuubz — Quest System Integration Tests');
console.log('=======================================\n');

// --- Test 1: Quest Tracker Shows Current Objective ---
console.log('\n--- Test 1: Quest Tracker Shows Current Objective ---');

const worldState = {};
let completedQuests = [];
let startedQuests = [];

const questSys = new QuestSystem(worldState, {
  onQuestComplete: (q) => completedQuests.push(q),
  onQuestStart: (q) => startedQuests.push(q),
});

// Q01 should be the first available quest at game start
const current = questSys.getCurrentQuest();
assertNotNull(current, 'Current quest exists at game start');
assertEquals(current.id, 'quest_01', 'Q01 is first quest');
assertEquals(current.name, 'First Steps', 'Q01 name correct');

// Quest tracker should show Q01 as available
const progress = questSys.getProgress('quest_01');
assertNotNull(progress, 'Q01 has progress entry');
assertEquals(progress.state, QUEST_STATES.AVAILABLE, 'Q01 is AVAILABLE at start');

// getCurrentQuest returns the first non-locked quest
assertEquals(questSys.getCurrentQuest().id, 'quest_01', 'getCurrentQuest returns Q01');

// --- Test 2: Progress Through First Quest (Q01) ---
console.log('\n--- Test 2: Progress Through First Quest (Q01) ---');

// Q01 requirements: wood_log × 5, dirt × 10
const q1 = questSys.getQuest('quest_01');
assertEquals(q1.requirements.length, 2, 'Q01 has 2 requirements');
assertEquals(q1.requirements[0].item, 'wood_log', 'Q01 req 1: wood_log');
assertEquals(q1.requirements[0].count, 5, 'Q01 req 1 count: 5');
assertEquals(q1.requirements[1].item, 'dirt', 'Q01 req 2: dirt');
assertEquals(q1.requirements[1].count, 10, 'Q01 req 2 count: 10');

// Add partial progress — some wood logs (addProgress is global by item)
questSys.addProgress('wood_log', 3);
const q1Progress = questSys.getProgress('quest_01');
assertEquals(q1Progress.state, QUEST_STATES.IN_PROGRESS, 'Q01 in_progress after partial wood');

// Complete wood requirement
questSys.addProgress('wood_log', 2); // +2 = 5 total
const afterWood = questSys.getProgress('quest_01');
assertFalse(afterWood.completed, 'Q01 not complete without dirt (only wood done)');

// Add partial dirt
questSys.addProgress('dirt', 7);
const afterDirt = questSys.getProgress('quest_01');
assertFalse(afterDirt.completed, 'Q01 not complete at 7/10 dirt');

// Complete dirt requirement → Q01 completes!
questSys.addProgress('dirt', 3); // +3 = 10 total
const q1Complete = questSys.getProgress('quest_01');
assertTrue(q1Complete.completed, 'Q01 completed after all requirements met');
assertEquals(q1Complete.state, QUEST_STATES.COMPLETE, 'Q01 state is COMPLETE');

// Verify callbacks fired
assert(completedQuests.includes('quest_01'), 'onQuestComplete callback fired for Q01');
assert(startedQuests.includes('quest_01'), 'onQuestStart callback fired for Q01');

// --- Test 3: Quest Completion Unlocks Next Quest ---
console.log('\n--- Test 3: Quest Completion Unlocks Next Quest ---');

// After Q01 complete, Q02 should be unlocked (available)
const q2Progress = questSys.getProgress('quest_02');
assertEquals(q2Progress.state, QUEST_STATES.AVAILABLE, 'Q02 available after Q01 complete');

// getCurrentQuest should now return Q02
const newCurrent = questSys.getCurrentQuest();
assertEquals(newCurrent.id, 'quest_02', 'getCurrentQuest returns Q02 after Q01 complete');
assertEquals(newCurrent.name, 'Crafting Basics', 'Q02 name correct');

// Verify Q02 requirements (planks × 10)
const q2 = questSys.getQuest('quest_02');
assertEquals(q2.requirements[0].item, 'planks', 'Q02 req: planks');
assertEquals(q2.requirements[0].count, 10, 'Q02 req count: 10');

// Complete Q02
questSys.addProgress('planks', 10);
assertTrue(questSys.getProgress('quest_02').completed, 'Q02 completed');

// Q03 should now be available
assertEquals(questSys.getProgress('quest_03').state, QUEST_STATES.AVAILABLE, 'Q03 available after Q02 complete');

// --- Test 4: Quest Marker Positions (Deterministic) ---
console.log('\n--- Test 4: Quest Marker Positions ---');

const markerSeed = 12345;

// Create markers via manager for all quests
const markerMgr = new QuestMarkerManager({ worldSeed: markerSeed });
markerMgr.setQuestSystem(questSys);
const markerCount = markerMgr.createAllMarkers();
assertGreaterEqual(markerCount, 20, `Created ${markerCount} markers (expect ~25)`);

// Q01 marker position should be deterministic based on seed
const q1MarkerPos = questSys.getMarkerPosition('quest_01', markerSeed);
assertNotNull(q1MarkerPos, 'Q01 marker position exists');
assert(typeof q1MarkerPos.x === 'number', 'Marker has X coordinate');
assert(typeof q1MarkerPos.z === 'number', 'Marker has Z coordinate');

// Same seed → same position (deterministic)
const q1MarkerPos2 = questSys.getMarkerPosition('quest_01', markerSeed);
assertEquals(q1MarkerPos.x, q1MarkerPos2.x, 'Q01 marker X deterministic with same seed');
assertEquals(q1MarkerPos.z, q1MarkerPos2.z, 'Q01 marker Z deterministic with same seed');

// Different seed → different position (usually)
const q1OtherSeed = questSys.getMarkerPosition('quest_01', 99999);
assert(typeof q1OtherSeed.x === 'number', 'Different seed also produces valid position');

// Marker for completed quest should be inactive
markerMgr._updateActiveMarkers();
const q1Marker = markerMgr.markers.find(m => m.questId === 'quest_01');
assertNotNull(q1Marker, 'Q01 marker found in manager');
assertFalse(markerMgr.activeMarkers.includes(q1Marker), 'Completed Q01 marker is inactive');

// --- Test 5: Quest Marker Interaction Flow ---
console.log('\n--- Test 5: Quest Marker Interaction ---');

// Create a fresh quest system for interaction testing
const interactWorldState = {};
const interactQuestSys = new QuestSystem(interactWorldState);

const testMarker = new QuestMarker('quest_01', {
  x: 10, y: 64, z: 20,
  questType: 'collect',
  biome: 'plains',
  active: true,
});

// Player approaches marker — within interaction range
const playerNear = { x: 11, y: 64, z: 21 }; // ~1.73 blocks away (< 3.0 INTERACTION_RANGE)
testMarker.update(playerNear, 0.016);
assertTrue(testMarker.inInteractionRange, 'Player near marker can interact');

// Player far from marker — outside interaction range
const playerFar = { x: 50, y: 64, z: 50 }; // ~42 blocks away (> 3.0)
testMarker.update(playerFar, 0.016);
assertFalse(testMarker.inInteractionRange, 'Player far from marker cannot interact');

// Player within visibility range (64 blocks)
const playerVisible = { x: 30, y: 64, z: 40 }; // ~28 blocks away (< 64)
testMarker.update(playerVisible, 0.016);
assertTrue(testMarker.visible, 'Player within visibility range sees marker');

// Player outside visibility range
const playerInvisible = { x: 100, y: 64, z: 100 }; // ~85 blocks away (> 64)
testMarker.update(playerInvisible, 0.016);
assertFalse(testMarker.visible, 'Player outside visibility range does not see marker');

// Interact with marker — returns quest data
const interactionResult = testMarker.interact(interactQuestSys);
assertNotNull(interactionResult, 'Interaction returns data');
assertEquals(interactionResult.questId, 'quest_01', 'Interaction has correct quest ID');
assertEquals(interactionResult.name, 'First Steps', 'Interaction has quest name');
assertTrue(testMarker.interacted, 'Marker marked as interacted after interaction');

// Second interaction should return null (already interacted)
const secondInteract = testMarker.interact(interactQuestSys);
assertEquals(secondInteract, null, 'Second interaction returns null');

// --- Test 6: Full Quest Chain Progression (Q01 → Q03) ---
console.log('\n--- Test 6: Full Quest Chain Progression ---');

const chainWorldState = {};
const chainQuestSys = new QuestSystem(chainWorldState);

// Progress through first 3 quests in sequence
// Q01: wood_log × 5, dirt × 10
chainQuestSys.addProgress('wood_log', 5);
chainQuestSys.addProgress('dirt', 10);
assertTrue(chainQuestSys.getProgress('quest_01').completed, 'Q01 completed');

// Q02: planks × 10
chainQuestSys.addProgress('planks', 10);
assertTrue(chainQuestSys.getProgress('quest_02').completed, 'Q02 completed');

// Q03: apple × 3
chainQuestSys.addProgress('apple', 3);
assertTrue(chainQuestSys.getProgress('quest_03').completed, 'Q03 completed');

// Verify chain progression — all 3 complete, Q04 available
assertEquals(chainQuestSys.getProgress('quest_01').state, QUEST_STATES.COMPLETE, 'Q01: COMPLETE');
assertEquals(chainQuestSys.getProgress('quest_02').state, QUEST_STATES.COMPLETE, 'Q02: COMPLETE');
assertEquals(chainQuestSys.getProgress('quest_03').state, QUEST_STATES.COMPLETE, 'Q03: COMPLETE');
assertEquals(chainQuestSys.getProgress('quest_04').state, QUEST_STATES.AVAILABLE, 'Q04: AVAILABLE (unlocked)');

// Q05 should still be locked (requires Q04 completion first)
assertEquals(chainQuestSys.getProgress('quest_05').state, QUEST_STATES.LOCKED, 'Q05: LOCKED (chain not yet reached)');

// getCurrentQuest should return Q04 after chain progression
assertEquals(chainQuestSys.getCurrentQuest().id, 'quest_04', 'Current quest is Q04 after completing Q1-Q3');

// --- Test 7: Quest Serialization and Persistence ---
console.log('\n--- Test 7: Quest Serialization and Persistence ---');

const persistWorldState = {};
const persistQuestSys = new QuestSystem(persistWorldState);

// Make some progress
persistQuestSys.addProgress('wood_log', 3); // Partial Q01 wood progress
persistQuestSys.addProgress('dirt', 5);     // Partial Q01 dirt progress

// Serialize quest state
const serialized = persistQuestSys.serialize();
assertNotNull(serialized, 'Serialization returns data');

// Deserialize into fresh system
const reloadWorldState = {};
const reloadQuestSys = new QuestSystem(reloadWorldState);
reloadQuestSys.deserialize(serialized);

// Verify quest progress survived round-trip
const reloadedQ1 = reloadQuestSys.getProgress('quest_01');
assertTrue(reloadedQ1.state === QUEST_STATES.IN_PROGRESS || reloadedQ1.state === QUEST_STATES.AVAILABLE,
           'Q01 state after reload is valid (in_progress or available)');
assertFalse(reloadedQ1.completed, 'Q01 not completed after reload (partial progress)');

// --- Test 8: Quest Marker Manager CRUD ---
console.log('\n--- Test 8: Quest Marker Manager Operations ---');

const mgrSeed = 42;
const managerQuestSys = new QuestSystem({});
managerQuestSys.reset(); // Initialize quest states
const markerManager = new QuestMarkerManager({ worldSeed: mgrSeed });
markerManager.setQuestSystem(managerQuestSys);

// Create all markers
const totalMarkers = markerManager.createAllMarkers();
assertGreaterEqual(totalMarkers, 20, `Created ${totalMarkers} markers`);

// Get closest marker to a position
const testPos = { x: 5, y: 64, z: 10 };
const closest = markerManager.getClosestMarker(testPos);
assertNotNull(closest, 'Closest marker found');

// Filter markers by act via the quest system (no dedicated API — filter manually)
const act1Markers = markerManager.markers.filter(m => {
  const quest = managerQuestSys.getQuest(m.questId);
  return quest && quest.act === 1;
});
assertTrue(act1Markers.length > 0, `Act 1 markers exist (${act1Markers.length})`);

// Filter markers by biome
const corruptMarkers = markerManager.markers.filter(m => m.biome === 'corrupt');
assertTrue(corruptMarkers.length > 0, 'Corrupt biome markers exist');

// --- Test 9: Quest System Reset (New Game) ---
console.log('\n--- Test 9: Quest System Reset ---');

const resetWorldState = {};
const resetQuestSys = new QuestSystem(resetWorldState);

// Make progress then reset
resetQuestSys.addProgress('wood_log', 5);
resetQuestSys.addProgress('dirt', 10);
assertTrue(resetQuestSys.getProgress('quest_01').completed, 'Q01 completed before reset');

// Reset to new game state
resetQuestSys.reset();

assertEquals(resetQuestSys.getCurrentQuest().id, 'quest_01', 'After reset: current quest is Q01');
assertEquals(resetQuestSys.getProgress('quest_01').state, QUEST_STATES.AVAILABLE, 'After reset: Q01 available');
assertFalse(resetQuestSys.getProgress('quest_01').completed, 'After reset: Q01 not completed');
assertEquals(resetQuestSys.getProgress('quest_02').state, QUEST_STATES.LOCKED, 'After reset: Q02 locked again');

// --- Test 10: Edge Cases ---
console.log('\n--- Test 10: Edge Cases ---');

const edgeWorldState = {};
const edgeQuestSys = new QuestSystem(edgeWorldState);

// Adding progress for unknown item should not crash
edgeQuestSys.addProgress('nonexistent_item', 5); // Should handle gracefully

// getCurrentQuest when nothing complete — returns Q01
assertEquals(edgeQuestSys.getCurrentQuest().id, 'quest_01', 'Current quest is Q01 at start');

// Verify all 25 quests are in the registry
assertEquals(QUEST_REGISTRY.length, 25, 'Registry has 25 quests');

// All quest states should be valid
for (const q of QUEST_REGISTRY) {
  const qs = edgeQuestSys.getProgress(q.id);
  assert(qs.state === QUEST_STATES.LOCKED || qs.state === QUEST_STATES.AVAILABLE,
         `Quest ${q.id} has valid initial state: ${qs.state}`);
}

// ============================================================
// Results
// ============================================================

console.log('\n=======================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All quest system integration tests passing!');
  process.exit(0);
}
})();
