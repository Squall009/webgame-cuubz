/**
 * Cuubz — bosses: definitions, phases, the encounter, and the bug that killed the last one
 *
 * §11's S6 row names two assertions and this file leads with both:
 *
 *   1. **Every boss constructs with all timers initialised and dies when damaged past
 *      every phase threshold.** That is the deleted `Boss.js`'s exact defect — it left
 *      `phaseTransitionTimer` undefined, so a deserialized boss was NaN-frozen and
 *      **unkillable**, in 1,135 lines with no test that ever drove one to death.
 *   2. **`BOSS_HIT` rejects out-of-arena, over-damage and over-rate.**
 *
 * Plus the two structural properties that keep a boss out of the world: `biomes: []`
 * present-and-empty, and absence from every spawn path.
 */

import { describe, it, expect } from 'vitest';
import { BossEntity } from '../../../src/game/entities/BossEntity.js';
import { BossEncounter, maxLegalHit, RESET_AFTER_EMPTY_SECONDS } from '../../../src/game/systems/BossEncounter.js';
import {
  BOSS_DEFINITIONS, BOSS_ORDER, BOSS_ABILITIES, bossForSeal, getBossDefinition,
} from '../../../src/game/mobs/bossDefinitions.js';
import {
  MOB_CATEGORIES, MOB_DEFINITIONS, getMobDefinition, getAllMobTypes,
  getMobTypesForBiome, selectMobForBiome,
} from '../../../src/game/mobs/mobDefinitions.js';
import { QuestSystem } from '../../../src/game/systems/QuestSystem.js';
import { SealSystem } from '../../../src/game/systems/SealSystem.js';
import { createQuestState, setSealSite } from '../../../src/game/data/QuestState.js';
import { SEAL_IDS } from '../../../src/game/data/SealDefinitions.js';
import { QUEST_ORDER } from '../../../src/game/data/QuestDefinitions.js';
import { BIOME_IDS } from '../../../src/engine/world/BiomeSystem.js';
import { NAMED_ITEMS } from '../../../src/game/data/ItemDefinitions.js';

describe('the definitions', () => {
  it('has six bosses, one per seal plus the finale', () => {
    expect(BOSS_ORDER).toHaveLength(6);
    for (const id of SEAL_IDS) {
      expect(bossForSeal(id), `${id} has a boss`).toBeTruthy();
    }
    expect(bossForSeal('finale')).toBe('corruption_overlord');
  });

  it('gives every boss `biomes: []` — present, and empty', () => {
    // `getMobTypesForBiome` and `selectMobForBiome` both do `def.biomes.includes(biome)`.
    // An empty array excludes bosses from natural spawning for free; a MISSING one
    // throws on every spawn tick. The difference is one character.
    for (const type of BOSS_ORDER) {
      const def = BOSS_DEFINITIONS[type];
      expect(Array.isArray(def.biomes), `${type}.biomes is an array`).toBe(true);
      expect(def.biomes, `${type}.biomes is empty`).toHaveLength(0);
    }
  });

  it('no spawn path can ever pick a boss', () => {
    // Belt and braces: `biomes: []` above, and absence from the spawnable table here.
    for (const type of BOSS_ORDER) {
      expect(MOB_DEFINITIONS[type], `${type} is not in MOB_DEFINITIONS`).toBeUndefined();
      expect(getAllMobTypes()).not.toContain(type);
    }
    for (const biome of BIOME_IDS) {
      expect(getMobTypesForBiome(biome).filter((t) => BOSS_ORDER.includes(t))).toEqual([]);
      for (let i = 0; i < 50; i++) {
        expect(BOSS_ORDER).not.toContain(selectMobForBiome(biome));
      }
    }
  });

  it('is findable by `getMobDefinition`, so the renderer can draw it', () => {
    // §8.1 — the deleted `Boss.js` had no renderer at all. These are mobs so that
    // `mobModelBuilder`, `mobAnimator` and `mobRenderer` work on them unchanged.
    for (const type of BOSS_ORDER) {
      const def = getMobDefinition(type);
      expect(def, `${type} resolves`).toBeTruthy();
      expect(def.category).toBe(MOB_CATEGORIES.BOSS);
      expect(def.geometry.parts.length, `${type} has geometry`).toBeGreaterThan(4);
      expect(def.animations.dead, `${type} has a death animation`).toBeDefined();
    }
  });

  it('uses only geometry primitives the model builder supports', () => {
    const supported = new Set(['box', 'sphere', 'cylinder', 'cone']);
    for (const type of BOSS_ORDER) {
      for (const part of BOSS_DEFINITIONS[type].geometry.parts) {
        expect(supported.has(part.type), `${type}.${part.id} is a ${part.type}`).toBe(true);
      }
    }
  });

  it('has descending phase thresholds starting at 1.0', () => {
    for (const type of BOSS_ORDER) {
      const phases = BOSS_DEFINITIONS[type].phases;
      expect(phases.length).toBeGreaterThanOrEqual(2);
      expect(phases[0].from).toBe(1.0);
      for (let i = 1; i < phases.length; i++) {
        expect(phases[i].from, `${type} phase ${i}`).toBeLessThan(phases[i - 1].from);
      }
      for (const phase of phases) {
        expect(phase.abilities.length, `${type}.${phase.id} has abilities`).toBeGreaterThan(0);
        for (const a of phase.abilities) {
          expect(Object.values(BOSS_ABILITIES)).toContain(a.kind);
          expect(a.cooldown, `${type}.${phase.id} ${a.kind} has a cooldown`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives the Corruption Overlord three phases', () => {
    expect(BOSS_DEFINITIONS.corruption_overlord.phases).toHaveLength(3);
    expect(BOSS_DEFINITIONS.corruption_overlord.phases.map((p) => p.name))
      .toEqual(['Guardian', 'Darkness', 'True Form']);
  });

  it('summons only mobs that exist', () => {
    for (const type of BOSS_ORDER) {
      for (const phase of BOSS_DEFINITIONS[type].phases) {
        for (const a of phase.abilities) {
          if (a.kind !== BOSS_ABILITIES.SUMMON) continue;
          expect(getMobDefinition(a.mob), `${type} summons ${a.mob}`).toBeTruthy();
        }
      }
    }
  });

  it('drops only items that exist', () => {
    for (const type of BOSS_ORDER) {
      for (const drop of BOSS_DEFINITIONS[type].drops) {
        expect(NAMED_ITEMS[drop.item], `${type} drops ${drop.item}`).toBeDefined();
      }
    }
  });

  it('ships only §8.3-approved abilities in the first boss', () => {
    // "First boss ships with melee + charge + summon + hazard-pool only. Projectiles
    // are their own stage; do not let them block the first working seal."
    const kinds = new Set(
      BOSS_DEFINITIONS.forest_warden.phases.flatMap((p) => p.abilities.map((a) => a.kind))
    );
    expect([...kinds].sort()).toEqual(['charge', 'hazard_pool', 'melee', 'summon']);
  });
});

describe('every timer is initialised — the bug that killed Boss.js', () => {
  const TIMER_FIELDS = [
    'phaseTransitionTimer', 'globalCooldown', 'aliveFor',
    'emptyArenaFor', 'chargeRemaining', 'shieldHp', 'shieldRemaining',
  ];

  it('constructs every boss with a real number in every timer', () => {
    for (const type of BOSS_ORDER) {
      const boss = new BossEntity({ type, sealId: 'verdant', position: { x: 0, y: 64, z: 0 } });
      for (const field of TIMER_FIELDS) {
        expect(Number.isFinite(boss[field]), `${type}.${field} is a number, not undefined`).toBe(true);
      }
      for (const [key, value] of Object.entries(boss.abilityTimers)) {
        expect(Number.isFinite(value), `${type}.abilityTimers[${key}]`).toBe(true);
      }
    }
  });

  it('DESERIALIZES with every timer initialised too', () => {
    // This is the precise failure. The old class deserialized by assigning fields onto
    // an object, so a boss loaded from a save had `phaseTransitionTimer === undefined`,
    // `undefined - delta` is NaN, and the boss froze permanently. `deserialize` goes
    // through the constructor here.
    for (const type of BOSS_ORDER) {
      const original = new BossEntity({ type, sealId: 'verdant', position: { x: 1, y: 2, z: 3 } });
      original.takeDamage(50, 'char_a');
      const restored = BossEntity.deserialize(original.serialize());

      for (const field of TIMER_FIELDS) {
        expect(Number.isFinite(restored[field]), `restored ${type}.${field}`).toBe(true);
      }
      restored.tick(0.5);
      for (const field of TIMER_FIELDS) {
        expect(Number.isNaN(restored[field]), `${type}.${field} is not NaN after a tick`).toBe(false);
      }
    }
  });

  it('every boss dies when driven through every phase threshold', () => {
    // The assertion the old class never had. Damage in small bites, so every threshold
    // is genuinely crossed rather than skipped by one enormous hit.
    for (const type of BOSS_ORDER) {
      const boss = new BossEntity({ type, sealId: 'verdant', position: { x: 0, y: 64, z: 0 } });
      const phasesSeen = new Set([boss.phaseIndex]);

      let guard = 0;
      while (!boss.isDead && guard++ < 100000) {
        boss.tick(1 / 60);
        boss.takeDamage(5, 'char_a');
        phasesSeen.add(boss.phaseIndex);
      }

      expect(boss.isDead, `${type} died`).toBe(true);
      expect(boss.hp).toBe(0);
      expect(phasesSeen.size, `${type} passed through every phase`)
        .toBe(BOSS_DEFINITIONS[type].phases.length);
    }
  });

  it('a deserialized boss can still be killed', () => {
    // The old one could not. That is the whole of D-?? and of §8.2.
    const original = new BossEntity({ type: 'forest_warden', sealId: 'verdant', position: { x: 0, y: 64, z: 0 } });
    original.takeDamage(300, 'char_a');
    const restored = BossEntity.deserialize(original.serialize());

    let guard = 0;
    while (!restored.isDead && guard++ < 10000) {
      restored.tick(1 / 60);
      restored.takeDamage(5, 'char_a');
    }
    expect(restored.isDead).toBe(true);
  });
});

describe('phases', () => {
  const warden = () => new BossEntity({ type: 'forest_warden', sealId: 'verdant', position: { x: 0, y: 64, z: 0 } });

  // S11 moved the seal bosses' enrage from 0.4 to 0.5 — the threshold is where a boss's
  // third ability appears, and at 40% half the fight's mechanics arrived for the last
  // 40% of the bar. `bossBalance.test.js` owns the *value*; this owns the transition.
  it('enrages at half health, not before', () => {
    const boss = warden();
    expect(boss.phase.id).toBe('opening');
    boss.takeDamage(boss.maxHp * 0.4, 'char_a');
    expect(boss.phase.id).toBe('opening');
    boss.takeDamage(boss.maxHp * 0.2, 'char_a');
    expect(boss.phase.id).toBe('enraged');
  });

  it('skips straight to the right phase after one huge hit', () => {
    const overlord = new BossEntity({ type: 'corruption_overlord', sealId: 'finale', position: { x: 0, y: 64, z: 0 } });
    overlord.takeDamage(overlord.maxHp * 0.8, 'char_a');
    expect(overlord.phase.id).toBe('true_form');
  });

  it('pauses on a phase transition, and the pause ends', () => {
    const boss = warden();
    boss.takeDamage(boss.maxHp * 0.7, 'char_a');
    expect(boss.phaseTransitionTimer).toBeGreaterThan(0);
    expect(boss.readyAbilities()).toEqual([]);
    boss.tick(2);
    expect(boss.phaseTransitionTimer).toBe(0);
    expect(boss.readyAbilities().length).toBeGreaterThan(0);
  });

  it('keys ability cooldowns by phase and index, not by kind', () => {
    // The Corruption Overlord's Guardian phase has two `hazard_pool` abilities with
    // different blocks and different cooldowns. Keying on kind would collapse them.
    const boss = new BossEntity({ type: 'corruption_overlord', sealId: 'finale', position: { x: 0, y: 64, z: 0 } });
    const pools = boss.definition.phases[0].abilities.filter((a) => a.kind === BOSS_ABILITIES.HAZARD_POOL);
    expect(pools.length).toBe(2);
    expect(Object.keys(boss.abilityTimers).filter((k) => k.startsWith('guardian:'))).toHaveLength(4);
  });
});

describe('shields', () => {
  it('absorbs damage without reducing HP, and still records the contributor', () => {
    // A player who spent the whole shield phase breaking the shield did fight the boss,
    // and §8.4 gives loot to everyone who fought.
    const boss = new BossEntity({ type: 'corruption_overlord', sealId: 'finale', position: { x: 0, y: 64, z: 0 } });
    boss.shieldHp = 100;
    boss.shieldRemaining = 20;

    const before = boss.hp;
    const r = boss.takeDamage(40, 'char_a');
    expect(r.dealt).toBe(0);
    expect(boss.hp).toBe(before);
    expect(boss.contributors.get('char_a')).toBe(40);
  });

  it('breaks, and then damage lands again', () => {
    const boss = new BossEntity({ type: 'corruption_overlord', sealId: 'finale', position: { x: 0, y: 64, z: 0 } });
    boss.shieldHp = 50;
    boss.shieldRemaining = 20;
    expect(boss.takeDamage(60, 'char_a').shieldBroke).toBe(true);
    expect(boss.isShielded).toBe(false);
    expect(boss.takeDamage(10, 'char_a').dealt).toBe(10);
  });

  it('expires on its own timer', () => {
    const boss = new BossEntity({ type: 'corruption_overlord', sealId: 'finale', position: { x: 0, y: 64, z: 0 } });
    boss.shieldHp = 50;
    boss.shieldRemaining = 3;
    boss.tick(4);
    expect(boss.isShielded).toBe(false);
  });
});

describe('HP scales with the party — Q5', () => {
  it('a four-player fight has more HP than a solo one, and not four times more', () => {
    // **S11 changed the bound from `< 2` to `< 4`, and the reason is the arithmetic this
    // assertion originally encoded backwards.** `< 2` was pinning "not four times as
    // long", but HP is not duration: four players deal roughly four times the damage, so
    // ×1.6 HP was a fight 40% the length of the solo one. Holding duration roughly flat
    // needs scaling close to linear. `bossBalance.test.js` states the property directly —
    // implied duration ratio in [0.75, 1.0] — and this keeps the crude bounds.
    const def = BOSS_DEFINITIONS.forest_warden;
    const solo = BossEntity.scaledMaxHp(def, 1);
    const four = BossEntity.scaledMaxHp(def, 4);
    expect(solo).toBe(def.health);
    expect(four).toBeGreaterThan(solo);
    expect(four / solo).toBeLessThan(4);
  });

  it('clamps to a real session size', () => {
    const boss = new BossEntity({ type: 'forest_warden', sealId: 'verdant', position: { x: 0, y: 0, z: 0 }, playerCount: 99 });
    expect(boss.playerCount).toBe(4);
  });
});

describe('contributors', () => {
  it('ranks by damage and caps at a full session', () => {
    const boss = new BossEntity({ type: 'forest_warden', sealId: 'verdant', position: { x: 0, y: 0, z: 0 } });
    boss.takeDamage(10, 'char_a');
    boss.takeDamage(50, 'char_b');
    boss.takeDamage(30, 'char_c');
    boss.takeDamage(20, 'char_d');
    boss.takeDamage(5, 'char_e');
    expect(boss.getContributors()).toEqual(['char_b', 'char_c', 'char_d', 'char_a']);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The encounter
// ══════════════════════════════════════════════════════════════════════

function harness(opts = {}) {
  const state = createQuestState();
  for (const id of QUEST_ORDER) {
    if (id === 'q12') break;
    state.quests[id] = { stage: 0, completed: true, completedAt: 1 };
  }
  const questSystem = new QuestSystem({ questState: state });
  const seals = new SealSystem({ questSystem });
  setSealSite(state, 'verdant', { x: 100, z: 100 });
  questSystem.setSeal('verdant', 'keyed');
  questSystem.setSeal('verdant', 'primed');

  const mobs = {
    spawned: [],
    removed: [],
    spawnMobAt(type, position) {
      const mob = { id: `m${this.spawned.length}`, mobType: type, position: { ...position }, health: 1, isDead: false };
      this.spawned.push(mob);
      return mob;
    },
    removeMob(id) { this.removed.push(id); },
  };

  const world = {
    blocks: new Map(),
    getBlockAtWorld: (x, y, z) => {
      const key = `${x},${y},${z}`;
      if (world.blocks.has(key)) return world.blocks.get(key);
      return y <= 64 ? 2 : 0;
    },
    setBlockAtWorld: (x, y, z, b) => world.blocks.set(`${x},${y},${z}`, b),
  };

  const sent = [];
  const inventory = { added: [], addItem(item, count) { this.added.push({ item, count }); return true; } };
  const player = { position: { x: 100, y: 66, z: 100 } };

  const encounter = new BossEncounter({
    questSystem, sealSystem: seals, mobManager: mobs, world, inventory, player,
    localContributorId: 'char_host',
    broadcast: opts.broadcast === null ? null : (m) => sent.push(m),
    vitals: opts.vitals || null,
    ...opts.overrides,
  });

  return { questSystem, seals, encounter, mobs, world, sent, inventory, player, state };
}

describe('the encounter lifecycle — §8.4', () => {
  it('summons only from a primed seal', () => {
    const h = harness();
    h.questSystem.getState().seals.verdant.state = 'dormant';
    expect(h.encounter.summon('verdant')).toBeNull();

    h.questSystem.getState().seals.verdant.state = 'primed';
    const boss = h.encounter.summon('verdant');
    expect(boss).toBeTruthy();
    expect(boss.type).toBe('forest_warden');
    expect(h.seals.getSealState('verdant')).toBe('contested');
  });

  it('draws the boss through the ordinary mob renderer', () => {
    const h = harness();
    h.encounter.summon('verdant');
    expect(h.mobs.spawned[0].mobType).toBe('forest_warden');
  });

  it('will not summon two at once', () => {
    const h = harness();
    h.encounter.summon('verdant');
    expect(h.encounter.summon('verdant')).toBeNull();
  });

  it('broadcasts BOSS_SPAWN and then BOSS_STATE at 10 Hz', () => {
    const h = harness();
    const boss = h.encounter.summon('verdant');
    // The envelope's `type` is the protocol's. A payload field of the same name spread
    // into it would silently overwrite it and the relay would drop the message as
    // unknown — which is exactly what happened before `spawnPayload` renamed its own
    // field to `bossType`.
    expect(h.sent[0].type).toBe('BOSS_SPAWN');
    expect(h.sent[0].bossType).toBe('forest_warden');
    expect(h.sent[0].bossId).toBe(boss.id);

    h.sent.length = 0;
    for (let i = 0; i < 60; i++) h.encounter.update(1 / 60);
    const states = h.sent.filter((m) => m.type === 'BOSS_STATE');
    // One second of frames at 10 Hz.
    expect(states.length).toBeGreaterThanOrEqual(9);
    expect(states.length).toBeLessThanOrEqual(11);
  });

  it('single-player broadcasts nothing at all — §6.5', () => {
    // Same runner, same simulation, null transport. There is no `if (multiplayer)` in
    // `BossEncounter`; this is what that means concretely.
    const h = harness({ broadcast: null });
    const boss = h.encounter.summon('verdant');
    expect(boss).toBeTruthy();
    for (let i = 0; i < 60; i++) h.encounter.update(1 / 60);
    expect(h.sent).toEqual([]);
    expect(h.encounter.isActive).toBe(true);
  });

  it('resets to primed after 60 s of an empty arena, at full HP', () => {
    const h = harness();
    const boss = h.encounter.summon('verdant');
    boss.takeDamage(200, 'char_host');

    // Walk the player out of the arena.
    h.player.position.x = 9999;
    for (let t = 0; t < RESET_AFTER_EMPTY_SECONDS - 1; t += 0.5) h.encounter.update(0.5);
    expect(h.encounter.boss).toBeTruthy();

    h.encounter.update(2);
    expect(h.encounter.boss).toBeNull();
    expect(h.seals.getSealState('verdant')).toBe('primed');

    // No partial credit: the next summon is a full-health boss.
    const again = h.encounter.summon('verdant');
    expect(again.hp).toBe(again.maxHp);
  });

  it('breaks the seal, completes the quest and rolls loot once on defeat', () => {
    const h = harness();
    const boss = h.encounter.summon('verdant');
    h.encounter.applyHit({ bossId: boss.id, damage: 30, contributorId: 'char_host' });
    boss.hp = 5;
    h.encounter.applyHit({ bossId: boss.id, damage: 30, contributorId: 'char_host' });

    expect(h.seals.getSealState('verdant')).toBe('broken');
    expect(h.questSystem.isCompleted('q12')).toBe(true);
    expect(h.questSystem.getState().seals.verdant.brokenBy).toContain('char_host');

    const defeated = h.sent.find((m) => m.type === 'BOSS_DEFEATED');
    expect(defeated).toBeTruthy();
    expect(defeated.contributors).toContain('char_host');
    // §8.5 — the host rolled, and the result travels. Clients do not roll.
    expect(Array.isArray(defeated.loot)).toBe(true);
    expect(h.encounter.boss).toBeNull();
  });

  it('gives loot to every contributor, not the killer', () => {
    const h = harness();
    const boss = h.encounter.summon('verdant');
    h.encounter.applyHit({ bossId: boss.id, damage: 20, contributorId: 'char_guest' });
    boss.hp = 1;
    h.encounter.applyHit({ bossId: boss.id, damage: 20, contributorId: 'char_host' });

    const defeated = h.sent.find((m) => m.type === 'BOSS_DEFEATED');
    expect(defeated.contributors).toContain('char_guest');
    expect(defeated.contributors).toContain('char_host');
  });
});

describe('BOSS_HIT validation — §6.3', () => {
  const live = () => {
    const h = harness();
    h.boss = h.encounter.summon('verdant');
    return h;
  };

  it('rejects an oversized hit, and the ceiling is computed', () => {
    const h = live();
    const before = h.boss.hp;
    expect(h.encounter.applyHit({ bossId: h.boss.id, damage: maxLegalHit() + 1 })).toBe(false);
    expect(h.boss.hp).toBe(before);

    // Computed from NAMED_ITEMS, not hard-coded — §6.3 says so explicitly, and a
    // literal would be wrong the first time anyone adds a weapon.
    const best = Math.max(...Object.values(NAMED_ITEMS).map((d) => d.damage || 0));
    expect(maxLegalHit()).toBeGreaterThan(best);
  });

  it('rejects a hit from outside the arena', () => {
    const h = live();
    const before = h.boss.hp;
    expect(h.encounter.applyHit({
      bossId: h.boss.id, damage: 10, position: { x: 5000, y: 64, z: 5000 },
    })).toBe(false);
    expect(h.boss.hp).toBe(before);
  });

  it('accepts a hit from just outside, because latency is not cheating', () => {
    const h = live();
    expect(h.encounter.applyHit({
      bossId: h.boss.id, damage: 10,
      position: { x: h.boss.position.x + h.boss.arenaRadius + 8, y: 64, z: h.boss.position.z },
    })).toBe(true);
  });

  it('rate limits per player without kicking anyone', () => {
    const h = live();
    let accepted = 0;
    for (let i = 0; i < 40; i++) {
      if (h.encounter.applyHit({ bossId: h.boss.id, damage: 1, playerId: 'guest_1' })) accepted++;
    }
    expect(accepted).toBeLessThan(40);
    expect(accepted).toBeGreaterThan(0);
    // A different player has their own budget.
    expect(h.encounter.applyHit({ bossId: h.boss.id, damage: 1, playerId: 'guest_2' })).toBe(true);
  });

  it('rejects a hit for the wrong boss', () => {
    const h = live();
    expect(h.encounter.applyHit({ bossId: 'some_other_boss', damage: 10 })).toBe(false);
  });

  it('rejects nonsense damage', () => {
    const h = live();
    expect(h.encounter.applyHit({ bossId: h.boss.id, damage: 0 })).toBe(false);
    expect(h.encounter.applyHit({ bossId: h.boss.id, damage: -5 })).toBe(false);
    expect(h.encounter.applyHit({ bossId: h.boss.id, damage: NaN })).toBe(false);
  });

  it('does nothing when there is no boss', () => {
    const h = harness();
    expect(h.encounter.applyHit({ damage: 10 })).toBe(false);
  });
});

describe("hazard pools — §8.3's payoff", () => {
  it('writes hazard blocks and reverts them when the pool expires', () => {
    // "A lava pool a boss creates is the same block with the same damage tick as a lava
    // pool the world generated." There is no boss-specific damage code — `HazardSystem`
    // was already looking at the block under the player.
    const h = harness();
    const boss = h.encounter.summon('verdant');
    boss.hp = boss.maxHp * 0.3; // enrage, which is the phase with the pool
    boss.updatePhase();
    boss.tick(3);

    const pool = boss.phase.abilities.find((a) => a.kind === BOSS_ABILITIES.HAZARD_POOL);
    expect(pool).toBeTruthy();

    const before = h.world.blocks.size;
    h.encounter._writePool(boss, pool, { position: h.player.position, distance: 1 });
    expect(h.world.blocks.size).toBeGreaterThan(before);
    expect(boss.pools).toHaveLength(1);

    // Expire it. The arena has to come back — a boss that permanently paved the floor
    // in lava would make a wipe unrecoverable.
    boss.tick(pool.duration + 1);
    h.encounter._reapPools();
    expect(boss.pools).toHaveLength(0);
  });

  it('refuses to write a block that does not exist, loudly', () => {
    // D-64's shape: a named block that resolves to `undefined` would make the pool
    // silently never appear.
    const h = harness();
    const boss = h.encounter.summon('verdant');
    const wrote = h.encounter._writePool(
      boss, { block: 'not_a_real_block', radius: 2, duration: 5 },
      { position: h.player.position, distance: 1 }
    );
    expect(wrote).toBe(false);
  });
});

describe('summons', () => {
  it('spawns adds and respects the cap', () => {
    const h = harness();
    const boss = h.encounter.summon('verdant');
    const summon = boss.phase.abilities.find((a) => a.kind === BOSS_ABILITIES.SUMMON);
    const target = { position: h.player.position, distance: 2 };

    const before = h.mobs.spawned.length;
    h.encounter._useAbility(boss, summon, target);
    expect(h.mobs.spawned.length).toBe(before + summon.count);

    // Fill to the cap and stop.
    for (let i = 0; i < 10; i++) h.encounter._useAbility(boss, summon, target);
    expect(h.mobs.spawned.length - before).toBeLessThanOrEqual(summon.max + summon.count);
  });

  it('clears its adds when the encounter ends', () => {
    const h = harness();
    const boss = h.encounter.summon('verdant');
    const summon = boss.phase.abilities.find((a) => a.kind === BOSS_ABILITIES.SUMMON);
    h.encounter._useAbility(boss, summon, { position: h.player.position, distance: 2 });
    h.encounter.reset('test');
    expect(h.mobs.removed.length).toBeGreaterThan(0);
  });
});

describe('melee reaches the player', () => {
  it("damages the local player's vitals when in range", () => {
    let damage = 0;
    const vitals = { isDead: false, takeDamage: (n) => { damage += n; return n; } };
    const h = harness({ vitals });
    const boss = h.encounter.summon('verdant');
    // Standing on top of it.
    h.player.position.x = boss.position.x;
    h.player.position.z = boss.position.z;

    for (let i = 0; i < 300; i++) h.encounter.update(1 / 60);
    expect(damage).toBeGreaterThan(0);
  });
});
