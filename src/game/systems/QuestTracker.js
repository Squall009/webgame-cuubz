/**
 * Cuubz — pooled objective evaluation, by polling (S1)
 *
 * ─── WHY POLLING, AND NOT EVENTS ────────────────────────────────────────────
 *
 * The obvious design is "fire an event when an item is gained". It was rejected in §4.5,
 * and the reason is the shape of what exists:
 *
 *   • `CraftingSystem` has no completion callback.
 *   • `Inventory` exposes exactly one channel, `onSelectionChange`.
 *   • `BlockInteraction` has no break or place callback.
 *
 * Feeding one consumer would mean adding three new event channels to three systems that
 * do not have them, and then keeping four paths in agreement about what counts. Polling
 * needs none of that: it is uniform across mining, crafting, looting, trading and
 * cheating one in from the creative palette, and it has **no ordering hazards** — there
 * is no such thing as an event that arrived before the system was listening.
 *
 * The cost is one pass over 36 slots, twice a second. `state.frameCount % 30` is the
 * existing throttle idiom (`NetworkStep.js:29`).
 *
 * ─── WHAT POLLING GIVES YOU IS NOT WHAT THE POOL NEEDS ──────────────────────
 *
 * A poll answers "how many does this player hold **right now**", which falls when they
 * drop, die, or hand something over. A pool that tracked that would run backwards. So
 * every observation is credited against that contributor's high-water mark and only the
 * positive difference reaches the pool — the arithmetic lives in `QuestState.js`, and
 * this file's whole job is to produce the observation and route the delta.
 *
 * ─── ONE CODE PATH, THREE SITUATIONS ────────────────────────────────────────
 *
 * Single-player, host, and guest all run this identically. The only difference is where
 * the delta goes: the authoritative instance applies it locally; a guest sends it as
 * `QUEST_CONTRIBUTE` and waits to be told the total. §6.4/§6.5 — the host is a player
 * too, and its own contributions go through the same call.
 */

import { OBJECTIVE_KINDS } from '../data/QuestDefinitions.js';

/** Frames between evaluations. 30 at 60 fps is ~0.5 s. */
export const TRACKER_INTERVAL_FRAMES = 30;

/** How close a player must be to satisfy a `visit` objective, in blocks. */
export const VISIT_RADIUS = 12;

export class QuestTracker {
  /**
   * @param {object} config
   * @param {import('./QuestSystem.js').QuestSystem} config.questSystem
   * @param {object} config.inventory — the local player's `Inventory`
   * @param {string} config.contributorId — the local player's **character** id (§4.5)
   * @param {function} [config.sendContribution] — `(questId, key, delta, contributorId)`;
   *   set on a guest, absent in single-player
   */
  constructor(config) {
    this._quests = config.questSystem;
    this._inventory = config.inventory || null;
    this._contributorId = config.contributorId || null;
    this._sendContribution = config.sendContribution || null;
    this._lastEvaluatedFrame = -1;
  }

  setInventory(inventory) {
    this._inventory = inventory;
  }

  setContributorId(id) {
    this._contributorId = id;
  }

  setTransport(sendContribution) {
    this._sendContribution = sendContribution;
  }

  /**
   * Called every frame; does work every `TRACKER_INTERVAL_FRAMES`.
   * @param {number} frameCount
   * @param {{x:number,y:number,z:number}} [playerPosition]
   */
  tick(frameCount, playerPosition) {
    if (frameCount === this._lastEvaluatedFrame) return;
    if (frameCount % TRACKER_INTERVAL_FRAMES !== 0) return;
    this._lastEvaluatedFrame = frameCount;
    this.evaluate(playerPosition);
  }

  /**
   * One evaluation pass over the active quest's objectives.
   *
   * Only the **active** quest is evaluated. A future quest's pool must not fill from
   * items a player happens to be carrying now — Act 3 wants 15 obsidian, and a player
   * who mined some in Act 2 should still have to go to the Lava biome for it. Crediting
   * it early would also mean the quest completes the instant it unlocks, skipping the
   * part of the game it describes.
   */
  evaluate(playerPosition) {
    const def = this._quests.getActiveQuest();
    if (!def) return;
    if (!this._contributorId) return;

    for (const objective of def.objectives) {
      switch (objective.kind) {
        case OBJECTIVE_KINDS.CONTRIBUTE_ITEM:
          this._evaluateItem(def.id, objective);
          break;
        case OBJECTIVE_KINDS.VISIT:
          this._evaluateVisit(def.id, objective, playerPosition);
          break;
        // deliver / boss_kill / seal_state are event-driven and pushed in by the seal
        // and boss systems — there is nothing to poll for them.
        default:
          break;
      }
    }
  }

  /**
   * Count what the local player holds of an objective's items, and credit the delta.
   *
   * `items` is a list because "5 wood_log" means any log — see `QuestDefinitions.js`.
   */
  _evaluateItem(questId, objective) {
    if (!this._inventory || typeof this._inventory.countItem !== 'function') return;

    let held = 0;
    for (const typeId of objective.items) {
      held += this._inventory.countItem(typeId);
    }
    if (held <= 0) return;

    if (this._sendContribution) {
      // A guest measures its own delta locally and reports it, then waits for the
      // host's authoritative total. `observe` on a non-authoritative system still
      // maintains the local high-water mark, which is what stops the same items being
      // reported on every one of the next ticks.
      const delta = this._quests.observe(questId, objective.key, this._contributorId, held);
      if (delta > 0) {
        this._sendContribution(questId, objective.key, delta, this._contributorId);
      }
      return;
    }

    this._quests.observe(questId, objective.key, this._contributorId, held);
  }

  /** A `visit` objective is satisfied by any player getting close enough, once. */
  _evaluateVisit(questId, objective, playerPosition) {
    if (!playerPosition || !objective.position) return;
    const dx = playerPosition.x - objective.position.x;
    const dz = playerPosition.z - objective.position.z;
    const radius = objective.radius || VISIT_RADIUS;
    if (dx * dx + dz * dz > radius * radius) return;

    if (this._sendContribution) {
      this._sendContribution(questId, objective.key, 1, this._contributorId);
      return;
    }
    this._quests.satisfyObjective(questId, objective.key);
  }
}
