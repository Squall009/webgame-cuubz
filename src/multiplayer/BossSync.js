/**
 * Cuubz — a boss on the wire (S6)
 *
 * The mirror of `PlayerSync`, and the reason it has to exist at all is §2.3: mobs are
 * **entirely client-local and non-deterministic**. Each client runs its own
 * `MobManager`, seeded per world but driven by bare `Math.random()` at a dozen call
 * sites, so two players standing in the same chunk see completely different mobs and
 * always have. That is fine for a wolf. It is not fine for a boss with a health bar.
 *
 * So a boss is the one entity with a host-authoritative networked layer:
 *
 *   host → guests   BOSS_SPAWN     once, with everything needed to build a mirror
 *                   BOSS_STATE     10 Hz while contested — position, hp, phase
 *                   BOSS_DEFEATED  once, with the loot the host rolled
 *                   BOSS_DESPAWN   on wipe or reset
 *   guest → host    BOSS_HIT       "I landed this"
 *
 * ─── A GUEST INTERPOLATES; IT DOES NOT SIMULATE ─────────────────────────────
 *
 * 10 Hz is six frames apart at 60 fps, and a boss that teleported six times a second
 * would be unfightable. The guest holds the last two states and moves between them, the
 * same shape `PlayerSync` uses for remote avatars — no AI, no ability timers, no phase
 * logic. Everything a guest's copy knows, it was told.
 */

import { MESSAGE_TYPES } from './Client.js';
import { BossEntity } from '../game/entities/BossEntity.js';
import { CuubzLogger } from '../util/Logger.js';

const _log = CuubzLogger.log;

/** Seconds to blend between two `BOSS_STATE` samples. One packet interval, plus slack. */
const INTERP_SECONDS = 0.12;

export class BossSync {
  /**
   * @param {object} config
   * @param {object} config.client — `MultiplayerClient`
   * @param {object} [config.mobManager] — to draw the mirrored boss
   * @param {boolean} [config.isHost=false]
   * @param {object} [config.encounter] — the host's runner, for `BOSS_HIT`
   * @param {object} [config.inventory] — for loot on defeat
   * @param {object} [config.questSystem]
   * @param {string} [config.contributorId]
   */
  constructor(config) {
    this._client = config.client || null;
    this._mobs = config.mobManager || null;
    this._isHost = !!config.isHost;
    this._encounter = config.encounter || null;
    this._inventory = config.inventory || null;
    this._quests = config.questSystem || null;
    this._contributorId = config.contributorId || null;

    /** The mirrored boss on a guest, or the host's own for the HUD. */
    this.boss = null;
    this.bossMob = null;

    this._from = null;
    this._to = null;
    this._blend = 0;

    /** `(boss) => void` */
    this.onBossChanged = null;
    /** `(boss, loot) => void` */
    this.onBossDefeated = null;
    /** `(boss) => void` */
    this.onBossGone = null;

    this._disposed = false;
  }

  attach() {
    if (!this._client) return;
    this._client.onGame(MESSAGE_TYPES.BOSS_SPAWN, (d) => this.handleSpawn(d));
    this._client.onGame(MESSAGE_TYPES.BOSS_STATE, (d) => this.handleState(d));
    this._client.onGame(MESSAGE_TYPES.BOSS_DEFEATED, (d) => this.handleDefeated(d));
    this._client.onGame(MESSAGE_TYPES.BOSS_DESPAWN, (d) => this.handleDespawn(d));
  }

  // ── Guest side ────────────────────────────────────────────────

  handleSpawn(data) {
    if (this._disposed || this._isHost) return;
    // `bossType`, not `type` — `type` is the protocol's and belongs to the envelope.
    if (!data || !data.bossType) return;

    try {
      this.boss = new BossEntity({
        id: data.bossId,
        type: data.bossType,
        sealId: data.sealId,
        position: data.position,
        arenaCentre: data.arena,
      });
    } catch (e) {
      console.warn('[BossSync] Could not build the boss:', e && e.message);
      return;
    }
    if (Number.isFinite(data.maxHp)) {
      this.boss.maxHp = data.maxHp;
      this.boss.hp = data.maxHp;
    }

    // Drawn by the ordinary mob renderer, because a boss is a mob (§8.1).
    if (this._mobs && typeof this._mobs.spawnMobAt === 'function') {
      this.bossMob = this._mobs.spawnMobAt(data.bossType, data.position);
    }

    this._from = { ...this.boss.position };
    this._to = { ...this.boss.position };
    this._blend = 1;

    _log(`[BossSync] ${data.bossType} spawned at the ${data.sealId} seal`);
    this._fire(this.onBossChanged, this.boss);
  }

  handleState(data) {
    if (this._disposed || this._isHost) return;
    if (!this.boss || !data || data.bossId !== this.boss.id) return;

    // Interpolate position; take everything else outright. HP is a number on a bar and
    // smoothing it would make the bar lie about how close the boss is to dying.
    this._from = { ...this.boss.position };
    this._to = { x: data.x, y: data.y, z: data.z };
    this._blend = 0;

    const beforeHp = this.boss.hp;
    const beforePhase = this.boss.phaseIndex;
    this.boss.applyState(data);
    // Position is the interpolator's now, so undo what `applyState` set.
    this.boss.position = { ...this._from };

    if (this.boss.hp !== beforeHp || this.boss.phaseIndex !== beforePhase) {
      this._fire(this.onBossChanged, this.boss);
    }
  }

  handleDefeated(data) {
    if (this._disposed) return;
    if (!this.boss || !data || data.bossId !== this.boss.id) return;

    // §8.5 — the host rolled, and a guest applies what it is told. It does not roll.
    // Loot goes to every contributor (§8.4), so a guest that fought takes its share.
    const mine = Array.isArray(data.contributors)
      && this._contributorId
      && data.contributors.includes(this._contributorId);

    if (mine && this._inventory && typeof this._inventory.addItem === 'function') {
      for (const drop of data.loot || []) {
        try { this._inventory.addItem(drop.item, drop.count); } catch { /* inventory full */ }
      }
    }

    if (!this._isHost && this._quests) {
      this._quests.recordBossDefeat(this.boss.type);
    }

    const boss = this.boss;
    boss.isDead = true;
    this._fire(this.onBossDefeated, boss, data.loot || []);
    this._clear();
  }

  handleDespawn(data) {
    if (this._disposed) return;
    if (!this.boss || !data || data.bossId !== this.boss.id) return;
    _log(`[BossSync] Boss despawned: ${data.reason}`);
    const boss = this.boss;
    this._fire(this.onBossGone, boss);
    this._clear();
  }

  /** Per-frame position blending. */
  update(delta) {
    if (this._disposed || this._isHost) return;
    if (!this.boss || !this._to || this._blend >= 1) return;
    if (!Number.isFinite(delta) || delta <= 0) return;

    this._blend = Math.min(1, this._blend + delta / INTERP_SECONDS);
    const t = this._blend;
    this.boss.position.x = this._from.x + (this._to.x - this._from.x) * t;
    this.boss.position.y = this._from.y + (this._to.y - this._from.y) * t;
    this.boss.position.z = this._from.z + (this._to.z - this._from.z) * t;

    if (this.bossMob) {
      this.bossMob.position.x = this.boss.position.x;
      this.bossMob.position.y = this.boss.position.y;
      this.bossMob.position.z = this.boss.position.z;
      this.bossMob.yaw = this.boss.yaw;
      this.bossMob.health = this.boss.hp;
    }
  }

  // ── Both sides ────────────────────────────────────────────────

  /**
   * Report a landed hit.
   *
   * **§6.4, again.** On a guest this goes on the wire; on the host it calls the runner
   * directly. One function for the caller, two transports, and no second path into boss
   * damage that could drift from the first.
   */
  reportHit(damage, origin) {
    if (this._disposed) return false;
    const boss = this._isHost && this._encounter ? this._encounter.boss : this.boss;
    if (!boss) return false;

    if (this._isHost) {
      return this._encounter.applyHit({
        bossId: boss.id,
        damage,
        contributorId: this._contributorId,
        position: origin,
      });
    }

    if (this._client && typeof this._client.sendBossHit === 'function') {
      this._client.sendBossHit(boss.id, damage, origin, null);
      return true;
    }
    return false;
  }

  /** The boss the HUD should draw a bar for, whichever side this is. */
  getActiveBoss() {
    if (this._isHost && this._encounter) return this._encounter.boss;
    return this.boss;
  }

  _clear() {
    if (this.bossMob && this._mobs && typeof this._mobs.removeMob === 'function') {
      try { this._mobs.removeMob(this.bossMob.id); } catch { /* already gone */ }
    }
    this.bossMob = null;
    this.boss = null;
    this._from = null;
    this._to = null;
  }

  _fire(fn, ...args) {
    if (typeof fn !== 'function') return;
    try { fn(...args); } catch (e) { console.warn('[BossSync] callback threw:', e && e.message); }
  }

  dispose() {
    this._disposed = true;
    this._clear();
    this.onBossChanged = null;
    this.onBossDefeated = null;
    this.onBossGone = null;
  }
}
