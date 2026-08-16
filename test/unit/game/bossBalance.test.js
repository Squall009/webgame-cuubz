/**
 * Cuubz — the boss numbers, against the player they are fought by (S11)
 *
 * ─── WHY A BALANCE TEST, AND WHAT IT CAN HONESTLY CLAIM ─────────────────────
 *
 * Nobody has played this game. Every constant in `bossDefinitions.js`, `BossEntity.js`,
 * `HazardSystem.js` and `PlayerVitals.js` was chosen by someone reasoning about a fight
 * they had not had, and `quest_implementation.md` §14 records the reasoning. A test
 * cannot tell you whether a fight is *fun*. What it can do is hold the handful of
 * relations that decide whether a fight is a fight **at all** — and five of the six
 * bosses were on the wrong side of the first one below.
 *
 * The relations are all between a boss number and a *player* number, which is the whole
 * point: a boss's speed means nothing on its own. So this file imports
 * `PLAYER_WALK_SPEED`, `PLAYER_SPRINT_MULTIPLIER` and `PLAYER_ATTACK_REACH` from the
 * files that define them rather than transcribing 5, 1.6 and 7 — the same rule
 * `BlockCategories.js` states and D-121 was the third bill for breaking.
 */

import { describe, it, expect } from 'vitest';
import { BOSS_DEFINITIONS, BOSS_ORDER, BOSS_ABILITIES } from '../../../src/game/mobs/bossDefinitions.js';
import { BossEntity } from '../../../src/game/entities/BossEntity.js';
import { RESET_AFTER_EMPTY_SECONDS } from '../../../src/game/systems/BossEncounter.js';
import { PLAYER_WALK_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../../../src/game/entities/Player.js';
import { PLAYER_ATTACK_REACH } from '../../../src/engine/loop/steps/CombatStep.js';
import { HAZARD_DPS } from '../../../src/game/systems/HazardSystem.js';
import { BLOCK_TYPES } from '../../../src/engine/world/BlockRegistry.js';
import {
  MAX_HEALTH, REGEN_DELAY_SECONDS, REGEN_PER_SECOND, INVULNERABLE_SECONDS,
} from '../../../src/game/entities/PlayerVitals.js';

const SPRINT_SPEED = PLAYER_WALK_SPEED * PLAYER_SPRINT_MULTIPLIER;
const bosses = BOSS_ORDER.map((type) => [type, BOSS_DEFINITIONS[type]]);
const meleeOf = (phase) => phase.abilities.find((a) => a.kind === BOSS_ABILITIES.MELEE);

describe('a boss has to be able to reach the player, and the player has to be able to leave', () => {
  it.each(bosses)('%s chases faster than the player walks', (type, def) => {
    // `BossEncounter._act` closes at `definition.speed * phase.speedMultiplier`. Below
    // the player's walk speed the gap never shrinks, so the boss's melee — its primary
    // and in two cases its only damage source — can never land on a player who backs
    // away while clicking. Five of the six were here: 3.2, 2.6, 2.2, 2.8 and 3.6 against
    // a walk speed of 5.
    expect(def.speed, `${type} cannot catch a walking player`).toBeGreaterThan(PLAYER_WALK_SPEED);
  });

  it.each(bosses)('%s can still be outrun at a sprint, in every phase', (type, def) => {
    // The other side of the same coin, and the reason the answer is not "make them all
    // fast": disengaging has to remain possible, because it is how a player eats, heals
    // and resets a fight going badly. Sprinting is not free — you cannot sprint away and
    // attack at the same time — so this is a real cost, not an escape hatch.
    for (const phase of def.phases) {
      const effective = def.speed * (phase.speedMultiplier || 1);
      expect(effective, `${type}/${phase.id} outruns a sprinting player`).toBeLessThan(SPRINT_SPEED);
    }
  });
});

describe('melee range against the player’s reach', () => {
  it.each(bosses)('%s always leaves a safe band, and never a comfortable one', (type, def) => {
    for (const phase of def.phases) {
      const melee = meleeOf(phase);
      expect(melee, `${type}/${phase.id} has no melee ability`).toBeTruthy();
      // Under the player's reach: there is always a distance from which the player can
      // hit and the boss cannot, so spacing is a skill rather than a coin flip.
      expect(melee.range, `${type}/${phase.id} out-reaches the player`)
        .toBeLessThan(PLAYER_ATTACK_REACH);
      // ...but not by much. At 3.4 against a reach of 7 the safe band was half the
      // engagement distance and a player could sit in it indefinitely.
      expect(melee.range, `${type}/${phase.id}'s safe band is a corridor, not a duel`)
        .toBeGreaterThan(PLAYER_ATTACK_REACH * 0.65);
    }
  });

  it.each(bosses)('%s reaches at least as far when enraged as when it opened', (type, def) => {
    let previous = 0;
    for (const phase of def.phases) {
      const range = meleeOf(phase).range;
      expect(range, `${type}/${phase.id} shrank its reach`).toBeGreaterThanOrEqual(previous);
      previous = range;
    }
  });

  it.each(bosses)('%s keeps ai.attackRange in step with its opening melee', (type, def) => {
    // `ai.attackRange` is the generic `mobAI` field. `BossEncounter` drives a boss and
    // never reads it, so the two can drift silently — and a boss IS a registered mob
    // definition, so anything that ever falls back to the ordinary AI would use it.
    expect(def.ai.attackRange, `${type}`).toBe(meleeOf(def.phases[0]).range);
  });
});

describe('the difficulty curve across the six fights', () => {
  it('boss HP never goes backwards along BOSS_ORDER', () => {
    // The player's damage output only goes up — stone 15.4 DPS, iron 19.8, diamond 26.4,
    // netherite 33.0 — so a later boss with less HP is a shorter fight against better
    // gear, which reads as the game getting easier at the exact moment the storyline
    // says it is getting harder. The Frost Serpent (480) sat behind the Lava Titan (520).
    const hp = BOSS_ORDER.map((t) => BOSS_DEFINITIONS[t].health);
    for (let i = 1; i < hp.length; i++) {
      expect(hp[i], `${BOSS_ORDER[i]} has less HP than ${BOSS_ORDER[i - 1]}`)
        .toBeGreaterThanOrEqual(hp[i - 1]);
    }
  });

  it('every seal boss splits its fight evenly between its two phases', () => {
    // The enrage is where a boss's third ability appears. At `from: 0.4` half of the
    // mechanical content was compressed into the last 40% of the HP bar.
    for (const [type, def] of bosses) {
      if (def.seal === 'finale') continue;
      expect(def.phases, `${type} is not a two-phase boss`).toHaveLength(2);
      expect(def.phases[1].from, `${type}'s enrage`).toBe(0.5);
    }
  });

  it('the Overlord is in thirds, descending, starting at full', () => {
    const phases = BOSS_DEFINITIONS.corruption_overlord.phases;
    expect(phases).toHaveLength(3);
    expect(phases[0].from).toBe(1.0);
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i].from).toBeLessThan(phases[i - 1].from);
    }
  });
});

describe('scaledMaxHp — what an extra player costs (Q5)', () => {
  it('keeps a full party’s fight about as long as a solo one, and never longer', () => {
    // Four players deal roughly four times the damage — a boss hitbox is 2.0–3.4 blocks
    // wide and `_nearestPlayer` means only ONE of them is ever the target, so a party is
    // strictly more DPS and strictly less danger per head. HP therefore has to scale
    // close to linearly just to hold the duration; ×1.6 at four players made the fight
    // 40% of its solo length.
    const def = BOSS_DEFINITIONS.forest_warden;
    const solo = BossEntity.scaledMaxHp(def, 1);
    expect(solo).toBe(def.health);

    for (const n of [2, 3, 4]) {
      const ratio = BossEntity.scaledMaxHp(def, n) / solo;
      // Duration ≈ ratio / n. Between 0.75 and 1.0 of the solo fight: a party is
      // rewarded for being a party, without the fight becoming a formality.
      expect(ratio / n, `${n} players`).toBeGreaterThanOrEqual(0.75);
      expect(ratio / n, `${n} players`).toBeLessThanOrEqual(1.0);
    }
  });

  it('is monotonic and clamps below 1 player', () => {
    const def = BOSS_DEFINITIONS.corruption_overlord;
    expect(BossEntity.scaledMaxHp(def, 0)).toBe(BossEntity.scaledMaxHp(def, 1));
    let previous = 0;
    for (let n = 1; n <= 4; n++) {
      const hp = BossEntity.scaledMaxHp(def, n);
      expect(hp).toBeGreaterThan(previous);
      previous = hp;
    }
  });
});

describe('the hazard ladder', () => {
  const dps = (block) => HAZARD_DPS[BLOCK_TYPES[block]];

  it('is ordered: lava kills, a boss pool hurts, ambient corruption grinds', () => {
    // Three categories, and they must be legible as three. Before S11 magma (1.0) and
    // toxic slime (1.5) both sat in the "grind" band, so a boss's ground slam cost less
    // than one swing of its own melee and there was no reason to move out of it.
    expect(dps('LAVA')).toBeGreaterThan(dps('TOXIC_SLIME'));
    expect(dps('TOXIC_SLIME')).toBeGreaterThan(dps('MAGMA'));
    expect(dps('MAGMA')).toBeGreaterThan(dps('CORRUPT_GRASS'));
    expect(dps('CORRUPT_GRASS')).toBe(dps('CORRUPT_STONE'));
  });

  it('lava kills from full in under three seconds, unarmoured or not', () => {
    // §3.5's whole design. `IGNORES_ARMOR` and `ignoreInvulnerability` are both set for
    // lava precisely so this number is the number.
    expect(MAX_HEALTH / dps('LAVA')).toBeLessThan(3);
  });

  it('a boss pool is a reason to move within a few seconds, not a rounding error', () => {
    // Standing in one through a full iron set (50% reduction) still costs a noticeable
    // fraction of the bar over the pool's lifetime.
    for (const block of ['MAGMA', 'TOXIC_SLIME']) {
      const secondsToDie = MAX_HEALTH / dps(block);
      expect(secondsToDie, block).toBeLessThan(20);
      expect(secondsToDie, block).toBeGreaterThan(5);
    }
  });

  it('ambient corruption is attrition — a minute of mining, not a crossing', () => {
    // §3.5: "crossing a patch is a sliver of health; standing in the middle of one
    // mining for a minute is a real problem."
    expect(dps('CORRUPT_GRASS') * 3).toBeLessThan(1);       // a 3 s crossing costs <1 HP
    expect(dps('CORRUPT_GRASS') * 60).toBeGreaterThan(MAX_HEALTH * 0.5); // a minute hurts
  });
});

describe('recovery, against the encounter that makes it necessary', () => {
  it('a full regeneration fits inside the arena reset with room to spare', () => {
    // The loop this bounds: fight, drop low, run out of the arena, wait, come back. If
    // the wait exceeds `RESET_AFTER_EMPTY_SECONDS` the boss returns to full HP and the
    // whole attempt is discarded, so a player recovering "correctly" would lose their
    // progress for it. At 0.5 HP/s that was 8 + 38 = 46 s against a 60 s reset.
    const fullHeal = REGEN_DELAY_SECONDS + MAX_HEALTH / REGEN_PER_SECOND;
    expect(fullHeal).toBeLessThan(RESET_AFTER_EMPTY_SECONDS * 0.75);
  });

  it('regeneration cannot start while any hazard is still ticking', () => {
    // The delay, not the rate, is what keeps regen out of combat — and the weakest
    // hazard in the game has to be able to hold it off, or standing in corruption
    // becomes free. Corruption applies 1 HP every `1/dps` seconds; that interval has to
    // stay under the delay.
    const slowest = Math.min(...Object.values(HAZARD_DPS));
    expect(1 / slowest).toBeLessThan(REGEN_DELAY_SECONDS);
  });

  it('the invulnerability window never suppresses an attack anything actually makes', () => {
    // It is a throughput guard, not a fairness window — see `PlayerVitals`. Its job is to
    // stop a per-frame damage source landing 60 hits a second. If it ever grew past the
    // shortest real attack cooldown in the game it would start silently eating boss
    // swings, which is a balance change disguised as a safety valve.
    const cooldowns = bosses.flatMap(([, def]) =>
      def.phases.flatMap((p) => p.abilities.map((a) => a.cooldown)));
    expect(INVULNERABLE_SECONDS).toBeLessThan(Math.min(...cooldowns));
  });
});
