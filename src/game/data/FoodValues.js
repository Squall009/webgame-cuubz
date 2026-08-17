/**
 * Cuubz — what a food item is worth, in health (S10, `BUGS.md` D-123)
 *
 * ─── THE FIELD EXISTED AND NOTHING READ IT ──────────────────────────────────
 *
 * `ItemDefinitions.js` gives nine items `category: FOOD` and a `foodRestore` value. Both
 * fields were written for the hunger bar, and hunger went with `SurvivalSystem` in PR 34
 * — so from that PR until this one, **the only caller of `PlayerVitals.heal` was the
 * passive regeneration tick**, and eating did not exist as an action at all. An apple was
 * a stack of nothing.
 *
 * Three quests disagree: Q03 pays out 5 berries as its reward, Q06 is a whole quest about
 * preparing to survive, and Q19 asks the player to craft 3 bread before the Frost
 * Serpent. So `foodRestore` becomes **health restored**, which is the only meaning left
 * for it in a game with no hunger.
 *
 * ─── DERIVED, NOT TRANSCRIBED ───────────────────────────────────────────────
 *
 * `BlockCategories.js` states the rule at length and D-121 is the third time this repo
 * paid for breaking it: never keep a hand-written table beside the source of truth. So
 * there is no list of foods here — the table below is the *overrides*, and everything
 * else falls out of `NAMED_ITEMS`. `test/unit/game/eating.test.js` asserts every `FOOD`
 * item resolves to a positive heal, so a food added to the registry that this file does
 * not understand fails a test instead of becoming the same silent nothing.
 */

import { NAMED_ITEMS, ITEM_CATEGORIES } from './ItemDefinitions.js';

/**
 * The one item whose `foodRestore` does not say what it is worth.
 *
 * A golden apple restores 4, the same as a plain apple; the field that marks it out is
 * `foodSaturation: 9.6`, the highest in the table, and nothing reads that. Rather than
 * invent a saturation→health formula for a single row, this states the intent directly:
 * half a health bar, and the thing you save for a boss. `MAX_HEALTH` is 20.
 */
export const FOOD_HEAL_OVERRIDES = Object.freeze({
  golden_apple: 10,
});

/** @param {*} typeId @returns {boolean} — is this a named FOOD item? */
export function isFood(typeId) {
  if (typeof typeId !== 'string') return false;
  const def = NAMED_ITEMS[typeId];
  return !!def && def.category === ITEM_CATEGORIES.FOOD;
}

/**
 * Health restored by eating one of `typeId`. 0 for anything that is not food.
 *
 * Block items have numeric type ids and hit the `typeof` guard in `isFood`, which is why
 * a hotbar full of stone cannot be eaten by accident.
 *
 * @param {*} typeId
 * @returns {number}
 */
export function getFoodHeal(typeId) {
  if (!isFood(typeId)) return 0;
  if (typeId in FOOD_HEAL_OVERRIDES) return FOOD_HEAL_OVERRIDES[typeId];
  const restore = NAMED_ITEMS[typeId].foodRestore;
  return Number.isFinite(restore) && restore > 0 ? restore : 0;
}
