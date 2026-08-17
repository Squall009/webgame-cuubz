/**
 * Cuubz — the player can be hurt, and can die (S3)
 *
 * ─── §2.2, WHICH IS THE LARGEST SINGLE HOLE IN THE GAME ─────────────────────
 *
 * `src/game/entities/Player.js` has `respawn(spawnPoint)` and **no `health`, no
 * `takeDamage`, no death**. `MobIntegration.init()` installs `onMobAttack` only
 * `if (survivalSystem)`, and `initMobs.js` passed `null`. So: mobs could not damage the
 * player, the player could not die, and no block was hazardous. Every "Boss Mechanics"
 * line in `questStoryline.md` described damage with no receiver, and so did the entire
 * premise of a dangerous Lava biome.
 *
 * ─── HEALTH ONLY. NOT THE 1,159-LINE `SurvivalSystem` ───────────────────────
 *
 * PR 34 deleted `SurvivalSystem` (hunger, thirst, sleep, stamina, its own competing
 * `#survival-hud`) and `DamageSystem` (627 lines, and D-64's pre-renumbering block ids).
 * The plan's recommendation is to salvage the *shape*, not the code, and to build the
 * smallest thing S4 and S6 actually need: **health, damage with the armour reduction
 * that already exists, death, respawn, and a writer for `#health-meter .meter-fill`.**
 *
 * The other four meters stay at 100% and stay honest. A hunger bar that moves and does
 * nothing is worse than one that visibly does not move.
 *
 * ─── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
 *
 * No status effects, no damage-over-time timers, no per-player debuff state. Hazards are
 * a per-tick lookup against the block under the player (§3.5) and they stop the instant
 * you step off — which is exactly why they need nothing here beyond `takeDamage`. The
 * moment a hazard lingers it becomes player state that has to survive death, disconnect
 * and rejoin, and this file stops being 200 lines.
 */

import { DAMAGE_SOURCES } from '../data/DamageSources.js';

/** Full health. 20 is two rows of ten hearts in the genre's idiom. */
export const MAX_HEALTH = 20;

/**
 * Seconds of not being hit before health starts coming back, and the rate once it does.
 *
 * Slow and unconditional. There is no hunger system to gate regeneration on, and a game
 * where the only way to heal is to quit to the menu is a game where every hazard is
 * permanent.
 *
 * ─── S11: THE DELAY IS THE GATE. THE RATE WAS JUST SLOW ─────────────────────
 *
 * These were 8 s and 0.5 HP/s, a full heal in ~48 s, and they were set (S3) when this
 * was the player's *only* recovery — D-123 found that no food in the game did anything.
 * With eating in place (S10) regen's job is the out-of-combat top-up, and its old rate
 * failed at that specific job: the loop a boss arena forces is fight → run out → wait →
 * come back, and `BossEncounter.RESET_AFTER_EMPTY_SECONDS` is **60**. A player who
 * disengaged at 4 HP and regenerated correctly needed 8 + 32 = 40 s, leaving 20 s of
 * margin before the boss reset to full and the whole attempt was discarded. Nobody chose
 * that; it fell out of two constants set three stages apart.
 *
 * At 1.0 HP/s a full heal is 28 s and the loop is comfortably inside the reset. **Raising
 * the rate does not weaken combat, because the delay is what keeps regen out of it:**
 * every hazard in `HAZARD_DPS` lands a hit at least every 4 s, so `_timeSinceDamage`
 * never reaches 8 while the player is standing in anything. `bossBalance.test.js` holds
 * both halves — full heal under the reset, and the weakest hazard's tick under the delay.
 */
export const REGEN_DELAY_SECONDS = 8;
export const REGEN_PER_SECOND = 1.0;

/**
 * Seconds of immunity after taking a hit.
 *
 * Not a fairness feature — a throughput one. Lava is 8 damage per second (§3.5) applied
 * every frame at 60 fps; without this the player would take 60 separate hits per second
 * and the damage flash would strobe. The hazard system's per-second rates assume it.
 * Mob attacks have their own cooldown and are unaffected.
 *
 * **S11 examined it and left it at 0.4**, which is worth recording as a decision rather
 * than as silence. The shortest attack cooldown anything in the game actually has is the
 * Corruption Overlord's true-form melee at 0.8 s, so this window has never suppressed an
 * intended hit and is doing exactly the one job its name claims. Growing it would start
 * silently eating boss swings — a balance change disguised as a safety valve — so
 * `bossBalance.test.js` asserts it stays below the shortest cooldown in `BOSS_DEFINITIONS`.
 */
export const INVULNERABLE_SECONDS = 0.4;

export class PlayerVitals {
  /**
   * @param {object} [config]
   * @param {object} [config.player] — the `Player`; read for position, written on respawn
   * @param {object} [config.inventory] — read for armour via `getEquipmentStats()`
   * @param {number} [config.maxHealth]
   */
  constructor(config = {}) {
    this._player = config.player || null;
    this._inventory = config.inventory || null;

    this.maxHealth = config.maxHealth || MAX_HEALTH;
    this.health = this.maxHealth;
    this.isDead = false;
    this.lastDamageSource = DAMAGE_SOURCES.NONE;

    this._timeSinceDamage = REGEN_DELAY_SECONDS;
    this._invulnerableFor = 0;

    /** `(amount, source, remaining) => void` */
    this.onDamage = null;
    /** `(source) => void` */
    this.onDeath = null;
    /** `() => void` */
    this.onRespawn = null;
    /** `(health, maxHealth) => void` — the HUD writer hangs off this. */
    this.onHealthChanged = null;
  }

  setInventory(inventory) {
    this._inventory = inventory;
  }

  setPlayer(player) {
    this._player = player;
  }

  /** 0..1, for the meter. */
  get fraction() {
    return this.maxHealth > 0 ? Math.max(0, this.health) / this.maxHealth : 0;
  }

  get isInvulnerable() {
    return this._invulnerableFor > 0;
  }

  /**
   * Apply damage, after armour.
   *
   * The armour formula is **not new** — it is the one already sitting in
   * `mobIntegration.js`, unreachable behind `if (survivalSystem)` since the survival
   * system was deleted. It is lifted here rather than left there so that lava, a boss's
   * ground slam and a corrupt wolf all reduce the same way; a hazard that ignored armour
   * while a mob respected it would be a balance decision made by accident of where the
   * code happened to live.
   *
   * @param {number} amount — raw damage, before armour
   * @param {string} [source] — a `DAMAGE_SOURCES` value
   * @param {object} [opts]
   * @param {boolean} [opts.ignoreArmor=false] — for sources armour should not stop
   * @param {boolean} [opts.ignoreInvulnerability=false]
   * @returns {number} the damage actually dealt
   */
  takeDamage(amount, source = DAMAGE_SOURCES.NONE, opts = {}) {
    if (this.isDead) return 0;
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (this._invulnerableFor > 0 && !opts.ignoreInvulnerability) return 0;

    const dealt = opts.ignoreArmor ? amount : this.applyArmor(amount);
    if (dealt <= 0) return 0;

    this.health = Math.max(0, this.health - dealt);
    this.lastDamageSource = source;
    this._timeSinceDamage = 0;
    if (!opts.ignoreInvulnerability) this._invulnerableFor = INVULNERABLE_SECONDS;

    this._fire(this.onDamage, dealt, source, this.health);
    this._fire(this.onHealthChanged, this.health, this.maxHealth);

    if (this.health <= 0) this._die(source);
    return dealt;
  }

  /**
   * Reduce damage by worn armour, capped at 80%.
   *
   * `totalArmor / 30` with a 0.8 ceiling: a full netherite set cannot make a player
   * immune to lava, which matters because §3.5's whole design is that lava kills quickly
   * and obviously.
   */
  applyArmor(amount) {
    if (!this._inventory || typeof this._inventory.getEquipmentStats !== 'function') {
      return amount;
    }
    let armorValue = 0;
    try {
      armorValue = this._inventory.getEquipmentStats().totalArmor || 0;
    } catch {
      return amount;
    }
    if (armorValue <= 0) return amount;
    const reduction = Math.min(0.8, armorValue / 30);
    // `Math.floor` would round a 1-damage hit through heavy armour down to 0 and make
    // the player immune to the slow hazards outright — the corrupt-ground drain is
    // 0.25 HP/s and would never land. Fractional health is fine; the meter is a bar.
    return amount * (1 - reduction);
  }

  /** Heal, clamped. Never revives — that is `respawn`'s job. */
  heal(amount) {
    if (this.isDead) return 0;
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    if (this.health !== before) this._fire(this.onHealthChanged, this.health, this.maxHealth);
    return this.health - before;
  }

  /**
   * Per-frame: tick the invulnerability window and regenerate.
   * @param {number} delta — seconds
   */
  update(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return;

    if (this._invulnerableFor > 0) {
      this._invulnerableFor = Math.max(0, this._invulnerableFor - delta);
    }
    if (this.isDead) return;

    this._timeSinceDamage += delta;
    if (this._timeSinceDamage < REGEN_DELAY_SECONDS) return;
    if (this.health >= this.maxHealth) return;

    this.heal(REGEN_PER_SECOND * delta);
  }

  _die(source) {
    this.isDead = true;
    this.health = 0;
    this._fire(this.onDeath, source);
  }

  /**
   * Come back at a spawn point.
   *
   * `character.spawnPoints[worldId]` is **already written** by `savePlayerState.js` on
   * the 30 s interval — it has been recorded for every session and read by nothing. This
   * is its first reader.
   *
   * @param {{x:number,y:number,z:number}} [spawnPoint]
   */
  respawn(spawnPoint) {
    this.health = this.maxHealth;
    this.isDead = false;
    this.lastDamageSource = DAMAGE_SOURCES.NONE;
    this._timeSinceDamage = REGEN_DELAY_SECONDS;
    // A moment of grace on arrival: respawning inside the lava that killed you and
    // dying again before the screen has redrawn is not a difficulty curve.
    this._invulnerableFor = INVULNERABLE_SECONDS * 5;

    if (this._player && spawnPoint) {
      if (typeof this._player.respawn === 'function') {
        this._player.respawn(spawnPoint);
      } else {
        this._player.position.x = spawnPoint.x;
        this._player.position.y = spawnPoint.y;
        this._player.position.z = spawnPoint.z;
        if (this._player.velocity) {
          this._player.velocity.x = 0;
          this._player.velocity.y = 0;
          this._player.velocity.z = 0;
        }
      }
    }

    this._fire(this.onHealthChanged, this.health, this.maxHealth);
    this._fire(this.onRespawn);
  }

  /** Serialize for the character save. Health is per-character, not per-world. */
  serialize() {
    return { health: this.health, maxHealth: this.maxHealth, isDead: this.isDead };
  }

  restore(data) {
    if (!data || typeof data !== 'object') return;
    if (Number.isFinite(data.maxHealth) && data.maxHealth > 0) this.maxHealth = data.maxHealth;
    if (Number.isFinite(data.health)) {
      this.health = Math.max(0, Math.min(this.maxHealth, data.health));
    }
    // A player who quit while dead comes back alive. Persisting death means loading into
    // a death screen with no way to dismiss it if the respawn path ever fails.
    this.isDead = false;
    if (this.health <= 0) this.health = this.maxHealth;
    this._fire(this.onHealthChanged, this.health, this.maxHealth);
  }

  _fire(fn, ...args) {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (e) {
      console.warn('[PlayerVitals] callback threw:', e && e.message);
    }
  }
}
