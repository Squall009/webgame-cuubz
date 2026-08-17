/**
 * Cuubz — quest state: one schema, versioned, world-scoped (S0)
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * Three incompatible shapes, none of which was ever written by gameplay
 * (`quest_implementation.md` §2.1):
 *
 *   WorldManager.questProgress      → { [questId]: { stage, completed, lastUpdated } }
 *   Host._worldState.questProgress  → { [questId]: number }
 *   SessionRejoin / AutoRejoin      → {}
 *
 * They disagreed about what a quest's progress even *is* — an object, a number, or
 * nothing — so no code could read one and write another. This file is the fourth shape
 * and the last one: everything that touches quest progress now goes through it.
 *
 * ─── EVERY FIELD IS MONOTONIC ───────────────────────────────────────────────
 *
 * Pools only rise, high-water marks only rise, seal states only advance, titles are only
 * added. That is not tidiness — it is what makes reordered packets, a late join and a
 * rejoin-after-crash all resolve to "take the higher value" with **no conflict
 * resolution code anywhere**. The one deliberate exception is `contested → primed`, an
 * encounter reset (§8.4), and `setSealState` names it explicitly rather than relaxing the
 * rule.
 *
 * ─── THE STORAGE BUDGET IS REAL ─────────────────────────────────────────────
 *
 * This lives in `localStorage` beside two other world configs and the character array
 * (`Persistence.js:176`), so the serialized form is budgeted at **≤ 8 KB**. Two things
 * follow: `hw` maps exist only on the ACTIVE quest and are dropped the moment it
 * completes, and `brokenBy` is capped at `MAX_PLAYERS_LIMIT`. `serializeQuestState()` is
 * where both are enforced; `estimateSize()` is how a test proves it.
 *
 * ─── POOLED CONTRIBUTION, AND WHY IT IS A HIGH-WATER MARK ───────────────────
 *
 * Objectives are party-wide totals (D-Q2, §4.5). The only signal available is polling —
 * `CraftingSystem` has no completion callback, `Inventory` exposes only
 * `onSelectionChange`, and `BlockInteraction` has no break/place hook — so what we can
 * observe is "player X currently holds N", which *regresses* when they drop an item, die
 * or disconnect. Crediting the raw observation would let the pool fall.
 *
 * So the pool is a sum of per-contributor **high-water marks**: credit only the positive
 * delta against the highest count that contributor has ever been seen holding, and never
 * decrease. Dropping, dying and disconnecting cannot take progress away, and a guest's
 * mark survives in the host's world across their disconnect — which is the whole of what
 * "work done counts for everyone" means when the connection is unreliable.
 *
 * The known, accepted exploit: A hands B five obsidian, A's mark stays, B's rises, and
 * the five count twice. This is a co-op game. Where it actually matters the objective is
 * a `deliver`, whose items are consumed at the altar and validated host-side.
 */

import { SEAL_IDS, SEAL_STATES, FINALE_STATES } from './SealDefinitions.js';
import { MAX_PLAYERS_LIMIT } from '../../../shared/protocol.js';

/**
 * Schema version. Bump when a field changes meaning, and add a branch to
 * `migrateQuestState`. Version 0 is "anything with no `v`" — i.e. all three legacy
 * shapes above, every one of which was empty in practice, which is why the v0 → v1
 * migration is allowed to discard rather than translate.
 */
export const QUEST_STATE_VERSION = 1;

/** The quest the game starts on. Act 1, Quest 01 — "First Steps". */
export const FIRST_QUEST_ID = 'q01';

/**
 * Build a fresh, empty quest state.
 *
 * `site` is `null` on every seal: sites are resolved from the world seed on first entry
 * and then **frozen** (§7.1), and a default that guessed would be a second source of
 * truth for where the Verdant altar is.
 *
 * @returns {object} a v1 quest state
 */
export function createQuestState() {
  const seals = {};
  for (const id of SEAL_IDS) {
    seals[id] = { state: 'dormant', site: null, brokenAt: null, brokenBy: [] };
  }
  return {
    v: QUEST_STATE_VERSION,
    activeQuestId: FIRST_QUEST_ID,
    quests: {},
    seals,
    finale: { state: 'sealed', site: null, defeatedAt: null, brokenBy: [] },
    titles: [],
    pendingLoot: {},
  };
}

/**
 * Coerce whatever came out of storage or off the wire into a valid v1 state.
 *
 * Never throws and never returns null — a corrupt blob becomes a fresh state, because a
 * player whose quest log resets is annoyed and a player whose game will not load is
 * gone. Unknown-but-newer `v` is also reset rather than guessed at.
 *
 * @param {*} raw — a v1 state, a legacy shape, `{}`, `undefined`, or garbage
 * @returns {object} a v1 quest state, always
 */
export function migrateQuestState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createQuestState();

  // v0 — no version field. All three legacy shapes land here, and all three were
  // write-only placeholders that no gameplay ever advanced, so there is nothing in them
  // worth translating. The migration exists so the *next* schema change has a precedent.
  if (raw.v !== QUEST_STATE_VERSION) return createQuestState();

  const base = createQuestState();
  const out = {
    v: QUEST_STATE_VERSION,
    activeQuestId: typeof raw.activeQuestId === 'string' ? raw.activeQuestId : base.activeQuestId,
    quests: {},
    seals: base.seals,
    finale: base.finale,
    titles: [],
    pendingLoot: {},
  };

  if (raw.quests && typeof raw.quests === 'object') {
    for (const [questId, q] of Object.entries(raw.quests)) {
      if (!q || typeof q !== 'object') continue;
      const entry = {
        stage: Number.isFinite(q.stage) ? q.stage : 0,
        completed: !!q.completed,
      };
      if (entry.completed) {
        entry.completedAt = Number.isFinite(q.completedAt) ? q.completedAt : null;
      } else if (q.objectives && typeof q.objectives === 'object') {
        entry.objectives = {};
        for (const [key, o] of Object.entries(q.objectives)) {
          if (!o || typeof o !== 'object') continue;
          entry.objectives[key] = {
            n: Math.max(0, Number.isFinite(o.n) ? o.n : 0),
            target: Math.max(0, Number.isFinite(o.target) ? o.target : 0),
            hw: sanitizeHighWater(o.hw),
          };
        }
      }
      out.quests[questId] = entry;
    }
  }

  if (raw.seals && typeof raw.seals === 'object') {
    for (const id of SEAL_IDS) {
      const s = raw.seals[id];
      if (!s || typeof s !== 'object') continue;
      out.seals[id] = {
        state: SEAL_STATES.includes(s.state) ? s.state : 'dormant',
        site: sanitizeSite(s.site),
        brokenAt: Number.isFinite(s.brokenAt) ? s.brokenAt : null,
        brokenBy: Array.isArray(s.brokenBy)
          ? s.brokenBy.filter((c) => typeof c === 'string').slice(0, MAX_PLAYERS_LIMIT)
          : [],
      };
    }
  }

  if (raw.finale && typeof raw.finale === 'object') {
    out.finale = {
      state: FINALE_STATES.includes(raw.finale.state) ? raw.finale.state : 'sealed',
      site: sanitizeSite(raw.finale.site),
      defeatedAt: Number.isFinite(raw.finale.defeatedAt) ? raw.finale.defeatedAt : null,
      brokenBy: Array.isArray(raw.finale.brokenBy)
        ? raw.finale.brokenBy.filter((c) => typeof c === 'string').slice(0, MAX_PLAYERS_LIMIT)
        : [],
    };
  }

  if (Array.isArray(raw.titles)) {
    out.titles = [...new Set(raw.titles.filter((t) => typeof t === 'string'))];
  }

  // S12 — absent on every state written before this stage, and `{}` is the right answer
  // for all of them. See the note on `pendingLoot` above `addPendingLoot`.
  out.pendingLoot = sanitizePendingLoot(raw.pendingLoot);

  return out;
}

/** `{ x, z }` with finite numbers, or null. Sites are frozen once written (§7.1). */
function sanitizeSite(site) {
  if (!site || typeof site !== 'object') return null;
  if (!Number.isFinite(site.x) || !Number.isFinite(site.z)) return null;
  const out = { x: site.x, z: site.z };
  if (Number.isFinite(site.y)) out.y = site.y;
  return out;
}

/** A `hw` map with string keys and non-negative finite values, or `{}`. */
function sanitizeHighWater(hw) {
  const out = {};
  if (!hw || typeof hw !== 'object') return out;
  for (const [contributorId, v] of Object.entries(hw)) {
    if (typeof contributorId !== 'string') continue;
    if (!Number.isFinite(v) || v < 0) continue;
    out[contributorId] = v;
  }
  return out;
}

// ─── Quest entries ───────────────────────────────────────────────────

/**
 * Get (creating if absent) the mutable entry for one quest.
 * @param {object} state @param {string} questId @param {number} [stage=0]
 */
export function ensureQuest(state, questId, stage = 0) {
  if (!state.quests[questId]) {
    state.quests[questId] = { stage, completed: false, objectives: {} };
  } else if (!state.quests[questId].completed && !state.quests[questId].objectives) {
    state.quests[questId].objectives = {};
  }
  return state.quests[questId];
}

/**
 * Get (creating if absent) one objective pool on a quest.
 * @returns {{n:number,target:number,hw:Object<string,number>}}
 */
export function ensureObjective(state, questId, objectiveKey, target = 0) {
  const quest = ensureQuest(state, questId);
  if (quest.completed) return null;
  if (!quest.objectives[objectiveKey]) {
    quest.objectives[objectiveKey] = { n: 0, target, hw: {} };
  } else if (target > 0) {
    // The definition is the authority on target; a stored one from an older definition
    // is corrected on load rather than honoured forever.
    quest.objectives[objectiveKey].target = target;
  }
  return quest.objectives[objectiveKey];
}

// ─── Pooled contribution (§4.5) ──────────────────────────────────────

/**
 * Credit an *observation* — "this contributor currently holds `observed`" — against
 * their high-water mark, and return the delta that was actually added to the pool.
 *
 * This is the local half, used by whoever is doing the observing. The host applies the
 * returned delta through `applyPooledDelta`; a client sends it as `QUEST_CONTRIBUTE`.
 *
 * @param {object} state
 * @param {string} questId
 * @param {string} objectiveKey
 * @param {string} contributorId — a **character** id, not a playerId. §4.5: playerIds are
 *   assigned per connection, so a reconnecting player would present a fresh mark of 0 and
 *   be credited a second time for items they never dropped.
 * @param {number} observed — the count they hold right now
 * @param {number} [target=0]
 * @returns {number} the credited delta, 0 if the observation was not a new high
 */
export function creditObservation(state, questId, objectiveKey, contributorId, observed, target = 0) {
  if (typeof contributorId !== 'string' || !contributorId) return 0;
  if (!Number.isFinite(observed) || observed <= 0) return 0;
  const obj = ensureObjective(state, questId, objectiveKey, target);
  if (!obj) return 0;

  const previous = obj.hw[contributorId] || 0;
  if (observed <= previous) return 0;

  const delta = observed - previous;
  obj.hw[contributorId] = observed;
  obj.n = Math.min(obj.n + delta, obj.target > 0 ? obj.target : obj.n + delta);
  return delta;
}

/**
 * Add a delta straight to the pool, clamped at the target. The host's half: it has
 * already been told how much to add and by whom, and the high-water bookkeeping happened
 * on the observer's side.
 *
 * The host still records the contributor's mark so a rejoining client that re-observes
 * the same items from zero cannot be credited twice — see `hostObservedHighWater`.
 *
 * @returns {{ credited: number, n: number, target: number, complete: boolean }}
 */
export function applyPooledDelta(state, questId, objectiveKey, delta, target = 0, contributorId = null) {
  const obj = ensureObjective(state, questId, objectiveKey, target);
  if (!obj) return { credited: 0, n: 0, target, complete: true };
  if (!Number.isFinite(delta) || delta <= 0) {
    return { credited: 0, n: obj.n, target: obj.target, complete: isObjectiveComplete(obj) };
  }

  const before = obj.n;
  obj.n = obj.target > 0 ? Math.min(obj.n + delta, obj.target) : obj.n + delta;
  if (typeof contributorId === 'string' && contributorId) {
    obj.hw[contributorId] = (obj.hw[contributorId] || 0) + delta;
  }
  return {
    credited: obj.n - before,
    n: obj.n,
    target: obj.target,
    complete: isObjectiveComplete(obj),
  };
}

/** @param {{n:number,target:number}} obj */
export function isObjectiveComplete(obj) {
  if (!obj) return false;
  return obj.target > 0 ? obj.n >= obj.target : obj.n > 0;
}

/** Every objective on the quest is complete (and there is at least one). */
export function areObjectivesComplete(state, questId) {
  const quest = state.quests[questId];
  if (!quest) return false;
  if (quest.completed) return true;
  const objectives = quest.objectives || {};
  const keys = Object.keys(objectives);
  if (keys.length === 0) return false;
  return keys.every((k) => isObjectiveComplete(objectives[k]));
}

/**
 * Mark a quest complete and **collapse it**: `objectives` and every `hw` map go, which is
 * most of the storage budget (§4.1). A completed quest is one boolean and a timestamp.
 */
export function completeQuest(state, questId, at = Date.now()) {
  const quest = ensureQuest(state, questId);
  if (quest.completed) return false;
  quest.completed = true;
  quest.completedAt = at;
  delete quest.objectives;
  return true;
}

// ─── Seals ───────────────────────────────────────────────────────────

/**
 * Advance a seal. Refuses to move backwards along `SEAL_STATES`, with one exception:
 * `contested → primed` is an encounter reset (§8.4), which is the only legal retreat and
 * is spelled out here rather than by loosening the comparison.
 *
 * @returns {boolean} whether the state changed
 */
export function setSealState(state, sealId, next) {
  // The finale has its own five-state vocabulary and its own ordering, so it dispatches
  // rather than being special-cased inside the seal logic below.
  if (sealId === 'finale') return setFinaleState(state, next);

  const seal = state.seals[sealId];
  if (!seal) return false;
  if (!SEAL_STATES.includes(next)) return false;
  if (seal.state === next) return false;

  const from = SEAL_STATES.indexOf(seal.state);
  const to = SEAL_STATES.indexOf(next);
  const isReset = seal.state === 'contested' && next === 'primed';
  if (to < from && !isReset) return false;

  seal.state = next;
  return true;
}

/**
 * Advance the finale. Monotonic along `FINALE_STATES`, with the same one legal retreat
 * a seal has: `contested → primed` is an encounter reset (§8.4).
 *
 * @returns {boolean} whether the state changed
 */
export function setFinaleState(state, next) {
  if (!FINALE_STATES.includes(next)) return false;
  const current = state.finale.state;
  if (current === next) return false;

  const from = FINALE_STATES.indexOf(current);
  const to = FINALE_STATES.indexOf(next);
  const isReset = current === 'contested' && next === 'primed';
  if (to < from && !isReset) return false;

  // The spire cannot open until all five seals are broken — the whole of §3.7, in one
  // guard, on the state machine rather than in a UI check that a second caller could
  // skip.
  if (to >= FINALE_STATES.indexOf('open') && !allSealsBroken(state)) return false;

  state.finale.state = next;
  if (next === 'defeated' && !state.finale.defeatedAt) state.finale.defeatedAt = Date.now();
  return true;
}

/**
 * Record that a character contributed damage to a seal's boss. Capped at
 * `MAX_PLAYERS_LIMIT` — the list exists to hand out loot to everyone who fought (§8.4),
 * and a session cannot hold more than four.
 */
export function addSealContributor(state, sealId, contributorId) {
  const seal = sealId === 'finale' ? state.finale : state.seals[sealId];
  if (!seal || typeof contributorId !== 'string' || !contributorId) return false;
  if (!Array.isArray(seal.brokenBy)) seal.brokenBy = [];
  if (seal.brokenBy.includes(contributorId)) return false;
  if (seal.brokenBy.length >= MAX_PLAYERS_LIMIT) return false;
  seal.brokenBy.push(contributorId);
  return true;
}

/** Freeze a seal's site the first time it is resolved, and never again (§7.1). */
export function setSealSite(state, sealId, site) {
  const target = sealId === 'finale' ? state.finale : state.seals[sealId];
  if (!target || target.site) return false;
  const clean = sanitizeSite(site);
  if (!clean) return false;
  target.site = clean;
  return true;
}

/** @returns {number} how many of the five are `broken` */
export function countBrokenSeals(state) {
  return SEAL_IDS.reduce((n, id) => n + (state.seals[id]?.state === 'broken' ? 1 : 0), 0);
}

export function allSealsBroken(state) {
  return countBrokenSeals(state) === SEAL_IDS.length;
}

// ─── Titles ──────────────────────────────────────────────────────────

/** @returns {boolean} whether it was newly granted */
export function grantTitle(state, titleId) {
  if (typeof titleId !== 'string' || !titleId) return false;
  if (state.titles.includes(titleId)) return false;
  state.titles.push(titleId);
  return true;
}

// ─── Serialization ───────────────────────────────────────────────────

/**
 * The form that goes to storage and onto the wire.
 *
 * A deep copy, so a caller cannot hand out a live reference to the authoritative state
 * and have a UI mutate it — and the point at which the budget is enforced: completed
 * quests keep no objectives, active ones keep their `hw` maps because that is the only
 * place a disconnected guest's contribution lives.
 */
export function serializeQuestState(state) {
  const quests = {};
  for (const [questId, q] of Object.entries(state.quests)) {
    if (q.completed) {
      quests[questId] = { stage: q.stage, completed: true, completedAt: q.completedAt ?? null };
      continue;
    }
    const objectives = {};
    for (const [key, o] of Object.entries(q.objectives || {})) {
      objectives[key] = { n: o.n, target: o.target, hw: { ...o.hw } };
    }
    quests[questId] = { stage: q.stage, completed: false, objectives };
  }

  const seals = {};
  for (const id of SEAL_IDS) {
    const s = state.seals[id];
    seals[id] = {
      state: s.state,
      site: s.site ? { ...s.site } : null,
      brokenAt: s.brokenAt,
      brokenBy: [...s.brokenBy],
    };
  }

  return {
    v: QUEST_STATE_VERSION,
    activeQuestId: state.activeQuestId,
    quests,
    seals,
    finale: {
      state: state.finale.state,
      site: state.finale.site ? { ...state.finale.site } : null,
      defeatedAt: state.finale.defeatedAt,
      brokenBy: [...(state.finale.brokenBy || [])],
    },
    titles: [...state.titles],
    pendingLoot: sanitizePendingLoot(state.pendingLoot),
  };
}

// ── Pending loot (S12, §8.5) ─────────────────────────────────────────────────
//
// **Why the schema version did NOT bump for this.** The rule above says bump when a
// field changes meaning, and `migrateQuestState` turns an unrecognised `v` into a
// *fresh state* — so bumping to 2 would erase the quest progress of every world written
// before this stage in order to add a map that is empty in all of them. `pendingLoot` is
// purely additive and its absence has exactly one correct reading, `{}`, so it is
// defaulted rather than migrated. A version bump is for a field whose old value has to
// be *translated*, and there is no old value here.
//
// **Why it is bounded, which the 8 KB budget requires.** At most `MAX_PLAYERS_LIMIT`
// contributors, exactly as `brokenBy` is capped, and counts are **merged by item** — so
// a player who missed all six bosses holds one entry per distinct drop across the whole
// game, which is five (`corrupt_crystal`, `diamond`, `gold_ingot`, `netherite_ingot`,
// `iron_ingot`), not eighteen. Four contributors × five entries is a few hundred bytes.

/** Largest count a single pending entry may hold. Six bosses cannot legitimately exceed it. */
export const MAX_PENDING_LOOT_COUNT = 999;

/** Distinct items one contributor may have waiting. The boss tables between them name 5. */
export const MAX_PENDING_LOOT_ITEMS = 8;

/**
 * Coerce a `pendingLoot` map from storage, the wire, or nothing at all.
 * Never throws; anything unrecognised becomes `{}`, which is the empty case anyway.
 */
export function sanitizePendingLoot(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

  let contributors = 0;
  for (const [id, drops] of Object.entries(raw)) {
    if (typeof id !== 'string' || !id) continue;
    if (!Array.isArray(drops) || drops.length === 0) continue;
    if (contributors >= MAX_PLAYERS_LIMIT) break;

    const merged = [];
    for (const drop of drops) {
      if (!drop || typeof drop !== 'object') continue;
      if (typeof drop.item !== 'string' || !drop.item) continue;
      const count = Math.floor(drop.count);
      if (!Number.isFinite(count) || count <= 0) continue;

      const existing = merged.find((m) => m.item === drop.item);
      if (existing) {
        existing.count = Math.min(MAX_PENDING_LOOT_COUNT, existing.count + count);
      } else if (merged.length < MAX_PENDING_LOOT_ITEMS) {
        merged.push({ item: drop.item, count: Math.min(MAX_PENDING_LOOT_COUNT, count) });
      }
    }
    if (merged.length === 0) continue;
    out[id] = merged;
    contributors++;
  }
  return out;
}

/**
 * Record loot a contributor earned and was not present to receive.
 *
 * Mutates `state` and returns what that contributor is now owed. Merged by item and
 * clamped by `sanitizePendingLoot`, so calling it six times for six bosses grows the
 * entry by counts and not by rows.
 *
 * @param {object} state — a live quest state
 * @param {string} contributorId — a character id, the same identity `brokenBy` records
 * @param {Array<{item: string, count: number}>} drops
 * @returns {Array<{item: string, count: number}>}
 */
export function addPendingLoot(state, contributorId, drops) {
  if (!state || typeof contributorId !== 'string' || !contributorId) return [];
  if (!Array.isArray(drops) || drops.length === 0) return [];
  if (!state.pendingLoot || typeof state.pendingLoot !== 'object') state.pendingLoot = {};

  // A contributor who already has an entry is never refused by the cap — the cap is on
  // how many *distinct* players are owed, and someone already in the map is not new.
  const isNew = !state.pendingLoot[contributorId];
  if (isNew && Object.keys(state.pendingLoot).length >= MAX_PLAYERS_LIMIT) return [];

  const combined = [...(state.pendingLoot[contributorId] || []), ...drops];
  const clean = sanitizePendingLoot({ [contributorId]: combined })[contributorId];
  if (!clean) return [];
  state.pendingLoot[contributorId] = clean;
  return clean;
}

/** What a contributor is owed, without clearing it. Empty array if nothing. */
export function peekPendingLoot(state, contributorId) {
  if (!state || !state.pendingLoot) return [];
  const drops = state.pendingLoot[contributorId];
  return Array.isArray(drops) ? drops.map((d) => ({ ...d })) : [];
}

/**
 * Hand over what a contributor is owed and forget it.
 *
 * **The caller clears only after the send succeeded** — see `HostManager.flushPendingLoot`
 * for the at-most-once argument and the window it deliberately leaves open.
 */
export function takePendingLoot(state, contributorId) {
  const drops = peekPendingLoot(state, contributorId);
  if (state && state.pendingLoot) delete state.pendingLoot[contributorId];
  return drops;
}

/** Serialized byte length, for the ≤ 8 KB budget assertion in the tests. */
export function estimateSize(state) {
  return JSON.stringify(serializeQuestState(state)).length;
}

/** The budget from §4.1, exported so the test and the comment cannot drift apart. */
export const QUEST_STATE_BUDGET_BYTES = 8192;
