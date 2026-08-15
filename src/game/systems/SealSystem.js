/**
 * Cuubz — the five seals: finding them, keying them, priming them (S5)
 *
 * ─── WHAT IT OWNS ───────────────────────────────────────────────────────────
 *
 * The half of a seal's life that happens before the boss: resolving where it is,
 * noticing when a player is carrying its key, accepting the offering at its altar, and
 * advancing `dormant → keyed → primed`. Everything from `primed` onward is
 * `BossEncounter`'s (S6).
 *
 * ─── THE ALTAR IS A PLACE, NOT A BLOCK ──────────────────────────────────────
 *
 * Interaction is proximity to `questState.seals[id].site`, not a raycast against the
 * altar block worldgen stamped there. That is deliberate: open question **Q4** — whether
 * arenas are protected — is unresolved, and the cheapest answer §7.3 gives is
 * *unprotected*. If the altar were a block, a player who mined it would have destroyed
 * their own run with no way back. Mining it now leaves a hole where a nice-looking altar
 * was, and the seal still works.
 *
 * ─── SITES ARE RESOLVED ONCE, THEN FROZEN ───────────────────────────────────
 *
 * `resolveSites` runs on first world entry and writes through `QuestState.setSealSite`,
 * which refuses a second write (§7.1). A guest never resolves anything: the host's sites
 * arrive in `QUEST_SYNC`, and two devices computing "the same" site from "the same" seed
 * is exactly the kind of agreement that holds until one of them updates.
 */

import { SEAL_IDS, SEAL_DEFINITIONS, FINALE_DEFINITION, getSealDefinition } from '../data/SealDefinitions.js';
import { setSealSite } from '../data/QuestState.js';
import { sealSites, distanceToSite, bearingToSite, compassLabel } from '../../engine/world/structures/SealSites.js';

/** How close a player must be to an altar to interact with it, in blocks. */
export const ALTAR_RADIUS = 6;

/** How close before the HUD starts pointing at it. */
export const MARKER_RADIUS = 512;

export class SealSystem {
  /**
   * @param {object} config
   * @param {import('./QuestSystem.js').QuestSystem} config.questSystem
   * @param {object} [config.inventory] — for key detection and offering consumption
   * @param {boolean} [config.authoritative=true] — false on a guest
   * @param {object} [config.host] — `HostManager`, so a transition is broadcast
   */
  constructor(config) {
    this._quests = config.questSystem;
    this._inventory = config.inventory || null;
    this._authoritative = config.authoritative !== false;
    this._host = config.host || null;

    /** `(sealId, state) => void` */
    this.onSealStateChanged = null;
    /** `(sealId) => void` — the offering was made; the boss can be summoned. */
    this.onSealPrimed = null;
    /** `(sealId, def) => void` — the player is standing at an altar they can use. */
    this.onAltarInRange = null;

    /** The seal whose altar the player is currently standing at, or null. */
    this.altarInRange = null;

    this._lastKeyScan = 0;
  }

  setInventory(inventory) {
    this._inventory = inventory;
  }

  /**
   * Resolve and freeze every site that does not have one yet.
   *
   * @param {number|string} seed
   * @param {function} biomeAt — `(wx, wz) => biomeId`
   * @returns {number} how many sites were newly written
   */
  resolveSites(seed, biomeAt) {
    if (!this._authoritative) return 0;
    const state = this._quests.getState();

    // Nothing to do if every site is already frozen — the common case on every world
    // entry after the first, and the search is ~940 biome samples that would otherwise
    // run for nothing.
    const missing = [...SEAL_IDS, 'finale'].filter((id) => {
      const target = id === 'finale' ? state.finale : state.seals[id];
      return target && !target.site;
    });
    if (missing.length === 0) return 0;

    const { sites } = sealSites(seed, biomeAt);
    let written = 0;
    for (const id of missing) {
      if (setSealSite(state, id, sites[id])) written++;
    }
    return written;
  }

  /** `{ x, z, y? }` or null. */
  getSite(sealId) {
    const state = this._quests.getState();
    const target = sealId === 'finale' ? state.finale : state.seals[sealId];
    return target ? target.site : null;
  }

  getSealState(sealId) {
    const state = this._quests.getState();
    return sealId === 'finale' ? state.finale.state : state.seals[sealId]?.state;
  }

  /**
   * The seal the active quest points at, if any. Drives the HUD marker.
   * @returns {string|null}
   */
  getTrackedSeal() {
    const quest = this._quests.getActiveQuest();
    return quest && quest.marker && quest.marker.seal ? quest.marker.seal : null;
  }

  /**
   * A direction and a distance to the tracked seal — what the HUD shows instead of a
   * pair of coordinates the player has to hold in their head.
   *
   * @returns {{sealId, name, distance, bearing, compass}|null}
   */
  getMarker(position) {
    const sealId = this.getTrackedSeal();
    if (!sealId || !position) return null;
    const site = this.getSite(sealId);
    if (!site) return null;

    const def = getSealDefinition(sealId);
    const distance = distanceToSite(position, site);
    const bearing = bearingToSite(position, site);
    return {
      sealId,
      name: def ? def.name : sealId,
      distance: Math.round(distance),
      bearing,
      compass: compassLabel(bearing),
      near: distance <= MARKER_RADIUS,
    };
  }

  /**
   * Per-frame. Cheap: a distance check per seal against a position, and an inventory
   * scan throttled to once a second.
   *
   * @param {number} delta @param {{x,y,z}} position
   */
  update(delta, position) {
    if (!position) return;

    // ── Which altar, if any, is the player standing at ──────────
    let inRange = null;
    for (const id of [...SEAL_IDS, 'finale']) {
      const site = this.getSite(id);
      if (!site) continue;
      if (distanceToSite(position, site) <= ALTAR_RADIUS) { inRange = id; break; }
    }

    if (inRange !== this.altarInRange) {
      this.altarInRange = inRange;
      if (inRange && this.onAltarInRange) {
        try { this.onAltarInRange(inRange, getSealDefinition(inRange)); } catch (e) { console.warn('[SealSystem] onAltarInRange threw:', e && e.message); }
      }
    }

    // ── Key detection, once a second ────────────────────────────
    this._lastKeyScan += delta;
    if (this._lastKeyScan >= 1) {
      this._lastKeyScan = 0;
      this._scanForKeys();
    }
  }

  /**
   * A seal whose key the party is carrying is `keyed`.
   *
   * Cosmetic on its own — nothing gates on `keyed` — but it is what makes the HUD say
   * "you have the key, now find the altar" rather than leaving a player who picked one
   * up wondering what it was for.
   */
  _scanForKeys() {
    if (!this._authoritative) return;
    if (!this._inventory || typeof this._inventory.countItem !== 'function') return;

    for (const id of SEAL_IDS) {
      if (this.getSealState(id) !== 'dormant') continue;
      const def = SEAL_DEFINITIONS[id];
      if (this._inventory.countItem(def.keyItem) > 0) this.setSeal(id, 'keyed');
    }
  }

  /**
   * Can the offering be made right now?
   *
   * @returns {{ ok: boolean, reason?: string, missing?: Array }}
   */
  canMakeOffering(sealId) {
    const def = getSealDefinition(sealId);
    if (!def) return { ok: false, reason: 'No such seal' };

    const state = this.getSealState(sealId);
    if (state === 'broken') return { ok: false, reason: 'This seal is already broken' };
    if (state === 'primed' || state === 'contested') {
      return { ok: false, reason: 'The offering has already been made' };
    }

    if (sealId === 'finale') {
      // The spire has stood there since world generation and answers to nothing until
      // all five are broken (§3.7).
      const broken = SEAL_IDS.filter((id) => this.getSealState(id) === 'broken').length;
      if (broken < FINALE_DEFINITION.requiresSealsBroken) {
        return { ok: false, reason: `Five seals hold this shut. ${broken} of 5 are broken.` };
      }
    }

    if (!this._inventory || typeof this._inventory.countItem !== 'function') {
      return { ok: false, reason: 'No inventory' };
    }

    const missing = [];
    if (def.keyItem && this._inventory.countItem(def.keyItem) < 1) {
      missing.push({ item: def.keyItem, need: 1, have: 0 });
    }
    for (const req of def.offering || []) {
      const have = this._inventory.countItem(req.item);
      if (have < req.count) missing.push({ item: req.item, need: req.count, have });
    }

    if (missing.length > 0) return { ok: false, reason: 'The offering is incomplete', missing };
    return { ok: true };
  }

  /**
   * Consume the offering and prime the seal.
   *
   * **Items are consumed here**, which is what makes every seal-critical step
   * exploit-proof while the gathering quests stay deliberately generous (§4.5). A
   * `contribute_item` objective can be double-counted by two players passing one stack
   * back and forth; a `deliver` cannot, because the stack is gone.
   *
   * @returns {{ ok: boolean, reason?: string }}
   */
  makeOffering(sealId) {
    const check = this.canMakeOffering(sealId);
    if (!check.ok) return check;
    if (!this._authoritative) return { ok: false, reason: 'Only the host can prime a seal' };

    const def = getSealDefinition(sealId);

    // Take the key and the offering. The key is spent: it opened one door, once.
    const consume = (item, count) => {
      if (typeof this._inventory.removeItem === 'function') {
        this._inventory.removeItem(item, count);
      }
    };
    if (def.keyItem) consume(def.keyItem, 1);
    for (const req of def.offering || []) consume(req.item, req.count);

    this.setSeal(sealId, 'primed');
    this._quests.recordDelivery(sealId);

    if (this.onSealPrimed) {
      try { this.onSealPrimed(sealId); } catch (e) { console.warn('[SealSystem] onSealPrimed threw:', e && e.message); }
    }
    return { ok: true };
  }

  /**
   * Advance a seal, and tell the session.
   *
   * Routes through the host when there is one, so the transition is broadcast and the
   * quest system's own `setSeal` — which satisfies `seal_state` objectives and opens the
   * finale on the fifth break — runs exactly once, on the authority.
   */
  setSeal(sealId, next) {
    const changed = this._host && typeof this._host.setSeal === 'function'
      ? this._host.setSeal(sealId, next)
      : this._quests.setSeal(sealId, next);
    if (!changed) return false;

    if (this.onSealStateChanged) {
      try { this.onSealStateChanged(sealId, next); } catch (e) { console.warn('[SealSystem] onSealStateChanged threw:', e && e.message); }
    }
    return true;
  }
}
