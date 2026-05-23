#!/usr/bin/env node
/**
 * Cuubz — Survival System Tests
 * Tests for health/hunger/thirst/sleep/stamina meters, damage, death/respawn.
 */

const { SurvivalSystem, DAMAGE_SOURCES, DEFAULT_METERS, STAMINA_COSTS, RESTORATION } = require('../js/systems/survival');

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

console.log('Testing survival system...');

// --- Test 1: Constructor initializes all meters to max ---
const ss = new SurvivalSystem();
assert(ss.meters.health === 100, 'Health should start at 100');
assert(ss.meters.hunger === 100, 'Hunger should start at 100');
assert(ss.meters.thirst === 100, 'Thirst should start at 100');
assert(ss.meters.sleep === 100, 'Sleep should start at 100');
assert(ss.meters.stamina === 100, 'Stamina should start at 100');

// --- Test 2: Player is not dead on creation ---
assert(ss.isDead === false, 'Player should not be dead on creation');

// --- Test 3: Default damage source is NONE ---
assert(ss.lastDamageSource === DAMAGE_SOURCES.NONE, 'Initial damage source should be NONE');

// --- Test 4: Default spawn point ---
assert(ss.spawnPoint.x === 0, 'Default spawn X should be 0');
assert(ss.spawnPoint.y === 20, 'Default spawn Y should be 20');
assert(ss.spawnPoint.z === 0, 'Default spawn Z should be 0');

// --- Test 5: Hunger depletes over time ---
const ss2 = new SurvivalSystem();
ss2.update(10, { isSprinting: false, isJumping: false, isMoving: false });
assert(ss2.meters.hunger < 100, 'Hunger should decrease over time');
// Expected: 100 - (1.5 * 10) = 85
assert(Math.abs(ss2.meters.hunger - 85) < 0.1, `Hunger after 10s should be ~85, got ${ss2.meters.hunger.toFixed(2)}`);

// --- Test 6: Thirst depletes over time (faster than hunger) ---
const ss3 = new SurvivalSystem();
ss3.update(10, { isSprinting: false, isJumping: false, isMoving: false });
assert(ss3.meters.thirst < ss3.meters.hunger, 'Thirst should deplete faster than hunger');
// Expected: 100 - (2.0 * 10) = 80
assert(Math.abs(ss3.meters.thirst - 80) < 0.1, `Thirst after 10s should be ~80, got ${ss3.meters.thirst.toFixed(2)}`);

// --- Test 7: Sleep depletes over time (slowest) ---
const ss4 = new SurvivalSystem();
ss4.update(10, { isSprinting: false, isJumping: false, isMoving: false });
assert(ss4.meters.sleep > ss4.meters.thirst, 'Sleep should deplete slower than thirst');
// Expected: 100 - (0.8 * 10) = 92
assert(Math.abs(ss4.meters.sleep - 92) < 0.1, `Sleep after 10s should be ~92, got ${ss4.meters.sleep.toFixed(2)}`);

// --- Test 8: Health does NOT deplete naturally (short time window) ---
const ss5 = new SurvivalSystem();
ss5.update(10, { isSprinting: false, isJumping: false, isMoving: false });
assert(ss5.meters.health === 100, 'Health should not deplete without damage (10s — meters still above 0)');

// --- Test 9: Stamina does NOT deplete naturally (no action) ---
const ss6 = new SurvivalSystem();
ss6.update(10, { isSprinting: false, isJumping: false, isMoving: false, currentTime: 100 });
assert(ss6.meters.stamina === 100, 'Stamina should not deplete when resting');

// --- Test 10: Sprinting consumes stamina ---
const ss7 = new SurvivalSystem();
ss7.lastStaminaActionTime = 0; // Clear action time so regen doesn't interfere
ss7.update(5, { isSprinting: true, isJumping: false, isMoving: true, currentTime: 10 });
assert(ss7.meters.stamina < 100, 'Sprinting should consume stamina');
// Expected: 100 - (20 * 5) = 0
assert(ss7.meters.stamina <= 1, `Stamina after 5s sprint should be ~0, got ${ss7.meters.stamina.toFixed(2)}`);

// --- Test 11: Meters clamp to 0 minimum ---
const ss8 = new SurvivalSystem();
ss8.update(200, { isSprinting: false, isJumping: false, isMoving: false });
assert(ss8.meters.hunger >= 0, 'Hunger should not go below 0');
assert(ss8.meters.thirst >= 0, 'Thirst should not go below 0');
assert(ss8.meters.sleep >= 0, 'Sleep should not go below 0');

// --- Test 12: takeDamage reduces health ---
const ss9 = new SurvivalSystem();
ss9.takeDamage(25, DAMAGE_SOURCES.LAVA);
assert(ss9.meters.health === 75, `Health after 25 damage should be 75, got ${ss9.meters.health}`);
assert(ss9.lastDamageSource === DAMAGE_SOURCES.LAVA, 'Last damage source should be LAVA');

// --- Test 13: takeDamage clamps health to 0 ---
const ss10 = new SurvivalSystem();
ss10.takeDamage(200, DAMAGE_SOURCES.FALL);
assert(ss10.meters.health === 0, 'Health should clamp to 0');

// --- Test 14: Death triggers when health reaches 0 ---
let deathTriggered = false;
const ss11 = new SurvivalSystem({
  onDeath: () => { deathTriggered = true; },
});
ss11.takeDamage(100, DAMAGE_SOURCES.BOSS);
assert(deathTriggered === true, 'Death callback should be called');
assert(ss11.isDead === true, 'Player should be marked dead');

// --- Test 15: Dead player cannot take more damage ---
const ss12 = new SurvivalSystem();
ss12.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ss12.isDead === true, 'Player should be dead after full damage');
ss12.takeDamage(50, DAMAGE_SOURCES.POISON);
assert(ss12.meters.health === 0, 'Dead player health stays at 0');

// --- Test 16: Dead player cannot update meters ---
const ss13 = new SurvivalSystem();
ss13.takeDamage(100, DAMAGE_SOURCES.LAVA);
const healthBefore = ss13.meters.health;
ss13.update(100, { isSprinting: false });
assert(ss13.meters.health === healthBefore, 'Dead player meters should not change');

// --- Test 17: Respawn restores all meters ---
const ss14 = new SurvivalSystem();
ss14.takeDamage(50, DAMAGE_SOURCES.LAVA);
ss14.update(20, {}); // Deplete some meters
ss14.respawn();
assert(ss14.meters.health === 100, 'Respawn should restore health');
assert(ss14.meters.hunger === 100, 'Respawn should restore hunger');
assert(ss14.meters.thirst === 100, 'Respawn should restore thirst');
assert(ss14.meters.sleep === 100, 'Respawn should restore sleep');
assert(ss14.meters.stamina === 100, 'Respawn should restore stamina');
assert(ss14.isDead === false, 'Respawn should set isDead to false');

// --- Test 18: Respawn callback fires ---
let respawnTriggered = false;
const ss15 = new SurvivalSystem({
  onRespawn: () => { respawnTriggered = true; },
});
ss15.respawn();
assert(respawnTriggered === true, 'Respawn callback should fire');

// --- Test 19: setSpawnPoint updates spawn point ---
const ss16 = new SurvivalSystem();
ss16.setSpawnPoint(10, 30, -5);
assert(ss16.spawnPoint.x === 10, 'Spawn X should be 10');
assert(ss16.spawnPoint.y === 30, 'Spawn Y should be 30');
assert(ss16.spawnPoint.z === -5, 'Spawn Z should be -5');

// --- Test 20: eatApple restores hunger ---
const ss17 = new SurvivalSystem();
ss17.meters.hunger = 50;
ss17.eatApple();
assert(ss17.meters.hunger === 75, `Eating apple should restore hunger to 75, got ${ss17.meters.hunger}`);

// --- Test 21: eatApple caps at max ---
const ss18 = new SurvivalSystem();
ss18.meters.hunger = 90;
ss18.eatApple();
assert(ss18.meters.hunger === 100, 'Eating apple should cap hunger at max');

// --- Test 22: eatApple returns false when dead ---
const ss19 = new SurvivalSystem();
ss19.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ss19.eatApple() === false, 'Dead player cannot eat');

// --- Test 23: drinkWater restores thirst ---
const ss20 = new SurvivalSystem();
ss20.meters.thirst = 40;
ss20.drinkWater();
assert(ss20.meters.thirst === 70, `Drinking water should restore thirst to 70, got ${ss20.meters.thirst}`);

// --- Test 24: drinkWater caps at max ---
const ss21 = new SurvivalSystem();
ss21.meters.thirst = 85;
ss21.drinkWater();
assert(ss21.meters.thirst === 100, 'Drinking water should cap thirst at max');

// --- Test 25: drinkWater returns false when dead ---
const ss22 = new SurvivalSystem();
ss22.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ss22.drinkWater() === false, 'Dead player cannot drink');

// --- Test 26: useBed restores sleep and health, sets spawn point ---
const ss23 = new SurvivalSystem();
ss23.meters.sleep = 30;
ss23.meters.health = 60;
ss23.useBed(5, 15, -3);
assert(ss23.meters.sleep === 90, `Bed should restore sleep to 90, got ${ss23.meters.sleep}`);
assert(ss23.meters.health === 80, `Bed should restore health to 80, got ${ss23.meters.health}`);
assert(ss23.spawnPoint.x === 5, 'Bed should set spawn X');
assert(ss23.spawnPoint.y === 15, 'Bed should set spawn Y');
assert(ss23.spawnPoint.z === -3, 'Bed should set spawn Z');

// --- Test 27: useBed caps at max ---
const ss24 = new SurvivalSystem();
ss24.meters.sleep = 80;
ss24.meters.health = 90;
ss24.useBed(0, 0, 0);
assert(ss24.meters.sleep === 100, 'Bed sleep restoration should cap at max');
assert(ss24.meters.health === 100, 'Bed health restoration should cap at max');

// --- Test 28: useBed returns false when dead ---
const ss25 = new SurvivalSystem();
ss25.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ss25.useBed(0, 0, 0) === false, 'Dead player cannot use bed');

// --- Test 29: Fall damage calculation ---
const ss26 = new SurvivalSystem();
assert(ss26.calculateFallDamage(1) === 0, '1 block fall should deal no damage');
assert(ss26.calculateFallDamage(3) === 0, '3 block fall should deal no damage (safe distance)');
assert(ss26.calculateFallDamage(4) === 2, '4 block fall should deal 2 damage');
assert(ss26.calculateFallDamage(10) === 14, '10 block fall should deal 14 damage');
assert(ss26.calculateFallDamage(20) === 34, '20 block fall should deal 34 damage');

// --- Test 30: applyFallDamage applies correct damage ---
const ss27 = new SurvivalSystem();
ss27.applyFallDamage(10, 20); // Fell 10 blocks
assert(ss27.meters.health === 86, `After 10-block fall, health should be 86, got ${ss27.meters.health}`);

// --- Test 31: applyFallDamage with safe distance does nothing ---
const ss28 = new SurvivalSystem();
ss28.applyFallDamage(10, 12); // Fell 2 blocks (safe)
assert(ss28.meters.health === 100, 'Safe fall should not damage health');

// --- Test 32: Environmental damage — lava ---
const ss29 = new SurvivalSystem();
ss29.applyEnvironmentalDamage(DAMAGE_SOURCES.LAVA, 2);
assert(ss29.meters.health === 60, `Lava for 2s should deal 40 damage, health=${ss29.meters.health}`);

// --- Test 33: Environmental damage — poison (slower) ---
const ss30 = new SurvivalSystem();
ss30.applyEnvironmentalDamage(DAMAGE_SOURCES.POISON, 2);
assert(ss30.meters.health === 90, `Poison for 2s should deal 10 damage, health=${ss30.meters.health}`);

// --- Test 34: Environmental damage no-ops when dead ---
const ss31 = new SurvivalSystem();
ss31.takeDamage(100, DAMAGE_SOURCES.LAVA);
ss31.applyEnvironmentalDamage(DAMAGE_SOURCES.POISON, 10);
assert(ss31.meters.health === 0, 'Dead player should not take environmental damage');

// --- Test 35: Desert biome increases thirst depletion ---
const ss32 = new SurvivalSystem();
ss32.setThirstMultiplier(2.0);
ss32.update(10, {});
// Expected: 100 - (2.0 * 2.0 * 10) = 60
assert(Math.abs(ss32.meters.thirst - 60) < 0.1, `Desert thirst after 10s should be ~60, got ${ss32.meters.thirst.toFixed(2)}`);

// --- Test 36: getNormalizedMeters returns 0-1 values ---
const ss33 = new SurvivalSystem();
ss33.meters.health = 50;
ss33.meters.hunger = 25;
const norm = ss33.getNormalizedMeters();
assert(Math.abs(norm.health - 0.5) < 0.01, 'Normalized health at 50 should be 0.5');
assert(Math.abs(norm.hunger - 0.25) < 0.01, 'Normalized hunger at 25 should be 0.25');

// --- Test 37: getMeters returns raw values ---
const ss34 = new SurvivalSystem();
ss34.meters.health = 73;
const raw = ss34.getMeters();
assert(raw.health === 73, 'getMeters should return raw health value');

// --- Test 38: canSprint returns true with enough stamina ---
const ss35 = new SurvivalSystem();
assert(ss35.canSprint() === true, 'Full stamina should allow sprinting');

// --- Test 39: canSprint returns false with low stamina ---
const ss36 = new SurvivalSystem();
ss36.meters.stamina = 0.1;
assert(ss36.canSprint() === false, 'Near-zero stamina should prevent sprinting');

// --- Test 40: Damage callback fires ---
let damageData = null;
const ss37 = new SurvivalSystem({
  onDamage: (data) => { damageData = data; },
});
ss37.takeDamage(15, DAMAGE_SOURCES.FALL);
assert(damageData !== null, 'Damage callback should receive data');
assert(damageData.amount === 15, 'Damage amount should be passed through');
assert(damageData.source === DAMAGE_SOURCES.FALL, 'Damage source should be passed through');

// --- Test 41: Starvation damage when hunger reaches 0 ---
const ss38 = new SurvivalSystem();
ss38.meters.hunger = 0;
ss38.update(5, {}); // 5 seconds with no hunger
assert(ss38.meters.health < 100, 'Starvation should deal health damage');
assert(ss38.lastDamageSource === DAMAGE_SOURCES.HUNGER, 'Last damage source should be HUNGER');

// --- Test 42: Dehydration damage when thirst reaches 0 ---
const ss39 = new SurvivalSystem();
ss39.meters.thirst = 0;
ss39.update(5, {}); // 5 seconds with no thirst
assert(ss39.meters.health < 100, 'Dehydration should deal health damage');
assert(ss39.lastDamageSource === DAMAGE_SOURCES.THIRST, 'Last damage source should be THIRST');

// --- Test 43: Low sleep reduces stamina regen ---
const ss40 = new SurvivalSystem();
ss40.meters.sleep = 10; // Very low sleep
ss40.meters.stamina = 50;
ss40.lastStaminaActionTime = 0;
ss40.update(10, { isSprinting: false, isJumping: false, currentTime: 100 });
// With low sleep (10/100), staminaRegenMultiplier should be ~0.1
assert(ss40.staminaRegenMultiplier < 0.3, 'Low sleep should reduce stamina regen multiplier');

// --- Test 44: Stamina regenerates when resting ---
const ss41 = new SurvivalSystem();
ss41.meters.stamina = 50;
ss41.lastStaminaActionTime = 0; // Old enough that delay has passed
ss41.update(5, { isSprinting: false, isJumping: false, currentTime: 100 });
// Expected regen: min(100, 50 + 15 * 5) = 100 (capped)
assert(ss41.meters.stamina === 100, `Stamina should regenerate to max when resting, got ${ss41.meters.stamina}`);

// --- Test 45: Stamina does NOT regen immediately after action ---
const ss42 = new SurvivalSystem();
ss42.meters.stamina = 70;
ss42.lastStaminaActionTime = 99; // Just acted at t=99
ss42.update(1, { isSprinting: false, isJumping: false, currentTime: 99.3 }); // Only 0.3s since action
// Delay is 0.5s, so regen should NOT happen yet
assert(ss42.meters.stamina < 75, 'Stamina should not regen within delay period');

// --- Test 46: Serialize/deserialize round-trip ---
const ss43 = new SurvivalSystem();
ss43.meters.health = 75;
ss43.meters.hunger = 50;
ss43.setSpawnPoint(10, 20, -5);
const saved = ss43.serialize();
assert(saved.meters.health === 75, 'Serialized health should be 75');
assert(saved.spawnPoint.x === 10, 'Serialized spawn X should be 10');

const ss44 = new SurvivalSystem();
ss44.deserialize(saved);
assert(ss44.meters.health === 75, 'Deserialized health should be 75');
assert(ss44.meters.hunger === 50, 'Deserialized hunger should be 50');
assert(ss44.spawnPoint.x === 10, 'Deserialized spawn X should be 10');

// --- Test 47: Deserialize clamps values to max ---
const ss45 = new SurvivalSystem();
ss45.deserialize({ meters: { health: 200, hunger: -10 } });
assert(ss45.meters.health === 100, 'Deserialized health should clamp to max');
assert(ss45.meters.hunger === 0, 'Deserialized hunger should clamp to min 0');

// --- Test 48: Deserialize with null data does nothing ---
const ss46 = new SurvivalSystem();
ss46.meters.health = 80;
ss46.deserialize(null);
assert(ss46.meters.health === 80, 'Deserialize null should not change state');

// --- Test 49: resetToMax restores everything ---
const ss47 = new SurvivalSystem();
ss47.takeDamage(50, DAMAGE_SOURCES.LAVA);
ss47.update(20, {});
ss47.resetToMax();
assert(ss47.meters.health === 100, 'resetToMax should restore health');
assert(ss47.meters.hunger === 100, 'resetToMax should restore hunger');
assert(ss47.isDead === false, 'resetToMax should set isDead to false');

// --- Test 50: generateHUDHTML returns valid HTML ---
const ss48 = new SurvivalSystem();
const html = ss48.generateHUDHTML();
assert(typeof html === 'string', 'generateHUDHTML should return a string');
assert(html.includes('survival-hud'), 'HTML should contain survival-hud container');
assert(html.includes('Health'), 'HTML should include Health meter');
assert(html.includes('Hunger'), 'HTML should include Hunger meter');
assert(html.includes('Thirst'), 'HTML should include Thirst meter');
assert(html.includes('Sleep'), 'HTML should include Sleep meter');
assert(html.includes('Stamina'), 'HTML should include Stamina meter');

// --- Test 51: HUD shows death message when dead ---
const ss49 = new SurvivalSystem();
ss49.takeDamage(100, DAMAGE_SOURCES.LAVA);
const deadHtml = ss49.generateHUDHTML();
assert(deadHtml.includes('DIED') || deadHtml.includes('☠️'), 'Dead HUD should show death message');

// --- Test 52: Custom meter config is respected ---
const ss50 = new SurvivalSystem({
  config: { health: { max: 200 } },
});
assert(ss50.config.health.max === 200, 'Custom health max should be 200');
assert(ss50.meters.health === 200, 'Health should start at custom max');

// --- Summary ---
console.log(`\nSurvival System Tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
