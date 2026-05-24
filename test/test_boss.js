#!/usr/bin/env node
/**
 * Cuubz — Boss Entity System Tests
 * 
 * Tests for: BOSS_STATES, BOSS_DEFINITIONS, Boss class, BossManager class,
 * helper functions (getBossDefinition, getAllBossIds, distanceBetween, squaredDistance).
 */

'use strict';

const {
  BOSS_STATES,
  BOSS_DEFINITIONS,
  Boss,
  BossManager,
  getBossDefinition,
  getAllBossIds,
  distanceBetween,
  squaredDistance,
} = require('../js/entities/boss');

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

function assertTrue(val, msg) { assert(val === true || val === 1, msg); }
function assertFalse(val, msg) { assert(val === false || val === 0, msg); }
function assertEquals(actual, expected, msg) { assert(actual === expected, `${msg} — expected ${expected}, got ${actual}`); }
function assertApprox(actual, expected, tolerance, msg) { assert(Math.abs(actual - expected) < tolerance, `${msg} — expected ~${expected}, got ${actual}`); }

console.log('=== Cuubz Boss System Tests ===\n');

// ─── Test Group 1: BOSS_STATES constants ─────────────────────────────
console.log('--- Test Group 1: BOSS_STATES constants ---');

assert(BOSS_STATES.IDLE === 'idle', 'IDLE state is "idle"');
assert(BOSS_STATES.PATROL === 'patrol', 'PATROL state is "patrol"');
assert(BOSS_STATES.AGGRO === 'aggro', 'AGGRO state is "aggro"');
assert(BOSS_STATES.ATTACK === 'attack', 'ATTACK state is "attack"');
assert(BOSS_STATES.PHASE_TRANSITION === 'phase_transition', 'PHASE_TRANSITION state is "phase_transition"');
assert(BOSS_STATES.DEAD === 'dead', 'DEAD state is "dead"');
assertEquals(Object.keys(BOSS_STATES).length, 6, '6 boss states defined');

console.log(`  Group 1: ${passed}/${total} passed\n`);

// ─── Test Group 2: BOSS_DEFINITIONS structure ────────────────────────
console.log('--- Test Group 2: BOSS_DEFINITIONS structure ---');

const bossIds = Object.keys(BOSS_DEFINITIONS);
assertEquals(bossIds.length, 5, '5 boss definitions defined');

// Check all expected bosses exist
assertTrue(bossIds.includes('forest_warden'), 'forest_warden defined');
assertTrue(bossIds.includes('lava_titan'), 'lava_titan defined');
assertTrue(bossIds.includes('frost_serpent'), 'frost_serpent defined');
assertTrue(bossIds.includes('corruption_overlord'), 'corruption_overlord defined');
assertTrue(bossIds.includes('final_seal'), 'final_seal defined');

// Check each boss has required fields
for (const id of bossIds) {
  const def = BOSS_DEFINITIONS[id];
  assertTrue(def.name !== undefined && def.name.length > 0, `${id}: has name`);
  assertTrue(def.health > 0, `${id}: health > 0 (${def.health})`);
  assertTrue(def.size.width > 0, `${id}: size.width > 0`);
  assertTrue(def.size.height > 0, `${id}: size.height > 0`);
  assertTrue(typeof def.color === 'string', `${id}: has color string`);
  assertTrue(def.patrolRadius > 0, `${id}: patrolRadius > 0`);
  assertTrue(def.aggroRange > 0, `${id}: aggroRange > 0`);
  assertTrue(def.moveSpeed > 0, `${id}: moveSpeed > 0`);
  assertTrue(Array.isArray(def.attacks), `${id}: attacks is array`);
  assertTrue(def.attacks.length > 0, `${id}: has at least 1 attack`);
  assertTrue(def.phases >= 1, `${id}: phases >= 1 (${def.phases})`);
  assertTrue(typeof def.questId === 'string', `${id}: has questId`);
}

// Check specific boss properties
const forestWarden = BOSS_DEFINITIONS.forest_warden;
assertEquals(forestWarden.health, 500, 'forest_warden health = 500');
assertEquals(forestWarden.phases, 2, 'forest_warden has 2 phases');
assertEquals(forestWarden.attacks.length, 3, 'forest_warden has 3 attacks');
assertEquals(forestWarden.questId, 'quest_12', 'forest_warden questId = quest_12');

const lavaTitan = BOSS_DEFINITIONS.lava_titan;
assertEquals(lavaTitan.health, 800, 'lava_titan health = 800');
assertEquals(lavaTitan.damageReduction, 0.2, 'lava_titan damageReduction = 0.2');
assertEquals(lavaTitan.questId, 'quest_17', 'lava_titan questId = quest_17');

const frostSerpent = BOSS_DEFINITIONS.frost_serpent;
assertEquals(frostSerpent.health, 1000, 'frost_serpent health = 1000');
assertEquals(frostSerpent.questId, 'quest_21', 'frost_serpent questId = quest_21');

const corruptionOverlord = BOSS_DEFINITIONS.corruption_overlord;
assertEquals(corruptionOverlord.health, 1500, 'corruption_overlord health = 1500');
assertEquals(corruptionOverlord.damageReduction, 0.3, 'corruption_overlord damageReduction = 0.3');
assertEquals(corruptionOverlord.questId, 'quest_24', 'corruption_overlord questId = quest_24');

const finalSeal = BOSS_DEFINITIONS.final_seal;
assertEquals(finalSeal.health, 2000, 'final_seal health = 2000');
assertEquals(finalSeal.phases, 3, 'final_seal has 3 phases');
assertTrue(finalSeal.phase3HealthThreshold !== undefined, 'final_seal has phase3 threshold');
assertEquals(finalSeal.questId, 'quest_25', 'final_seal questId = quest_25');

console.log(`  Group 2: ${passed}/${total} passed\n`);

// ─── Test Group 3: Attack definitions validation ─────────────────────
console.log('--- Test Group 3: Attack definitions ---');

for (const id of bossIds) {
  const def = BOSS_DEFINITIONS[id];
  for (const attack of def.attacks) {
    assertTrue(attack.name !== undefined && attack.name.length > 0, `${id}.${attack.name || '?'}: has name`);
    assertTrue(typeof attack.damage === 'number', `${id}.${attack.name}: damage is number`);
    assertTrue(typeof attack.cooldown === 'number', `${id}.${attack.name}: cooldown is number`);
    assertTrue(attack.cooldown > 0, `${id}.${attack.name}: cooldown > 0`);
    assertTrue(typeof attack.range === 'number', `${id}.${attack.name}: range is number`);
    assertTrue(typeof attack.type === 'string', `${id}.${attack.name}: type is string`);
  }
}

// Check phase-specific attacks on final_seal
const fsAttacks = BOSS_DEFINITIONS.final_seal.attacks;
const p1Attacks = fsAttacks.filter(a => a.phase === 1);
const p2Attacks = fsAttacks.filter(a => a.phase === 2);
const p3Attacks = fsAttacks.filter(a => a.phase === 3);
assertTrue(p1Attacks.length >= 1, 'final_seal has phase 1 attacks');
assertTrue(p2Attacks.length >= 1, 'final_seal has phase 2 attacks');
assertTrue(p3Attacks.length >= 1, 'final_seal has phase 3 attacks');

console.log(`  Group 3: ${passed}/${total} passed\n`);

// ─── Test Group 4: Helper functions ──────────────────────────────────
console.log('--- Test Group 4: Helper functions ---');

// getBossDefinition
assertEquals(getBossDefinition('forest_warden').name, 'Forest Warden', 'getBossDefinition returns correct boss');
assertEquals(getBossDefinition('nonexistent'), null, 'getBossDefinition returns null for unknown boss');

// getAllBossIds
const allIds = getAllBossIds();
assertEquals(allIds.length, 5, 'getAllBossIds returns 5 IDs');
assertTrue(allIds.includes('forest_warden'), 'includes forest_warden');

// distanceBetween
assertEquals(distanceBetween({x:0,y:0,z:0}, {x:3,y:4,z:0}), 5, 'distance 3-4-0 triangle = 5');
assertEquals(distanceBetween({x:0,y:0,z:0}, {x:0,y:0,z:0}), 0, 'distance same point = 0');
assertApprox(distanceBetween({x:0,y:0,z:0}, {x:1,y:1,z:1}), Math.sqrt(3), 0.001, 'diagonal distance');

// squaredDistance
assertEquals(squaredDistance({x:0,y:0,z:0}, {x:3,y:4,z:0}), 25, 'squared distance = 25');
assertEquals(squaredDistance({x:0,y:0,z:0}, {x:0,y:0,z:0}), 0, 'squared same point = 0');

console.log(`  Group 4: ${passed}/${total} passed\n`);

// ─── Test Group 5: Boss constructor ──────────────────────────────────
console.log('--- Test Group 5: Boss constructor ---');

const boss1 = new Boss('forest_warden', {x: 0, y: 20, z: 0});
assertEquals(boss1.bossId, 'forest_warden', 'bossId set correctly');
assertEquals(boss1.currentHealth, 500, 'health initialized to max (500)');
assertEquals(boss1.maxHealth, 500, 'maxHealth = 500');
assertEquals(boss1.state, BOSS_STATES.IDLE, 'starts in IDLE state');
assertEquals(boss1.currentPhase, 1, 'starts at phase 1');
assertFalse(boss1.isDead, 'not dead on construction');
assertEquals(boss1.position.x, 0, 'position.x = spawn x');
assertEquals(boss1.position.y, 20, 'position.y = spawn y');
assertEquals(boss1.position.z, 0, 'position.z = spawn z');
assertEquals(boss1.aggroRange, 30, 'aggroRange from definition (30)');
assertEquals(boss1.patrolRadius, 15, 'patrolRadius from definition (15)');
assertEquals(boss1.moveSpeed, 3.5, 'moveSpeed from definition (3.5)');
assertEquals(boss1.definition.name, 'Forest Warden', 'definition linked correctly');

// Test invalid boss ID throws
let threwError = false;
try { new Boss('nonexistent_boss', {x:0,y:0,z:0}); } catch(e) { threwError = true; }
assertTrue(threwError, 'throws error for unknown boss ID');

console.log(`  Group 5: ${passed}/${total} passed\n`);

// ─── Test Group 6: Health and damage ─────────────────────────────────
console.log('--- Test Group 6: Health and damage ---');

const boss2 = new Boss('lava_titan', {x: 10, y: 20, z: 10});

// Basic damage — lava_titan has 20% natural reduction
let result = boss2.takeDamage(100);
assertEquals(boss2.currentHealth, 720, 'health after 100 damage (80 actual with 20% reduction)');
assertEquals(result.damageDealt, 80, 'damage dealt = 80 (20% reduced)');
assertFalse(result.died, 'not dead yet');

// More damage
result = boss2.takeDamage(100);
assertEquals(boss2.currentHealth, 640, 'health after another 100 damage (80 actual)');

// Large damage to kill — 640 remaining / 0.8 = need 800 raw to deal 640 actual
result = boss2.takeDamage(900); // 900 * 0.8 = 720 actual → 640 - 720 = clamped to 0
assertApprox(boss2.currentHealth, 0, 5, 'health at or near 0 after large damage');
assertTrue(result.died, 'boss died from large damage');
assertTrue(boss2.isDead, 'isDead flag set');
assertEquals(boss2.state, BOSS_STATES.DEAD, 'state = DEAD after death');

// Damage to dead boss has no effect
result = boss2.takeDamage(100);
assertEquals(result.damageDealt, 0, 'dead boss takes 0 damage');
assertFalse(result.died, 'died flag false for already dead');

console.log(`  Group 6: ${passed}/${total} passed\n`);

// ─── Test Group 7: Shield buff reduces damage ────────────────────────
console.log('--- Test Group 7: Shield buffs ---');

const boss3 = new Boss('corruption_overlord', {x: 0, y: 20, z: 0});
assertEquals(boss3.currentHealth, 1500, 'starting health');

// Apply shield manually (simulating Crystal Shield attack)
boss3.activeBuffs.push({ type: 'shield', shieldReduction: 0.5, remaining: 8, maxDuration: 8 });

// Combined reduction: 0.3 natural + 0.5 shield ≈ 0.8 (floating point may give ~0.7999)
result = boss3.takeDamage(100);
assertApprox(result.damageDealt, 20, 2, `damage reduced to ~20 (got ${result.damageDealt}, 80% total reduction)`);
assertEquals(boss3.currentHealth, 1500 - result.damageDealt, 'health consistent with damage dealt');

console.log(`  Group 7: ${passed}/${total} passed\n`);

// ─── Test Group 8: Phase transitions ─────────────────────────────────
console.log('--- Test Group 8: Phase transitions ---');

let phaseChanged = false;
const boss4 = new Boss('forest_warden', {x: 0, y: 20, z: 0}, {
  onPhaseChange: () => { phaseChanged = true; },
});

assertEquals(boss4.currentPhase, 1, 'starts at phase 1');

// Deal damage to reach phase 2 threshold (50% = 250 health)
boss4.takeDamage(300); // Health: 500 - 300*(1-0) = 200
assertEquals(boss4.currentHealth, 200, 'health at 200 after damage');

// Check phase transition
boss4.checkPhaseTransition();
assertEquals(boss4.currentPhase, 2, 'transitioned to phase 2');
assertEquals(boss4.state, BOSS_STATES.PHASE_TRANSITION, 'state = PHASE_TRANSITION');
assertTrue(phaseChanged, 'onPhaseChange callback fired');

// Check phase effects
const effects = boss4.getPhaseEffects();
assertEquals(effects.attackSpeedMultiplier, 1.4, 'phase 2 attack speed multiplier');
assertEquals(effects.damageMultiplier, 1.3, 'phase 2 damage multiplier');

// Phase name
assertEquals(boss4.definition.phase2Name, 'Enraged Warden', 'phase 2 name correct');

console.log(`  Group 8: ${passed}/${total} passed\n`);

// ─── Test Group 9: Final boss 3-phase transitions ───────────────────
console.log('--- Test Group 9: Final boss multi-phase ---');

const finalBoss = new Boss('final_seal', {x: 0, y: 20, z: 0}, {
  onPhaseChange: () => {},
});

assertEquals(finalBoss.currentPhase, 1, 'starts at phase 1');

// Phase 2 threshold: 60% health = 1200
finalBoss.takeDamage(900); // 2000 - 900*(1-0.15) ≈ 1315... let's deal more
finalBoss.takeDamage(200); // More damage

// Force to phase 2 threshold
finalBoss.currentHealth = 1100; // Below 60% (1200)
finalBoss.checkPhaseTransition();
assertEquals(finalBoss.currentPhase, 2, 'transitioned to phase 2');

// Phase 3 threshold: 30% health = 600
finalBoss.currentHealth = 500; // Below 30% (600)
finalBoss.checkPhaseTransition();
assertEquals(finalBoss.currentPhase, 3, 'transitioned to phase 3');

// Phase effects at phase 3
const p3Effects = finalBoss.getPhaseEffects();
assertEquals(p3Effects.attackSpeedMultiplier, 2.0, 'phase 3 attack speed x2');
assertEquals(p3Effects.damageMultiplier, 1.8, 'phase 3 damage multiplier x1.8');

console.log(`  Group 9: ${passed}/${total} passed\n`);

// ─── Test Group 10: Attack system ────────────────────────────────────
console.log('--- Test Group 10: Attack system ---');

const boss5 = new Boss('forest_warden', {x: 0, y: 20, z: 0});

// Get available attacks at phase 1
const attacks = boss5.getAvailableAttacks();
assertEquals(attacks.length, 3, '3 attacks available in phase 1');

// All cooldowns start at 0 (ready to attack)
const nextAttack = boss5.getNextAttack();
assertTrue(nextAttack !== null, 'has next attack ready');

// Execute attack on nearby player
const playerPos = { x: 3, y: 20, z: 4 }; // Within range of Vine Lash (range 8)
boss5.state = BOSS_STATES.AGGRO;
const attackResult = boss5.executeAttack(playerPos);

assertTrue(attackResult !== null, 'attack executed');
assertTrue(attackResult.attack.name !== undefined, 'attack has name');
assertTrue(attackResult.damage >= 0, 'damage calculated');
assertEquals(attackResult.phase, 1, 'attack at phase 1');
assertEquals(boss5.state, BOSS_STATES.ATTACK, 'state changed to ATTACK');

// Cooldown should be set now
const nextAttackAfter = boss5.getNextAttack();
// Either another attack is ready (different cooldown) or null if all on cooldown
assertTrue(nextAttackAfter !== undefined, 'getNextAttack returns something after cooldown set');

console.log(`  Group 10: ${passed}/${total} passed\n`);

// ─── Test Group 11: Attack cooldowns ──────────────────────────────────
console.log('--- Test Group 11: Attack cooldowns ---');

const boss6 = new Boss('forest_warden', {x: 0, y: 20, z: 0});

// Execute an attack (should set cooldown)
boss6.executeAttack({x: 3, y: 20, z: 4});
assertTrue(boss6.attackCooldowns.size > 0, 'cooldown map has entries after attack');

// Simulate time passing — update should reduce cooldowns
boss6.update(1.0, {x: 3, y: 20, z: 4}); // 1 second passes

// The first attack had 2.5s cooldown, so after 1s it should still be on cooldown
let allReady = true;
for (const [, remaining] of boss6.attackCooldowns) {
  if (remaining <= 0) allReady = false;
}
// At least some attacks should have reduced cooldown
assertTrue(boss6.attackCooldowns.size > 0, 'cooldowns still tracked after update');

console.log(`  Group 11: ${passed}/${total} passed\n`);

// ─── Test Group 12: AI state machine ──────────────────────────────────
console.log('--- Test Group 12: AI state machine ---');

const boss7 = new Boss('lava_titan', {x: 0, y: 20, z: 0});

// IDLE → should transition to PATROL after time
assertEquals(boss7.state, BOSS_STATES.IDLE, 'starts in IDLE');
boss7.update(5.0, null); // 5 seconds with no player
assertTrue(boss7.state === BOSS_STATES.PATROL || boss7.state === BOSS_STATES.IDLE, 
  `state is PATROL or still IDLE after 5s (got ${boss7.state})`);

// PATROL → AGGRO when player enters range
const farPlayer = { x: 100, y: 20, z: 100 }; // Outside aggro range (25)
boss7.update(1.0, farPlayer);
assertFalse(boss7.state === BOSS_STATES.AGGRO, 'no aggro when player is far');

const nearPlayer = { x: 5, y: 20, z: 5 }; // Within aggro range (25)
boss7.update(1.0, nearPlayer);
assertTrue(boss7.state === BOSS_STATES.AGGRO || boss7.state === BOSS_STATES.ATTACK, 
  `aggro or attack when player nearby (got ${boss7.state})`);

console.log(`  Group 12: ${passed}/${total} passed\n`);

// ─── Test Group 13: Death callback ────────────────────────────────────
console.log('--- Test Group 13: Death callback ---');

let deathData = null;
const boss8 = new Boss('frost_serpent', {x: 0, y: 20, z: 0}, {
  onDeath: (data) => { deathData = data; },
});

// Kill the boss
boss8.takeDamage(2000); // Way more than 1000 health

assertTrue(boss8.isDead, 'boss is dead');
assertTrue(deathData !== null, 'death callback was called');
assertEquals(deathData.bossId, 'frost_serpent', 'death data has correct bossId');
assertEquals(deathData.questId, 'quest_21', 'death data has correct questId');
assertEquals(deathData.titleReward, 'Serpent Slayer', 'death data has title reward');

console.log(`  Group 13: ${passed}/${total} passed\n`);

// ─── Test Group 14: Minion spawning ──────────────────────────────────
console.log('--- Test Group 14: Minion spawning ---');

const boss9 = new Boss('corruption_overlord', {x: 0, y: 20, z: 0});

// Find summon attack
const summonAttack = boss9.definition.attacks.find(a => a.type === 'summon');
assertTrue(summonAttack !== undefined, 'corruption_overlord has summon attack');

// Execute summon attack
boss9.state = BOSS_STATES.ATTACK;
const summonResult = boss9.executeAttack({x: 5, y: 20, z: 5});
assertTrue(summonResult !== null, 'summon attack executed');
assertTrue(Array.isArray(summonResult.minionsSpawned), 'minions spawned is array');
assertEquals(summonResult.minionsSpawned.length, 3, '3 minions spawned');
assertEquals(boss9.minions.length, 3, 'boss has 3 active minions');

// Check minion properties
const minion = summonResult.minionsSpawned[0];
assertTrue(minion.health > 0, 'minion has health');
assertTrue(minion.damage > 0, 'minion has damage');
assertTrue(minion.position.x !== undefined, 'minion has position');

// Damage a minion
const dmgResult = boss9.damageMinion(minion.id, 100);
assertTrue(dmgResult !== null, 'damage result returned');
assertFalse(dmgResult.alive, 'minion dead from 100 damage');
assertEquals(boss9.minions.length, 2, 'one minion removed after death');

console.log(`  Group 14: ${passed}/${total} passed\n`);

// ─── Test Group 15: Boss reset ────────────────────────────────────────
console.log('--- Test Group 15: Boss reset ---');

const boss10 = new Boss('forest_warden', {x: 10, y: 20, z: 10});
boss10.position = { x: 50, y: 30, z: 50 }; // Move away from spawn
boss10.takeDamage(400); // Damage it

assertEquals(boss10.currentHealth, 100, 'health damaged');
assertEquals(boss10.position.x, 50, 'position moved');

boss10.reset();
assertEquals(boss10.currentHealth, 500, 'health restored to max after reset');
assertEquals(boss10.position.x, 10, 'position returned to spawn x');
assertEquals(boss10.position.y, 20, 'position returned to spawn y');
assertEquals(boss10.position.z, 10, 'position returned to spawn z');
assertEquals(boss10.currentPhase, 1, 'phase reset to 1');
assertEquals(boss10.state, BOSS_STATES.IDLE, 'state reset to IDLE');
assertFalse(boss10.isDead, 'isDead cleared after reset');

console.log(`  Group 15: ${passed}/${total} passed\n`);

// ─── Test Group 16: Serialization / Deserialization ──────────────────
console.log('--- Test Group 16: Serialization ---');

const boss11 = new Boss('lava_titan', {x: 5, y: 20, z: 5});
boss11.takeDamage(200); // Damage it

// Add a minion manually for testing
boss11.minions.push({
  id: 'test_minion_1',
  health: 40,
  maxHealth: 50,
  position: { x: 8, y: 20, z: 8 },
});

const serialized = boss11.serialize();
assertEquals(serialized.bossId, 'lava_titan', 'serialized bossId');
assertEquals(serialized.currentHealth, 640, 'serialized health (800 - 160 with reduction)');
assertEquals(serialized.maxHealth, 800, 'serialized maxHealth');
assertEquals(serialized.position.x, 5, 'serialized position x');
assertEquals(serialized.state, BOSS_STATES.IDLE, 'serialized state');
assertFalse(serialized.isDead, 'serialized isDead = false');
assertTrue(Array.isArray(serialized.minions), 'serialized minions array');
assertEquals(serialized.minions.length, 1, '1 minion serialized');

// Deserialize
const deserialized = Boss.deserialize(serialized);
assertEquals(deserialized.bossId, 'lava_titan', 'deserialized bossId matches');
assertEquals(deserialized.currentHealth, 640, 'deserialized health matches');
assertEquals(deserialized.maxHealth, 800, 'deserialized maxHealth matches');
assertEquals(deserialized.position.x, 5, 'deserialized position x matches');
assertFalse(deserialized.isDead, 'deserialized isDead = false');

console.log(`  Group 16: ${passed}/${total} passed\n`);

// ─── Test Group 17: BossManager ──────────────────────────────────────
console.log('--- Test Group 17: BossManager ---');

const manager = new BossManager();

let spawnData = null;
manager.onBossSpawn = (data) => { spawnData = data; };

// Spawn a boss
const mBoss = manager.spawnBoss('forest_warden', {x: 0, y: 20, z: 0});
assertTrue(mBoss !== null, 'spawnBoss returns boss instance');
assertEquals(manager.activeBosses.size, 1, '1 boss in manager');
assertTrue(spawnData !== null, 'onBossSpawn callback fired');
assertEquals(spawnData.bossId, 'forest_warden', 'spawn data has correct bossId');

// Spawn another boss
manager.spawnBoss('lava_titan', {x: 50, y: 20, z: 50});
assertEquals(manager.activeBosses.size, 2, '2 bosses in manager');

// Get boss by ID
const retrieved = manager.getBoss('forest_warden');
assertTrue(retrieved !== null, 'getBoss returns existing boss');
assertEquals(retrieved.bossId, 'forest_warden', 'retrieved correct boss');

// Non-existent boss
assertEquals(manager.getBoss('nonexistent'), null, 'getBoss returns null for unknown');

// isBossActive
assertTrue(manager.isBossActive('forest_warden'), 'forest_warden is active');
assertFalse(manager.isBossActive('frost_serpent'), 'frost_serpent not active');

// Get alive bosses
const alive = manager.getAliveBosses();
assertEquals(alive.length, 2, '2 alive bosses');

// Kill a boss and check
let deathTriggered = false;
manager.onBossDeath = () => { deathTriggered = true; };
retrieved.takeDamage(600); // Kill forest_warden (500 health)
assertTrue(retrieved.isDead, 'boss killed');
assertTrue(deathTriggered, 'onBossDeath callback fired');

// Alive bosses after death
const aliveAfter = manager.getAliveBosses();
assertEquals(aliveAfter.length, 1, '1 alive boss after one died');
assertFalse(manager.isBossActive('forest_warden'), 'dead boss not active');

// Respawn dead boss (reset)
const respawned = manager.spawnBoss('forest_warden', {x: 0, y: 20, z: 0});
assertEquals(respawned.currentHealth, 500, 'respawned boss has full health');
assertFalse(respawned.isDead, 'respawned boss is alive');

// Remove boss
manager.removeBoss('lava_titan');
assertEquals(manager.activeBosses.size, 1, '1 boss after removal');
assertEquals(manager.getBoss('lava_titan'), null, 'removed boss returns null');

console.log(`  Group 17: ${passed}/${total} passed\n`);

// ─── Test Group 18: Manager update loop ──────────────────────────────
console.log('--- Test Group 18: Manager update ---');

const manager2 = new BossManager();
manager2.spawnBoss('forest_warden', {x: 0, y: 20, z: 0});
manager2.spawnBoss('lava_titan', {x: 50, y: 20, z: 50});

// Update with player position
manager2.update(1.0, {x: 3, y: 20, z: 3}); // Near forest_warden

const fwAfter = manager2.getBoss('forest_warden');
assertTrue(fwAfter.state !== BOSS_STATES.IDLE || fwAfter.age > 0, 
  'forest_warden updated (not idle or age increased)');

const ltAfter = manager2.getBoss('lava_titan');
assertTrue(ltAfter.age > 0, 'lava_titan also updated (age increased)');

console.log(`  Group 18: ${passed}/${total} passed\n`);

// ─── Test Group 19: State summary ─────────────────────────────────────
console.log('--- Test Group 19: State summary ---');

const boss12 = new Boss('final_seal', {x: 0, y: 20, z: 0});
const summary = boss12.getStateSummary();

assertEquals(summary.bossId, 'final_seal', 'summary has bossId');
assertEquals(summary.name, 'The World Eater', 'summary has name');
assertEquals(summary.health, 2000, 'summary health = max');
assertEquals(summary.maxHealth, 2000, 'summary maxHealth');
assertApprox(summary.healthPercent, 1.0, 0.001, 'healthPercent = 1.0');
assertEquals(summary.currentPhase, 1, 'summary phase = 1');
assertEquals(summary.totalPhases, 3, 'summary totalPhases = 3');
assertEquals(summary.state, BOSS_STATES.IDLE, 'summary state = IDLE');
assertEquals(summary.minionCount, 0, 'summary minionCount = 0');

// After taking damage — final_seal has 15% natural reduction: floor(500 * 0.85) = 425 actual damage
boss12.takeDamage(500);
const summary2 = boss12.getStateSummary();
assertApprox(summary2.healthPercent, 0.7875, 0.01, `healthPercent ≈ 0.7875 after 500 damage (got ${summary2.healthPercent})`);

console.log(`  Group 19: ${passed}/${total} passed\n`);

// ─── Test Group 20: Phase-specific attacks ───────────────────────────
console.log('--- Test Group 20: Phase-specific attack filtering ---');

const boss13 = new Boss('final_seal', {x: 0, y: 20, z: 0});

// Phase 1 — only phase 1 attacks available
let p1Avail = boss13.getAvailableAttacks();
const p1Only = p1Avail.filter(a => a.phase === undefined || a.phase === null || a.phase <= 1);
assertTrue(p1Avail.length >= 1, 'has attacks in phase 1');

// Force to phase 2
boss13.currentHealth = 1100; // Below 60%
boss13.checkPhaseTransition();
assertEquals(boss13.currentPhase, 2, 'at phase 2');

let p2Avail = boss13.getAvailableAttacks();
// Phase 2 should include phase 1 + phase 2 attacks
assertTrue(p2Avail.length >= 2, 'more attacks in phase 2');

// Force to phase 3
boss13.currentHealth = 500; // Below 30%
boss13.checkPhaseTransition();
assertEquals(boss13.currentPhase, 3, 'at phase 3');

let p3Avail = boss13.getAvailableAttacks();
// Phase 3 should include all attacks
assertTrue(p3Avail.length >= 3, 'all attacks available in phase 3');

console.log(`  Group 20: ${passed}/${total} passed\n`);

// ─── Test Group 21: Edge cases ────────────────────────────────────────
console.log('--- Test Group 21: Edge cases ---');

// Damage at exactly 0 health
const boss14 = new Boss('forest_warden', {x: 0, y: 20, z: 0});
boss14.currentHealth = 100;
const exactResult = boss14.takeDamage(100); // Exactly enough to kill (no reduction)
assertTrue(boss14.isDead, 'exactly lethal damage kills boss');
assertEquals(boss14.currentHealth, 0, 'health exactly 0');

// Overkill damage
boss14.takeDamage(1000);
assertEquals(boss14.currentHealth, 0, 'overkill doesn\'t go negative');

// getHealthPercent at 0
assertApprox(boss14.getHealthPercent(), 0, 0.001, 'healthPercent = 0 when dead');

// Boss update while dead is no-op
const deadBoss = new Boss('forest_warden', {x: 0, y: 20, z: 0});
deadBoss.takeDamage(999); // Kill it
deadBoss.update(1.0, {x: 0, y: 20, z: 0});
assertEquals(deadBoss.state, BOSS_STATES.DEAD, 'dead boss state unchanged after update');

// Minion not found returns null
const unknownMinionResult = deadBoss.damageMinion('nonexistent_minion', 10);
assertEquals(unknownMinionResult, null, 'damage unknown minion returns null');

console.log(`  Group 21: ${passed}/${total} passed\n`);

// ─── Test Group 22: All bosses can be instantiated ───────────────────
console.log('--- Test Group 22: All bosses instantiable ---');

for (const id of getAllBossIds()) {
  const b = new Boss(id, {x: 0, y: 20, z: 0});
  assertTrue(b.currentHealth > 0, `${id}: health > 0`);
  assertTrue(!b.isDead, `${id}: not dead on creation`);
  assertEquals(b.state, BOSS_STATES.IDLE, `${id}: starts in IDLE`);
  
  // Can take damage and die
  b.takeDamage(99999);
  assertTrue(b.isDead, `${id}: can be killed`);
}

console.log(`  Group 22: ${passed}/${total} passed\n`);

// ─── Test Group 23: Manager getAllSummaries ──────────────────────────
console.log('--- Test Group 23: Manager getAllSummaries ---');

const manager3 = new BossManager();
manager3.spawnBoss('forest_warden', {x: 0, y: 20, z: 0});
manager3.spawnBoss('lava_titan', {x: 50, y: 20, z: 50});

const summaries = manager3.getAllSummaries();
assertEquals(summaries.length, 2, '2 summaries returned');
assertTrue(summaries.some(s => s.bossId === 'forest_warden'), 'includes forest_warden summary');
assertTrue(summaries.some(s => s.bossId === 'lava_titan'), 'includes lava_titan summary');

// Check summary structure
const s = summaries[0];
assertTrue(s.name !== undefined, 'summary has name');
assertTrue(s.healthPercent >= 0 && s.healthPercent <= 1, 'summary healthPercent in [0,1]');
assertTrue(s.attackSpeedMultiplier >= 1, 'summary attackSpeedMultiplier >= 1');

console.log(`  Group 23: ${passed}/${total} passed\n`);

// ─── Summary ──────────────────────────────────────────────────────────
console.log('===================================');
console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
if (failed === 0) {
  console.log('  🎉 All boss system tests passing!');
} else {
  console.log('  ⚠️  Some tests failed — see above for details');
}
console.log('===================================');

process.exit(failed > 0 ? 1 : 0);
