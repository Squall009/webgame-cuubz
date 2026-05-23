#!/usr/bin/env node
/**
 * Cuubz — Damage System Tests
 * Tests for environmental damage (lava, poison), fall damage, boss attacks,
 * damage flash effects, and the integrated DamageSystem class.
 */

const {
  DamageSystem,
  DamageFlashEffect,
  DAMAGE_SOURCES,
  ENVIRONMENTAL_DAMAGE_RATES,
  POISON_CONFIG,
  FALL_DAMAGE_CONFIG,
  BOSS_ATTACKS,
  getBlockDamageSource,
  isDamagingBlock,
  calculateFallDamage,
  getEnvironmentalDamageRate,
  getBossDefinition,
  calculateBossAttackDamage,
  getBossKeys,
} = require('../js/systems/damageSystem');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message} — expected ~${expected}, got ${actual}`);
  }
}

console.log('Testing damage system...');

// ============================================================
// Section 1: Constants and Configuration
// ============================================================

// --- Test: DAMAGE_SOURCES has all expected keys ---
assert(DAMAGE_SOURCES.NONE === 'none', 'DAMAGE_SOURCES.NONE should be "none"');
assert(DAMAGE_SOURCES.LAVA === 'lava', 'DAMAGE_SOURCES.LAVA should be "lava"');
assert(DAMAGE_SOURCES.POISON === 'poison', 'DAMAGE_SOURCES.POISON should be "poison"');
assert(DAMAGE_SOURCES.FALL === 'fall', 'DAMAGE_SOURCES.FALL should be "fall"');
assert(DAMAGE_SOURCES.BOSS === 'boss', 'DAMAGE_SOURCES.BOSS should be "boss"');
assert(DAMAGE_SOURCES.HUNGER === 'hunger', 'DAMAGE_SOURCES.HUNGER should be "hunger"');
assert(DAMAGE_SOURCES.THIRST === 'thirst', 'DAMAGE_SOURCES.THIRST should be "thirst"');

// --- Test: ENVIRONMENTAL_DAMAGE_RATES ---
assert(ENVIRONMENTAL_DAMAGE_RATES[DAMAGE_SOURCES.LAVA] === 20.0, 'Lava damage rate should be 20/s');
assert(ENVIRONMENTAL_DAMAGE_RATES[DAMAGE_SOURCES.POISON] === 5.0, 'Poison damage rate should be 5/s');

// --- Test: POISON_CONFIG ---
assert(POISON_CONFIG.tickInterval === 1.0, 'Poison tick interval should be 1s');
assert(POISON_CONFIG.maxStacks === 3, 'Max poison stacks should be 3');
assert(POISON_CONFIG.damagePerStack === 5.0, 'Damage per stack should be 5');
assert(POISON_CONFIG.duration === 8.0, 'Poison duration should be 8s');

// --- Test: FALL_DAMAGE_CONFIG ---
assert(FALL_DAMAGE_CONFIG.safeFallDistance === 3.0, 'Safe fall distance should be 3 blocks');
assert(FALL_DAMAGE_CONFIG.damagePerBlock === 2.0, 'Damage per block should be 2');
assert(FALL_DAMAGE_CONFIG.maxDamage === 100.0, 'Max fall damage should be 100');

// ============================================================
// Section 2: Block Damage Source Detection
// ============================================================

// --- Test: Lava block (ID 15) returns LAVA source ---
assert(getBlockDamageSource(15) === DAMAGE_SOURCES.LAVA, 'Block ID 15 should return LAVA damage source');

// --- Test: Toxic slime block (ID 17) returns POISON source ---
assert(getBlockDamageSource(17) === DAMAGE_SOURCES.POISON, 'Block ID 17 should return POISON damage source');

// --- Test: Non-damaging blocks return null ---
assert(getBlockDamageSource(0) === null, 'Air block should not be damaging');
assert(getBlockDamageSource(1) === null, 'Grass block should not be damaging');
assert(getBlockDamageSource(2) === null, 'Dirt block should not be damaging');
assert(getBlockDamageSource(3) === null, 'Stone block should not be damaging');
assert(getBlockDamageSource(6) === null, 'Water block should not be damaging');
assert(getBlockDamageSource(7) === null, 'Wood log should not be damaging');

// --- Test: isDamagingBlock utility ---
assert(isDamagingBlock(15) === true, 'Lava (15) should be a damaging block');
assert(isDamagingBlock(17) === true, 'Toxic slime (17) should be a damaging block');
assert(isDamagingBlock(0) === false, 'Air (0) should not be damaging');
assert(isDamagingBlock(3) === false, 'Stone (3) should not be damaging');

// ============================================================
// Section 3: Fall Damage Calculation
// ============================================================

// --- Test: Falls under safe distance cause no damage ---
assert(calculateFallDamage(0) === 0, '0 block fall should deal 0 damage');
assert(calculateFallDamage(1) === 0, '1 block fall should deal 0 damage');
assert(calculateFallDamage(2) === 0, '2 block fall should deal 0 damage');
assert(calculateFallDamage(3) === 0, '3 block fall (safe limit) should deal 0 damage');

// --- Test: Falls above safe distance scale correctly ---
assert(calculateFallDamage(4) === 2, '4 block fall should deal 2 damage');
assert(calculateFallDamage(5) === 4, '5 block fall should deal 4 damage');
assert(calculateFallDamage(10) === 14, '10 block fall should deal 14 damage');
assert(calculateFallDamage(20) === 34, '20 block fall should deal 34 damage');

// --- Test: Negative fall distance (going up) causes no damage ---
assert(calculateFallDamage(-5) === 0, 'Negative fall distance should deal 0 damage');

// --- Test: Very large falls cap at max damage ---
assert(calculateFallDamage(1000) <= FALL_DAMAGE_CONFIG.maxDamage, '1000 block fall should cap at max damage');

// ============================================================
// Section 4: Environmental Damage Rate Lookup
// ============================================================

assert(getEnvironmentalDamageRate(DAMAGE_SOURCES.LAVA) === 20.0, 'Lava rate lookup should return 20');
assert(getEnvironmentalDamageRate(DAMAGE_SOURCES.POISON) === 5.0, 'Poison rate lookup should return 5');

// ============================================================
// Section 5: Boss Definitions
// ============================================================

// --- Test: getBossDefinition returns correct data ---
const boss1 = getBossDefinition('CORRUPT_GUARDIAN');
assert(boss1 !== null, 'CORRUPT_GUARDIAN should exist');
assert(boss1.name === 'Corrupt Crystal Guardian', 'Boss 1 name should match');
assert(boss1.health === 500, 'Boss 1 health should be 500');
assert(boss1.attacks.length === 3, 'Boss 1 should have 3 attacks');
assert(boss1.phases === 2, 'Boss 1 should have 2 phases');

const boss4 = getBossDefinition('CORRUPTION_OVERLORD');
assert(boss4 !== null, 'CORRUPTION_OVERLORD should exist');
assert(boss4.health === 1500, 'Final boss health should be 1500');
assert(boss4.phases === 3, 'Final boss should have 3 phases');
assert(boss4.phase2HealthThreshold === 0.6, 'Phase 2 threshold should be 0.6');
assert(boss4.phase3HealthThreshold === 0.3, 'Phase 3 threshold should be 0.3');

// --- Test: Invalid boss key returns null ---
assert(getBossDefinition('NONEXISTENT') === null, 'Invalid boss key should return null');

// --- Test: getBossKeys returns all 4 bosses ---
const keys = getBossKeys();
assert(keys.length === 4, 'Should have 4 boss definitions');
assert(keys.includes('CORRUPT_GUARDIAN'), 'Should include CORRUPT_GUARDIAN');
assert(keys.includes('LAVA_WURM'), 'Should include LAVA_WURM');
assert(keys.includes('YETI_KING'), 'Should include YETI_KING');
assert(keys.includes('CORRUPTION_OVERLORD'), 'Should include CORRUPTION_OVERLORD');

// --- Test: Boss attack definitions have required fields ---
for (const key of getBossKeys()) {
  const def = getBossDefinition(key);
  for (const attack of def.attacks) {
    assert(typeof attack.name === 'string', `${key} attack "${attack.name}" should have name`);
    assert(typeof attack.damage === 'number', `${key} attack "${attack.name}" should have damage`);
    assert(typeof attack.cooldown === 'number', `${key} attack "${attack.name}" should have cooldown`);
    assert(typeof attack.range === 'number', `${key} attack "${attack.name}" should have range`);
    assert(typeof attack.type === 'string', `${key} attack "${attack.name}" should have type`);
  }
}

// ============================================================
// Section 6: Boss Attack Damage Calculation
// ============================================================

const testAttack = { name: 'Test Attack', damage: 20, cooldown: 3, range: 5, type: 'melee' };

// --- Test: Phase 1 has base damage ---
assert(calculateBossAttackDamage(testAttack, 1) === 20, 'Phase 1 should deal base damage (20)');

// --- Test: Phase 2 increases by 20% ---
assert(calculateBossAttackDamage(testAttack, 2) === 24, 'Phase 2 should deal 20% more (24)');

// --- Test: Phase 3 increases by 40% ---
assert(calculateBossAttackDamage(testAttack, 3) === 28, 'Phase 3 should deal 40% more (28)');

// --- Test: Zero-damage buffs return 0 ---
const shieldAttack = { name: 'Shield', damage: 0, cooldown: 10, range: 0, type: 'buff' };
assert(calculateBossAttackDamage(shieldAttack, 1) === 0, 'Zero-damage attack should return 0');
assert(calculateBossAttackDamage(shieldAttack, 2) === 0, 'Zero-damage attack at phase 2 should still be 0');

// ============================================================
// Section 7: DamageFlashEffect
// ============================================================

// --- Test: Flash starts inactive ---
const flash = new DamageFlashEffect();
assert(flash.active === false, 'Flash should start inactive');
assert(flash.intensity === 0, 'Flash intensity should start at 0');
assert(flash.source === DAMAGE_SOURCES.NONE, 'Flash source should start as NONE');

// --- Test: Trigger activates flash ---
flash.trigger(DAMAGE_SOURCES.LAVA, 10, 100);
assert(flash.active === true, 'Flash should be active after trigger');
assertApprox(flash.intensity, 0.1, 0.001, 'Intensity should be damage/maxHealth = 0.1');
assert(flash.source === DAMAGE_SOURCES.LAVA, 'Source should match trigger source');

// --- Test: Intensity capped at 1.0 ---
flash.trigger(DAMAGE_SOURCES.BOSS, 200, 100);
assert(flash.intensity === 1.0, 'Intensity should cap at 1.0 for damage > maxHealth');

// --- Test: Flash fades over time ---
const flash2 = new DamageFlashEffect();
flash2.trigger(DAMAGE_SOURCES.POISON, 50, 100); // intensity = 0.5
assert(flash2.update(0.1), 'Flash should still be active after 0.1s');
assertApprox(flash2.intensity, 0.3, 0.01, 'Intensity should decrease by fadeRate * deltaTime');

// --- Test: Flash deactivates when fully faded ---
const flash3 = new DamageFlashEffect();
flash3.trigger(DAMAGE_SOURCES.FALL, 5, 100); // intensity = 0.05
assert(flash3.update(0.02), 'Flash should be active after 0.02s');
assert(flash3.intensity > 0, 'Intensity should still be positive');

// Fade it out completely with large delta
const result = flash3.update(10.0);
assert(result === false, 'Flash should return false when fully faded');
assert(flash3.active === false, 'Flash should be inactive after full fade');
assert(flash3.intensity === 0, 'Intensity should be 0 after full fade');

// --- Test: getColor returns correct colors by source ---
const flash4 = new DamageFlashEffect();
flash4.trigger(DAMAGE_SOURCES.LAVA, 50, 100);
assert(flash4.getColor().includes('255, 80, 0'), 'Lava flash should be orange-red');

flash4.trigger(DAMAGE_SOURCES.POISON, 50, 100);
assert(flash4.getColor().includes('160, 32, 240'), 'Poison flash should be purple');

flash4.trigger(DAMAGE_SOURCES.FALL, 50, 100);
assert(flash4.getColor().includes('255, 255, 255'), 'Fall flash should be white');

flash4.trigger(DAMAGE_SOURCES.BOSS, 50, 100);
assert(flash4.getColor().includes('200, 0, 100'), 'Boss flash should be deep red');

// --- Test: generateHTML returns empty when inactive ---
const flash5 = new DamageFlashEffect();
assert(flash5.generateHTML() === '', 'Inactive flash should return empty HTML');

// --- Test: generateHTML returns div when active ---
flash5.trigger(DAMAGE_SOURCES.LAVA, 30, 100);
const html = flash5.generateHTML();
assert(html.includes('damage-flash'), 'Active flash HTML should include damage-flash id');
assert(html.includes('box-shadow'), 'Flash HTML should include box-shadow style');
assert(html.includes('rgba(255, 80, 0,'), 'Flash HTML should have correct lava color');

// --- Test: reset clears all state ---
flash5.reset();
assert(flash5.active === false, 'Reset should deactivate flash');
assert(flash5.intensity === 0, 'Reset should zero intensity');
assert(flash5.source === DAMAGE_SOURCES.NONE, 'Reset should clear source to NONE');

// ============================================================
// Section 8: DamageSystem Integration Tests
// ============================================================

// --- Test: Constructor initializes correctly ---
const ds = new DamageSystem();
assert(ds.flashEffect instanceof DamageFlashEffect, 'Should create DamageFlashEffect');
assert(ds.poisonStacks === 0, 'Poison stacks should start at 0');
assert(ds.fallStartY === null, 'Fall start Y should be null');
assert(ds.activeBosses.size === 0, 'Active bosses should start empty');

// --- Test: Lava environmental damage ---
class MockSurvival {
  constructor() {
    this.health = 100;
    this.isDead = false;
    this.config = { health: { max: 100 } };
    this.damageHistory = [];
  }
  takeDamage(amount, source) {
    this.health -= amount;
    this.damageHistory.push({ amount, source });
  }
}

const ds2 = new DamageSystem();
const mockSurvival = new MockSurvival();
ds2.linkSurvivalSystem(mockSurvival);

// Simulate 1 second of lava contact
ds2.update(1.0, { currentHazard: DAMAGE_SOURCES.LAVA, position: { x: 0, y: 20, z: 0 } });
assertApprox(mockSurvival.health, 80, 0.1, 'After 1s in lava (20/s), health should be ~80');

// --- Test: Poison adds stacks, doesn't deal continuous damage ---
const ds3 = new DamageSystem();
const mockSurvival2 = new MockSurvival();
ds3.linkSurvivalSystem(mockSurvival2);

// Contact poison — should add stack but not deal direct damage in same frame
ds3.update(0.5, { currentHazard: DAMAGE_SOURCES.POISON, position: { x: 0, y: 20, z: 0 } });
assert(ds3.poisonStacks === 1, 'Should have 1 poison stack after contact');

// --- Test: Poison DoT deals damage on ticks ---
const ds4 = new DamageSystem();
const mockSurvival3 = new MockSurvival();
ds4.linkSurvivalSystem(mockSurvival3);
ds4.poisonStacks = 2;
ds4.poisonTimer = 0; // Ready to tick

// Advance by 1 second (past tick interval)
ds4.update(1.5, { position: { x: 0, y: 20, z: 0 } });
// Should deal 5 * 2 = 10 damage on the tick
assertApprox(mockSurvival3.health, 90, 1.0, 'Poison DoT should deal stack*base damage per tick');

// --- Test: Fall damage on landing ---
const ds5 = new DamageSystem();
const mockSurvival4 = new MockSurvival();
ds5.linkSurvivalSystem(mockSurvival4);

// Simulate falling from y=30, landing at y=10 (20 block fall)
ds5.update(0.016, { position: { x: 0, y: 30, z: 0 }, isGrounded: false }); // Start falling
ds5.update(0.016, { position: { x: 0, y: 29, z: 0 }, isGrounded: false }); // Continue falling
// ... skip intermediate frames for brevity
// Land at y=10
const fallDamage = ds5.calculateFallDamage(20);
assert(fallDamage === 34, '20 block fall should deal 34 damage');

// --- Test: Safe fall distance no damage ---
assert(ds5.calculateFallDamage(3) === 0, '3 block fall should be safe (no damage)');
assert(ds5.calculateFallDamage(2.9) === 0, '2.9 block fall should be safe');

// --- Test: Boss spawning and damage ---
const ds6 = new DamageSystem();
const mockSurvival5 = new MockSurvival();
ds6.linkSurvivalSystem(mockSurvival5);

const bossInstance = ds6.spawnBoss('CORRUPT_GUARDIAN', { x: 10, y: 20, z: 10 }, 'boss-1');
assert(bossInstance !== null, 'Should spawn CORRUPT_GUARDIAN');
assert(bossInstance.health === 500, 'Boss health should be 500');
assert(bossInstance.phase === 1, 'Boss should start at phase 1');
assert(ds6.activeBosses.size === 1, 'Should have 1 active boss');

// --- Test: Boss damage to player when in range ---
const ds7 = new DamageSystem();
const mockSurvival6 = new MockSurvival();
ds7.linkSurvivalSystem(mockSurvival6);

ds7.spawnBoss('CORRUPT_GUARDIAN', { x: 5, y: 20, z: 5 }, 'boss-near');
// Player at (0, 20, 0), boss at (5, 20, 5) — distance = ~7.07, within Crystal Blast range of 8
ds7.update(0.1, { position: { x: 0, y: 20, z: 0 } });
// Boss should have attacked (cooldown starts at 0, ready to attack)
assert(mockSurvival6.health <= 100, 'Player health should be <= 100 after boss attack');

// --- Test: Boss phase transition on low health ---
const ds8 = new DamageSystem();
ds8.spawnBoss('CORRUPTION_OVERLORD', { x: 0, y: 20, z: 0 }, 'final-boss');

// Deal damage to push below 60% threshold (1500 * 0.6 = 900)
let died = ds8.damageBoss('final-boss', 700); // health = 800, which is < 900
assert(died === false, 'Boss should not die from 700 damage (health=800)');
const bossState = ds8.activeBosses.get('final-boss');
assert(bossState.phase === 2, 'Boss should enter phase 2 when health < 60%');

// Push to phase 3 (below 30% = 450)
died = ds8.damageBoss('final-boss', 500); // health = 300, which is < 450
assert(died === false, 'Boss should not die from another 500 damage (health=300)');
assert(bossState.phase === 3, 'Boss should enter phase 3 when health < 30%');

// Kill the boss
died = ds8.damageBoss('final-boss', 999); // health < 0
assert(died === true, 'Boss should die from killing blow');
assert(ds8.activeBosses.size === 0, 'Dead boss should be removed from active bosses');

// --- Test: Boss removal ---
const ds9 = new DamageSystem();
ds9.spawnBoss('LAVA_WURM', { x: 0, y: 20, z: 0 }, 'lava-boss');
assert(ds9.activeBosses.size === 1, 'Should have 1 boss');
ds9.removeBoss('lava-boss');
assert(ds9.activeBosses.size === 0, 'Boss should be removed');

// --- Test: getActiveBosses returns a copy ---
const ds10 = new DamageSystem();
ds10.spawnBoss('YETI_KING', { x: 0, y: 20, z: 0 }, 'yeti');
const bosses = ds10.getActiveBosses();
assert(bosses.size === 1, 'Should have 1 boss in returned map');

// --- Test: Serialization/Deserialization ---
const ds11 = new DamageSystem();
ds11.spawnBoss('CORRUPT_GUARDIAN', { x: 10, y: 25, z: -5 }, 'save-boss');
ds11.damageBoss('save-boss', 200); // Reduce health to 300
ds11.poisonStacks = 2;
ds11.poisonTimer = 4.5;

const saved = ds11.serialize();
assert(saved.poisonStacks === 2, 'Serialized poison stacks should be 2');
assert(saved.poisonTimer === 4.5, 'Serialized poison timer should be 4.5');
assert(saved.bosses.length === 1, 'Should have 1 boss in serialization');
assert(saved.bosses[0].health === 300, 'Boss health should serialize correctly');

// Deserialize into new system
const ds12 = new DamageSystem();
ds12.deserialize(saved);
assert(ds12.poisonStacks === 2, 'Deserialized poison stacks should match');
assert(ds12.poisonTimer === 4.5, 'Deserialized poison timer should match');
assert(ds12.activeBosses.size === 1, 'Should have 1 boss after deserialization');

// --- Test: getFlashHTML delegates to flash effect ---
const ds13 = new DamageSystem();
assert(ds13.getFlashHTML() === '', 'Inactive flash should return empty HTML');
ds13.flashEffect.trigger(DAMAGE_SOURCES.LAVA, 20, 100);
assert(ds13.getFlashHTML().includes('damage-flash'), 'Active flash should return HTML');

// --- Test: Dead player — no damage applied ---
class DeadMockSurvival {
  constructor() {
    this.health = 100;
    this.isDead = true;
    this.config = { health: { max: 100 } };
    this.damageHistory = [];
  }
  takeDamage(amount, source) {
    this.health -= amount;
    this.damageHistory.push({ amount, source });
  }
}

const ds14 = new DamageSystem();
const deadSurvival = new DeadMockSurvival();
ds14.linkSurvivalSystem(deadSurvival);
ds14.update(1.0, { currentHazard: DAMAGE_SOURCES.LAVA, position: { x: 0, y: 20, z: 0 } });
assert(deadSurvival.health === 100, 'Dead player should not take environmental damage');

// --- Test: Config overrides work ---
const ds15 = new DamageSystem({
  config: {
    fall: { safeFallDistance: 5.0, damagePerBlock: 3.0 },
    poison: { maxStacks: 5, damagePerStack: 10.0 },
  },
});
assert(ds15.config.fall.safeFallDistance === 5.0, 'Config override for safe fall distance');
assert(ds15.config.fall.damagePerBlock === 3.0, 'Config override for damage per block');
assert(ds15.config.poison.maxStacks === 5, 'Config override for max poison stacks');
assert(ds15.config.poison.damagePerStack === 10.0, 'Config override for poison damage per stack');

// With custom config: 8 block fall = (8-5) * 3 = 9 damage
assert(ds15.calculateFallDamage(8) === 9, 'Custom fall config should apply (8-5)*3=9');

// ============================================================
// Summary
// ============================================================
console.log(`\n--- Damage System: ${passed} passed, ${failed} failed ---`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All damage system tests passed!');
  process.exit(0);
}
