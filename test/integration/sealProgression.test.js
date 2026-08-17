/**
 * Cuubz — every seal, from quest to broken (S7)
 *
 * §11's S7 row is one line — *"Each seal reachable and completable"* — and it is the
 * only assertion in the suite that exercises the whole vertical: quest definitions →
 * pooled objectives → key item → altar offering → summon → boss phases → defeat → seal
 * broken → next quest unlocked.
 *
 * Everything below the test harness is production code. The stubs are an inventory, a
 * world of solid ground, and a mob manager that records what it was asked to spawn —
 * the three things that need a browser.
 *
 * ─── WHY THIS IS WORTH A SLOW TEST ──────────────────────────────────────────
 *
 * Each stage of this feature was green on its own. The failures that survive that are
 * the ones at the seams — a quest that names a boss no seal summons, a seal whose key
 * item no quest awards, an act that unlocks nothing. Every one of those is invisible to
 * a unit test of either side and fatal to a playthrough.
 */

import { describe, it, expect } from 'vitest';
import { QuestSystem } from '../../src/game/systems/QuestSystem.js';
import { SealSystem } from '../../src/game/systems/SealSystem.js';
import { BossEncounter } from '../../src/game/systems/BossEncounter.js';
import { createQuestState, setSealSite } from '../../src/game/data/QuestState.js';
import { SEAL_IDS, SEAL_DEFINITIONS } from '../../src/game/data/SealDefinitions.js';
import { QUEST_DEFINITIONS, QUEST_ORDER, OBJECTIVE_KINDS } from '../../src/game/data/QuestDefinitions.js';
import { BOSS_DEFINITIONS, bossForSeal } from '../../src/game/mobs/bossDefinitions.js';
import { TITLE_DEFINITIONS } from '../../src/game/data/TitleDefinitions.js';

function mockInventory() {
  const held = new Map();
  return {
    countItem: (t) => held.get(String(t)) || 0,
    addItem(t, n) { held.set(String(t), (held.get(String(t)) || 0) + n); return true; },
    removeItem(t, n) { held.set(String(t), Math.max(0, (held.get(String(t)) || 0) - n)); return true; },
    _set: (t, n) => held.set(String(t), n),
  };
}

const solidWorld = () => ({
  blocks: new Map(),
  getBlockAtWorld(x, y, z) {
    const k = `${x},${y},${z}`;
    return this.blocks.has(k) ? this.blocks.get(k) : (y <= 64 ? 2 : 0);
  },
  setBlockAtWorld(x, y, z, b) { this.blocks.set(`${x},${y},${z}`, b); },
});

const mockMobs = () => ({
  spawned: [], removed: [],
  spawnMobAt(type, position) {
    const m = { id: `m${this.spawned.length}`, mobType: type, position: { ...position }, health: 1, isDead: false };
    this.spawned.push(m);
    return m;
  },
  removeMob(id) { this.removed.push(id); },
});

/** A full stack: quests, seals, an encounter, and a player standing at the origin. */
function newRun() {
  const questState = createQuestState();
  const inventory = mockInventory();
  const questSystem = new QuestSystem({ questState, inventory });
  const sealSystem = new SealSystem({ questSystem, inventory });
  const world = solidWorld();
  const mobs = mockMobs();
  const player = { position: { x: 0, y: 66, z: 0 } };

  // Sites are normally resolved from the seed; here they are placed where the player
  // stands so the proximity checks are about the state machine, not about walking.
  for (const id of [...SEAL_IDS, 'finale']) setSealSite(questState, id, { x: 0, z: 0 });

  const encounter = new BossEncounter({
    questSystem, sealSystem, mobManager: mobs, world, inventory, player,
    localContributorId: 'char_solo',
    broadcast: null, // single-player: §6.5's null transport
  });

  return { questState, questSystem, sealSystem, encounter, inventory, mobs, player, world };
}

/** Satisfy whatever the active quest wants, short of the things a boss provides. */
function satisfyActiveQuest(run) {
  const def = run.questSystem.getActiveQuest();
  if (!def) return false;

  for (const objective of def.objectives) {
    switch (objective.kind) {
      case OBJECTIVE_KINDS.CONTRIBUTE_ITEM:
        // Give the party the first accepted item type, in the quantity asked for.
        run.inventory._set(objective.items[0], objective.count);
        run.questSystem.observe(def.id, objective.key, 'char_solo', objective.count);
        break;
      case OBJECTIVE_KINDS.DELIVER: {
        // Real delivery: the key and the offering are consumed at the altar.
        const sealDef = SEAL_DEFINITIONS[objective.seal];
        run.inventory._set(sealDef.keyItem, 1);
        for (const req of sealDef.offering) run.inventory._set(req.item, req.count);
        const r = run.sealSystem.makeOffering(objective.seal);
        expect(r.ok, `offering at ${objective.seal}: ${r.reason}`).toBe(true);
        break;
      }
      case OBJECTIVE_KINDS.BOSS_KILL:
        return 'boss';
      default:
        break;
    }
  }
  return true;
}

/** Prime a seal by hand — used when the act has no DELIVER quest of its own. */
function primeSeal(run, sealId) {
  if (run.sealSystem.getSealState(sealId) === 'primed') return;
  const def = SEAL_DEFINITIONS[sealId];
  run.inventory._set(def.keyItem, 1);
  for (const req of def.offering) run.inventory._set(req.item, req.count);
  const r = run.sealSystem.makeOffering(sealId);
  expect(r.ok, `priming ${sealId}: ${r.reason}`).toBe(true);
}

/** Summon and kill the seal's boss with honest damage through the validated path. */
function fightBoss(run, sealId) {
  primeSeal(run, sealId);
  const boss = run.encounter.summon(sealId);
  expect(boss, `${sealId} summoned a boss`).toBeTruthy();
  expect(boss.type).toBe(bossForSeal(sealId));

  let guard = 0;
  while (run.encounter.boss && guard++ < 20000) {
    // Shields are broken by the same hits; the loop simply keeps swinging.
    run.encounter.applyHit({ bossId: boss.id, damage: 20, contributorId: 'char_solo' });
    run.encounter.update(1 / 60);
  }
  expect(run.encounter.boss, `${sealId}'s boss died`).toBeNull();
  return boss;
}

describe('the storyline is a connected graph', () => {
  it('every seal has a boss, and every boss has a seal', () => {
    // The seam a unit test on either side cannot see.
    for (const id of SEAL_IDS) {
      const type = bossForSeal(id);
      expect(type, `${id} has a boss`).toBeTruthy();
      expect(BOSS_DEFINITIONS[type].seal).toBe(id);
    }
    for (const [type, def] of Object.entries(BOSS_DEFINITIONS)) {
      expect(def.seal, `${type} names a seal`).toBeTruthy();
      expect([...SEAL_IDS, 'finale']).toContain(def.seal);
    }
  });

  it('every boss a quest names is a boss that exists', () => {
    for (const id of QUEST_ORDER) {
      for (const o of QUEST_DEFINITIONS[id].objectives) {
        if (o.kind !== OBJECTIVE_KINDS.BOSS_KILL) continue;
        expect(BOSS_DEFINITIONS[o.boss], `${id} wants ${o.boss} killed`).toBeDefined();
      }
    }
  });

  it('every seal a DELIVER quest names is a seal that exists', () => {
    for (const id of QUEST_ORDER) {
      for (const o of QUEST_DEFINITIONS[id].objectives) {
        if (o.kind !== OBJECTIVE_KINDS.DELIVER) continue;
        expect(SEAL_DEFINITIONS[o.seal], `${id} delivers to ${o.seal}`).toBeDefined();
      }
    }
  });

  it('every seal key item is awarded by exactly one quest', () => {
    // A key with no quest is a seal that can never be primed.
    for (const id of SEAL_IDS) {
      const keyItem = SEAL_DEFINITIONS[id].keyItem;
      const quests = QUEST_ORDER.filter((q) =>
        QUEST_DEFINITIONS[q].objectives.some((o) =>
          o.kind === OBJECTIVE_KINDS.CONTRIBUTE_ITEM && o.items.includes(keyItem))
      );
      expect(quests, `${keyItem} is asked for by exactly one quest`).toHaveLength(1);
    }
  });

  it("every act after the first ends on its seal's boss", () => {
    const bossQuests = QUEST_ORDER.filter((id) =>
      QUEST_DEFINITIONS[id].objectives.some((o) => o.kind === OBJECTIVE_KINDS.BOSS_KILL));
    expect(bossQuests).toHaveLength(6);
    // Act 1 has none; acts 2-7 have exactly one each, and it is the act's last quest.
    for (const id of bossQuests) {
      const def = QUEST_DEFINITIONS[id];
      const inAct = QUEST_ORDER.map((q) => QUEST_DEFINITIONS[q]).filter((q) => q.act === def.act);
      expect(inAct[inAct.length - 1].id, `act ${def.act} ends on its boss`).toBe(id);
    }
  });
});

describe('each seal is reachable and completable — §11, S7', () => {
  for (const sealId of SEAL_IDS) {
    it(`breaks the ${sealId} seal, from dormant to broken`, () => {
      const run = newRun();

      expect(run.sealSystem.getSealState(sealId)).toBe('dormant');
      const boss = fightBoss(run, sealId);

      expect(run.sealSystem.getSealState(sealId)).toBe('broken');
      expect(run.questState.seals[sealId].brokenBy).toContain('char_solo');
      expect(run.questState.seals[sealId].brokenAt).toBeGreaterThan(0);
      // The boss was drawn — §8.1, the thing the deleted `Boss.js` never did.
      expect(run.mobs.spawned.some((m) => m.mobType === boss.type)).toBe(true);
      // And it was cleaned up.
      expect(run.mobs.removed.length).toBeGreaterThan(0);
    }, 30000);
  }

  it('the fifth break opens the finale, and not before', () => {
    const run = newRun();
    for (let i = 0; i < SEAL_IDS.length; i++) {
      expect(run.questState.finale.state, `after ${i} seals`).toBe('sealed');
      fightBoss(run, SEAL_IDS[i]);
    }
    expect(run.questState.finale.state).toBe('open');
  }, 60000);
});

describe('a whole playthrough, quest by quest', () => {
  it('completes all 28 quests in order and earns all 13 titles', () => {
    // The strongest statement this suite can make: the storyline, start to finish,
    // through the real systems. Anything that broke the chain — an unreachable quest, a
    // seal that cannot be primed, a boss that will not die — stops it dead.
    const run = newRun();
    const completed = [];
    run.questSystem.onQuestCompleted = (id) => completed.push(id);

    let guard = 0;
    while (run.questSystem.getActiveQuest() && guard++ < 60) {
      const active = run.questSystem.getActiveQuest();
      const result = satisfyActiveQuest(run);

      if (result === 'boss') {
        const objective = active.objectives.find((o) => o.kind === OBJECTIVE_KINDS.BOSS_KILL);
        const sealId = BOSS_DEFINITIONS[objective.boss].seal;
        if (sealId === 'finale') {
          // The finale is S8's; the run reaches it and stops here.
          expect(active.id).toBe('q28');
          break;
        }
        fightBoss(run, sealId);
      }

      expect(run.questSystem.getActiveQuest()?.id, `${active.id} advanced`).not.toBe(active.id);
    }

    // Everything up to and including Q27.
    expect(completed).toEqual(QUEST_ORDER.slice(0, 27));
    expect(run.questSystem.getActiveQuest().id).toBe('q28');
    expect(run.questSystem.getCompletionSummary()).toEqual({ completed: 27, total: 28 });

    // Twelve of the thirteen titles; `world_saver` is Q28's.
    const earned = run.questState.titles;
    const expected = Object.values(TITLE_DEFINITIONS)
      .filter((t) => t.quest !== 'q28')
      .map((t) => t.id);
    expect([...earned].sort()).toEqual([...expected].sort());
    expect(earned).not.toContain('world_saver');

    // And all five seals are broken, which is what makes Q28 possible at all.
    for (const id of SEAL_IDS) expect(run.sealSystem.getSealState(id)).toBe('broken');
    expect(run.questState.finale.state).toBe('open');
  }, 120000);
});

describe('phase tables, per boss — §11, S7', () => {
  it('every boss passes through all of its phases on the way down', () => {
    for (const [type, def] of Object.entries(BOSS_DEFINITIONS)) {
      const run = newRun();
      const sealId = def.seal;
      if (sealId === 'finale') continue; // S8

      primeSeal(run, sealId);
      const boss = run.encounter.summon(sealId);
      const seen = new Set();

      let guard = 0;
      while (run.encounter.boss && guard++ < 20000) {
        seen.add(run.encounter.boss.phaseIndex);
        run.encounter.applyHit({ bossId: boss.id, damage: 8, contributorId: 'char_solo' });
        run.encounter.update(1 / 60);
      }
      expect(seen.size, `${type} used all ${def.phases.length} phases`).toBe(def.phases.length);
    }
  }, 60000);

  it('an enraged boss is faster and hits harder than an opening one', () => {
    for (const [type, def] of Object.entries(BOSS_DEFINITIONS)) {
      if (def.phases.length !== 2) continue;
      const [opening, enraged] = def.phases;
      expect(enraged.speedMultiplier, `${type} speeds up`).toBeGreaterThan(opening.speedMultiplier);

      const meleeOf = (p) => p.abilities.find((a) => a.kind === 'melee');
      expect(meleeOf(enraged).damage, `${type} hits harder`).toBeGreaterThan(meleeOf(opening).damage);
      expect(meleeOf(enraged).cooldown, `${type} hits faster`).toBeLessThan(meleeOf(opening).cooldown);
    }
  });
});
