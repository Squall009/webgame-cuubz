/**
 * Cuubz — quest state on the wire (S2)
 *
 * The mirror of `InventorySync.js`: one class that owns every quest message in both
 * directions, so no init step has to know which of five types goes which way.
 *
 * ─── THE ASYMMETRY IS THE DESIGN ────────────────────────────────────────────
 *
 * Inventory sync is symmetric — every player owns their own inventory and broadcasts it.
 * Quest state is not. There is **one** quest state, it lives in the host's world, and it
 * is the host's (§5.2). So:
 *
 *   host → guests   QUEST_SYNC     the whole state, on join
 *                   QUEST_UPDATE   one objective's authoritative total, on change
 *                   SEAL_UPDATE    a seal transition
 *   guest → host    QUEST_CONTRIBUTE   "I newly gathered `delta` of this"
 *
 * A guest never decides anything. It measures its own contribution, reports it, and
 * displays whatever it is told. `QuestSystem` is constructed with `authoritative: false`
 * on a guest for exactly this reason, so a guest that derives a completion locally drops
 * it rather than granting itself a title.
 *
 * ─── THE HOST IS A PLAYER, AND USES THIS PATH TOO ───────────────────────────
 *
 * §6.4 is the most important rule in `quest_implementation.md`, and it is a rule because
 * the repo's history is a list of what happens when two paths exist for one thing. The
 * host's own gathering does **not** bypass the wire logic: `attachHost` gives the
 * tracker a `sendContribution` that calls the host's handler directly — the same
 * function the relay's messages land in — rather than a second, local route into
 * `QuestSystem.observe`. One function, two transports.
 */

import { MESSAGE_TYPES } from './Client.js';
import { CuubzLogger } from '../util/Logger.js';
import { migrateQuestState } from '../game/data/QuestState.js';

const _log = CuubzLogger.log;

export class QuestSync {
  /**
   * @param {object} config
   * @param {import('../game/systems/QuestSystem.js').QuestSystem} config.questSystem
   * @param {object} config.client — `MultiplayerClient`
   * @param {object} [config.host] — the `HostManager`, on a host; absent on a guest
   * @param {string} [config.contributorId] — the local character id
   */
  constructor(config) {
    this._quests = config.questSystem;
    this._client = config.client;
    this._host = config.host || null;
    this._contributorId = config.contributorId || null;

    /** `() => void` — fired whenever anything changed, so the HUD can repaint. */
    this.onStateChanged = null;
    /** `(sealId, state) => void` */
    this.onSealChanged = null;

    this._disposed = false;
  }

  get isHost() {
    return !!this._host;
  }

  /**
   * Register the client-side handlers. Safe on a host too: a host receives its own
   * broadcasts back from the relay for some types and must not double-apply them, which
   * is why every handler below is a monotonic write.
   */
  attach() {
    if (!this._client) return;

    this._client.onGame(MESSAGE_TYPES.QUEST_SYNC, (data) => this.handleQuestSync(data));
    this._client.onGame(MESSAGE_TYPES.QUEST_UPDATE, (data) => this.handleQuestUpdate(data));
    this._client.onGame(MESSAGE_TYPES.SEAL_UPDATE, (data) => this.handleSealUpdate(data));
  }

  // ── Guest side ────────────────────────────────────────────────

  /**
   * The whole state, on join. A guest **replaces** rather than merges: it has nothing
   * worth keeping, and merging would mean deciding whose Q07 pool is right, which is a
   * conflict-resolution problem the monotonic design exists to not have.
   */
  handleQuestSync(data) {
    if (this._disposed) return;
    if (!data || !data.questState) return;
    // A host that somehow receives its own sync back must ignore it — its live state is
    // the original and the copy is strictly older.
    if (this.isHost) return;

    // Migrated before it is trusted. A `QUEST_SYNC` comes from the host, but "the host"
    // is another browser: `migrateQuestState` is the same function storage uses, it
    // never throws, and anything unrecognised becomes a fresh valid state rather than a
    // half-shape that breaks the HUD three frames later.
    this._quests.replaceState(migrateQuestState(data.questState));
    _log('[QuestSync] Applied QUEST_SYNC from host');
    this._fireChanged();
  }

  /**
   * One objective's authoritative total.
   *
   * Carries `{ n, target }` and not the delta, so a guest that missed a packet catches
   * up from the next one rather than drifting by whatever it lost. `setObjectiveTotal`
   * is monotonic, so a reordered pair applies the higher and discards the lower.
   */
  handleQuestUpdate(data) {
    if (this._disposed) return;
    if (!data || typeof data.questId !== 'string' || typeof data.objectiveKey !== 'string') return;
    if (this.isHost) return;

    const changed = this._quests.setObjectiveTotal(
      data.questId, data.objectiveKey, data.n, data.target
    );
    if (changed) this._fireChanged();
  }

  /** A seal transition. `setSeal` refuses to move backwards, so replays are no-ops. */
  handleSealUpdate(data) {
    if (this._disposed) return;
    if (!data || typeof data.sealId !== 'string' || typeof data.state !== 'string') return;
    if (this.isHost) return;

    if (!this._quests.setSeal(data.sealId, data.state)) return;

    const seal = this._quests.getState().seals[data.sealId];
    if (seal && Array.isArray(data.brokenBy)) seal.brokenBy = [...data.brokenBy];
    if (seal && Number.isFinite(data.brokenAt)) seal.brokenAt = data.brokenAt;

    if (this.onSealChanged) {
      try { this.onSealChanged(data.sealId, data.state); } catch (e) { console.warn('[QuestSync] onSealChanged threw:', e && e.message); }
    }
    this._fireChanged();
  }

  /**
   * The tracker's transport on a **guest**: put the delta on the wire and wait.
   *
   * Returns nothing and applies nothing locally beyond the high-water mark the tracker
   * already moved — a guest that credited its own pool would show a total the host has
   * not agreed to, and would then be corrected by the next `QUEST_UPDATE`, which reads
   * as a counter jumping backwards.
   */
  sendContribution(questId, objectiveKey, delta, contributorId) {
    if (this._disposed || !this._client) return;
    this._client.sendQuestContribute(
      questId, objectiveKey, delta, contributorId || this._contributorId
    );
  }

  // ── Host side ─────────────────────────────────────────────────

  /**
   * The tracker's transport on the **host**: call the host's own handler directly.
   *
   * This is §6.4 made mechanical. The host's gathering goes through
   * `handleQuestContribute` — the same validation, the same pooling, the same
   * `QUEST_UPDATE` broadcast — as any guest's, with the socket replaced by a function
   * call. If the host applied its own contributions straight to `QuestSystem` instead,
   * there would be two ways for a pool to move and they would disagree the first time
   * one of them changed.
   */
  hostContribution(questId, objectiveKey, delta, contributorId) {
    if (this._disposed || !this._host) return;
    this._host.handleLocalQuestContribute({
      questId,
      objectiveKey,
      delta,
      contributorId: contributorId || this._contributorId,
    });
  }

  /** The transport to hand `QuestTracker`, whichever side this is. */
  getTransport() {
    return this.isHost
      ? (q, k, d, c) => this.hostContribution(q, k, d, c)
      : (q, k, d, c) => this.sendContribution(q, k, d, c);
  }

  _fireChanged() {
    if (!this.onStateChanged) return;
    try { this.onStateChanged(); } catch (e) { console.warn('[QuestSync] onStateChanged threw:', e && e.message); }
  }

  dispose() {
    this._disposed = true;
    this.onStateChanged = null;
    this.onSealChanged = null;
  }
}
