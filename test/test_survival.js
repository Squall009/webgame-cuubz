#!/usr/bin/env node
/**
 * Cuubz — Survival System Tests
 * Tests for health/hunger/thirst/sleep/stamina meters, damage, death/respawn.
 * Includes comprehensive food system tests (FOOD_ITEMS registry, eating mechanics, saturation).
 */

const { SurvivalSystem, DAMAGE_SOURCES, DEFAULT_METERS, STAMINA_COSTS, RESTORATION, FOOD_ITEMS, EATING } = require('../js/systems/survival');

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

// --- Test 20: eatApple restores hunger (backward compat alias) ---
const ss17 = new SurvivalSystem();
ss17.meters.hunger = 50;
ss17.eatApple();
assert(ss17.meters.hunger === 75, `Eating apple should restore hunger to 75, got ${ss17.meters.hunger}`);

// --- Test 21: eatApple caps at max (backward compat) ---
const ss18 = new SurvivalSystem();
ss18.meters.hunger = 90;
ss18.eatApple();
assert(ss18.meters.hunger === 100, 'Eating apple should cap hunger at max');

// --- Test 21b: eatApple returns false when dead (backward compat) ---
const ss19 = new SurvivalSystem();
ss19.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ss19.eatApple() === false, 'Dead player cannot eat');

// ═══════════════════════════════════════════════════════════════════════════
// FOOD SYSTEM TESTS — New comprehensive food system (FOOD_ITEMS registry)
// ═══════════════════════════════════════════════════════════════════════════

// --- Test F1: FOOD_ITEMS registry has expected entries ---
assert(FOOD_ITEMS.apple !== undefined, 'FOOD_ITEMS should have apple entry');
assert(FOOD_ITEMS.cooked_meat !== undefined, 'FOOD_ITEMS should have cooked_meat entry');
assert(FOOD_ITEMS.berry !== undefined, 'FOOD_ITEMS should have berry entry');
assert(FOOD_ITEMS.bread !== undefined, 'FOOD_ITEMS should have bread entry');
assert(FOOD_ITEMS.golden_apple !== undefined, 'FOOD_ITEMS should have golden_apple entry');

// --- Test F2: Apple food properties ---
const appleFood = FOOD_ITEMS.apple;
assert(appleFood.hunger === 25, `Apple hunger restoration should be 25, got ${appleFood.hunger}`);
assert(appleFood.thirst === 0, 'Apple thirst restoration should be 0');
assert(appleFood.health === 0, 'Apple health restoration should be 0');
assert(appleFood.saturation === 0.8, `Apple saturation should be 0.8, got ${appleFood.saturation}`);
assert(appleFood.eatTime === 0.5, `Apple eatTime should be 0.5, got ${appleFood.eatTime}`);
assert(appleFood.blockDrop === 24, `Apple blockDrop should be 24, got ${appleFood.blockDrop}`);

// --- Test F3: Cooked meat properties (high hunger, negative thirst) ---
const meatFood = FOOD_ITEMS.cooked_meat;
assert(meatFood.hunger === 40, 'Cooked meat should restore 40 hunger');
assert(meatFood.thirst === -5, `Cooked meat should have -5 thirst (dehydrating), got ${meatFood.thirst}`);
assert(meatFood.health === 5, 'Cooked meat should restore 5 health');
assert(meatFood.saturation === 0.5, 'Cooked meat saturation should be 0.5 (very filling)');

// --- Test F4: Berry properties (light snack) ---
const berryFood = FOOD_ITEMS.berry;
assert(berryFood.hunger === 10, 'Berry should restore 10 hunger');
assert(berryFood.thirst === 5, 'Berry should restore 5 thirst');
assert(berryFood.eatTime === 0.3, 'Berry eatTime should be 0.3 (fastest to eat)');

// --- Test F5: Golden apple properties (premium food) ---
const goldenApple = FOOD_ITEMS.golden_apple;
assert(goldenApple.hunger === 35, 'Golden apple should restore 35 hunger');
assert(goldenApple.thirst === 10, 'Golden apple should restore 10 thirst');
assert(goldenApple.health === 20, `Golden apple should restore 20 health, got ${goldenApple.health}`);
assert(goldenApple.saturation === 0.4, 'Golden apple saturation should be 0.4 (most filling)');

// --- Test F6: EATING constants ---
assert(EATING.defaultCooldown === 0.5, `Eating cooldown should be 0.5s, got ${EATING.defaultCooldown}`);
assert(EATING.saturationDuration === 30, `Saturation duration should be 30s, got ${EATING.saturationDuration}`);

// --- Test F7: isValidFood checks ---
const ssF1 = new SurvivalSystem();
assert(ssF1.isValidFood('apple') === true, 'apple should be valid food');
assert(ssF1.isValidFood('bread') === true, 'bread should be valid food');
assert(ssF1.isValidFood('nonexistent') === false, 'nonexistent should not be valid food');

// --- Test F8: getFoodItem returns correct definition ---
const ssF2 = new SurvivalSystem();
const appleDef = ssF2.getFoodItem('apple');
assert(appleDef !== null, 'getFoodItem(apple) should return a definition');
assert(appleDef.hunger === 25, 'Returned definition should match registry');
assert(ssF2.getFoodItem('nonexistent') === null, 'Unknown food should return null');

// --- Test F9: getAvailableFoods returns all keys ---
const ssF3 = new SurvivalSystem();
const foods = ssF3.getAvailableFoods();
assert(Array.isArray(foods), 'getAvailableFoods should return array');
assert(foods.length === 5, `Should have 5 food types, got ${foods.length}`);
assert(foods.includes('apple'), 'Should include apple');
assert(foods.includes('golden_apple'), 'Should include golden_apple');

// --- Test F10: eatFood — instant eat restores hunger ---
const ssF4 = new SurvivalSystem();
ssF4.meters.hunger = 50;
ssF4.eatFood('apple');
assert(ssF4.meters.hunger === 75, `Eat apple should restore to 75, got ${ssF4.meters.hunger}`);

// --- Test F11: eatFood — cooked_meat restores hunger + health, reduces thirst ---
const ssF5 = new SurvivalSystem();
ssF5.meters.hunger = 30;
ssF5.meters.thirst = 80;
ssF5.meters.health = 60;
ssF5.eatFood('cooked_meat');
assert(ssF5.meters.hunger === 70, `Meat should restore hunger to 70, got ${ssF5.meters.hunger}`);
assert(ssF5.meters.thirst === 75, `Meat should reduce thirst to 75 (dehydrating), got ${ssF5.meters.thirst}`);
assert(ssF5.meters.health === 65, `Meat should restore health to 65, got ${ssF5.meters.health}`);

// --- Test F12: eatFood — golden_apple restores all three meters ---
const ssF6 = new SurvivalSystem();
ssF6.meters.hunger = 40;
ssF6.meters.thirst = 30;
ssF6.meters.health = 50;
ssF6.eatFood('golden_apple');
assert(ssF6.meters.hunger === 75, `Golden apple hunger: ${ssF6.meters.hunger}`);
assert(ssF6.meters.thirst === 40, `Golden apple thirst: ${ssF6.meters.thirst}`);
assert(ssF6.meters.health === 70, `Golden apple health: ${ssF6.meters.health}`);

// --- Test F13: eatFood — caps at max ---
const ssF7 = new SurvivalSystem();
ssF7.meters.hunger = 95;
ssF7.eatFood('apple'); // Would add 25 → 120, should cap at 100
assert(ssF7.meters.hunger === 100, 'Hunger should cap at max after eating');

// --- Test F14: eatFood — returns false for dead player ---
const ssF8 = new SurvivalSystem();
ssF8.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ssF8.eatFood('apple') === false, 'Dead player cannot eat');

// --- Test F15: eatFood — returns false for invalid food type ---
const ssF9 = new SurvivalSystem();
assert(ssF9.eatFood('rock') === false, 'Invalid food type should return false');
assert(ssF9.eatFood('') === false, 'Empty string food type should return false');

// --- Test F16: startEating — begins eating animation ---
const ssF10 = new SurvivalSystem();
ssF10.lastEatTime = 0; // Clear cooldown
const started = ssF10.startEating('apple');
assert(started === true, 'startEating should return true');
assert(ssF10.isEating === true, 'Should be marked as eating');
assert(ssF10.currentFoodItem !== null, 'Current food item should be set');
assert(ssF10.eatingProgress === 0, 'Eating progress should start at 0');

// --- Test F17: startEating — returns false when already eating ---
const ssF11 = new SurvivalSystem();
ssF11.lastEatTime = 0;
ssF11.startEating('apple');
assert(ssF11.startEating('bread') === false, 'Cannot start eating while already eating');

// --- Test F18: startEating — returns false when dead ---
const ssF12 = new SurvivalSystem();
ssF12.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ssF12.startEating('apple') === false, 'Dead player cannot start eating');

// --- Test F19: startEating — returns false for invalid food ---
const ssF13 = new SurvivalSystem();
ssF13.lastEatTime = 0;
assert(ssF13.startEating('stone') === false, 'Invalid food should fail to start eating');

// --- Test F20: Eating progress completes in update loop ---
const ssF14 = new SurvivalSystem();
ssF14.lastEatTime = 0;
let foodEaten = null;
ssF14.onFoodEaten = (data) => { foodEaten = data; };
ssF14.startEating('berry'); // eatTime = 0.3s
assert(ssF14.isEating === true, 'Should be eating');

// Advance time past eatTime
ssF14.update(0.5, { currentTime: 100 });
assert(ssF14.isEating === false, 'Eating should complete after eatTime');
assert(foodEaten !== null, 'onFoodEaten callback should fire');
assert(foodEaten.foodType === 'berry', `Should report berry was eaten, got ${foodEaten.foodType}`);

// --- Test F21: Eating completion applies restoration ---
const ssF15 = new SurvivalSystem();
ssF15.meters.hunger = 40;
ssF15.lastEatTime = 0;
ssF15.startEating('bread'); // bread restores 30 hunger, eatTime=0.8
ssF15.update(1.0, { currentTime: 100 });
// Eating completes (+30), then depletion happens in same frame (with saturation bonus).
// Expected: ~40 + 30 - (1.5 * 0.7 * 1.0) ≈ 68.95
assert(ssF15.meters.hunger > 65, `After eating bread, hunger should be significantly higher (~69), got ${ssF15.meters.hunger.toFixed(2)}`);
assert(ssF15.meters.hunger < 75, `Should not exceed max after depletion, got ${ssF15.meters.hunger.toFixed(2)}`);

// --- Test F22: Eating completion applies saturation bonus ---
const ssF16 = new SurvivalSystem();
ssF16.lastEatTime = 0;
ssF16.startEating('golden_apple'); // saturation=0.4 (very filling)
ssF16.update(1.0, { currentTime: 100 });
const satState = ssF16.getSaturationState();
assert(satState.active === true, 'Saturation should be active after eating');
assert(Math.abs(satState.multiplier - 0.4) < 0.01, `Saturation multiplier should be 0.4, got ${satState.multiplier}`);
assert(satState.timeRemaining > 0, 'Saturation timer should be running');

// --- Test F23: Saturation reduces hunger depletion rate ---
const ssF17 = new SurvivalSystem();
ssF17.lastEatTime = 0;
ssF17.startEating('golden_apple'); // saturation=0.4
ssF17.update(1.0, { currentTime: 100 }); // Complete eating → saturation active

// Now deplete hunger for 10 seconds with saturation active
const hungerBefore = ssF17.meters.hunger;
for (let i = 0; i < 10; i++) {
  ssF17.update(1, { currentTime: 200 + i });
}
// Normal depletion: 1.5/s → 15 over 10s. With saturation 0.4: 1.5*0.4=0.6/s → 6 over 10s
const depletion = hungerBefore - ssF17.meters.hunger;
assert(depletion < 12, `Saturation should reduce depletion (got ${depletion.toFixed(1)}, expected ~6)`);
assert(depletion > 3, `Depletion should still happen (got ${depletion.toFixed(1)})`);

// --- Test F24: Saturation timer expires and resets ---
const ssF18 = new SurvivalSystem();
ssF18.lastEatTime = 0;
ssF18.startEating('apple');
ssF18.update(1.0, { currentTime: 100 }); // Complete eating

// Advance past saturation duration (30s)
for (let i = 0; i < 35; i++) {
  ssF18.update(1, { currentTime: 200 + i });
}
const satAfter = ssF18.getSaturationState();
assert(satAfter.active === false, 'Saturation should expire after duration');
assert(Math.abs(satAfter.multiplier - 1.0) < 0.01, 'Multiplier should reset to 1.0');

// --- Test F25: cancelEating stops eating without applying restoration ---
const ssF19 = new SurvivalSystem();
ssF19.meters.hunger = 40;
ssF19.lastEatTime = 0;
ssF19.startEating('apple');
assert(ssF19.isEating === true, 'Should be eating before cancel');
ssF19.cancelEating();
assert(ssF19.isEating === false, 'cancelEating should set isEating to false');
assert(ssF19.meters.hunger === 40, 'Hunger should not change when eating is cancelled');

// --- Test F26: canEat returns true when off cooldown ---
const ssF20 = new SurvivalSystem();
ssF20.lastEatTime = 0; // Far in the past
assert(ssF20.canEat() === true, 'Should be able to eat when off cooldown');

// --- Test F27: canEat returns false when dead ---
const ssF21 = new SurvivalSystem();
ssF21.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ssF21.canEat() === false, 'Dead player cannot eat');

// --- Test F28: canEat returns false while eating ---
const ssF22 = new SurvivalSystem();
ssF22.lastEatTime = 0;
ssF22.startEating('apple');
assert(ssF22.canEat() === false, 'Should not be able to eat while already eating');

// --- Test F29: getEatingState returns correct data ---
const ssF23 = new SurvivalSystem();
let state = ssF23.getEatingState();
assert(state.isEating === false, 'Not eating should return isEating=false');
assert(state.foodType === null, 'Not eating should have null foodType');

ssF23.lastEatTime = 0;
ssF23.startEating('bread'); // eatTime=0.8
state = ssF23.getEatingState();
assert(state.isEating === true, 'Should be eating');
assert(state.foodType === 'bread', `Food type should be bread, got ${state.foodType}`);

// Halfway through eating
ssF23.update(0.4, { currentTime: 100 }); // eatTime=0.8, so 0.4 is halfway
state = ssF23.getEatingState();
assert(state.isEating === true, 'Should still be eating at halfway');
assert(Math.abs(state.progress - 0.5) < 0.1, `Progress should be ~0.5, got ${state.progress.toFixed(2)}`);

// --- Test F30: getSaturationState returns correct data ---
const ssF24 = new SurvivalSystem();
let sat = ssF24.getSaturationState();
assert(sat.active === false, 'No saturation by default');
assert(Math.abs(sat.multiplier - 1.0) < 0.01, 'Default multiplier should be 1.0');

// --- Test F31: onFoodEaten callback receives correct data ---
const ssF25 = new SurvivalSystem();
let callbackData = null;
ssF25.onFoodEaten = (data) => { callbackData = data; };
ssF25.eatFood('cooked_meat');
assert(callbackData !== null, 'Callback should fire on eatFood');
assert(callbackData.foodType === 'cooked_meat', `Should report cooked_meat, got ${callbackData.foodType}`);

// --- Test F32: Food serialization includes food state ---
const ssF26 = new SurvivalSystem();
ssF26.lastEatTime = 0;
ssF26.startEating('bread');
ssF26.eatingProgress = 0.4; // Midway through eating
const saved = ssF26.serialize();
assert(saved.isEating === true, 'Serialized state should include isEating');
assert(saved.eatingProgress === 0.4, 'Serialized eating progress should be preserved');
assert(saved.currentFoodItemKey === 'bread', `Current food key should be bread, got ${saved.currentFoodItemKey}`);

// --- Test F33: Food deserialization restores food state ---
const ssF27 = new SurvivalSystem();
ssF27.deserialize({
  meters: { health: 80, hunger: 60 },
  isEating: true,
  eatingProgress: 0.5,
  currentFoodItemKey: 'golden_apple',
  saturationTimer: 15,
  activeSaturation: 0.4,
});
assert(ssF27.isEating === true, 'Deserialized isEating should be true');
assert(ssF27.currentFoodItem !== null, 'Current food item should be restored');
assert(ssF27.saturationTimer === 15, 'Saturation timer should be restored');
assert(Math.abs(ssF27.activeSaturation - 0.4) < 0.01, 'Active saturation should be restored');

// --- Test F34: Deserialize null food key resets state ---
const ssF28 = new SurvivalSystem();
ssF28.deserialize({ currentFoodItemKey: null });
assert(ssF28.currentFoodItem === null, 'Null food key should reset currentFoodItem');

// --- Test F35: Eating while dead does nothing ---
const ssF29 = new SurvivalSystem();
ssF29.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ssF29.isDead === true, 'Player should be dead');
ssF29.update(10, { currentTime: 100 });
assert(ssF29.isEating === false, 'Dead player should not be eating after update');

// --- Test F36: Negative thirst from food is clamped to 0 ---
const ssF30 = new SurvivalSystem();
ssF30.meters.thirst = 3; // Very low thirst
ssF30.eatFood('cooked_meat'); // thirst restoration = -5
assert(ssF30.meters.thirst === 0, `Thirst should clamp to 0 (not negative), got ${ssF30.meters.thirst}`);

// --- Test F37: Multiple food types have different eatTimes ---
const ssF31 = new SurvivalSystem();
assert(FOOD_ITEMS.berry.eatTime < FOOD_ITEMS.apple.eatTime, 'Berry should be faster to eat than apple');
assert(FOOD_ITEMS.apple.eatTime < FOOD_ITEMS.bread.eatTime, 'Apple should be faster to eat than bread');
assert(FOOD_ITEMS.bread.eatTime <= FOOD_ITEMS.cooked_meat.eatTime, 'Bread should not be slower than cooked meat');

// --- Test F38: Food items with health restoration heal player ---
const ssF32 = new SurvivalSystem();
ssF32.meters.health = 50;
ssF32.eatFood('golden_apple'); // health=20
assert(ssF32.meters.health === 70, `Golden apple should restore 20 health, got ${ssF32.meters.health}`);

// --- Test F39: Food with no health restoration doesn't change health ---
const ssF33 = new SurvivalSystem();
ssF33.meters.health = 75;
ssF33.eatFood('bread'); // health=0 for bread
assert(ssF33.meters.health === 75, 'Bread should not change health');

// --- Test F40: EATING constants are exported correctly ---
assert(typeof EATING.defaultCooldown === 'number', 'EATING.defaultCooldown should be a number');
assert(typeof EATING.saturationDuration === 'number', 'EATING.saturationDuration should be a number');
assert(EATING.defaultCooldown > 0, 'Cooldown should be positive');
assert(EATING.saturationDuration > 0, 'Saturation duration should be positive');

// ═══════════════════════════════════════════════════════════════════════════
// CORE SURVIVAL TESTS — drinkWater, useBed, fall damage, env damage, etc.
// ═══════════════════════════════════════════════════════════════════════════

// --- Test 23: drinkWater restores thirst (backward compat) ---
const ssD1 = new SurvivalSystem();
ssD1.meters.thirst = 40;
ssD1.drinkWater();
assert(ssD1.meters.thirst === 70, `Drinking water should restore thirst to 70, got ${ssD1.meters.thirst}`);

// --- Test 24: drinkWater caps at max ---
const ssD2 = new SurvivalSystem();
ssD2.meters.thirst = 85;
ssD2.drinkWater();
assert(ssD2.meters.thirst === 100, 'Drinking water should cap thirst at max');

// --- Test 25: drinkWater returns false when dead ---
const ssD3 = new SurvivalSystem();
ssD3.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ssD3.drinkWater() === false, 'Dead player cannot drink');

// --- Test 26: useBed restores sleep and health, sets spawn point ---
const ssD4 = new SurvivalSystem();
ssD4.meters.sleep = 30;
ssD4.meters.health = 60;
ssD4.useBed(5, 15, -3);
assert(ssD4.meters.sleep === 90, `Bed should restore sleep to 90, got ${ssD4.meters.sleep}`);
assert(ssD4.meters.health === 80, `Bed should restore health to 80, got ${ssD4.meters.health}`);
assert(ssD4.spawnPoint.x === 5, 'Bed should set spawn X');
assert(ssD4.spawnPoint.y === 15, 'Bed should set spawn Y');
assert(ssD4.spawnPoint.z === -3, 'Bed should set spawn Z');

// --- Test 27: useBed caps at max ---
const ssD5 = new SurvivalSystem();
ssD5.meters.sleep = 80;
ssD5.meters.health = 90;
ssD5.useBed(0, 0, 0);
assert(ssD5.meters.sleep === 100, 'Bed sleep restoration should cap at max');
assert(ssD5.meters.health === 100, 'Bed health restoration should cap at max');

// --- Test 28: useBed returns false when dead ---
const ssD6 = new SurvivalSystem();
ssD6.takeDamage(100, DAMAGE_SOURCES.LAVA);
assert(ssD6.useBed(0, 0, 0) === false, 'Dead player cannot use bed');

// --- Test 29: Fall damage calculation ---
const ssD7 = new SurvivalSystem();
assert(ssD7.calculateFallDamage(1) === 0, '1 block fall should deal no damage');
assert(ssD7.calculateFallDamage(3) === 0, '3 block fall should deal no damage (safe distance)');
assert(ssD7.calculateFallDamage(4) === 2, '4 block fall should deal 2 damage');
assert(ssD7.calculateFallDamage(10) === 14, '10 block fall should deal 14 damage');
assert(ssD7.calculateFallDamage(20) === 34, '20 block fall should deal 34 damage');

// --- Test 30: applyFallDamage applies correct damage ---
const ssD8 = new SurvivalSystem();
ssD8.applyFallDamage(10, 20); // Fell 10 blocks
assert(ssD8.meters.health === 86, `After 10-block fall, health should be 86, got ${ssD8.meters.health}`);

// --- Test 31: Safe fall does nothing ---
const ssD9 = new SurvivalSystem();
ssD9.applyFallDamage(10, 12); // Fell 2 blocks (safe)
assert(ssD9.meters.health === 100, 'Safe fall should not damage health');

// --- Test 32: Environmental damage — lava ---
const ssD10 = new SurvivalSystem();
ssD10.applyEnvironmentalDamage(DAMAGE_SOURCES.LAVA, 2);
assert(ssD10.meters.health === 60, `Lava for 2s should deal 40 damage, health=${ssD10.meters.health}`);

// --- Test 33: Environmental damage — poison (slower) ---
const ssD11 = new SurvivalSystem();
ssD11.applyEnvironmentalDamage(DAMAGE_SOURCES.POISON, 2);
assert(ssD11.meters.health === 90, `Poison for 2s should deal 10 damage, health=${ssD11.meters.health}`);

// --- Test 34: Environmental damage no-ops when dead ---
const ssD12 = new SurvivalSystem();
ssD12.takeDamage(100, DAMAGE_SOURCES.LAVA);
ssD12.applyEnvironmentalDamage(DAMAGE_SOURCES.POISON, 10);
assert(ssD12.meters.health === 0, 'Dead player should not take environmental damage');

// --- Test 35: Desert biome increases thirst depletion ---
const ssD13 = new SurvivalSystem();
ssD13.setThirstMultiplier(2.0);
ssD13.update(10, {});
assert(Math.abs(ssD13.meters.thirst - 60) < 0.1, `Desert thirst after 10s should be ~60, got ${ssD13.meters.thirst.toFixed(2)}`);

// --- Test 36: getNormalizedMeters returns 0-1 values ---
const ssD14 = new SurvivalSystem();
ssD14.meters.health = 50;
ssD14.meters.hunger = 25;
const norm = ssD14.getNormalizedMeters();
assert(Math.abs(norm.health - 0.5) < 0.01, 'Normalized health at 50 should be 0.5');
assert(Math.abs(norm.hunger - 0.25) < 0.01, 'Normalized hunger at 25 should be 0.25');

// --- Test 37: getMeters returns raw values ---
const ssD15 = new SurvivalSystem();
ssD15.meters.health = 73;
const raw = ssD15.getMeters();
assert(raw.health === 73, 'getMeters should return raw health value');

// --- Test 38: canSprint returns true with enough stamina ---
const ssD16 = new SurvivalSystem();
assert(ssD16.canSprint() === true, 'Full stamina should allow sprinting');

// --- Test 39: canSprint returns false with low stamina ---
const ssD17 = new SurvivalSystem();
ssD17.meters.stamina = 0.1;
assert(ssD17.canSprint() === false, 'Near-zero stamina should prevent sprinting');

// --- Test 40: Damage callback fires ---
let damageData = null;
const ssD18 = new SurvivalSystem({
  onDamage: (data) => { damageData = data; },
});
ssD18.takeDamage(15, DAMAGE_SOURCES.FALL);
assert(damageData !== null, 'Damage callback should receive data');
assert(damageData.amount === 15, 'Damage amount should be passed through');
assert(damageData.source === DAMAGE_SOURCES.FALL, 'Damage source should be passed through');

// --- Test 41: Starvation damage when hunger reaches 0 ---
const ssD19 = new SurvivalSystem();
ssD19.meters.hunger = 0;
ssD19.update(5, {});
assert(ssD19.meters.health < 100, 'Starvation should deal health damage');
assert(ssD19.lastDamageSource === DAMAGE_SOURCES.HUNGER, 'Last damage source should be HUNGER');

// --- Test 42: Dehydration damage when thirst reaches 0 ---
const ssD20 = new SurvivalSystem();
ssD20.meters.thirst = 0;
ssD20.update(5, {});
assert(ssD20.meters.health < 100, 'Dehydration should deal health damage');
assert(ssD20.lastDamageSource === DAMAGE_SOURCES.THIRST, 'Last damage source should be THIRST');

// --- Test 43: Low sleep reduces stamina regen ---
const ssD21 = new SurvivalSystem();
ssD21.meters.sleep = 10;
ssD21.meters.stamina = 50;
ssD21.lastStaminaActionTime = 0;
ssD21.update(10, { isSprinting: false, isJumping: false, currentTime: 100 });
assert(ssD21.staminaRegenMultiplier < 0.3, 'Low sleep should reduce stamina regen multiplier');

// --- Test 44: Stamina regenerates when resting ---
const ssD22 = new SurvivalSystem();
ssD22.meters.stamina = 50;
ssD22.lastStaminaActionTime = 0;
ssD22.update(5, { isSprinting: false, isJumping: false, currentTime: 100 });
assert(ssD22.meters.stamina === 100, `Stamina should regenerate to max when resting, got ${ssD22.meters.stamina}`);

// --- Test 45: Stamina does NOT regen immediately after action ---
const ssD23 = new SurvivalSystem();
ssD23.meters.stamina = 70;
ssD23.lastStaminaActionTime = 99;
ssD23.update(1, { isSprinting: false, isJumping: false, currentTime: 99.3 });
assert(ssD23.meters.stamina < 75, 'Stamina should not regen within delay period');

// --- Test 46: Serialize/deserialize round-trip (basic) ---
const ssD24 = new SurvivalSystem();
ssD24.meters.health = 75;
ssD24.meters.hunger = 50;
ssD24.setSpawnPoint(10, 20, -5);
const savedBasic = ssD24.serialize();
assert(savedBasic.meters.health === 75, 'Serialized health should be 75');
assert(savedBasic.spawnPoint.x === 10, 'Serialized spawn X should be 10');

const ssD25 = new SurvivalSystem();
ssD25.deserialize(savedBasic);
assert(ssD25.meters.health === 75, 'Deserialized health should be 75');
assert(ssD25.meters.hunger === 50, 'Deserialized hunger should be 50');
assert(ssD25.spawnPoint.x === 10, 'Deserialized spawn X should be 10');

// --- Test 47: Deserialize clamps values to max ---
const ssD26 = new SurvivalSystem();
ssD26.deserialize({ meters: { health: 200, hunger: -10 } });
assert(ssD26.meters.health === 100, 'Deserialized health should clamp to max');
assert(ssD26.meters.hunger === 0, 'Deserialized hunger should clamp to min 0');

// --- Test 48: Deserialize with null data does nothing ---
const ssD27 = new SurvivalSystem();
ssD27.meters.health = 80;
ssD27.deserialize(null);
assert(ssD27.meters.health === 80, 'Deserialize null should not change state');

// --- Test 49: resetToMax restores everything ---
const ssD28 = new SurvivalSystem();
ssD28.takeDamage(50, DAMAGE_SOURCES.LAVA);
ssD28.update(20, {});
ssD28.resetToMax();
assert(ssD28.meters.health === 100, 'resetToMax should restore health');
assert(ssD28.meters.hunger === 100, 'resetToMax should restore hunger');
assert(ssD28.isDead === false, 'resetToMax should set isDead to false');

// --- Test 50: generateHUDHTML returns valid HTML ---
const ssD29 = new SurvivalSystem();
const html = ssD29.generateHUDHTML();
assert(typeof html === 'string', 'generateHUDHTML should return a string');
assert(html.includes('survival-hud'), 'HTML should contain survival-hud container');
assert(html.includes('Health'), 'HTML should include Health meter');

// --- Test 51: HUD shows death message when dead ---
const ssD30 = new SurvivalSystem();
ssD30.takeDamage(100, DAMAGE_SOURCES.LAVA);
const deadHtml = ssD30.generateHUDHTML();
assert(deadHtml.includes('DIED') || deadHtml.includes('☠️'), 'Dead HUD should show death message');

// --- Test 52: Custom meter config is respected ---
const ssD31 = new SurvivalSystem({
  config: { health: { max: 200 } },
});
assert(ssD31.config.health.max === 200, 'Custom health max should be 200');
assert(ssD31.meters.health === 200, 'Health should start at custom max');

// --- Summary ---
console.log(`\nSurvival System Tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
