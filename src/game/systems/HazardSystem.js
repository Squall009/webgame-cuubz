/**
 * Cuubz — environmental damage (S4)
 *
 * ─── THE WHOLE SYSTEM IS A TABLE AND A LOOKUP ───────────────────────────────
 *
 * Per tick: find the block the player is standing in and the one they are standing on,
 * look both up in `HAZARD_DPS`, and apply the higher rate. That is the entire design,
 * and §3.5 spends most of its length explaining why it must stay that small.
 *
 * **Nothing lingers.** No status effects, no poison timers, no per-player debuff state.
 * The question is *"is the block I am touching hazardous, right now"*, evaluated fresh
 * every tick, and the moment the answer is no the damage stops in the same tick. There
 * is nothing to cure, nothing to wait out and nothing to carry home.
 *
 * That is not a simplification for its own sake. The moment a hazard lingers it becomes
 * player state that has to survive death, disconnect and rejoin — it has to be
 * serialized, synced, migrated and reasoned about in four more files. A one-table system
 * is worth protecting.
 *
 * ─── D-64, WHICH IS THE MOST LIKELY WAY TO GET THIS WRONG ───────────────────
 *
 * The deleted `DamageSystem.js` hard-coded `LAVA_ID = 15` and `TOXIC_SLIME_ID = 17`
 * against a registry where lava is 47 and toxic slime 188. Block ids have been
 * renumbered in this project before. Its test asserted the *same wrong mapping*, so it
 * passed, and the system silently applied lava damage to whatever block 15 happened to
 * be.
 *
 * So: **every id here is read from `BLOCK_TYPES`, never written as a literal**, the
 * table is keyed by computed member access, and `hazardSystem.test.js` asserts the
 * resolved ids equal the registry's — which is the assertion the old one lacked.
 *
 * ─── SCALE ──────────────────────────────────────────────────────────────────
 *
 * Lava and corruption are not on the same scale and must not feel like it. Lava kills
 * from full in about two and a half seconds. Corrupted ground costs 1 HP per four
 * seconds — crossing a patch is a sliver of health; standing in the middle of one mining
 * for a minute is a real problem.
 *
 * ─── S11: THERE ARE THREE BANDS, AND TWO OF THEM USED TO BE ONE ─────────────
 *
 * The table has to read as three categories, because that is what it is for: **lava is
 * death**, **a boss's pool means get out now**, and **ambient corruption is attrition**.
 * Magma at 1.0 and toxic slime at 1.5 both sat in the attrition band, which made a boss's
 * ground slam cost less than one swing of its own melee — a Lava Titan's phase-one pool
 * was 14 seconds of standing in 0.5 HP/s through iron armour. Nobody moves for that.
 *
 * 2.0 and 2.5 put them where they belong: through a full iron set (50%) a Titan pool is
 * 1 HP/s and its whole 14 s duration is 14 HP, most of a health bar. Still nowhere near
 * lava, which ignores armour entirely and is the only thing here that kills by surprise.
 * `test/unit/game/bossBalance.test.js` holds the ordering and the three bands.
 */

import { BLOCK_TYPES } from '../../engine/world/BlockRegistry.js';
import { DAMAGE_SOURCES } from '../data/DamageSources.js';

/**
 * Damage per second, by block id.
 *
 * Computed keys off `BLOCK_TYPES` — see the header. A literal in this table is the
 * single most likely way to reintroduce D-64.
 */
export const HAZARD_DPS = Object.freeze({
  [BLOCK_TYPES.LAVA]:          8.0,   // lethal in ~2.5 s from full
  [BLOCK_TYPES.MAGMA]:         2.0,   // 10 s from full — get off it
  [BLOCK_TYPES.CORRUPT_GRASS]: 0.25,  // ~1 HP per 4 s
  [BLOCK_TYPES.CORRUPT_STONE]: 0.25,
  [BLOCK_TYPES.TOXIC_SLIME]:   2.5,   // 8 s from full — the nastiest thing short of lava
});

/** Which `DAMAGE_SOURCES` value each hazard reports, for the death message. */
export const HAZARD_SOURCE = Object.freeze({
  [BLOCK_TYPES.LAVA]:          DAMAGE_SOURCES.LAVA,
  [BLOCK_TYPES.MAGMA]:         DAMAGE_SOURCES.LAVA,
  [BLOCK_TYPES.CORRUPT_GRASS]: DAMAGE_SOURCES.POISON,
  [BLOCK_TYPES.CORRUPT_STONE]: DAMAGE_SOURCES.POISON,
  [BLOCK_TYPES.TOXIC_SLIME]:   DAMAGE_SOURCES.POISON,
});

/**
 * Hazards a full armour set should not blunt.
 *
 * Lava is the whole reason `applyArmor` caps at 80%: §3.5's design is that it kills
 * quickly and obviously, and a player in netherite wading through it because the numbers
 * happened to work out is a different game. Armour still helps against the slow ones.
 */
const IGNORES_ARMOR = new Set([BLOCK_TYPES.LAVA]);

export class HazardSystem {
  /**
   * @param {object} config
   * @param {object} config.vitals — `PlayerVitals`
   * @param {object} config.player — read for position
   * @param {object} config.world — anything with `getBlockAtWorld(x, y, z)`;
   *   `state.chunkWorld` is the shim the collision code already uses
   * @param {function} [config.isCreative] — `() => boolean`
   */
  constructor(config) {
    this._vitals = config.vitals;
    this._player = config.player;
    this._world = config.world || null;
    this._isCreative = config.isCreative || (() => false);

    /** The block id currently hurting the player, or 0. Read by the HUD and by tests. */
    this.currentHazard = 0;

    // Damage is accumulated and applied in whole-ish amounts rather than as a fractional
    // hit every frame, because `PlayerVitals` opens a 0.4 s invulnerability window on
    // every landed hit — sixty tiny hits a second would land one and drop fifty-nine,
    // making the effective rate a function of frame rate. Accumulating means the rate is
    // what the table says regardless of fps.
    this._accumulated = 0;
  }

  setWorld(world) {
    this._world = world;
  }

  /**
   * The block id at a world position, or 0 if it cannot be read.
   * Never throws: this runs every frame and a chunk boundary is not an error.
   */
  _blockAt(x, y, z) {
    if (!this._world || typeof this._world.getBlockAtWorld !== 'function') return 0;
    try {
      return this._world.getBlockAtWorld(Math.floor(x), Math.floor(y), Math.floor(z)) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Which hazard is touching the player, and at what rate.
   *
   * Two probes: the block the player's feet occupy (standing *in* lava) and the one
   * directly beneath (standing *on* magma or corrupted ground). The higher rate wins —
   * a player in lava standing on corrupt stone is being killed by the lava.
   *
   * @returns {{ blockId: number, dps: number }}
   */
  sample() {
    const pos = this._player ? this._player.position : null;
    if (!pos) return { blockId: 0, dps: 0 };

    const inside = this._blockAt(pos.x, pos.y, pos.z);
    const below = this._blockAt(pos.x, pos.y - 0.1, pos.z);

    const insideDps = HAZARD_DPS[inside] || 0;
    const belowDps = HAZARD_DPS[below] || 0;

    if (insideDps === 0 && belowDps === 0) return { blockId: 0, dps: 0 };
    return insideDps >= belowDps
      ? { blockId: inside, dps: insideDps }
      : { blockId: below, dps: belowDps };
  }

  /**
   * @param {number} delta — seconds
   */
  update(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    if (!this._vitals || this._vitals.isDead) return;
    if (this._isCreative()) {
      // A player placing scenery does not want a lava lake to kill them, and the
      // storyline's hazards are a survival-mode idea.
      this.currentHazard = 0;
      this._accumulated = 0;
      return;
    }

    const { blockId, dps } = this.sample();

    // **The no-lingering guarantee, in one branch.** Step off and the accumulator is
    // discarded in the same tick — a partial tick's worth of damage does not follow the
    // player out of the biome, and there is no timer left running behind them.
    if (dps <= 0) {
      this.currentHazard = 0;
      this._accumulated = 0;
      return;
    }

    this.currentHazard = blockId;
    this._accumulated += dps * delta;

    // Apply in whole hit points. At 0.25 dps that is one hit every four seconds; at 8.0
    // it is eight hits a second, which the invulnerability window then paces.
    if (this._accumulated < 1) return;

    const amount = Math.floor(this._accumulated);
    this._accumulated -= amount;

    this._vitals.takeDamage(amount, HAZARD_SOURCE[blockId] || DAMAGE_SOURCES.NONE, {
      ignoreArmor: IGNORES_ARMOR.has(blockId),
      // Lava has to keep landing. Its whole design is that it kills in a couple of
      // seconds, and being gated behind a 0.4 s window per hit would stretch that out.
      ignoreInvulnerability: blockId === BLOCK_TYPES.LAVA,
    });
  }
}
