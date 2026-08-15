/**
 * Cuubz — one boss encounter's state (S6)
 *
 * ─── EVERY TIMER IS INITIALISED IN THE CONSTRUCTOR ──────────────────────────
 *
 * `quest_implementation.md` §8.2, stated as a rule because it is the bug that made the
 * deleted `Boss.js` worthless: it left `phaseTransitionTimer` **undefined**, so a
 * deserialized boss compared `undefined > 0`, got `NaN` into its arithmetic, and became
 * permanently frozen and **unkillable**. Nothing caught it — the class had 1,135 lines
 * and no test that drove a boss to death.
 *
 * So: every timer this class has is written in the constructor with a real number,
 * `deserialize` goes through the constructor rather than assigning fields onto a bare
 * object, and `bossEntity.test.js` constructs each of the six bosses, drives it through
 * every phase threshold, and asserts it dies.
 *
 * ─── IT HOLDS STATE, NOT BEHAVIOUR ──────────────────────────────────────────
 *
 * Where the boss is, how much health it has, which phase it is in, which abilities are
 * off cooldown, and who has hit it. What to *do* about any of that is `BossEncounter`'s,
 * which is the host-side runner. The split is what lets a guest hold one of these purely
 * to draw a health bar with.
 */

import { getBossDefinition, BOSS_ABILITIES } from '../mobs/bossDefinitions.js';
import { MAX_PLAYERS_LIMIT } from '../../../shared/protocol.js';

export class BossEntity {
  /**
   * @param {object} config
   * @param {string} config.type — a `BOSS_DEFINITIONS` key
   * @param {string} config.sealId
   * @param {{x,y,z}} config.position
   * @param {{x,z,y?}} config.arenaCentre
   * @param {number} [config.playerCount=1] — scales HP; see `scaledMaxHp`
   * @param {string} [config.id] — for a client mirroring the host's instance
   */
  constructor(config) {
    const def = getBossDefinition(config.type);
    if (!def) throw new Error(`BossEntity: unknown boss type "${config.type}"`);

    this.id = config.id || `boss_${config.type}_${config.sealId}`;
    this.type = config.type;
    this.sealId = config.sealId;
    this.definition = def;

    this.position = { ...(config.position || { x: 0, y: 64, z: 0 }) };
    this.yaw = 0;
    this.velocity = { x: 0, y: 0, z: 0 };

    this.arenaCentre = { ...(config.arenaCentre || { x: this.position.x, z: this.position.z }) };
    this.arenaRadius = def.hitbox ? 24 : 24;

    this.playerCount = Math.max(1, Math.min(MAX_PLAYERS_LIMIT, config.playerCount || 1));
    this.maxHp = BossEntity.scaledMaxHp(def, this.playerCount);
    this.hp = this.maxHp;

    // ── Timers. Every one of them, with a number. See the header. ──
    this.phaseIndex = 0;
    this.phaseTransitionTimer = 0;
    this.abilityTimers = {};
    this.globalCooldown = 0;
    this.aliveFor = 0;
    this.emptyArenaFor = 0;
    this.chargeRemaining = 0;
    this.shieldHp = 0;
    this.shieldRemaining = 0;
    this._resetAbilityTimers();

    this.aiState = 'idle';
    this.isDead = false;
    this.targetId = null;

    /** `characterId → damage dealt`. Everyone in here gets loot (§8.4). */
    this.contributors = new Map();

    /** Hazard pools this boss has written, so they can be cleaned up. */
    this.pools = [];
  }

  /**
   * Boss HP by player count.
   *
   * **Open question Q5 gets an answer here, and it is a conservative one.** The plan
   * says scaling is unspecified and floats "2× for four players?". Linear-per-player
   * makes a four-player fight four times as long, which is not four times as fun; the
   * ×1.6 at four players below keeps a full party's fight meaningfully longer than a
   * solo one without turning it into a health-bar marathon. It is one formula in one
   * place precisely so it is cheap to retune once anyone has played it.
   */
  static scaledMaxHp(def, playerCount) {
    const n = Math.max(1, playerCount);
    return Math.round(def.health * (1 + (n - 1) * 0.2));
  }

  _resetAbilityTimers() {
    this.abilityTimers = {};
    for (const phase of this.definition.phases) {
      for (let i = 0; i < phase.abilities.length; i++) {
        // Keyed by phase and index rather than by kind: a phase can hold two
        // `hazard_pool` abilities with different blocks and different cooldowns, and
        // keying on kind would silently collapse them into one.
        this.abilityTimers[`${phase.id}:${i}`] = 0;
      }
    }
  }

  // ── Phases ────────────────────────────────────────────────────

  get phase() {
    return this.definition.phases[this.phaseIndex];
  }

  get hpFraction() {
    return this.maxHp > 0 ? Math.max(0, this.hp) / this.maxHp : 0;
  }

  get isShielded() {
    return this.shieldHp > 0;
  }

  /**
   * Which phase this boss's current HP puts it in.
   *
   * Thresholds are descending fractions and the **last** one at or below the current
   * fraction wins, so a boss that takes a huge hit skips straight to the right phase
   * rather than stepping through the intermediate ones one tick at a time.
   */
  phaseIndexForHp() {
    const phases = this.definition.phases;
    let index = 0;
    for (let i = 0; i < phases.length; i++) {
      if (this.hpFraction <= phases[i].from) index = i;
    }
    return index;
  }

  /**
   * Move to the phase the current HP implies.
   * @returns {object|null} the new phase, or null if nothing changed
   */
  updatePhase() {
    const next = this.phaseIndexForHp();
    if (next === this.phaseIndex) return null;
    this.phaseIndex = next;
    // A brief pause while it comes apart and reassembles. A real number, always.
    this.phaseTransitionTimer = 1.2;
    this.globalCooldown = Math.max(this.globalCooldown, 1.2);
    return this.phase;
  }

  // ── Damage ────────────────────────────────────────────────────

  /**
   * @param {number} amount
   * @param {string|null} contributorId — a **character** id, as everywhere else
   * @returns {{ dealt:number, died:boolean, phaseChanged:object|null, shieldBroke:boolean }}
   */
  takeDamage(amount, contributorId = null) {
    if (this.isDead) return { dealt: 0, died: false, phaseChanged: null, shieldBroke: false };
    if (!Number.isFinite(amount) || amount <= 0) {
      return { dealt: 0, died: false, phaseChanged: null, shieldBroke: false };
    }

    // Contribution is recorded even when a shield eats the hit. A player who spent the
    // whole shield phase breaking the shield did fight the boss, and §8.4 gives loot to
    // everyone in `brokenBy` rather than to the killer.
    if (contributorId) {
      this.contributors.set(contributorId, (this.contributors.get(contributorId) || 0) + amount);
    }

    let shieldBroke = false;
    if (this.shieldHp > 0) {
      this.shieldHp -= amount;
      if (this.shieldHp <= 0) {
        this.shieldHp = 0;
        this.shieldRemaining = 0;
        shieldBroke = true;
      }
      return { dealt: 0, died: false, phaseChanged: null, shieldBroke };
    }

    this.hp = Math.max(0, this.hp - amount);
    const phaseChanged = this.updatePhase();

    if (this.hp <= 0) {
      this.isDead = true;
      this.aiState = 'dead';
      return { dealt: amount, died: true, phaseChanged, shieldBroke };
    }
    return { dealt: amount, died: false, phaseChanged, shieldBroke };
  }

  /** Everyone who landed a hit, best first, capped at a full session. */
  getContributors() {
    return [...this.contributors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PLAYERS_LIMIT)
      .map(([id]) => id);
  }

  // ── Per-tick bookkeeping ──────────────────────────────────────

  /**
   * Advance every timer. Behaviour is `BossEncounter`'s; this only counts down.
   * @param {number} delta — seconds
   */
  tick(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.aliveFor += delta;

    this.phaseTransitionTimer = Math.max(0, this.phaseTransitionTimer - delta);
    this.globalCooldown = Math.max(0, this.globalCooldown - delta);
    this.chargeRemaining = Math.max(0, this.chargeRemaining - delta);

    for (const key of Object.keys(this.abilityTimers)) {
      this.abilityTimers[key] = Math.max(0, this.abilityTimers[key] - delta);
    }

    if (this.shieldRemaining > 0) {
      this.shieldRemaining = Math.max(0, this.shieldRemaining - delta);
      if (this.shieldRemaining === 0) this.shieldHp = 0;
    }

    // Expire hazard pools this boss wrote.
    for (const pool of this.pools) pool.remaining -= delta;
  }

  /** Pools whose time is up, removed from the list and returned for cleanup. */
  reapExpiredPools() {
    const expired = this.pools.filter((p) => p.remaining <= 0);
    if (expired.length > 0) this.pools = this.pools.filter((p) => p.remaining > 0);
    return expired;
  }

  /**
   * Abilities that are off cooldown, in the current phase.
   *
   * Returns nothing at all during a phase transition or a global cooldown: the boss
   * coming apart and reassembling is a real pause, and it is the window a party uses to
   * heal and reposition.
   */
  readyAbilities() {
    if (this.isDead) return [];
    if (this.phaseTransitionTimer > 0 || this.globalCooldown > 0) return [];

    const phase = this.phase;
    const ready = [];
    for (let i = 0; i < phase.abilities.length; i++) {
      if (this.abilityTimers[`${phase.id}:${i}`] <= 0) {
        ready.push({ ability: phase.abilities[i], key: `${phase.id}:${i}` });
      }
    }
    return ready;
  }

  /** Put an ability on cooldown and take a short global one. */
  useAbility(key, ability) {
    this.abilityTimers[key] = ability.cooldown || 1;
    // Enough that two abilities cannot land on the same frame, little enough that it
    // does not become the real cooldown.
    this.globalCooldown = Math.max(this.globalCooldown, 0.35);

    if (ability.kind === BOSS_ABILITIES.SHIELD) {
      this.shieldHp = ability.hp || 100;
      this.shieldRemaining = ability.duration || 15;
    }
    if (ability.kind === BOSS_ABILITIES.CHARGE) {
      this.chargeRemaining = 1.2;
    }
  }

  /** Record a hazard pool so it can be reaped later. */
  addPool(blockId, centre, radius, duration, previous) {
    this.pools.push({
      blockId, centre: { ...centre }, radius,
      remaining: duration, previous: previous || [],
    });
  }

  // ── Wire form ─────────────────────────────────────────────────

  /**
   * `BOSS_SPAWN`'s payload. Everything a client needs to build its own mirror.
   *
   * The boss's type is `bossType`, **not** `type`. Every message on this wire carries
   * its protocol type in `type`, and a payload field of the same name spread into the
   * same object silently overwrites it — the message would go out as
   * `{ type: 'forest_warden' }`, hit the relay's `default:` branch, and be logged as an
   * unknown message type while the boss never appeared for anyone. Caught by the test
   * that asserts the first broadcast is a `BOSS_SPAWN`.
   */
  spawnPayload() {
    return {
      bossId: this.id,
      bossType: this.type,
      sealId: this.sealId,
      position: { ...this.position },
      maxHp: this.maxHp,
      arena: { ...this.arenaCentre, radius: this.arenaRadius },
    };
  }

  /** `BOSS_STATE`'s payload — 10 Hz while contested, ~120 bytes. §6.2. */
  statePayload() {
    return {
      bossId: this.id,
      x: Math.round(this.position.x * 100) / 100,
      y: Math.round(this.position.y * 100) / 100,
      z: Math.round(this.position.z * 100) / 100,
      yaw: Math.round(this.yaw * 100) / 100,
      hp: Math.round(this.hp),
      phase: this.phaseIndex,
      aiState: this.aiState,
      shield: Math.round(this.shieldHp),
    };
  }

  /** Apply a `BOSS_STATE` on a client. Monotonic on nothing — the host is the truth. */
  applyState(data) {
    if (!data) return;
    if (Number.isFinite(data.x)) this.position.x = data.x;
    if (Number.isFinite(data.y)) this.position.y = data.y;
    if (Number.isFinite(data.z)) this.position.z = data.z;
    if (Number.isFinite(data.yaw)) this.yaw = data.yaw;
    if (Number.isFinite(data.hp)) {
      this.hp = data.hp;
      if (this.hp <= 0) { this.isDead = true; this.aiState = 'dead'; }
    }
    if (Number.isFinite(data.phase)) this.phaseIndex = Math.max(0, Math.min(this.definition.phases.length - 1, data.phase));
    if (Number.isFinite(data.shield)) this.shieldHp = data.shield;
    if (typeof data.aiState === 'string') this.aiState = data.aiState;
  }

  serialize() {
    return {
      id: this.id, type: this.type, sealId: this.sealId,
      position: { ...this.position }, hp: this.hp, maxHp: this.maxHp,
      phaseIndex: this.phaseIndex, playerCount: this.playerCount,
      arenaCentre: { ...this.arenaCentre },
      contributors: [...this.contributors.entries()],
    };
  }

  /**
   * Rebuild from `serialize()`.
   *
   * **Goes through the constructor.** The deleted `Boss.js` deserialized by assigning
   * fields onto an object, which is precisely how it ended up with an undefined
   * `phaseTransitionTimer` and an unkillable boss. Every timer is re-initialised here by
   * construction, and only the fields that are genuinely state are copied over.
   */
  static deserialize(data) {
    if (!data || !data.type) return null;
    const boss = new BossEntity({
      type: data.type,
      sealId: data.sealId,
      position: data.position,
      arenaCentre: data.arenaCentre,
      playerCount: data.playerCount,
      id: data.id,
    });
    if (Number.isFinite(data.maxHp) && data.maxHp > 0) boss.maxHp = data.maxHp;
    if (Number.isFinite(data.hp)) boss.hp = Math.max(0, Math.min(boss.maxHp, data.hp));
    boss.phaseIndex = boss.phaseIndexForHp();
    if (Array.isArray(data.contributors)) boss.contributors = new Map(data.contributors);
    if (boss.hp <= 0) { boss.isDead = true; boss.aiState = 'dead'; }
    return boss;
  }
}
