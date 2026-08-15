/**
 * Cuubz — the host-side encounter runner (S6)
 *
 * ─── SINGLE-PLAYER AND MULTIPLAYER ARE THE SAME CODE ────────────────────────
 *
 * §6.5: single-player instantiates this with a **null transport**. The simulation, the
 * validation and the state machine are identical; only the broadcast is a no-op. There is
 * no `if (multiplayer)` anywhere in this file, and that is the point — the two modes
 * cannot drift because there is only one of them.
 *
 * ─── THE LIFECYCLE IS §8.4's DIAGRAM, EXACTLY ───────────────────────────────
 *
 *   primed  ──[any player interacts with the altar]──▶  contested
 *                                                          │
 *          ┌───────────────────────────────────────────────┤
 *     [boss hp ≤ 0]                          [all players leave the arena
 *          │                                  for 60 s, or all die]
 *          ▼                                            ▼
 *       broken                                     primed (reset)
 *
 * A reset restores full HP and costs nothing but time — Q5's stated assumption, and the
 * kind one: a party that wipes on the Forest Warden has lost ten minutes, not their
 * seal keys.
 *
 * ─── LOOT IS ROLLED ONCE, BY THE HOST ───────────────────────────────────────
 *
 * §8.5. `rollDrops` uses bare `Math.random()`, so four clients rolling independently
 * would produce four different answers about what dropped. The host rolls, the result
 * travels in `BOSS_DEFEATED`, and clients apply what they are told. Same rule as
 * everything else: one authority.
 *
 * And loot goes to **every contributor**, not the killer — consistent with §4.5's pooled
 * objectives, where work counts for everyone.
 */

import { BossEntity } from '../entities/BossEntity.js';
import { BOSS_ABILITIES, getBossDefinition, bossForSeal } from '../mobs/bossDefinitions.js';
import { BLOCK_TYPES } from '../../engine/world/BlockRegistry.js';
import { DAMAGE_SOURCES } from '../data/DamageSources.js';
import { NAMED_ITEMS } from '../data/ItemDefinitions.js';

/** How long an empty arena waits before the encounter resets. §8.4. */
export const RESET_AFTER_EMPTY_SECONDS = 60;

/** `BOSS_STATE` broadcast rate while a fight is live. §6.2 — ~1.2 KB/s per client. */
export const STATE_HZ = 10;

/**
 * The largest single hit the host will accept, **computed rather than hard-coded**.
 *
 * §6.3 says so explicitly. A literal here would be wrong the first time anyone adds a
 * weapon, and wrong in the direction that silently rejects legitimate hits.
 */
export function maxLegalHit() {
  let best = 0;
  for (const def of Object.values(NAMED_ITEMS)) {
    if (typeof def.damage === 'number' && def.damage > best) best = def.damage;
  }
  // Generous slack for a critical, a buff, or anything a later stage adds.
  return Math.max(1, best) * 3;
}

export class BossEncounter {
  /**
   * @param {object} config
   * @param {import('./QuestSystem.js').QuestSystem} config.questSystem
   * @param {import('./SealSystem.js').SealSystem} config.sealSystem
   * @param {object} [config.mobManager] — for spawning the boss and its adds
   * @param {object} [config.world] — `getBlockAtWorld` / `setBlockAtWorld` for hazard pools
   * @param {object} [config.vitals] — the local player's, for melee damage
   * @param {object} [config.player] — the local player, for position
   * @param {object} [config.inventory] — for loot
   * @param {function} [config.broadcast] — `(msg) => void`; **null in single-player**
   * @param {function} [config.getPlayerPositions] — `() => [{id, position}]`
   * @param {string} [config.localContributorId]
   */
  constructor(config) {
    this._quests = config.questSystem;
    this._seals = config.sealSystem;
    this._mobs = config.mobManager || null;
    this._world = config.world || null;
    this._vitals = config.vitals || null;
    this._player = config.player || null;
    this._inventory = config.inventory || null;
    this._broadcast = config.broadcast || null;
    this._getPlayerPositions = config.getPlayerPositions || null;
    this._localContributorId = config.localContributorId || null;

    /** The live boss, or null. One at a time — there is one party. */
    this.boss = null;
    /** The `Mob` the renderer is drawing for it. */
    this.bossMob = null;

    this._stateAccumulator = 0;
    this._hitLog = new Map(); // playerId → [timestamps]
    this._adds = [];

    /** `(boss) => void` */
    this.onBossSpawned = null;
    /** `(boss, loot, contributors) => void` */
    this.onBossDefeated = null;
    /** `(boss, reason) => void` */
    this.onBossDespawned = null;
    /** `(boss) => void` — HP or phase moved; the boss bar reads this. */
    this.onBossChanged = null;
  }

  get isActive() {
    return !!this.boss && !this.boss.isDead;
  }

  setWorld(world) { this._world = world; }
  setMobManager(mobManager) { this._mobs = mobManager; }

  // ── Starting and ending ───────────────────────────────────────

  /**
   * Summon the seal's boss. Called when a primed altar is interacted with.
   * @returns {BossEntity|null}
   */
  summon(sealId, playerCount = 1) {
    if (this.boss) return null;
    if (this._seals.getSealState(sealId) !== 'primed') return null;

    const type = bossForSeal(sealId);
    if (!type) return null;

    const site = this._seals.getSite(sealId);
    if (!site) return null;

    const y = Number.isFinite(site.y) ? site.y + 2 : this._groundAt(site.x, site.z);
    const boss = new BossEntity({
      type,
      sealId,
      position: { x: site.x, y, z: site.z },
      arenaCentre: { x: site.x, z: site.z },
      playerCount,
    });
    this.boss = boss;

    // The renderer draws it because it is a mob (§8.1). `spawnMobAt` bypasses the spawn
    // tick entirely, which is how a `biomes: []` definition gets into the world at all.
    if (this._mobs && typeof this._mobs.spawnMobAt === 'function') {
      this.bossMob = this._mobs.spawnMobAt(type, boss.position);
      if (this.bossMob) {
        this.bossMob.health = boss.hp;
        this.bossMob.maxHealth = boss.maxHp;
      }
    }

    this._seals.setSeal(sealId, 'contested');
    this._send({ type: 'BOSS_SPAWN', ...boss.spawnPayload() });
    this._fire(this.onBossSpawned, boss);
    return boss;
  }

  /** @returns {number} a plausible standing height at a column */
  _groundAt(x, z) {
    if (!this._world || typeof this._world.getBlockAtWorld !== 'function') return 70;
    for (let y = 120; y > 4; y--) {
      try {
        if (this._world.getBlockAtWorld(Math.floor(x), y, Math.floor(z))) return y + 2;
      } catch { /* unloaded column */ }
    }
    return 70;
  }

  /**
   * Per-frame. Host only — a guest's copy is driven by `BossSync`.
   * @param {number} delta — seconds
   */
  update(delta) {
    const boss = this.boss;
    if (!boss || !Number.isFinite(delta) || delta <= 0) return;
    if (boss.isDead) return;

    boss.tick(delta);
    this._reapPools();

    const players = this._playerPositions();
    const target = this._nearestPlayer(players, boss.position);

    // ── Reset: an empty arena, or a wiped party ─────────────────
    if (!target) {
      boss.emptyArenaFor += delta;
      if (boss.emptyArenaFor >= RESET_AFTER_EMPTY_SECONDS) {
        this.reset('arena empty');
        return;
      }
    } else {
      boss.emptyArenaFor = 0;
      this._act(boss, target, delta);
    }

    this._syncMob();

    // ── Broadcast at 10 Hz, and only while contested ────────────
    //
    // The accumulator **subtracts** the interval rather than resetting to zero, so the
    // rate is 10 Hz rather than "however many whole frames fit in 0.1 s". At 60 fps
    // six frames of `1/60` sum to 0.09999999999999999, which is *less* than 0.1 — so
    // zeroing would silently make this an 8.5 Hz broadcast and the discrepancy would
    // only ever show up as slightly stuttery boss movement on a guest.
    this._stateAccumulator += delta;
    const interval = 1 / STATE_HZ;
    while (this._stateAccumulator + 1e-9 >= interval) {
      this._stateAccumulator -= interval;
      this._send({ type: 'BOSS_STATE', ...boss.statePayload() });
    }
  }

  /** Everyone inside the arena, with their positions. */
  _playerPositions() {
    const out = [];
    if (this._player && this._player.position) {
      // §6.4 — the host is a player. Its own position goes through the same list.
      out.push({ id: this._localContributorId || 'host', position: this._player.position });
    }
    if (this._getPlayerPositions) {
      try {
        for (const p of this._getPlayerPositions() || []) {
          if (p && p.position) out.push(p);
        }
      } catch { /* a disconnecting player is not an error */ }
    }
    return out;
  }

  _nearestPlayer(players, from) {
    let best = null;
    let bestDist = Infinity;
    for (const p of players) {
      const dx = p.position.x - from.x;
      const dz = p.position.z - from.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist && dist <= this.boss.arenaRadius + 8) {
        best = p; bestDist = dist;
      }
    }
    return best ? { ...best, distance: bestDist } : null;
  }

  /** Face and chase the target, and fire whatever is off cooldown. */
  _act(boss, target, delta) {
    const dx = target.position.x - boss.position.x;
    const dz = target.position.z - boss.position.z;
    boss.yaw = Math.atan2(dx, dz);

    const phase = boss.phase;
    const speed = boss.definition.speed * (phase.speedMultiplier || 1)
      * (boss.chargeRemaining > 0 ? 3 : 1);

    if (target.distance > (phase.abilities[0]?.range || 3)) {
      const inv = 1 / (target.distance || 1);
      boss.position.x += dx * inv * speed * delta;
      boss.position.z += dz * inv * speed * delta;
      boss.aiState = boss.chargeRemaining > 0 ? 'chase' : 'wander';
    } else {
      boss.aiState = 'attack';
    }

    // Stay in the arena. Q4 is unresolved and §8.4's reset covers the case where a
    // player kites it out; this keeps it from wandering out on its own.
    const cdx = boss.position.x - boss.arenaCentre.x;
    const cdz = boss.position.z - boss.arenaCentre.z;
    const fromCentre = Math.sqrt(cdx * cdx + cdz * cdz);
    if (fromCentre > boss.arenaRadius) {
      const pull = boss.arenaRadius / fromCentre;
      boss.position.x = boss.arenaCentre.x + cdx * pull;
      boss.position.z = boss.arenaCentre.z + cdz * pull;
    }

    for (const { ability, key } of boss.readyAbilities()) {
      if (this._useAbility(boss, ability, target)) {
        boss.useAbility(key, ability);
        break; // one per tick; the global cooldown paces the rest
      }
    }
  }

  /** @returns {boolean} whether the ability actually fired */
  _useAbility(boss, ability, target) {
    switch (ability.kind) {
      case BOSS_ABILITIES.MELEE: {
        if (target.distance > (ability.range || 3)) return false;
        // Damage lands on the local player only when the local player is the target.
        // A guest's damage is applied on the guest, from the `BOSS_STATE` they receive
        // — this runner does not reach into other people's health.
        if (this._vitals && this._isLocal(target)) {
          this._vitals.takeDamage(ability.damage || boss.definition.damage, DAMAGE_SOURCES.BOSS);
        }
        return true;
      }

      case BOSS_ABILITIES.CHARGE: {
        if (target.distance < 6 || target.distance > (ability.range || 20)) return false;
        if (ability.teleport) {
          // "Burrow and surface" — the Dune Colossus closes the distance the only way
          // something that size plausibly can.
          boss.position.x = target.position.x;
          boss.position.z = target.position.z;
        }
        return true;
      }

      case BOSS_ABILITIES.SUMMON: {
        if (!this._mobs || typeof this._mobs.spawnMobAt !== 'function') return false;
        this._adds = this._adds.filter((m) => m && !m.isDead);
        if (this._adds.length >= (ability.max || 4)) return false;

        for (let i = 0; i < (ability.count || 1); i++) {
          const angle = (i / (ability.count || 1)) * Math.PI * 2;
          const add = this._mobs.spawnMobAt(ability.mob, {
            x: boss.position.x + Math.cos(angle) * 4,
            y: boss.position.y,
            z: boss.position.z + Math.sin(angle) * 4,
          });
          if (add) this._adds.push(add);
        }
        return true;
      }

      case BOSS_ABILITIES.HAZARD_POOL: {
        return this._writePool(boss, ability, target);
      }

      case BOSS_ABILITIES.SHIELD:
        return true; // `useAbility` sets the shield; there is nothing else to do

      default:
        return false;
    }
  }

  /**
   * Write a disc of hazard blocks onto the arena floor.
   *
   * §8.3's payoff, and the reason S4 came first: a lava pool a boss creates is the same
   * block with the same damage tick as a lava pool the world generated. There is no
   * boss-specific damage code here at all — `HazardSystem` was already looking.
   *
   * The previous blocks are recorded so the pool can be reverted when it expires. A
   * boss that permanently paved an arena in lava would make a wipe unrecoverable.
   */
  _writePool(boss, ability, target) {
    if (!this._world || typeof this._world.setBlockAtWorld !== 'function') return false;

    const blockId = BLOCK_TYPES[String(ability.block).toUpperCase()];
    if (blockId === undefined) {
      // A named block that does not exist is a definition bug, and a silent one — the
      // pool would simply never appear. D-64's shape, so it is logged.
      console.warn(`[BossEncounter] Unknown hazard block "${ability.block}"`);
      return false;
    }

    const centre = { x: Math.floor(target.position.x), z: Math.floor(target.position.z) };
    const radius = ability.radius || 3;
    const previous = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const x = centre.x + dx;
        const z = centre.z + dz;
        const y = this._groundAt(x, z) - 2;
        try {
          previous.push({ x, y, z, block: this._world.getBlockAtWorld(x, y, z) });
          this._world.setBlockAtWorld(x, y, z, blockId);
        } catch { /* an unloaded column is not an error */ }
      }
    }

    boss.addPool(blockId, centre, radius, ability.duration || 12, previous);
    return true;
  }

  /** Put back what a pool covered. */
  _reapPools() {
    if (!this.boss || !this._world || typeof this._world.setBlockAtWorld !== 'function') return;
    for (const pool of this.boss.reapExpiredPools()) {
      for (const cell of pool.previous) {
        try { this._world.setBlockAtWorld(cell.x, cell.y, cell.z, cell.block); } catch { /* gone */ }
      }
    }
  }

  _isLocal(target) {
    return !this._localContributorId || target.id === this._localContributorId || target.id === 'host';
  }

  /** Keep the drawn mob in step with the authoritative entity. */
  _syncMob() {
    if (!this.bossMob || !this.boss) return;
    this.bossMob.position.x = this.boss.position.x;
    this.bossMob.position.y = this.boss.position.y;
    this.bossMob.position.z = this.boss.position.z;
    this.bossMob.yaw = this.boss.yaw;
    this.bossMob.health = this.boss.hp;
  }

  // ── Damage in ─────────────────────────────────────────────────

  /**
   * A validated hit. Both the socket path and the host's own attacks land here.
   *
   * §6.3's validation, and §6.4's one-code-path rule: the host's swings arrive through
   * `applyHit` with a null `playerId`, and a guest's arrive from `BOSS_HIT` with the
   * relay's. Same function, same arithmetic.
   *
   * @returns {boolean} whether it was applied
   */
  applyHit({ bossId, damage, contributorId, playerId, position }) {
    const boss = this.boss;
    if (!boss || boss.isDead) return false;
    if (bossId && bossId !== boss.id) return false;

    if (!Number.isFinite(damage) || damage <= 0) return false;
    if (damage > maxLegalHit()) {
      console.warn(`[BossEncounter] Rejected oversized hit: ${damage}`);
      return false;
    }

    // In the arena, with latency slack. A hit from across the world is not one.
    if (position) {
      const dx = position.x - boss.position.x;
      const dz = position.z - boss.position.z;
      if (Math.sqrt(dx * dx + dz * dz) > boss.arenaRadius + 16) {
        console.warn('[BossEncounter] Rejected out-of-arena hit');
        return false;
      }
    }

    // Rate limit, per player, at the fastest legal attack speed with tolerance. Never
    // kick — §6.3 — a laggy client is not a cheater.
    if (playerId && !this._rateOk(playerId)) return false;

    const result = boss.takeDamage(damage, contributorId || this._localContributorId);
    if (result.dealt <= 0 && !result.shieldBroke) {
      this._fire(this.onBossChanged, boss);
      return true; // a shielded hit is applied, it just does not reduce HP
    }

    this._syncMob();
    this._fire(this.onBossChanged, boss);

    if (result.died) this._defeat(boss);
    return true;
  }

  /** Fastest legal attack is 4.0/s at `attackSpeed: 0`; 12/s is generous slack. */
  _rateOk(playerId) {
    const now = Date.now();
    const window = 1000;
    const stamps = (this._hitLog.get(playerId) || []).filter((t) => t > now - window);
    if (stamps.length >= 12) return false;
    stamps.push(now);
    this._hitLog.set(playerId, stamps);
    return true;
  }

  // ── Ending ────────────────────────────────────────────────────

  _defeat(boss) {
    const contributors = boss.getContributors();
    // §8.5 — the host rolls once and ships the result. Four clients rolling
    // independently would produce four different answers about what dropped.
    const loot = this._rollLoot(boss);

    // The finale's terminal state is `defeated`; a seal's is `broken`. Same call, and
    // `setFinaleState` knows which vocabulary it is in.
    this._seals.setSeal(boss.sealId, boss.sealId === 'finale' ? 'defeated' : 'broken');
    const state = this._quests.getState();
    const seal = boss.sealId === 'finale' ? state.finale : state.seals[boss.sealId];
    if (seal) {
      if (!Array.isArray(seal.brokenBy)) seal.brokenBy = [];
      for (const id of contributors) {
        if (!seal.brokenBy.includes(id) && seal.brokenBy.length < 4) seal.brokenBy.push(id);
      }
      if (!seal.brokenAt) seal.brokenAt = Date.now();
    }

    this._quests.recordBossDefeat(boss.type);

    // Loot to **every** contributor, not the killer (§8.4). Locally that is the one
    // inventory this process owns; the rest is in `BOSS_DEFEATED` for the clients.
    if (this._inventory && typeof this._inventory.addItem === 'function') {
      const mine = this._localContributorId && contributors.includes(this._localContributorId);
      if (mine || contributors.length === 0) {
        for (const drop of loot) {
          try { this._inventory.addItem(drop.item, drop.count); } catch { /* full */ }
        }
      }
    }

    this._send({
      type: 'BOSS_DEFEATED',
      bossId: boss.id, sealId: boss.sealId, contributors, loot,
    });
    this._fire(this.onBossDefeated, boss, loot, contributors);

    this._despawnMob();
    this._clearAdds();
    this.boss = null;
  }

  /**
   * One roll, on the host. `mobDropTable.rollDrops` uses bare `Math.random()`, which is
   * exactly why this cannot be left to the clients.
   */
  _rollLoot(boss) {
    const out = [];
    for (const drop of boss.definition.drops || []) {
      if (Math.random() * 100 > (drop.weight ?? 100)) continue;
      const span = (drop.maxCount ?? 1) - (drop.minCount ?? 1);
      const count = (drop.minCount ?? 1) + Math.floor(Math.random() * (span + 1));
      if (count > 0) out.push({ item: drop.item, count });
    }
    return out;
  }

  /**
   * Wipe or walk-away. Full HP, no partial credit, and it costs nothing but time —
   * Q5's assumption, and the kind one.
   */
  reset(reason = 'reset') {
    const boss = this.boss;
    if (!boss) return;

    this._seals.setSeal(boss.sealId, 'primed');
    this._send({ type: 'BOSS_DESPAWN', bossId: boss.id, reason });
    this._fire(this.onBossDespawned, boss, reason);

    this._revertAllPools();
    this._despawnMob();
    this._clearAdds();
    this.boss = null;
  }

  _revertAllPools() {
    if (!this.boss || !this._world || typeof this._world.setBlockAtWorld !== 'function') return;
    for (const pool of this.boss.pools) {
      for (const cell of pool.previous) {
        try { this._world.setBlockAtWorld(cell.x, cell.y, cell.z, cell.block); } catch { /* gone */ }
      }
    }
    this.boss.pools = [];
  }

  _despawnMob() {
    if (this.bossMob && this._mobs && typeof this._mobs.removeMob === 'function') {
      try { this._mobs.removeMob(this.bossMob.id); } catch { /* already gone */ }
    }
    this.bossMob = null;
  }

  _clearAdds() {
    if (this._mobs && typeof this._mobs.removeMob === 'function') {
      for (const add of this._adds) {
        if (add && !add.isDead) {
          try { this._mobs.removeMob(add.id); } catch { /* already gone */ }
        }
      }
    }
    this._adds = [];
  }

  _send(msg) {
    if (!this._broadcast) return; // single-player: the broadcast is the no-op (§6.5)
    try { this._broadcast(msg); } catch (e) { console.warn('[BossEncounter] broadcast failed:', e && e.message); }
  }

  _fire(fn, ...args) {
    if (typeof fn !== 'function') return;
    try { fn(...args); } catch (e) { console.warn('[BossEncounter] callback threw:', e && e.message); }
  }
}

export { getBossDefinition };
