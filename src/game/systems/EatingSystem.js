/**
 * Cuubz — the player can eat (S10, `BUGS.md` D-123)
 *
 * ─── WHY THIS IS PART OF A BALANCE PASS ─────────────────────────────────────
 *
 * Before this, the player's *entire* recovery budget was `PlayerVitals`' passive regen:
 * 0.5 HP/s, and only after 8 seconds without being hit. Against a boss in an arena that
 * resets after 60 s of being empty, recovering from 4 HP to 20 costs 8 + 32 = **40 s of
 * complete disengagement** — a fifth of a minute of standing behind a rock, repeated
 * three or four times a fight, with 20 s of margin before the boss resets to full and the
 * whole attempt is discarded. Nobody chose that number. It fell out of two constants set
 * in different stages for different reasons, and it is the tightest number in the game.
 *
 * Eating is the answer, and it is the cheap one: nine food items already exist, the
 * right-click input path already exists on both mouse and touch, and the health meter
 * that shows the result has had a writer since S3. §8.1's rule — do not build a mechanic
 * without the thing that makes it observable — is satisfied on every side.
 *
 * ─── THE COOLDOWN IS THE BALANCE, NOT THE HEAL ──────────────────────────────
 *
 * A stack of 16 cooked meat is 128 HP. Without a cooldown that is applied in one frame
 * and every fight becomes a right-click endurance test. With one, the food carried into
 * the arena is a resource spent *during* the fight, at a rate the boss can outpace, which
 * is what makes carrying it a decision.
 *
 * Local-only, deliberately. Health is not synced (`PlayerVitals` is per-client and
 * `S3` kept it that way), so eating is not either — a guest eats their own food out of
 * their own inventory and the host never hears about it.
 */

import { getFoodHeal } from '../data/FoodValues.js';

/**
 * Seconds between one bite and the next.
 *
 * 1.2 s is roughly the genre's eat animation, and it sets the ceiling on in-combat
 * healing: the best food in the game is a golden apple at 10 HP, so the fastest sustained
 * heal available is ~8 HP/s and only while holding a stack of them. Every boss's opening
 * phase out-damages that, which is the property that matters — food buys a fight back,
 * it does not win one.
 */
export const EAT_COOLDOWN_SECONDS = 1.2;

/** What `tryEat` returns when nothing happened. Frozen so a caller cannot mutate it. */
const NOT_EATEN = Object.freeze({ eaten: false, healed: 0, item: null });

export class EatingSystem {
  /**
   * @param {object} [config]
   * @param {object} [config.inventory] — read for the selected slot, decremented on a bite
   * @param {object} [config.vitals] — `PlayerVitals`
   */
  constructor(config = {}) {
    this._inventory = config.inventory || null;
    this._vitals = config.vitals || null;

    /** Seconds remaining before the next bite is allowed. */
    this._cooldown = 0;
  }

  setInventory(inventory) { this._inventory = inventory; }
  setVitals(vitals) { this._vitals = vitals; }

  get isOnCooldown() { return this._cooldown > 0; }

  /**
   * Per-frame.
   *
   * Subtracts the elapsed time rather than counting up to a target, for the reason
   * `BossEncounter` spells out at its own accumulator: six frames of `1/60` sum to
   * slightly less than `0.1`, and a comparison written the other way round silently
   * lengthens the interval.
   *
   * @param {number} delta — seconds
   */
  update(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    if (this._cooldown > 0) this._cooldown = Math.max(0, this._cooldown - delta);
  }

  /**
   * Eat the selected item, if it is food and if eating would do anything.
   *
   * **The return value decides whether the click was consumed**, which is why every
   * refusal below is explicit rather than a shrug: `BlockInteraction` places a block on
   * any right-click this does not claim, so a false positive here makes stone
   * unplaceable and a false negative eats nothing and plants a dirt block instead.
   *
   * @returns {{eaten: boolean, healed: number, item: string|null}}
   */
  tryEat() {
    if (this._cooldown > 0) return NOT_EATEN;
    if (!this._vitals || this._vitals.isDead) return NOT_EATEN;
    // Refused rather than wasted: a right-click at full health is much more likely to be
    // a misclick than a decision to throw away an apple.
    if (this._vitals.health >= this._vitals.maxHealth) return NOT_EATEN;
    if (!this._inventory || typeof this._inventory.getSelectedItem !== 'function') return NOT_EATEN;

    const item = this._inventory.getSelectedItem();
    if (!item) return NOT_EATEN;

    const heal = getFoodHeal(item.typeId);
    if (heal <= 0) return NOT_EATEN;

    const index = this._inventory.hotbarSlotIndex(this._inventory.selectedHotbarSlot);
    const removed = this._inventory.removeFromSlot(index);
    // Consume first, heal second. If the removal fails there is nothing to pay with, and
    // healing anyway would be a free heal out of an empty slot.
    if (!removed) return NOT_EATEN;

    const healed = this._vitals.heal(heal);
    this._cooldown = EAT_COOLDOWN_SECONDS;
    return { eaten: true, healed, item: item.typeId };
  }
}
