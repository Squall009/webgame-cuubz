#!/usr/bin/env node
'use strict';

let passCount = 0, failCount = 0;
const failures = [];

function assert(c, m) { if (c) { passCount++; console.log(`  ✅ ${m}`); } else { failCount++; failures.push(m); console.log(`  ❌ ${m}`); } }
function assertEquals(a, e, m) { assert(a === e, `${m}: expected ${e}, got ${a}`); }
function assertTrue(c, m) { assert(c === true, m); }
function assertFalse(c, m) { assert(c === false, m); }
function assertNotNull(v, m) { assert(v !== null && v !== undefined, m); }
function assertNull(v, m) { assert(v === null, m); }
function assertGreaterThan(a, t, m) { assert(a > t, `${m}: expected > ${t}, got ${a}`); }
function assertLessThan(a, t, m) { assert(a < t, `${m}: expected < ${t}, got ${a}`); }
function assertApprox(a, e, tol, m) { assert(Math.abs(a - e) <= tol, `${m}: expected ~${e}, got ${a} (diff: ${Math.abs(a-e).toFixed(4)})`); }

const {
  MARKER_HEIGHT,
  MARKER_WIDTH,
  INTERACTION_RANGE,
  VISIBILITY_RADIUS,
  GLOW_PULSE_SPEED,
  PARTICLE_COUNT,
  MARKER_COLORS,
  DEFAULT_MARKER_COLOR,
  QuestMarker,
  QuestMarkerManager,
} = require('../js/entities/questMarker.js');

const { QuestSystem } = require('../js/systems/questSystem.js');

console.log('Quest Marker Tests');
console.log('==================\n');

// ============================================================
// Test 1: Constants & Enums
// ============================================================
console.log('--- Constants ---');
assertEquals(2.0, MARKER_HEIGHT, 'MARKER_HEIGHT is 2.0 blocks');
assertEquals(0.3, MARKER_WIDTH, 'MARKER_WIDTH is 0.3 blocks');
assertEquals(3.0, INTERACTION_RANGE, 'INTERACTION_RANGE is 3.0 blocks');
assertEquals(64.0, VISIBILITY_RADIUS, 'VISIBILITY_RADIUS is 64.0 blocks');
assertEquals(2.0, GLOW_PULSE_SPEED, 'GLOW_PULSE_SPEED is 2.0 rad/s');
assertEquals(8, PARTICLE_COUNT, 'PARTICLE_COUNT is 8');

// MARKER_COLORS has entries for all quest types
assertEquals(6, Object.keys(MARKER_COLORS).length, 'MARKER_COLORS has 6 entries');
assertEquals(0x4CAF50, MARKER_COLORS.collect, 'collect color is green');
assertEquals(0xF44336, MARKER_COLORS.kill, 'kill color is red');
assertEquals(0x2196F3, MARKER_COLORS.explore, 'explore color is blue');
assertEquals(0xFF9800, MARKER_COLORS.craft, 'craft color is orange');
assertEquals(0x9C27B0, MARKER_COLORS.deliver, 'deliver color is purple');
assertEquals(0xFFD700, MARKER_COLORS.boss, 'boss color is gold');
assertEquals(0xFFFFFF, DEFAULT_MARKER_COLOR, 'DEFAULT_MARKER_COLOR is white');

// ============================================================
// Test 2: QuestMarker Constructor & Defaults
// ============================================================
console.log('\n--- Constructor & Defaults ---');

const m1 = new QuestMarker('test_quest', { x: 10, y: 20, z: 30 });
assertNotNull(m1, 'Creates instance');
assertEquals('test_quest', m1.questId, 'questId set correctly');
assertEquals(10, m1.position.x, 'position.x set correctly');
assertEquals(20, m1.position.y, 'position.y set correctly');
assertEquals(30, m1.position.z, 'position.z set correctly');
assertEquals('collect', m1.questType, 'default questType is collect');
assertEquals('plains', m1.biome, 'default biome is plains');
assertTrue(m1.active, 'default active is true');
assertTrue(m1.visible, 'default visible is true');
assertFalse(m1.interacted, 'default interacted is false');
assertFalse(m1.inInteractionRange, 'default inInteractionRange is false');
assertEquals(1.0, m1.glowIntensity, 'default glowIntensity is 1.0');
assertEquals(0.0, m1.pulsePhase, 'default pulsePhase is 0.0');
assertNull(m1.mesh, 'mesh is null (no Three.js)');
assertNull(m1.glowMesh, 'glowMesh is null');
assert(Array.isArray(m1.particles), 'particles is array');
assertEquals(0, m1.particles.length, 'particles empty initially');

// Default options
const m2 = new QuestMarker('q1');
assertEquals(0, m2.position.x, 'default position.x is 0');
assertEquals(0, m2.position.y, 'default position.y is 0');
assertEquals(0, m2.position.z, 'default position.z is 0');

// Custom quest type and biome
const m3 = new QuestMarker('q1', { x: 5, y: 10, z: 15, questType: 'boss', biome: 'corrupt', active: false });
assertEquals('boss', m3.questType, 'custom questType set');
assertEquals('corrupt', m3.biome, 'custom biome set');
assertFalse(m3.active, 'custom active=false set');

// ============================================================
// Test 3: Display Color
// ============================================================
console.log('\n--- Display Color ---');

assertEquals(0x4CAF50, new QuestMarker('q1', { questType: 'collect' }).getDisplayColor(), 'collect returns green');
assertEquals(0xF44336, new QuestMarker('q1', { questType: 'kill' }).getDisplayColor(), 'kill returns red');
assertEquals(0x2196F3, new QuestMarker('q1', { questType: 'explore' }).getDisplayColor(), 'explore returns blue');
assertEquals(0xFF9800, new QuestMarker('q1', { questType: 'craft' }).getDisplayColor(), 'craft returns orange');
assertEquals(0x9C27B0, new QuestMarker('q1', { questType: 'deliver' }).getDisplayColor(), 'deliver returns purple');
assertEquals(0xFFD700, new QuestMarker('q1', { questType: 'boss' }).getDisplayColor(), 'boss returns gold');
assertEquals(0xFFFFFF, new QuestMarker('q1', { questType: 'unknown_type' }).getDisplayColor(), 'unknown type returns default white');

// ============================================================
// Test 4: Distance Calculations
// ============================================================
console.log('\n--- Distance Calculations ---');

const mDist = new QuestMarker('q1', { x: 0, y: 10, z: 0 });

// Same position
assertEquals(0, mDist.squaredDistanceFrom({ x: 0, y: 10, z: 0 }), 'zero distance at same position');
assertApprox(0, mDist.distanceFrom({ x: 0, y: 10, z: 0 }), 0.001, 'distance 0 at same position');

// Simple distances
assertEquals(25, mDist.squaredDistanceFrom({ x: 5, y: 10, z: 0 }), 'squared distance along X');
assertApprox(5.0, mDist.distanceFrom({ x: 5, y: 10, z: 0 }), 0.001, 'distance 5 along X');

assertEquals(100, mDist.squaredDistanceFrom({ x: 0, y: 20, z: 0 }), 'squared distance along Y');
assertApprox(10.0, mDist.distanceFrom({ x: 0, y: 20, z: 0 }), 0.001, 'distance 10 along Y');

// Diagonal (3D) — dx=2, dy=0, dz=3 → 4+0+9=13
assertEquals(13, mDist.squaredDistanceFrom({ x: 2, y: 10, z: 3 }), 'squared distance diagonal 3D');
assertApprox(Math.sqrt(13), mDist.distanceFrom({ x: 2, y: 10, z: 3 }), 0.001, 'distance sqrt(13) diagonal 3D');

// Negative coordinates
assertEquals(50, mDist.squaredDistanceFrom({ x: -5, y: 10, z: 5 }), 'squared distance negative coords');
assertApprox(Math.sqrt(50), mDist.distanceFrom({ x: -5, y: 10, z: 5 }), 0.001, 'distance sqrt(50) negative coords');

// ============================================================
// Test 5: Interaction Range
// ============================================================
console.log('\n--- Interaction Range ---');

const mInteract = new QuestMarker('q1', { x: 0, y: 10, z: 0 });

// Within range (distance < INTERACTION_RANGE=3.0)
assertTrue(mInteract.isInInteractionRange({ x: 0, y: 10, z: 0 }), 'at marker position');
assertTrue(mInteract.isInInteractionRange({ x: 1, y: 10, z: 1 }), 'distance ~1.41');
assertTrue(mInteract.isInInteractionRange({ x: 2, y: 10, z: 1 }), 'distance ~2.24');

// At boundary (distance = INTERACTION_RANGE=3.0)
assertTrue(mInteract.isInInteractionRange({ x: 3, y: 10, z: 0 }), 'at exact range boundary X');
assertTrue(mInteract.isInInteractionRange({ x: 0, y: 13, z: 0 }), 'at exact range boundary Y');

// Just outside range
assertFalse(mInteract.isInInteractionRange({ x: 4, y: 10, z: 0 }), 'distance 4 > range 3');

// At distance ~2.83 (sqrt(8)) — within range since sqrt(8) < 3.0
assertTrue(mInteract.isInInteractionRange({ x: 2, y: 10, z: 2 }), 'distance sqrt(8)=~2.83 < range 3');

// ============================================================
// Test 6: Visibility Range
// ============================================================
console.log('\n--- Visibility Range ---');

const mVis = new QuestMarker('q1', { x: 0, y: 10, z: 0 });

assertTrue(mVis.isInVisibilityRange({ x: 0, y: 10, z: 0 }), 'at marker position visible');
assertTrue(mVis.isInVisibilityRange({ x: 64, y: 10, z: 0 }), 'at exact visibility boundary');
assertFalse(mVis.isInVisibilityRange({ x: 100, y: 10, z: 0 }), 'distance 100 > radius 64');
assertTrue(mVis.isInVisibilityRange({ x: 32, y: 10, z: 32 }), 'diagonal distance ~45 < 64');

// ============================================================
// Test 7: Update Method
// ============================================================
console.log('\n--- Update Method ---');

const mUpdate = new QuestMarker('q1', { x: 0, y: 10, z: 0 });

// Update with nearby player
mUpdate.update({ x: 1, y: 10, z: 0 }, 0.016); // ~60fps delta
assertTrue(mUpdate.visible, 'visible when player nearby');
assertTrue(mUpdate.inInteractionRange, 'in interaction range when close');
assertGreaterThan(mUpdate.pulsePhase, 0, 'pulsePhase advances');
assertGreaterThan(mUpdate.glowIntensity, 0.4, 'glowIntensity > 0 for active marker');
assertLessThan(mUpdate.glowIntensity, 1.1, 'glowIntensity < 1.1 (bounded)');

// Update with far player
mUpdate.update({ x: 100, y: 10, z: 0 }, 0.016);
assertFalse(mUpdate.visible, 'not visible when player far away');
assertTrue(mUpdate.inInteractionRange === false || mUpdate.interacted, 'out of interaction range when far');

// Update inactive marker
const mInactive = new QuestMarker('q1', { x: 0, y: 10, z: 0, active: false });
mInactive.update({ x: 0, y: 10, z: 0 }, 0.016);
assertEquals(0.0, mInactive.glowIntensity, 'inactive marker has 0 glow');
assertFalse(mInactive.inInteractionRange, 'inactive marker not interactable');

// Update with null player pos — should not crash
mUpdate.update(null, 0.016);
assertTrue(true, 'no crash on null playerPos');

// Update with zero deltaTime — should not crash
mUpdate.update({ x: 0, y: 10, z: 0 }, 0);
assertTrue(true, 'no crash on zero deltaTime');

// ============================================================
// Test 8: Glow Pulse Animation
// ============================================================
console.log('\n--- Glow Pulse Animation ---');

const mPulse = new QuestMarker('q1', { x: 0, y: 0, z: 0 });

// Update over time and check sinusoidal behavior
let minGlow = 2.0, maxGlow = -1.0;
for (let t = 0; t < Math.PI * 2; t += 0.1) {
  mPulse.update({ x: 0, y: 0, z: 0 }, 0.1);
  if (mPulse.glowIntensity < minGlow) minGlow = mPulse.glowIntensity;
  if (mPulse.glowIntensity > maxGlow) maxGlow = mPulse.glowIntensity;
}
assertGreaterThan(maxGlow, 0.45, 'max glow > 0.45');
assertLessThan(minGlow, 0.56, 'min glow < 0.56');
// Glow should oscillate between ~0.5 and ~1.0

// ============================================================
// Test 9: Interaction
// ============================================================
console.log('\n--- Interaction ---');

const qs = new QuestSystem({});
const mInteract2 = new QuestMarker('quest_01', { x: 3, y: 64, z: 5, questType: 'collect' });

// First interaction should succeed
const result1 = mInteract2.interact(qs);
assertNotNull(result1, 'interaction returns data');
assertEquals('quest_01', result1.questId, 'result has correct questId');
assertEquals('First Steps', result1.name, 'result has correct quest name');
assertTrue(mInteract2.interacted, 'marker marked as interacted');
assertNotNull(mInteract2.questUpdateData, 'questUpdateData stored');

// Second interaction should return null (already interacted)
const result2 = mInteract2.interact(qs);
assertNull(result2, 'second interaction returns null');

// Inactive marker interaction
const mInactive2 = new QuestMarker('q1', { x: 0, y: 0, z: 0, active: false });
const result3 = mInactive2.interact(qs);
assertNull(result3, 'inactive marker interaction returns null');

// Interact without quest system
const mNoQS = new QuestMarker('unknown_quest', { x: 0, y: 0, z: 0 });
const result4 = mNoQS.interact(null);
assertNotNull(result4, 'interaction works without questSystem');
assertEquals('Unknown Quest', result4.name, 'unknown quest name when no system');

// ============================================================
// Test 10: Reset
// ============================================================
console.log('\n--- Reset ---');

const mReset = new QuestMarker('q1', { x: 0, y: 0, z: 0 });
mReset.interact(qs);
assertTrue(mReset.interacted, 'marker interacted before reset');
assertNotNull(mReset.questUpdateData, 'questUpdateData set before reset');

mReset.reset();
assertFalse(mReset.interacted, 'interacted cleared after reset');
assertNull(mReset.questUpdateData, 'questUpdateData cleared after reset');
assertEquals(1.0, mReset.glowIntensity, 'glowIntensity reset to 1.0');
assertEquals(0.0, mReset.pulsePhase, 'pulsePhase reset to 0.0');
assertTrue(mReset.visible, 'visible reset to true');
assertFalse(mReset.inInteractionRange, 'inInteractionRange reset to false');

// ============================================================
// Test 11: setActive
// ============================================================
console.log('\n--- setActive ---');

const mSet = new QuestMarker('q1', { x: 0, y: 0, z: 0 });
assertTrue(mSet.active, 'starts active');

mSet.setActive(false);
assertFalse(mSet.active, 'setActive(false) works');
assertEquals(0.0, mSet.glowIntensity, 'glow set to 0 when deactivated');
assertFalse(mSet.inInteractionRange, 'interaction disabled when deactivated');

mSet.setActive(true);
assertTrue(mSet.active, 'setActive(true) reactivates');

// Boolean coercion
mSet.setActive(1);
assertTrue(mSet.active, 'truthy value activates');
mSet.setActive(0);
assertFalse(mSet.active, 'falsy value deactivates');
mSet.setActive('yes');
assertTrue(mSet.active, 'string truthy activates');

// ============================================================
// Test 12: Serialization / Deserialization
// ============================================================
console.log('\n--- Serialization / Deserialization ---');

const mOrig = new QuestMarker('quest_05', { x: 15, y: 64, z: -10, questType: 'collect', biome: 'mountains', active: true });
mOrig.interact(qs);

const serialized = mOrig.serialize();
assertEquals('quest_05', serialized.questId, 'serialized questId');
assertEquals(15, serialized.position.x, 'serialized position.x');
assertEquals(64, serialized.position.y, 'serialized position.y');
assertEquals(-10, serialized.position.z, 'serialized position.z');
assertEquals('collect', serialized.questType, 'serialized questType');
assertEquals('mountains', serialized.biome, 'serialized biome');
assertTrue(serialized.active, 'serialized active');
assertTrue(serialized.interacted, 'serialized interacted');

// Deserialize
const mClone = QuestMarker.deserialize(serialized);
assertNotNull(mClone, 'deserialize returns instance');
assertEquals('quest_05', mClone.questId, 'deserialized questId matches');
assertEquals(15, mClone.position.x, 'deserialized position.x matches');
assertEquals(64, mClone.position.y, 'deserialized position.y matches');
assertEquals(-10, mClone.position.z, 'deserialized position.z matches');
assertEquals('collect', mClone.questType, 'deserialized questType matches');
assertEquals('mountains', mClone.biome, 'deserialized biome matches');

// Deserialize null/invalid
assertNull(QuestMarker.deserialize(null), 'null input returns null');
assertNull(QuestMarker.deserialize({}), 'missing questId returns null');
assertNull(QuestMarker.deserialize({ questId: 'q1' }), 'missing position returns null');
assertNull(QuestMarker.deserialize('not an object'), 'string input returns null');

// Round-trip serialization
const mRound = new QuestMarker('q_test', { x: -5, y: 30, z: 20, questType: 'boss', biome: 'corrupt' });
const s1 = mRound.serialize();
const mRound2 = QuestMarker.deserialize(s1);
assertEquals(mRound.questId, mRound2.questId, 'round-trip questId');
assertEquals(mRound.position.x, mRound2.position.x, 'round-trip position.x');
assertEquals(mRound.position.y, mRound2.position.y, 'round-trip position.y');
assertEquals(mRound.position.z, mRound2.position.z, 'round-trip position.z');
assertEquals(mRound.questType, mRound2.questType, 'round-trip questType');
assertEquals(mRound.biome, mRound2.biome, 'round-trip biome');

// ============================================================
// Test 13: QuestMarkerManager — Constructor & Defaults
// ============================================================
console.log('\n--- QuestMarkerManager Constructor ---');

const mgr1 = new QuestMarkerManager();
assert(Array.isArray(mgr1.markers), 'markers is array');
assertEquals(0, mgr1.markers.length, 'empty markers initially');
assertEquals('default', mgr1.worldSeed, 'default worldSeed');
assertNull(mgr1._questSystem, 'no quest system by default');

const mgr2 = new QuestMarkerManager({ worldSeed: 'test_seed_42' });
assertEquals('test_seed_42', mgr2.worldSeed, 'custom worldSeed set');

// ============================================================
// Test 14: QuestMarkerManager — setQuestSystem
// ============================================================
console.log('\n--- QuestMarkerManager setQuestSystem ---');

const qsMgr = new QuestSystem({});
const mgr3 = new QuestMarkerManager({ worldSeed: 'seed_123' });
mgr3.setQuestSystem(qsMgr);
assertNotNull(mgr3._questSystem, 'quest system set');
assertEquals(qsMgr, mgr3._questSystem, 'correct quest system reference');

// ============================================================
// Test 15: QuestMarkerManager — createAllMarkers
// ============================================================
console.log('\n--- QuestMarkerManager createAllMarkers ---');

const qsCreate = new QuestSystem({});
const mgr4 = new QuestMarkerManager({ worldSeed: 'marker_seed' });

// Without quest system — returns 0
assertEquals(0, mgr4.createAllMarkers(), 'returns 0 without quest system');
assertEquals(0, mgr4.markers.length, 'no markers created without quest system');

// With quest system
mgr4.setQuestSystem(qsCreate);
const count = mgr4.createAllMarkers();
assertEquals(25, count, 'creates 25 markers (one per quest)');
assertEquals(25, mgr4.markers.length, 'markers array has 25 entries');

// All markers have valid data
let allValid = true;
for (const m of mgr4.markers) {
  if (!m.questId || !m.position || typeof m.position.x !== 'number') {
    allValid = false;
    break;
  }
}
assertTrue(allValid, 'all markers have valid questId and position');

// Marker positions match QuestSystem.getMarkerPosition()
for (const m of mgr4.markers) {
  const expected = qsCreate.getMarkerPosition(m.questId, 'marker_seed');
  assertEquals(expected.x, m.position.x, `marker ${m.questId} x matches getMarkerPosition`);
  assertEquals(expected.z, m.position.z, `marker ${m.questId} z matches getMarkerPosition`);
}

// ============================================================
// Test 16: QuestMarkerManager — Active Markers
// ============================================================
console.log('\n--- QuestMarkerManager Active Markers ---');

// Initially all 25 quests are non-completed → all 25 markers active
assertEquals(25, mgr4.activeMarkers.length, 'all 25 markers active initially (none completed)');

// After completing quest_01, quest_01 marker deactivates
qsCreate.addProgress('wood_log', 5);
qsCreate.addProgress('dirt', 10);
// Now quest_01 should be complete, quest_02 available
mgr4._updateActiveMarkers();
assertEquals(24, mgr4.activeMarkers.length, '24 active markers after completing quest_01');

// ============================================================
// Test 17: QuestMarkerManager — update
// ============================================================
console.log('\n--- QuestMarkerManager update ---');

const playerPos = { x: 5, y: 20, z: 5 };
mgr4.update(playerPos, 0.016);

// At least some markers should have been updated (pulsePhase advanced)
let anyUpdated = false;
for (const m of mgr4.markers) {
  if (m.pulsePhase > 0 && m.active) {
    anyUpdated = true;
    break;
  }
}
assertTrue(anyUpdated, 'at least one marker pulsePhase advanced after update');

// ============================================================
// Test 18: QuestMarkerManager — getInteractableMarkers
// ============================================================
console.log('\n--- QuestMarkerManager getInteractableMarkers ---');

// Place player near quest_02 marker (quest_01 was completed in test 16)
const q2Pos = qsCreate.getMarkerPosition('quest_02', 'marker_seed');
const nearbyPos2 = { x: q2Pos.x, y: q2Pos.y, z: q2Pos.z };
mgr4.update(nearbyPos2, 0.016);

const interactables2 = mgr4.getInteractableMarkers(nearbyPos2);
// quest_02 should be available and in range
assertGreaterThan(interactables2.length, 0, 'has interactable markers when near');

// ============================================================
// Test 19: QuestMarkerManager — getClosestMarker
// ============================================================
console.log('\n--- QuestMarkerManager getClosestMarker ---');

const closest2 = mgr4.getClosestMarker(nearbyPos2);
assertNotNull(closest2, 'returns closest marker');
assertEquals('quest_02', closest2.questId, 'closest is quest_02 (player standing on it)');

// Far away from all markers
const farPos = { x: 999, y: 20, z: 999 };
const farClosest = mgr4.getClosestMarker(farPos);
assertNotNull(farClosest, 'still returns a marker even when far');

// ============================================================
// Test 20: QuestMarkerManager — getMarkersByStageRange
// ============================================================
console.log('\n--- QuestMarkerManager getMarkersByStageRange ---');

const stage1_6 = mgr4.getMarkersByStageRange(1, 6);
assertEquals(6, stage1_6.length, '6 markers in stages 1-6 (introduction)');

const stage7_12 = mgr4.getMarkersByStageRange(7, 12);
assertEquals(6, stage7_12.length, '6 markers in stages 7-12 (dungeon 1)');

const stage13_17 = mgr4.getMarkersByStageRange(13, 17);
assertEquals(5, stage13_17.length, '5 markers in stages 13-17 (dungeon 2)');

const stage18_21 = mgr4.getMarkersByStageRange(18, 21);
assertEquals(4, stage18_21.length, '4 markers in stages 18-21 (dungeon 3)');

const stage22_25 = mgr4.getMarkersByStageRange(22, 25);
assertEquals(4, stage22_25.length, '4 markers in stages 22-25 (dungeon 4 + final)');

// ============================================================
// Test 21: QuestMarkerManager — getMarkersByBiome
// ============================================================
console.log('\n--- QuestMarkerManager getMarkersByBiome ---');

const plainsMarkers = mgr4.getMarkersByBiome('plains');
assertGreaterThan(plainsMarkers.length, 0, 'has plains markers');

const corruptMarkers = mgr4.getMarkersByBiome('corrupt');
assertGreaterThan(corruptMarkers.length, 0, 'has corrupt markers');

const lavaMarkers = mgr4.getMarkersByBiome('lava');
assertGreaterThan(lavaMarkers.length, 0, 'has lava markers');

// Biome marker counts should add up to total
let totalByBiome = 0;
const biomes = new Set(mgr4.markers.map(m => m.biome));
for (const biome of biomes) {
  totalByBiome += mgr4.getMarkersByBiome(biome).length;
}
assertEquals(25, totalByBiome, 'biome marker counts sum to 25');

// ============================================================
// Test 22: QuestMarkerManager — deactivateCompleted
// ============================================================
console.log('\n--- QuestMarkerManager deactivateCompleted ---');

const qsDeact = new QuestSystem({});
const mgrDeact = new QuestMarkerManager({ worldSeed: 'deact_seed' });
mgrDeact.setQuestSystem(qsDeact);
mgrDeact.createAllMarkers();

// Initially quest_01 marker should be active
const q1marker = mgrDeact.markers.find(m => m.questId === 'quest_01');
assertTrue(q1marker.active, 'quest_01 marker active before completion');

// Complete quest_01
qsDeact.addProgress('wood_log', 5);
qsDeact.addProgress('dirt', 10);
mgrDeact.deactivateCompleted();

assertFalse(q1marker.active, 'quest_01 marker deactivated after completion');

// ============================================================
// Test 23: QuestMarkerManager — serializeAll / deserializeAll
// ============================================================
console.log('\n--- QuestMarkerManager Serialization ---');

const serializedAll = mgr4.serializeAll();
assertEquals(25, serializedAll.length, 'serializes all 25 markers');

// Check structure of first entry
assertNotNull(serializedAll[0].questId, 'serialized entry has questId');
assertNotNull(serializedAll[0].position, 'serialized entry has position');
assertNotNull(serializedAll[0].position.x, 'serialized entry position has x');

// Deserialize into new manager
const mgrNew = new QuestMarkerManager({ worldSeed: 'marker_seed' });
mgrNew.deserializeAll(serializedAll);
assertEquals(25, mgrNew.markers.length, 'deserialized 25 markers');
assertEquals(mgr4.markers[0].questId, mgrNew.markers[0].questId, 'deserialized questIds match');

// Deserialize null/invalid
const mgrEmpty = new QuestMarkerManager();
mgrEmpty.deserializeAll(null);
assertEquals(0, mgrEmpty.markers.length, 'null input leaves markers empty');
mgrEmpty.deserializeAll('not array');
assertEquals(0, mgrEmpty.markers.length, 'string input leaves markers empty');

// ============================================================
// Test 24: QuestMarkerManager — resetAll
// ============================================================
console.log('\n--- QuestMarkerManager resetAll ---');

// Interact with a marker first
mgr4.markers[0].interact(qsCreate);
assertTrue(mgr4.markers[0].interacted, 'marker interacted before reset');

mgr4.resetAll();
assertFalse(mgr4.markers[0].interacted, 'marker reset after resetAll');

// ============================================================
// Test 25: QuestMarkerManager — createAllMeshes / updateAllVisuals / disposeAll
// ============================================================
console.log('\n--- QuestMarkerManager Mesh Methods (no Three.js) ---');

// Should not crash when THREE is undefined
mgr4.createAllMeshes(null);
assertTrue(true, 'createAllMeshes with null scene does not crash');

mgr4.updateAllVisuals(0.016);
assertTrue(true, 'updateAllVisuals without meshes does not crash');

mgr4.disposeAll(null);
assertTrue(true, 'disposeAll with null scene does not crash');

// ============================================================
// Test 26: Edge Cases
// ============================================================
console.log('\n--- Edge Cases ---');

// Marker at world origin
const mOrigin = new QuestMarker('q', { x: 0, y: 0, z: 0 });
assertEquals(0, mOrigin.squaredDistanceFrom({ x: 0, y: 0, z: 0 }), 'origin distance is 0');

// Marker with extreme coordinates
const mExtreme = new QuestMarker('q', { x: -10000, y: -32, z: 10000 });
assertNotNull(mExtreme.position, 'handles extreme coordinates');

// Multiple updates accumulate pulse phase
const mAccum = new QuestMarker('q', { x: 0, y: 0, z: 0 });
const initialPhase = mAccum.pulsePhase;
for (let i = 0; i < 100; i++) {
  mAccum.update({ x: 0, y: 0, z: 0 }, 0.016);
}
assertGreaterThan(mAccum.pulsePhase, initialPhase, 'pulsePhase accumulates over updates');

// Manager with empty quest system
const mgrEmpty2 = new QuestMarkerManager();
mgrEmpty2.setQuestSystem(new QuestSystem({}));
assertEquals(25, mgrEmpty2.createAllMarkers(), 'creates 25 markers even with fresh quest system');

// ============================================================
// Test 27: Marker Position Determinism
// ============================================================
console.log('\n--- Marker Position Determinism ---');

const qsA = new QuestSystem({});
const qsB = new QuestSystem({});
const mgrA = new QuestMarkerManager({ worldSeed: 'deterministic_test' });
const mgrB = new QuestMarkerManager({ worldSeed: 'deterministic_test' });
mgrA.setQuestSystem(qsA);
mgrB.setQuestSystem(qsB);
mgrA.createAllMarkers();
mgrB.createAllMarkers();

// Same seed → same positions
let allMatch = true;
for (let i = 0; i < mgrA.markers.length; i++) {
  if (mgrA.markers[i].position.x !== mgrB.markers[i].position.x ||
      mgrA.markers[i].position.z !== mgrB.markers[i].position.z) {
    allMatch = false;
    break;
  }
}
assertTrue(allMatch, 'same seed produces same marker positions');

// ============================================================
// Test 28: Manager Methods Return Types
// ============================================================
console.log('\n--- Manager Method Return Types ---');

assert(Array.isArray(mgr4.getMarkersByBiome('plains')), 'getMarkersByBiome returns array');
assert(Array.isArray(mgr4.getInteractableMarkers({ x: 0, y: 0, z: 0 })), 'getInteractableMarkers returns array');
assert(Array.isArray(mgr4.getMarkersByStageRange(1, 6)), 'getMarkersByStageRange returns array');
assert(typeof mgr4.getClosestMarker({ x: 0, y: 0, z: 0 }) === 'object', 'getClosestMarker returns object or null');

// ============================================================
// Test 29: Quest Marker Colors Are Distinct
// ============================================================
console.log('\n--- Color Uniqueness ---');

const colorValues = Object.values(MARKER_COLORS);
const uniqueColors = new Set(colorValues);
assertEquals(6, uniqueColors.size, 'all quest type colors are unique');

// ============================================================
// Summary
// ============================================================
console.log('\n==================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('🎉 All quest marker tests passing!');
  process.exit(0);
}
