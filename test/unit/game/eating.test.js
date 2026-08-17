/**
 * Cuubz — eating heals, and every food is worth eating (S10, BUGS.md D-123)
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Nine items carry `category: FOOD` and a `foodRestore` value, and until this stage
 * **nothing in the game read either field.** `foodRestore` was a *hunger* number, and
 * hunger went with `SurvivalSystem` in PR 34; the only caller of `PlayerVitals.heal` was
 * the passive regeneration tick. So an apple was a stack of nothing, and three quests
 * said otherwise: Q03 pays out 5 berries as its reward, Q06's whole act is survival
 * preparation, and Q19 asks the player to craft 3 bread before the Frost Serpent.
 *
 * The gate that matters most here is the **ledger** one — every `FOOD` item resolves to a
 * positive heal. A food added to `ItemDefinitions.js` that this module does not
 * understand would be a second silent stack of nothing, which is the exact defect.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NAMED_ITEMS, ITEM_CATEGORIES } from '../../../src/game/data/ItemDefinitions.js';
import { getFoodHeal, isFood, FOOD_HEAL_OVERRIDES } from '../../../src/game/data/FoodValues.js';
import { EatingSystem, EAT_COOLDOWN_SECONDS } from '../../../src/game/systems/EatingSystem.js';
import { PlayerVitals, MAX_HEALTH } from '../../../src/game/entities/PlayerVitals.js';
import { BlockInteraction } from '../../../src/game/systems/BlockInteractionSystem.js';

const FOOD_IDS = Object.keys(NAMED_ITEMS)
  .filter((k) => NAMED_ITEMS[k].category === ITEM_CATEGORIES.FOOD);

describe('the food table', () => {
  it('covers every FOOD item in the registry, with a positive heal', () => {
    expect(FOOD_IDS.length).toBeGreaterThan(5);
    for (const id of FOOD_IDS) {
      expect(getFoodHeal(id), `${id} heals nothing`).toBeGreaterThan(0);
      expect(isFood(id)).toBe(true);
    }
  });

  it('is derived from the registry, not transcribed beside it', () => {
    // `BlockCategories.js` states the rule this repo keeps relearning: compute from the
    // source of truth, never keep a parallel hand-written table. Everything but the
    // deliberate overrides comes straight from `foodRestore`.
    for (const id of FOOD_IDS) {
      if (id in FOOD_HEAL_OVERRIDES) continue;
      expect(getFoodHeal(id)).toBe(NAMED_ITEMS[id].foodRestore);
    }
  });

  it('makes the golden apple the best thing to eat', () => {
    // Its `foodRestore` is 4 — the same as a plain apple — and the field that says it is
    // special is `foodSaturation: 9.6`, the highest in the table, which nothing reads.
    // An override is the honest way to say that in one place.
    const best = Math.max(...FOOD_IDS.map(getFoodHeal));
    expect(getFoodHeal('golden_apple')).toBe(best);
    expect(getFoodHeal('golden_apple')).toBeGreaterThan(getFoodHeal('apple'));
  });

  it('the two foods the quests hand out or ask for are real heals', () => {
    expect(getFoodHeal('berry')).toBeGreaterThan(0);  // Q03's reward
    expect(getFoodHeal('bread')).toBeGreaterThan(0);  // Q19's objective
  });

  it('refuses non-food, including tools and blocks', () => {
    expect(getFoodHeal('iron_sword')).toBe(0);
    expect(getFoodHeal('coal')).toBe(0);
    expect(getFoodHeal(4)).toBe(0);
    expect(getFoodHeal(undefined)).toBe(0);
    expect(isFood('iron_sword')).toBe(false);
  });
});

/** The smallest inventory the system needs: one hotbar slot it can read and decrement. */
function fakeInventory(typeId, count = 3) {
  return {
    slot: typeId === null ? null : { typeId, count },
    removed: 0,
    getSelectedItem() { return this.slot; },
    selectedHotbarSlot: 0,
    hotbarSlotIndex(i) { return i; },
    removeFromSlot() {
      if (!this.slot) return null;
      this.removed++;
      if (this.slot.count > 1) { this.slot.count--; return { typeId: this.slot.typeId, count: 1 }; }
      const item = { ...this.slot };
      this.slot = null;
      return item;
    },
  };
}

describe('EatingSystem', () => {
  let vitals;

  beforeEach(() => {
    vitals = new PlayerVitals();
    vitals.takeDamage(10, 'test', { ignoreArmor: true });
  });

  it('heals, and takes exactly one from the stack', () => {
    const inventory = fakeInventory('bread');
    const eating = new EatingSystem({ inventory, vitals });

    const result = eating.tryEat();

    expect(result.eaten).toBe(true);
    expect(result.healed).toBe(getFoodHeal('bread'));
    expect(vitals.health).toBe(10 + getFoodHeal('bread'));
    expect(inventory.removed).toBe(1);
    expect(inventory.slot.count).toBe(2);
  });

  it('will not eat again until the cooldown elapses', () => {
    // Without this a stack of 16 cooked meat is 128 HP applied in one frame, and every
    // fight becomes a right-click endurance test. The cooldown is what makes the food
    // you carried into the arena a finite resource *during* the fight.
    const eating = new EatingSystem({ inventory: fakeInventory('bread'), vitals });
    expect(eating.tryEat().eaten).toBe(true);
    expect(eating.tryEat().eaten).toBe(false);

    eating.update(EAT_COOLDOWN_SECONDS / 2);
    expect(eating.tryEat().eaten).toBe(false);

    eating.update(EAT_COOLDOWN_SECONDS / 2 + 1e-6);
    expect(eating.tryEat().eaten).toBe(true);
  });

  it('subtracts the interval rather than resetting, so the rate survives 60 fps', () => {
    // The accumulator trap this repo has hit before: six frames of 1/60 sum to less than
    // 0.1. Here the same shape would make the cooldown *longer* than it says.
    const eating = new EatingSystem({ inventory: fakeInventory('bread', 16), vitals });
    eating.tryEat();
    let elapsed = 0;
    while (elapsed < EAT_COOLDOWN_SECONDS + 1 / 60) { eating.update(1 / 60); elapsed += 1 / 60; }
    expect(eating.tryEat().eaten).toBe(true);
  });

  it('refuses at full health, so food is never wasted on a right-click', () => {
    const full = new PlayerVitals();
    const inventory = fakeInventory('bread');
    const eating = new EatingSystem({ inventory, vitals: full });

    expect(eating.tryEat().eaten).toBe(false);
    expect(inventory.removed).toBe(0);
  });

  it('never overheals past max', () => {
    const nicked = new PlayerVitals();
    nicked.takeDamage(1, 'test', { ignoreArmor: true });
    const eating = new EatingSystem({ inventory: fakeInventory('cooked_meat'), vitals: nicked });

    expect(eating.tryEat().healed).toBe(1);
    expect(nicked.health).toBe(MAX_HEALTH);
  });

  it('refuses a non-food selection, so right-click still places blocks', () => {
    // The block-placing path is downstream of this: `BlockInteraction` only skips the
    // place when `tryEat` says it consumed the click. A false positive here would make
    // stone unplaceable.
    const inventory = fakeInventory(4);
    const eating = new EatingSystem({ inventory, vitals });
    expect(eating.tryEat().eaten).toBe(false);
    expect(inventory.removed).toBe(0);
  });

  it('refuses an empty hand and a dead player', () => {
    expect(new EatingSystem({ inventory: fakeInventory(null), vitals }).tryEat().eaten).toBe(false);

    const dead = new PlayerVitals();
    dead.takeDamage(999, 'test', { ignoreArmor: true });
    expect(dead.isDead).toBe(true);
    const inventory = fakeInventory('bread');
    expect(new EatingSystem({ inventory, vitals: dead }).tryEat().eaten).toBe(false);
    expect(inventory.removed).toBe(0);
  });

  it('survives a missing inventory or vitals rather than throwing into the frame', () => {
    expect(new EatingSystem({}).tryEat().eaten).toBe(false);
    expect(() => new EatingSystem({}).update(1 / 60)).not.toThrow();
  });
});

describe('the right-click seam', () => {
  /**
   * `BlockInteraction` with the two things `update()` reads and nothing else. Both
   * `_tryPlaceBlock` and the break path are replaced so the only thing under test is
   * which of the two branches a right-click takes — the seam that, wired the other way
   * round, makes every block in the game unplaceable.
   */
  function stubInteraction() {
    const bi = new BlockInteraction({
      renderer: { raycast: () => null },
      chunkManager: {}, mouse: { leftClick: false, justClickedRight: true }, player: {},
    });
    bi.placed = 0;
    bi._tryPlaceBlock = () => { bi.placed++; };
    return bi;
  }

  it('eats instead of placing when the held item is food', () => {
    const vitals = new PlayerVitals();
    vitals.takeDamage(10, 'test', { ignoreArmor: true });
    const eating = new EatingSystem({ inventory: fakeInventory('bread'), vitals });

    const bi = stubInteraction();
    bi.onUseItem = () => eating.tryEat().eaten;
    bi.update(1 / 60);

    expect(bi.placed).toBe(0);
    expect(vitals.health).toBeGreaterThan(10);
  });

  it('still places when the held item is not food', () => {
    const vitals = new PlayerVitals();
    vitals.takeDamage(10, 'test', { ignoreArmor: true });
    const eating = new EatingSystem({ inventory: fakeInventory(4), vitals });

    const bi = stubInteraction();
    bi.onUseItem = () => eating.tryEat().eaten;
    bi.update(1 / 60);

    expect(bi.placed).toBe(1);
  });

  it('places when no consumer is wired at all, which is every state before init 15a', () => {
    const bi = stubInteraction();
    bi.update(1 / 60);
    expect(bi.placed).toBe(1);
  });

  it('places rather than swallowing the click when the consumer throws', () => {
    const bi = stubInteraction();
    bi.onUseItem = () => { throw new Error('boom'); };
    bi.update(1 / 60);
    expect(bi.placed).toBe(1);
  });
});
