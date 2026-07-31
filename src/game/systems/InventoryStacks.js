/**
 * Cuubz — stack mutation: add, remove, swap, split (PR 23)
 *
 * Split out of `src/game/systems/InventorySystem.js`. A PROTOTYPE MIXIN: `this` is still
 * the `Inventory` instance and no call site changed (decision 44). Every body here is the
 * one it had as a class member except `splitStack`, whose D-65 fix is described below.
 *
 * FIELDS CROSSING THIS BOUNDARY: 2 — `slots` and `totalSlots`. This is the *write* half of
 * those two fields; `InventoryQuery.js` is the read-only half. Every mutation of
 * `this.slots` that is not a direct `setSlot`/`clearSlot` happens in this file, which is
 * what makes "did an item get created or destroyed?" a question about one file.
 *
 * These methods also call `this.getMaxStack`, `this.itemsMatch` (`InventoryItemTypes.js`)
 * and `this._notifySlotChange` (`InventorySystem.js`) — prototype methods, which the mixin
 * plumbing guarantees are on the same object.
 *
 * IMPORT DIRECTION: imported BY `InventorySystem.js`, imports nothing at all. `src/` has
 * no import cycles and must not gain one (D-28).
 *
 * ─── D-65 — splitStack could silently destroy items ─────────────────────────
 *
 * `swapSlots` bounds-checks both indices against `totalSlots`; its sibling `splitStack`
 * checked neither. `splitStack(0, 999)` wrote `this.slots[999]`, growing the fixed-size
 * array past `totalSlots` and leaving 963 holes behind it. `serialize()` iterates
 * `i < this.totalSlots`, so the split-off items were **gone on the next save** with no
 * error anywhere. A negative `to` was worse in kind and identical in outcome: it defines a
 * named property on the array object, which `serialize` also never visits.
 *
 * The fix is `swapSlots`'s own guard, copied verbatim rather than reinvented — the two
 * methods take the same argument pair from the same places and had no business disagreeing
 * about what a valid index is.
 *
 * Second half of the same row: when the destination stack was already full, `actualMove`
 * came out 0, nothing moved, and the method still fired `_notifySlotChange` **twice** and
 * returned `true` — a no-op reported to the caller as a successful split, and two spurious
 * UI repaints. It now returns `false` and notifies nothing.
 *
 * The guard is `<= 0`, not `=== 0`. A destination stack holding more than its own
 * `maxStack` — which `setSlot` and `deserialize` both permit, neither caps `count` —
 * makes `space` negative, and a negative `actualMove` ran the transfer *backwards*:
 * `fromSlot.count -= actualMove` grew the source. `<= 0` is the same guard for the case
 * D-65 names and closes that one too.
 *
 * NOTE ON REACH: D-65 is filed as reachable from the DOM datasets in
 * `src/ui/overlays/InventoryDrag.js`. As of this PR that is not yet true —
 * `splitStack` has **no call site in `src/` at all**; only `test/test_inventory.js` calls
 * it. It is public API on a class the whole game holds, the sibling it disagrees with IS
 * called from those datasets (`InventoryDrag.js:268`), and the fix is four lines, so it is
 * fixed rather than deferred. The reach claim is corrected here, not in the fix.
 */

export const StackMethods = {
  // ============================================================
  // The stack ceiling — D-76
  // ============================================================

  /**
   * ─── D-76 — THE ONE PLACE `count` IS BOUNDED ABOVE ────────────────────────
   *
   * `addItem`, `addToSlot` and `splitStack` above have always respected `getMaxStack`.
   * The two doors that bypass every one of them did not: `InventorySystem.setSlot(i,
   * {typeId, count})` stored whatever it was handed, and `Inventory.deserialize` clamped
   * with `Math.max(1, count)` — a LOWER bound only. So an over-full stack could be
   * created (a stale `data-slot` in `InventoryDrag.js`, a malformed `InventorySync`
   * payload) and, once created, it SURVIVED a save/load round trip, because nothing on
   * the way back down looked at the maximum either. Downstream, `space = maxStack -
   * slot.count` in this very file goes negative; D-65's `actualMove <= 0` guard catches
   * that and refuses the split, but it does not repair the stack — the inventory stays
   * wrong and the player simply cannot split it, with no message.
   *
   * It lives HERE, in the write half of `slots`, and not next to `setSlot`, for the
   * reason this file's header gives: "did an item get created or destroyed?" is a
   * question about one file. Capping a count destroys items. It is reached as
   * `this._capCount(...)` / `inv._capCount(...)` through the prototype mixin, exactly as
   * `this.getMaxStack` is.
   *
   * ─── THE DATA DECISION, MADE EXPLICITLY ───────────────────────────────────
   *
   * Enforcing a cap changes what an existing save deserializes to, so it is a data
   * question and not merely a validation one. Three options were on the table:
   *
   *   1. Leave it. The corruption persists forever and spreads through every save.
   *   2. Refuse to load a save containing an over-full stack. The player loses the WHOLE
   *      world to one bad number. Strictly worse than 3.
   *   3. **Clamp on read, and say so out loud.** Chosen. It is lossy — items above the
   *      maximum are destroyed and cannot be recovered — but it is bounded loss on a
   *      state that was never reachable by playing, and it converges the save on
   *      something the rest of the code can reason about.
   *
   * The lossiness is the whole reason this is not silent. A `console.warn` naming the
   * call site, the item, the old count and the new one is the difference between "the
   * game quietly ate 9,935 stone" and a line an operator can paste into a bug report. It
   * is a warn and not a throw because a throw here would take down `deserialize`, which
   * is option 2 wearing a different hat.
   *
   * Only the UPPER bound is applied here. The lower bound stays where it already was
   * (`Math.max(1, …)` in `deserialize`) — moving it would change `setSlot`'s behaviour
   * for counts of 0, which is a separate question with its own call sites.
   *
   * @param {{typeId: *, count: number}|null|undefined} item — mutated IN PLACE when it is
   *   over the maximum, so the object the caller kept a reference to and the object the
   *   inventory stores cannot disagree.
   * @param {string} where — call-site label, so the warning names the door it came through.
   * @returns {boolean} true if a clamp was applied.
   */
  _capCount(item, where) {
    if (!item || typeof item.count !== 'number') return false;
    const max = this.getMaxStack(item.typeId);
    if (!(item.count > max)) return false;
    console.warn(
      `[Inventory] ${where}: ${JSON.stringify(item.typeId)} count ${item.count} exceeds ` +
      `its max stack of ${max} — clamped to ${max}. ${item.count - max} item(s) discarded. ` +
      'This state is not reachable by playing; the source is a malformed save, an ' +
      'InventorySync payload or a stale data-slot (BUGS.md D-76).'
    );
    item.count = max;
    return true;
  },

  // ============================================================
  // Add Items
  // ============================================================

  /**
   * Add an item to inventory, stacking on existing stacks first.
   * @param {*} typeId - Block type ID (number) or named item (string)
   * @param {number} count - Number of items to add
   * @returns {object} { added: number, remaining: number }
   */
  addItem(typeId, count = 1) {
    if (count <= 0) return { added: 0, remaining: 0 };

    let remaining = count;
    const maxStack = this.getMaxStack(typeId);

    // First pass: try to stack onto existing slots
    for (let i = 0; i < this.totalSlots; i++) {
      if (remaining <= 0) break;
      const slot = this.slots[i];
      if (slot && this.itemsMatch(slot.typeId, typeId)) {
        const space = maxStack - slot.count;
        if (space > 0) {
          const add = Math.min(space, remaining);
          slot.count += add;
          remaining -= add;
          this._notifySlotChange(i);
        }
      }
    }

    // Second pass: fill empty slots
    for (let i = 0; i < this.totalSlots; i++) {
      if (remaining <= 0) break;
      if (this.slots[i] === null) {
        const add = Math.min(maxStack, remaining);
        this.slots[i] = { typeId, count: add };
        remaining -= add;
        this._notifySlotChange(i);
      }
    }

    return { added: count - remaining, remaining };
  },

  /**
   * Add an item to a specific slot (used for drag/drop)
   */
  addToSlot(index, typeId, count = 1) {
    if (index < 0 || index >= this.totalSlots) return false;
    const maxStack = this.getMaxStack(typeId);

    const slot = this.slots[index];
    if (slot === null) {
      this.slots[index] = { typeId, count: Math.min(maxStack, count) };
      this._notifySlotChange(index);
      return true;
    }
    if (this.itemsMatch(slot.typeId, typeId)) {
      const space = maxStack - slot.count;
      if (space > 0) {
        slot.count += Math.min(space, count);
        this._notifySlotChange(index);
        return true;
      }
    }
    return false;
  },

  // ============================================================
  // Remove Items
  // ============================================================

  /**
   * Remove items by type. Removes from most-full stacks first.
   * @param {*} typeId - Block type ID or named item
   * @param {number} count - Number to remove
   * @returns {object} { removed: number, remaining: number } (remaining = still in inventory)
   */
  removeItem(typeId, count = 1) {
    if (count <= 0) return { removed: 0 };

    let remainingToRemove = count;

    // Find all matching slots and sort by count descending (remove from fullest first)
    const matchingSlots = [];
    for (let i = 0; i < this.totalSlots; i++) {
      const slot = this.slots[i];
      if (slot && this.itemsMatch(slot.typeId, typeId)) {
        matchingSlots.push({ index: i, count: slot.count });
      }
    }
    matchingSlots.sort((a, b) => b.count - a.count);

    for (const ms of matchingSlots) {
      if (remainingToRemove <= 0) break;
      const slot = this.slots[ms.index];
      if (!slot) continue;

      const remove = Math.min(slot.count, remainingToRemove);
      slot.count -= remove;
      remainingToRemove -= remove;

      if (slot.count <= 0) {
        this.slots[ms.index] = null;
      }
      this._notifySlotChange(ms.index);
    }

    return { removed: count - remainingToRemove };
  },

  /**
   * Remove one item from a specific slot. Returns the item or null.
   */
  removeFromSlot(index) {
    if (index < 0 || index >= this.totalSlots) return null;
    const slot = this.slots[index];
    if (!slot) return null;

    // If stack > 1, decrement count
    if (slot.count > 1) {
      slot.count--;
      this._notifySlotChange(index);
    } else {
      // Remove the slot entirely
      const item = { ...slot };
      this.slots[index] = null;
      this._notifySlotChange(index);
      return item;
    }
    return { typeId: slot.typeId, count: 1 };
  },

  /**
   * Clear all items from inventory
   */
  clear() {
    for (let i = 0; i < this.totalSlots; i++) {
      if (this.slots[i] !== null) {
        this.slots[i] = null;
        this._notifySlotChange(i);
      }
    }
    return true;
  },

  // ============================================================
  // Drag and Drop (UI Integration)
  // ============================================================

  /**
   * Swap two slots. Returns true if swap occurred.
   */
  swapSlots(from, to) {
    if (from === to) return false;
    if (from < 0 || from >= this.totalSlots || to < 0 || to >= this.totalSlots) return false;

    const temp = this.slots[from];
    this.slots[from] = this.slots[to];
    this.slots[to] = temp;

    this._notifySlotChange(from);
    this._notifySlotChange(to);
    return true;
  },

  /**
   * Split a stack — move half to another slot
   */
  splitStack(from, to) {
    // D-76, second row: `swapSlots` above opens with `if (from === to) return false;` and
    // this method did not, though both take the same argument pair from the same places.
    // A same-slot split read `fromSlot` and `toSlot` as the SAME object, so
    // `fromSlot.count -= actualMove` and `toSlot.count += actualMove` cancelled — and the
    // method then fired `_notifySlotChange(from)` and `_notifySlotChange(to)` for the one
    // slot and returned `true`. A no-op reported as a successful split, with two spurious
    // repaints: the exact shape D-65's second half already fixed for a full destination.
    // Reachable from a stale `data-slot` attribute in `InventoryDrag.js`, which is where
    // `swapSlots` gets its own identical guard's workout.
    if (from === to) return false;
    // D-65: the same bounds guard `swapSlots` has, for the same two arguments. Without it
    // an out-of-range `to` wrote past `totalSlots` and `serialize()` dropped the items.
    if (from < 0 || from >= this.totalSlots || to < 0 || to >= this.totalSlots) return false;

    const fromSlot = this.slots[from];
    if (!fromSlot || fromSlot.count <= 1) return false;

    const toSlot = this.slots[to];
    if (toSlot && !this.itemsMatch(toSlot.typeId, fromSlot.typeId)) return false;

    const moveCount = Math.ceil(fromSlot.count / 2);
    const maxStack = this.getMaxStack(fromSlot.typeId);

    let space = maxStack;
    if (toSlot) {
      space = maxStack - toSlot.count;
    }
    const actualMove = Math.min(moveCount, space);

    // D-65, second half: a full destination leaves nothing to move. Reporting that as a
    // successful split — and repainting both slots — was a lie to the caller.
    if (actualMove <= 0) return false;

    fromSlot.count -= actualMove;
    if (fromSlot.count <= 0) {
      this.slots[from] = null;
    }

    if (!toSlot) {
      this.slots[to] = { typeId: fromSlot.typeId, count: actualMove };
    } else {
      toSlot.count += actualMove;
    }

    this._notifySlotChange(from);
    this._notifySlotChange(to);
    return true;
  },
};
