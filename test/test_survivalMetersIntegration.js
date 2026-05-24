#!/usr/bin/env node
/**
 * Cuubz — Survival Meters Integration Test
 * Simulates playing for several minutes and verifies:
 * - All 5 meters deplete over time
 * - Hunger restored by eating apples
 * - Thirst restored by drinking water
 * - Sleep restored by beds, spawn point set
 * - Death and respawn at spawn point works
 *
 * This is an integration test that runs the full update loop
 * simulating realistic gameplay scenarios.
 */

const { SurvivalSystem, DAMAGE_SOURCES, DEFAULT_METERS, STAMINA_COSTS, STAMINA_REGEN, FOOD_ITEMS, BED, DRINKING } = require('../js/systems/survival');

let passed = 0;
let failed = 0;
let totalAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function logStep(step) {
  console.log(`  → ${step}`);
}

// Helper: simulate N seconds of gameplay with a given context.
// Uses simulated currentTime throughout to avoid Date.now() conflicts.
function simulateSeconds(survival, seconds, context = {}) {
  const tickSize = 0.1; // 100ms ticks for accuracy
  const totalTicks = Math.ceil(seconds / tickSize);
  let simTime = (context.currentTime || 1000);

  for (let i = 0; i < totalTicks; i++) {
    // Patch lastStaminaActionTime to use simulated time if it's from real clock
    // This is necessary because _markStaminaAction() uses Date.now()/1000 internally.
    if (survival.lastStaminaActionTime > simTime + 100) {
      // Real clock timestamp — convert to simulated equivalent
      survival.lastStaminaActionTime = simTime - STAMINA_REGEN.delay - 0.01;
    }

    survival.update(tickSize, { ...context, currentTime: simTime });
    simTime += tickSize;
  }

  return simTime; // Return final simulated time
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 1: All meters deplete over time (without starvation death)
// We test each meter individually by setting depletion rates to 0 for ones
// we don't want to interfere with the test.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 1: Meter depletion over time ===');

// Test hunger depletion (disable thirst/sleep so no starvation death)
const ss1h = new SurvivalSystem({
  config: {
    thirst: { max: 100, depletionRate: 0 },
    sleep: { max: 100, depletionRate: 0 },
  }
});
logStep('Depleting hunger for 40 seconds (thirst/sleep disabled)');
simulateSeconds(ss1h, 40, { isSprinting: false });
assert(ss1h.meters.hunger < 50, `Hunger should deplete after 40s, got ${ss1h.meters.hunger.toFixed(1)}`);
// Expected: 100 - 1.5*40 = 40
assert(Math.abs(ss1h.meters.hunger - 40) < 1, `Hunger should be ~40 after 40s, got ${ss1h.meters.hunger.toFixed(1)}`);

// Test thirst depletion
const ss1t = new SurvivalSystem({
  config: {
    hunger: { max: 100, depletionRate: 0 },
    sleep: { max: 100, depletionRate: 0 },
  }
});
simulateSeconds(ss1t, 40, { isSprinting: false });
assert(ss1t.meters.thirst < 50, `Thirst should deplete after 40s, got ${ss1t.meters.thirst.toFixed(1)}`);
// Expected: 100 - 2.0*40 = 20
assert(Math.abs(ss1t.meters.thirst - 20) < 1, `Thirst should be ~20 after 40s, got ${ss1t.meters.thirst.toFixed(1)}`);

// Test sleep depletion
const ss1s = new SurvivalSystem({
  config: {
    hunger: { max: 100, depletionRate: 0 },
    thirst: { max: 100, depletionRate: 0 },
  }
});
simulateSeconds(ss1s, 60, { isSprinting: false });
assert(ss1s.meters.sleep < 80, `Sleep should deplete after 60s, got ${ss1s.meters.sleep.toFixed(1)}`);
// Expected: 100 - 0.8*60 = 52
assert(Math.abs(ss1s.meters.sleep - 52) < 1, `Sleep should be ~52 after 60s, got ${ss1s.meters.sleep.toFixed(1)}`);

// Test that health does NOT deplete naturally (no damage source)
const ss1hp = new SurvivalSystem({
  config: {
    hunger: { max: 100, depletionRate: 0 },
    thirst: { max: 100, depletionRate: 0 },
    sleep: { max: 100, depletionRate: 0 },
  }
});
simulateSeconds(ss1hp, 300, { isSprinting: false });
assert(ss1hp.meters.health === 100, `Health should not deplete naturally after 5min, got ${ss1hp.meters.health.toFixed(1)}`);

// Test stamina does NOT deplete at rest (with simulated time fix)
const ss1st = new SurvivalSystem({
  config: {
    hunger: { max: 100, depletionRate: 0 },
    thirst: { max: 100, depletionRate: 0 },
    sleep: { max: 100, depletionRate: 0 },
  }
});
ss1st.lastStaminaActionTime = 900; // Before sim start (1000)
simulateSeconds(ss1st, 300, { isSprinting: false });
assert(ss1st.meters.stamina === 100, `Stamina should not deplete at rest after 5min, got ${ss1st.meters.stamina.toFixed(1)}`);

logStep('✅ All 5 meters verified for correct behavior');

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 2: Hunger restored by eating apples
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 2: Eating restores hunger ===');

const ss2 = new SurvivalSystem({
  config: { thirst: { max: 100, depletionRate: 0 }, sleep: { max: 100, depletionRate: 0 } }
});
logStep('Deplete hunger for 40 seconds');
simulateSeconds(ss2, 40, { isSprinting: false });

const hungerAfterDepletion = ss2.meters.hunger;
assert(hungerAfterDepletion < 50, `Hunger should be depleted after 40s, got ${hungerAfterDepletion.toFixed(1)}`);

logStep('Eating an apple (instant for testing)');
ss2.lastEatTime = 0; // Clear cooldown
ss2.eatFood('apple');

assert(ss2.meters.hunger > hungerAfterDepletion, `Hunger should increase after eating`);
// Apple restores 25 hunger
const hungerExpected = Math.min(100, hungerAfterDepletion + 25);
assert(Math.abs(ss2.meters.hunger - hungerExpected) < 1, `Hunger should be ~${hungerExpected}, got ${ss2.meters.hunger.toFixed(1)}`);

logStep('Testing multiple food types');
const ss2b = new SurvivalSystem();
ss2b.meters.hunger = 30;
ss2b.eatFood('cooked_meat'); // +40 hunger
assert(ss2b.meters.hunger === 70, `Cooked meat should restore 40 hunger: ${ss2b.meters.hunger}`);

ss2b.meters.hunger = 50;
ss2b.eatFood('golden_apple'); // +35 hunger
assert(ss2b.meters.hunger === 85, `Golden apple should restore 35 hunger: ${ss2b.meters.hunger}`);

logStep('Testing animated eating flow (startEating → update → completion)');
const ss2c = new SurvivalSystem();
ss2c.meters.hunger = 40;
ss2c.lastEatTime = 0;
let foodEatenCount = 0;
ss2c.onFoodEaten = () => { foodEatenCount++; };

ss2c.startEating('bread'); // eatTime = 0.8s
assert(ss2c.isEating === true, 'Should be eating bread');
assert(foodEatenCount === 0, 'Food not yet eaten while animation plays');

// Advance past eatTime (0.8s) — use small simulation
simulateSeconds(ss2c, 1.0, { isSprinting: false });
assert(ss2c.isEating === false, 'Eating should complete');
assert(foodEatenCount === 1, 'onFoodEaten callback should fire once');
assert(ss2c.meters.hunger > 40, `Hunger should increase after bread (was ~40, now ${ss2c.meters.hunger.toFixed(1)})`);

logStep('Testing food capping at max');
const ss2d = new SurvivalSystem();
ss2d.meters.hunger = 95;
ss2d.eatFood('apple'); // +25 → would be 120, capped to 100
assert(ss2d.meters.hunger === 100, 'Hunger should cap at max after eating');

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 3: Thirst restored by drinking water
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 3: Drinking restores thirst ===');

const ss3 = new SurvivalSystem({
  config: { hunger: { max: 100, depletionRate: 0 }, sleep: { max: 100, depletionRate: 0 } }
});
logStep('Deplete thirst for 40 seconds');
simulateSeconds(ss3, 40, { isSprinting: false });

const thirstAfterDepletion = ss3.meters.thirst;
assert(thirstAfterDepletion < 30, `Thirst should be low after 40s, got ${thirstAfterDepletion.toFixed(1)}`);

logStep('Setting near water source and drinking');
ss3.setNearWaterSource(true);
assert(ss3.canDrink() === true, 'Should be able to drink when near water');

ss3.lastDrinkTime = 0; // Clear cooldown
const drank = ss3.drinkWaterInstant();
assert(drank === true, 'drinkWaterInstant should return true');
assert(ss3.meters.thirst > thirstAfterDepletion, `Thirst should increase after drinking`);

const thirstExpected = Math.min(100, thirstAfterDepletion + DRINKING.thirstRestoration);
assert(Math.abs(ss3.meters.thirst - thirstExpected) < 1, `Thirst should be ~${thirstExpected}, got ${ss3.meters.thirst.toFixed(1)}`);

logStep('Testing animated drinking flow');
const ss3b = new SurvivalSystem();
ss3b.setNearWaterSource(true);
ss3b.lastDrinkTime = 0;
let waterDrunkCount = 0;
ss3b.onWaterDrunk = () => { waterDrunkCount++; };

const startedDrinking = ss3b.startDrinking();
assert(startedDrinking === true, 'startDrinking should return true');
assert(ss3b.isDrinking === true, 'Should be marked as drinking');
assert(waterDrunkCount === 0, 'Water not yet consumed while animation plays');

simulateSeconds(ss3b, 1.0, { isSprinting: false });
assert(ss3b.isDrinking === false, 'Drinking should complete');
assert(waterDrunkCount === 1, 'onWaterDrunk callback should fire once');

logStep('Testing cannot drink without water source');
const ss3c = new SurvivalSystem();
ss3c.setNearWaterSource(false);
assert(ss3c.canDrink() === false, 'Cannot drink when not near water');
assert(ss3c.startDrinking() === false, 'startDrinking should fail without water');

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 4: Sleep restored by beds + spawn point set
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 4: Bed use restores sleep + sets spawn ===');

const ss4 = new SurvivalSystem({
  config: { hunger: { max: 100, depletionRate: 0 }, thirst: { max: 100, depletionRate: 0 } }
});
logStep('Deplete sleep for 60 seconds');
simulateSeconds(ss4, 60, { isSprinting: false });

const sleepBeforeBed = ss4.meters.sleep;
assert(sleepBeforeBed < 55, `Sleep should be depleted after 60s, got ${sleepBeforeBed.toFixed(1)}`);

logStep('Using bed (instant for testing)');
ss4.lastBedUseTime = 0; // Clear cooldown
let bedUsedCount = 0;
ss4.onBedUsed = (data) => { bedUsedCount++; };

const usedBed = ss4.useBed(50, 25, -10);
assert(usedBed === true, 'useBed should return true');
assert(ss4.meters.sleep > sleepBeforeBed, `Sleep should increase after bed use`);

const expectedSleep = Math.min(100, sleepBeforeBed + BED.sleepRestoration);
assert(Math.abs(ss4.meters.sleep - expectedSleep) < 1, `Sleep should be ~${expectedSleep}, got ${ss4.meters.sleep.toFixed(1)}`);

logStep('Verifying spawn point set above bed');
const spawn = ss4.getSpawnPoint();
assert(spawn.x === 50, `Spawn X should match bed X (50), got ${spawn.x}`);
assert(spawn.y === 26, `Spawn Y should be bed Y+1 (26), got ${spawn.y}`);
assert(spawn.z === -10, `Spawn Z should match bed Z (-10), got ${spawn.z}`);

// Bed also restores health and small amounts of hunger/thirst
assert(ss4.meters.health > 0, 'Health should be restored by bed');

logStep('Testing animated bed use flow (startUsingBed → update → completion)');
const ss4b = new SurvivalSystem();
ss4b.setNearBed({ x: 100, y: 30, z: 50 });
ss4b.lastBedUseTime = 0;
let bedUsedAnimated = false;
ss4b.onBedUsed = (data) => {
  bedUsedAnimated = true;
  assert(data.spawnPoint.x === 100, 'Animated bed use should set correct spawn X');
  assert(data.sleepRestored === BED.sleepRestoration, `Sleep restored should be ${BED.sleepRestoration}`);
};

const startedSleeping = ss4b.startUsingBed();
assert(startedSleeping === true, 'startUsingBed should return true');
assert(ss4b.isSleeping === true, 'Should be marked as sleeping');
assert(bedUsedAnimated === false, 'Bed not yet used while animation plays');

// Advance past BED.useTime (3.0s)
simulateSeconds(ss4b, 4.0, { isSprinting: false });
assert(ss4b.isSleeping === false, 'Sleeping should complete after useTime');
assert(bedUsedAnimated === true, 'onBedUsed callback should fire on completion');

logStep('Testing bed cooldown prevents spam');
const ss4c = new SurvivalSystem();
ss4c.setNearBed({ x: 0, y: 20, z: 0 });
ss4c.lastBedUseTime = Date.now() / 1000; // Just used
assert(ss4c.canUseBed() === false, 'Should be on cooldown immediately after use');

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 5: Death and respawn at spawn point
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 5: Death → respawn cycle ===');

const ss5 = new SurvivalSystem();
ss5.setSpawnPoint(10, 35, -20);

let deathData = null;
let respawnData = null;
ss5.onDeath = (data) => { deathData = data; };
ss5.onRespawn = (data) => { respawnData = data; };

logStep('Taking lethal damage');
assert(ss5.isDead === false, 'Player should start alive');
ss5.takeDamage(100, DAMAGE_SOURCES.LAVA);

assert(ss5.isDead === true, 'Player should be dead after 100 damage');
assert(ss5.meters.health === 0, 'Health should be 0 when dead');
assert(deathData !== null, 'onDeath callback should fire');
assert(deathData.lastDamageSource === DAMAGE_SOURCES.LAVA, 'Death source should be LAVA');
assert(deathData.spawnPoint.x === 10, 'Death data should include spawn X');

logStep('Verifying dead player cannot take more damage or update');
ss5.takeDamage(50, DAMAGE_SOURCES.FALL);
assert(ss5.meters.health === 0, 'Dead player health stays at 0');
assert(ss5.isDead === true, 'Player still dead');

const metersBeforeDeath = { ...ss5.meters };
simulateSeconds(ss5, 10, { isSprinting: false });
assert(ss5.meters.health === metersBeforeDeath.health, 'Dead player meters do not change during update');

logStep('Respawning at spawn point');
ss5.respawn();

assert(ss5.isDead === false, 'Player should be alive after respawn');
assert(ss5.meters.health === 100, 'Health restored to 100');
assert(ss5.meters.hunger === 100, 'Hunger restored to 100');
assert(ss5.meters.thirst === 100, 'Thirst restored to 100');
assert(ss5.meters.sleep === 100, 'Sleep restored to 100');
assert(ss5.meters.stamina === 100, 'Stamina restored to 100');

assert(respawnData !== null, 'onRespawn callback should fire');
assert(respawnData.spawnPoint.x === 10, `Respawn spawn X should be 10, got ${respawnData.spawnPoint.x}`);
assert(respawnData.spawnPoint.y === 35, `Respawn spawn Y should be 35, got ${respawnData.spawnPoint.y}`);

logStep('Testing death from starvation (meters deplete → damage → death)');
const ss5b = new SurvivalSystem();
ss5b.setSpawnPoint(0, 20, 0);
let starvedDeath = false;
ss5b.onDeath = (data) => { starvedDeath = true; };

// Deplete all meters for long enough that starvation kills the player
simulateSeconds(ss5b, 120, { isSprinting: false });
assert(starvedDeath === true, 'Player should die from starvation after ~120s');
assert(ss5b.lastDamageSource === DAMAGE_SOURCES.HUNGER || ss5b.lastDamageSource === DAMAGE_SOURCES.THIRST,
  `Death source should be hunger/thirst, got ${ss5b.lastDamageSource}`);

// After death, respawn works
ss5b.respawn();
assert(ss5b.isDead === false, 'Respawn restores life after starvation death');
assert(ss5b.meters.health === 100, 'Health fully restored on respawn');

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 6: Stamina depletion via sprinting + regeneration at rest
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 6: Stamina cycle (sprint → deplete → rest → regen) ===');

const ss6 = new SurvivalSystem({
  config: { hunger: { max: 100, depletionRate: 0 }, thirst: { max: 100, depletionRate: 0 }, sleep: { max: 100, depletionRate: 0 } }
});
ss6.lastStaminaActionTime = 900; // Before sim start

logStep('Sprinting for 5 seconds');
simulateSeconds(ss6, 5, { isSprinting: true, isJumping: false, isMoving: true });

assert(ss6.meters.stamina <= 2, `Stamina should be nearly empty after sprinting, got ${ss6.meters.stamina.toFixed(1)}`);

logStep('Resting for 5 seconds (should regenerate stamina)');
simulateSeconds(ss6, 5, { isSprinting: false, isJumping: false, isMoving: false });

// After rest: should regen at ~15/s * 5s = 75. From 0 → max(0, 75) = 75 (capped at 100)
assert(ss6.meters.stamina > 50, `Stamina should regenerate after rest, got ${ss6.meters.stamina.toFixed(1)}`);

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 7: Full gameplay simulation — play for 2 minutes with actions
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 7: Full 2-minute gameplay simulation ===');

const ss7 = new SurvivalSystem();
ss7.setSpawnPoint(0, 25, 0);
ss7.lastStaminaActionTime = 900; // Before sim start
let deaths = 0;
ss7.onDeath = () => { deaths++; };

// Simulate 120 seconds with periodic eating/drinking/sleeping to stay alive
const tickSize = 1.0; // 1-second ticks for this longer simulation
const totalTicks = 120;
let simTime = 1000;

for (let i = 0; i < totalTicks; i++) {
  const elapsed = i;

  // Eat every 20 seconds to stay fed (apple = +25 hunger, depletion ~1.5/s)
  if (elapsed > 0 && elapsed % 20 === 0) {
    ss7.lastEatTime = 0;
    ss7.eatFood('cooked_meat'); // cooked_meat restores 40 hunger — better than apple
  }

  // Drink every 15 seconds to stay hydrated (thirst depletion ~2.0/s, drink restores 35)
  if (elapsed > 0 && elapsed % 15 === 0) {
    ss7.setNearWaterSource(true);
    ss7.lastDrinkTime = 0;
    ss7.drinkWaterInstant();
  }

  // Use bed every 60 seconds to restore sleep
  if (elapsed > 0 && elapsed % 60 === 0) {
    ss7.setNearBed({ x: 5, y: 25, z: 5 });
    ss7.lastBedUseTime = 0;
    ss7.useBed(5, 25, 5);
  }

  const isSprinting = elapsed < 10; // Sprint first 10 seconds only
  ss7.update(tickSize, {
    isSprinting: isSprinting,
    isJumping: false,
    isMoving: true,
    currentTime: simTime,
  });
  simTime += tickSize;
}

logStep('After 2 minutes of gameplay with periodic eating/drinking/bed use');

assert(deaths === 0, 'Player should still be alive after 2 min with proper maintenance');
assert(ss7.meters.health > 50, `Health should be healthy (${ss7.meters.health.toFixed(1)})`);
assert(ss7.meters.hunger > 20, `Hunger should be manageable (${ss7.meters.hunger.toFixed(1)})`);
assert(ss7.meters.thirst > 20, `Thirst should be manageable (${ss7.meters.thirst.toFixed(1)})`);
assert(ss7.meters.sleep > 20, `Sleep should be manageable (${ss7.meters.sleep.toFixed(1)})`);

// Spawn point should be set from bed use
const finalSpawn = ss7.getSpawnPoint();
assert(finalSpawn.x === 5, `Spawn X should be 5 (from bed), got ${finalSpawn.x}`);
assert(finalSpawn.y === 26, `Spawn Y should be 26 (bed Y+1), got ${finalSpawn.y}`);

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 8: Survival state serialization round-trip
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 8: Survival state persistence ===');

const ss8 = new SurvivalSystem();
ss8.setSpawnPoint(42, 30, -15);
simulateSeconds(ss8, 30, { isSprinting: false });

logStep('Serializing survival state');
const serialized = ss8.serialize();
assert(serialized.meters.health !== undefined, 'Serialized state has health');
assert(serialized.meters.hunger !== undefined, 'Serialized state has hunger');
assert(serialized.spawnPoint.x === 42, 'Spawn point serialized');

logStep('Deserializing into new SurvivalSystem');
const ss8b = new SurvivalSystem();
ss8b.deserialize(serialized);

assert(Math.abs(ss8b.meters.health - ss8.meters.health) < 0.1, 'Health matches after deserialization');
assert(Math.abs(ss8b.meters.hunger - ss8.meters.hunger) < 0.1, 'Hunger matches after deserialization');
assert(ss8b.spawnPoint.x === 42, 'Spawn point restored correctly');
assert(ss8b.spawnPoint.y === 30, 'Spawn Y restored correctly');
assert(ss8b.spawnPoint.z === -15, 'Spawn Z restored correctly');

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 9: Desert biome thirst multiplier
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 9: Desert biome faster thirst depletion ===');

const ss9a = new SurvivalSystem({
  config: { hunger: { max: 100, depletionRate: 0 }, sleep: { max: 100, depletionRate: 0 } }
});
const ss9b = new SurvivalSystem({
  config: { hunger: { max: 100, depletionRate: 0 }, sleep: { max: 100, depletionRate: 0 } }
});
ss9b.setThirstMultiplier(2.0); // Desert biome

simulateSeconds(ss9a, 30, { isSprinting: false });
simulateSeconds(ss9b, 30, { isSprinting: false });

assert(ss9b.meters.thirst < ss9a.meters.thirst,
  `Desert thirst (${ss9b.meters.thirst.toFixed(1)}) should deplete faster than normal (${ss9a.meters.thirst.toFixed(1)})`);

// Normal: 100 - 2.0*30 = 40. Desert: 100 - 4.0*30 = -20 → clamped to 0
assert(ss9b.meters.thirst <= 2, `Desert thirst should be nearly depleted after 30s, got ${ss9b.meters.thirst.toFixed(1)}`);

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 10: Low sleep penalty on stamina regeneration
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 10: Low sleep penalizes stamina regen ===');

const ss10 = new SurvivalSystem({
  config: { hunger: { max: 100, depletionRate: 0 }, thirst: { max: 100, depletionRate: 0 } }
});
ss10.lastStaminaActionTime = 900;

// Deplete sleep below 20 threshold (~125s needed at 0.8/s to go from 100→0)
simulateSeconds(ss10, 125, { isSprinting: false });
assert(ss10.meters.sleep < 20, `Sleep should be below 20 after 125s, got ${ss10.meters.sleep.toFixed(1)}`);

// Deplete stamina, then check regen rate with low sleep
ss10.meters.stamina = 50;
ss10.lastStaminaActionTime = ss10.lastStaminaActionTime || 900;

const beforeRegen = ss10.meters.stamina;
simulateSeconds(ss10, 5, { isSprinting: false, isJumping: false, isMoving: false });
const afterRegen = ss10.meters.stamina;

// Normal regen would be ~15/s * 5s = 75. With low sleep penalty (<20), multiplier ≈ sleep/100 < 0.2.
// So regen ≈ 15 * 0.2 * 5 = 15 max. Should be significantly less than normal.
const regenGained = afterRegen - beforeRegen;
assert(regenGained < 30, `Stamina regen should be reduced with low sleep (gained ${regenGained.toFixed(1)}, expected <30)`);
assert(regenGained > 5, `Some stamina should still regenerate (gained ${regenGained.toFixed(1)})`);

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 11: Environmental damage (lava, poison, fall)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 11: Environmental damage sources ===');

const ss11 = new SurvivalSystem();

logStep('Lava contact damage (20/s)');
ss11.applyEnvironmentalDamage(DAMAGE_SOURCES.LAVA, 2); // 2 seconds in lava
assert(ss11.meters.health === 60, `Health should be 60 after 2s lava, got ${ss11.meters.health}`);

logStep('Poison DoT (5/s)');
const healthBeforePoison = ss11.meters.health;
ss11.applyEnvironmentalDamage(DAMAGE_SOURCES.POISON, 4); // 4 seconds in poison
assert(ss11.meters.health === healthBeforePoison - 20, `Health should decrease by 20 from 4s poison, got ${ss11.meters.health}`);

logStep('Fall damage calculation');
const ss11f = new SurvivalSystem();
assert(ss11f.calculateFallDamage(2) === 0, '2-block fall should cause 0 damage');
assert(ss11f.calculateFallDamage(3) === 0, '3-block fall should cause 0 damage (safe threshold)');
assert(ss11f.calculateFallDamage(4) === 2, '4-block fall should cause 2 damage');
assert(ss11f.calculateFallDamage(10) === 14, '10-block fall should cause 14 damage');

logStep('Apply fall damage');
ss11f.applyFallDamage(5, 20); // Fall from y=20 to y=5 (15 block distance)
assert(ss11f.meters.health === 100 - Math.floor((15 - 3) * 2), `Health after 15-block fall: ${ss11f.meters.health}`);

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIO 12: getNormalizedMeters for HUD rendering
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Scenario 12: Normalized meters for HUD ===');

const ss12 = new SurvivalSystem();
ss12.meters.health = 50;
ss12.meters.hunger = 75;
ss12.meters.thirst = 25;
ss12.meters.sleep = 0;
ss12.meters.stamina = 100;

const normalized = ss12.getNormalizedMeters();
assert(Math.abs(normalized.health - 0.5) < 0.01, `Health normalization: ${normalized.health}`);
assert(Math.abs(normalized.hunger - 0.75) < 0.01, `Hunger normalization: ${normalized.hunger}`);
assert(Math.abs(normalized.thirst - 0.25) < 0.01, `Thirst normalization: ${normalized.thirst}`);
assert(Math.abs(normalized.sleep - 0) < 0.01, `Sleep normalization: ${normalized.sleep}`);
assert(Math.abs(normalized.stamina - 1.0) < 0.01, `Stamina normalization: ${normalized.stamina}`);

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n===================================');
console.log(`  Survival Meters Integration Tests`);
console.log(`  ${passed}/${totalAssertions} assertions passed, ${failed} failed`);
console.log('===================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('  🎉 All survival meter integration tests passing!');
  process.exit(0);
}
