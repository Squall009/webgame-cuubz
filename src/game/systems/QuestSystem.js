/**
 * Cuubz — the quest state machine (S1)
 *
 * ─── WHAT IT OWNS, AND WHAT IT DOES NOT ─────────────────────────────────────
 *
 * It owns: which quest is active, whether an objective is met, what a completed quest
 * unlocks, and which titles have been earned. It reads and mutates one `questState`
 * object (§4.1) and nothing else.
 *
 * **No DOM and no network.** `src/ui/hud/QuestTracker.js` reads this and writes the HUD;
 * `src/multiplayer/QuestSync.js` reads this and puts it on the wire. Neither direction
 * is inverted, so this file runs unchanged in Node, in single-player, on a host and on a
 * guest — and §6.5's rule that single-player and multiplayer share one code path is a
 * property of the dependency direction rather than a thing anyone has to remember.
 *
 * ─── ADVANCEMENT IS DEFINITION-DRIVEN ───────────────────────────────────────
 *
 * The function this replaces was `WorldManager.advanceQuest`, whose entire body was
 * `completed = nextStage >= 5` under the comment *"simplified — actual quest system will
 * define stages"*. Every quest in the game was five stages long, whatever its
 * definition said. Here a quest completes when **its own objectives** are met, and what
 * happens next is what **its own rewards** say.
 *
 * ─── THE HOST IS THE AUTHORITY, AND SO IS SINGLE-PLAYER ─────────────────────
 *
 * `applyRewards` grants items, titles and unlocks; on a guest, none of that is theirs to
 * decide. So the system carries an `authoritative` flag: a guest's instance evaluates
 * and displays, and drops any completion it derives locally in favour of the host's
 * `QUEST_SYNC`. Single-player is authoritative, which is why it needs no special case.
 */

import {
  createQuestState,
  ensureQuest,
  ensureObjective,
  isObjectiveComplete,
  completeQuest,
  creditObservation,
  applyPooledDelta,
  grantTitle,
  setSealState,
  allSealsBroken,
} from '../data/QuestState.js';
import { QUEST_DEFINITIONS, QUEST_ORDER, getQuest, OBJECTIVE_KINDS } from '../data/QuestDefinitions.js';
import { TITLE_DEFINITIONS } from '../data/TitleDefinitions.js';

export class QuestSystem {
  /**
   * @param {object} [config]
   * @param {object} [config.questState] — the live state; a fresh one if omitted
   * @param {boolean} [config.authoritative=true] — false on a guest (§5.2)
   * @param {object} [config.inventory] — for `item` rewards; optional
   */
  constructor(config = {}) {
    this._state = config.questState || createQuestState();
    this._authoritative = config.authoritative !== false;
    this._inventory = config.inventory || null;

    /** `(questId, def) => void` — a quest completed. */
    this.onQuestCompleted = null;
    /** `(questId, def) => void` — a new quest became active. */
    this.onQuestStarted = null;
    /** `(questId, objectiveKey, {n, target}) => void` — a pool moved. */
    this.onObjectiveProgress = null;
    /** `(titleId, def) => void` — a title was earned. */
    this.onTitleGranted = null;
    /** `() => void` — Q28's `complete` reward. The end of the game. */
    this.onGameComplete = null;

    this._ensureActiveQuest();
  }

  // ── State access ──────────────────────────────────────────────

  /** The live state object, by reference — `saveWorldState` serializes it. */
  getState() {
    return this._state;
  }

  /**
   * Replace the whole state — a guest applying the host's `QUEST_SYNC`.
   * Fires no callbacks: the host has already decided, and re-deriving completions here
   * would grant a guest's local inventory the host's rewards.
   */
  replaceState(questState) {
    this._state = questState;
    this._ensureActiveQuest();
  }

  get isAuthoritative() {
    return this._authoritative;
  }

  setInventory(inventory) {
    this._inventory = inventory;
  }

  // ── The active quest ──────────────────────────────────────────

  /** @returns {object|null} the active quest's definition */
  getActiveQuest() {
    return getQuest(this._state.activeQuestId);
  }

  /** @returns {object|null} the active quest's stored entry (pools and all) */
  getActiveEntry() {
    const id = this._state.activeQuestId;
    if (!id) return null;
    const def = getQuest(id);
    if (!def) return null;
    return ensureQuest(this._state, id, def.stage);
  }

  /**
   * Is a quest available to be worked on? Every id in `requires` must be completed.
   * A quest whose prerequisites are unmet is not merely hidden — its objectives are not
   * evaluated, so a player who happens to be carrying 20 obsidian in Act 1 does not
   * silently bank Act 3's pool.
   */
  isAvailable(questId) {
    const def = getQuest(questId);
    if (!def) return false;
    if (this.isCompleted(questId)) return false;
    return def.requires.every((req) => this.isCompleted(req));
  }

  isCompleted(questId) {
    return !!this._state.quests[questId]?.completed;
  }

  /**
   * Pick the active quest: the first in stage order that is available.
   *
   * Called on construction, after every completion and after a `QUEST_SYNC`. Deriving it
   * rather than storing it as the only truth means a state whose `activeQuestId` points
   * at a completed or unknown quest self-corrects instead of stalling — which is what an
   * older save, a definition rename or a partial sync would otherwise produce.
   */
  _ensureActiveQuest() {
    const current = this._state.activeQuestId;
    if (current && getQuest(current) && this.isAvailable(current)) {
      // Create the pools even when the active quest has not changed. They are what
      // `objectivesComplete` counts, and a quest whose second objective did not exist
      // yet would complete on its first — Q01 finishing on five logs with the ten dirt
      // never asked for.
      this._syncObjectiveTargets(current);
      return current;
    }

    for (const id of QUEST_ORDER) {
      if (this.isAvailable(id)) {
        const changed = this._state.activeQuestId !== id;
        this._state.activeQuestId = id;
        this._syncObjectiveTargets(id);
        if (changed && this.onQuestStarted) {
          try { this.onQuestStarted(id, getQuest(id)); } catch (e) { console.warn('[QuestSystem] onQuestStarted threw:', e && e.message); }
        }
        return id;
      }
    }

    // Everything is done. Q28 is complete and the world is remade.
    this._state.activeQuestId = null;
    return null;
  }

  /**
   * Create each of the quest's objective pools with the target its **definition** gives.
   * A stored target from an older definition is corrected here rather than honoured
   * forever, so re-balancing a quest does not need a migration.
   */
  _syncObjectiveTargets(questId) {
    const def = getQuest(questId);
    if (!def || this.isCompleted(questId)) return;
    for (const objective of def.objectives) {
      ensureObjective(this._state, questId, objective.key, objective.count || 1);
    }
  }

  // ── Progress ──────────────────────────────────────────────────

  /**
   * Credit an observation of what one contributor holds, against their high-water mark.
   *
   * The tracker's entry point. Returns the delta credited so the caller can decide
   * whether to put a `QUEST_CONTRIBUTE` on the wire — a zero means the observation was
   * not a new high and there is nothing to tell anyone about.
   *
   * @returns {number} the credited delta
   */
  observe(questId, objectiveKey, contributorId, observed) {
    if (!this.isAvailable(questId)) return 0;
    const objective = this._findObjective(questId, objectiveKey);
    if (!objective) return 0;

    const credited = creditObservation(
      this._state, questId, objectiveKey, contributorId, observed, objective.count || 1
    );
    if (credited > 0) this._afterProgress(questId, objectiveKey);
    return credited;
  }

  /**
   * Apply a delta from elsewhere — a guest's `QUEST_CONTRIBUTE` arriving at the host, or
   * the host's `QUEST_UPDATE` arriving at a guest.
   */
  applyDelta(questId, objectiveKey, delta, contributorId = null) {
    // The same gate `observe` applies, and for the same reason — but this is the path a
    // *remote* delta takes, so it is also the only thing standing between a client and
    // any quest in the game. Without it a guest could send 15 sandstone at Q22 in Act 1
    // and complete it, unlocking Q23, Q24 and the seal behind them.
    if (!this.isAvailable(questId)) return { credited: 0 };
    const objective = this._findObjective(questId, objectiveKey);
    if (!objective) return { credited: 0 };
    const result = applyPooledDelta(
      this._state, questId, objectiveKey, delta, objective.count || 1, contributorId
    );
    if (result.credited > 0) this._afterProgress(questId, objectiveKey);
    return result;
  }

  /**
   * Set a pool to an authoritative absolute total — a guest applying `QUEST_UPDATE`.
   * Monotonic like everything else: a lower figure than the one already held is a stale
   * packet and is ignored.
   */
  setObjectiveTotal(questId, objectiveKey, n, target) {
    const def = getQuest(questId);
    if (!def) return false;
    const pool = ensureObjective(this._state, questId, objectiveKey, target || 0);
    if (!pool) return false;
    if (n <= pool.n) return false;
    pool.n = n;
    if (target) pool.target = target;
    this._afterProgress(questId, objectiveKey);
    return true;
  }

  /** Mark a `boss_kill` or `seal_state` objective satisfied. */
  satisfyObjective(questId, objectiveKey) {
    const objective = this._findObjective(questId, objectiveKey);
    if (!objective) return false;
    const pool = ensureObjective(this._state, questId, objectiveKey, objective.count || 1);
    if (!pool || isObjectiveComplete(pool)) return false;
    pool.n = pool.target > 0 ? pool.target : 1;
    this._afterProgress(questId, objectiveKey);
    return true;
  }

  _findObjective(questId, objectiveKey) {
    const def = getQuest(questId);
    if (!def) return null;
    return def.objectives.find((o) => o.key === objectiveKey) || null;
  }

  _afterProgress(questId, objectiveKey) {
    const pool = this._state.quests[questId]?.objectives?.[objectiveKey];
    if (pool && this.onObjectiveProgress) {
      try {
        this.onObjectiveProgress(questId, objectiveKey, { n: pool.n, target: pool.target });
      } catch (e) {
        console.warn('[QuestSystem] onObjectiveProgress threw:', e && e.message);
      }
    }
    if (this.objectivesComplete(questId)) this.tryComplete(questId);
  }

  /**
   * Are all of a quest's objectives met?
   *
   * Iterates the **definition's** objectives, not the stored pools. `QuestState`'s
   * `areObjectivesComplete` can only see pools that exist, and a pool is created the
   * first time something is credited to it — so a quest whose second objective had not
   * been touched yet looked, to that function, like a quest with one objective that was
   * finished. Q01 completed on five logs and never asked for the ten dirt.
   *
   * The definition is the authority on what a quest requires. This is where that is
   * enforced.
   */
  objectivesComplete(questId) {
    const def = getQuest(questId);
    if (!def) return false;
    if (this.isCompleted(questId)) return true;
    if (def.objectives.length === 0) return false;

    const stored = this._state.quests[questId]?.objectives || {};
    return def.objectives.every((o) => {
      const pool = stored[o.key];
      if (!pool) return false;
      return isObjectiveComplete(pool);
    });
  }

  // ── Completion ────────────────────────────────────────────────

  /**
   * Complete a quest if its objectives are met. Idempotent, and a no-op on a guest,
   * whose completions come from the host.
   *
   * @returns {boolean} whether it completed on this call
   */
  tryComplete(questId) {
    if (this.isCompleted(questId)) return false;
    if (!this.objectivesComplete(questId)) return false;
    if (!this._authoritative) return false;

    const def = getQuest(questId);
    if (!def) return false;

    completeQuest(this._state, questId);
    this._applyRewards(def);

    if (this.onQuestCompleted) {
      try { this.onQuestCompleted(questId, def); } catch (e) { console.warn('[QuestSystem] onQuestCompleted threw:', e && e.message); }
    }

    this._ensureActiveQuest();
    return true;
  }

  /**
   * Grant a quest's rewards.
   *
   * `unlock` is deliberately a no-op on the state: the next quest is derived from
   * `requires` + what is completed (`_ensureActiveQuest`), so an `unlock` reward and a
   * `requires` entry saying the same thing cannot disagree. It stays in the definitions
   * because the storyline is written in those terms and the quest log shows it.
   */
  _applyRewards(def) {
    for (const reward of def.rewards) {
      switch (reward.kind) {
        case 'title':
          if (grantTitle(this._state, reward.id) && this.onTitleGranted) {
            try { this.onTitleGranted(reward.id, TITLE_DEFINITIONS[reward.id] || null); } catch (e) { console.warn('[QuestSystem] onTitleGranted threw:', e && e.message); }
          }
          break;

        case 'item':
          if (this._inventory && typeof this._inventory.addItem === 'function') {
            try {
              this._inventory.addItem(reward.item, reward.count || 1);
            } catch (e) {
              console.warn('[QuestSystem] reward item could not be added:', e && e.message);
            }
          }
          break;

        case 'complete':
          if (this.onGameComplete) {
            try { this.onGameComplete(); } catch (e) { console.warn('[QuestSystem] onGameComplete threw:', e && e.message); }
          }
          break;

        case 'unlock':
          break;

        default:
          console.warn(`[QuestSystem] Unknown reward kind: ${reward.kind}`);
      }
    }
  }

  // ── Seals ─────────────────────────────────────────────────────

  /**
   * Advance a seal, and satisfy any `seal_state` objective waiting on it.
   *
   * Also the one place "all five broken" is detected: the finale opens the moment the
   * fifth seal breaks, which is what makes the spire — standing inert since world
   * generation — finally answer to something (§3.7).
   */
  setSeal(sealId, state) {
    if (!setSealState(this._state, sealId, state)) return false;

    if (sealId === 'finale') {
      // The finale's terminal state is `defeated`, and reaching it is the end of the
      // game rather than the opening of anything.
      if (state === 'defeated') this._quests_onFinaleDefeated();
      return true;
    }

    if (state === 'broken') {
      if (!this._state.seals[sealId].brokenAt) this._state.seals[sealId].brokenAt = Date.now();
      // §3.7 — the spire has been standing there since world generation, inert, and
      // this is the moment it answers to something. `setFinaleState` enforces the
      // precondition again on its own, so a second caller cannot skip it.
      if (allSealsBroken(this._state)) setSealState(this._state, 'finale', 'open');
    }

    const activeId = this._state.activeQuestId;
    if (activeId) {
      const def = getQuest(activeId);
      const objective = def?.objectives.find(
        (o) => o.kind === OBJECTIVE_KINDS.SEAL_STATE && o.seal === sealId && o.state === state
      );
      if (objective) this.satisfyObjective(activeId, objective.key);
    }
    return true;
  }

  /**
   * The Corruption Overlord is dead. Q28's own `complete` reward fires the end of the
   * game; this only stamps the state that outlives it.
   */
  _quests_onFinaleDefeated() {
    if (!this._state.finale.defeatedAt) this._state.finale.defeatedAt = Date.now();
  }

  /** A boss died. Satisfies the active quest's `boss_kill` objective for that boss. */
  recordBossDefeat(bossType) {
    const activeId = this._state.activeQuestId;
    if (!activeId) return false;
    const def = getQuest(activeId);
    if (!def) return false;
    const objective = def.objectives.find(
      (o) => o.kind === OBJECTIVE_KINDS.BOSS_KILL && o.boss === bossType
    );
    if (!objective) return false;
    return this.satisfyObjective(activeId, objective.key);
  }

  /** An altar consumed an offering. Satisfies the active quest's `deliver` objective. */
  recordDelivery(sealId) {
    const activeId = this._state.activeQuestId;
    if (!activeId) return false;
    const def = getQuest(activeId);
    if (!def) return false;
    const objective = def.objectives.find(
      (o) => o.kind === OBJECTIVE_KINDS.DELIVER && o.seal === sealId
    );
    if (!objective) return false;
    return this.satisfyObjective(activeId, objective.key);
  }

  /** A player reached a `visit` objective's target. */
  recordVisit(objectiveKey) {
    const activeId = this._state.activeQuestId;
    if (!activeId) return false;
    return this.satisfyObjective(activeId, objectiveKey);
  }

  // ── Read models for the UI ────────────────────────────────────

  /**
   * The active quest, flattened for the HUD: title, narrative, and every objective with
   * its current total. Returns null once Q28 is done.
   */
  getTrackerView() {
    const def = this.getActiveQuest();
    if (!def) return null;
    const entry = this.getActiveEntry();
    const objectives = def.objectives.map((o) => {
      const pool = entry?.objectives?.[o.key] || { n: 0, target: o.count || 1 };
      return {
        key: o.key,
        kind: o.kind,
        label: o.label,
        n: pool.n,
        target: pool.target || o.count || 1,
        complete: isObjectiveComplete(pool),
      };
    });
    return {
      id: def.id,
      title: def.title,
      act: def.act,
      stage: def.stage,
      type: def.type,
      narrative: def.narrative,
      marker: def.marker,
      objectives,
    };
  }

  /** Every quest, with its status — the quest log's model. */
  getLogView() {
    return QUEST_ORDER.map((id) => {
      const def = QUEST_DEFINITIONS[id];
      const entry = this._state.quests[id];
      let status = 'locked';
      if (entry?.completed) status = 'completed';
      else if (id === this._state.activeQuestId) status = 'active';
      else if (this.isAvailable(id)) status = 'available';

      return {
        id,
        title: def.title,
        act: def.act,
        stage: def.stage,
        type: def.type,
        status,
        // Narrative is withheld until a quest is reachable — the log is not a
        // spoiler list, and Q27's text gives away the whole turn.
        narrative: status === 'locked' ? null : def.narrative,
        objectives: status === 'locked' || status === 'completed' ? [] : def.objectives.map((o) => {
          const pool = entry?.objectives?.[o.key] || { n: 0, target: o.count || 1 };
          return { key: o.key, label: o.label, n: pool.n, target: pool.target || o.count || 1 };
        }),
      };
    });
  }

  /** Earned titles, as definitions. */
  getTitles() {
    return this._state.titles.map((id) => TITLE_DEFINITIONS[id]).filter(Boolean);
  }

  /** `{ completed, total }` — the header line of the quest log. */
  getCompletionSummary() {
    const total = QUEST_ORDER.length;
    const completed = QUEST_ORDER.filter((id) => this.isCompleted(id)).length;
    return { completed, total };
  }
}
