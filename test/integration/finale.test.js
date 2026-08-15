/**
 * Cuubz — the spire, the Corruption Overlord, and the end of the game (S8)
 *
 * §11's S8 row: *"Five-broken detection; finale gating | Full run."*
 *
 * ─── THE FINALE IS NOT A SEAL, AND THAT IS THE WORK ─────────────────────────
 *
 * S6 shipped the Corruption Overlord's definition and S7 proved the five seals, and the
 * finale still could not be reached: `state.seals.finale` does not exist, so every
 * transition through the seal state machine returned false. Its states are
 * `sealed | open | primed | contested | defeated` — a vocabulary of its own, because
 * "sealed" means something `dormant` does not. The spire is standing there, visible,
 * from world generation, and it is refusing (§3.7).
 *
 * ─── THE GATE IS ON THE STATE MACHINE, NOT ON THE UI ────────────────────────
 *
 * `setFinaleState` refuses to move past `sealed` unless all five seals are broken. The
 * UI checks it too, so a player gets "3 of 5 are broken" rather than a silent refusal —
 * but the check that *matters* is the one a second caller cannot skip.
 */

import { describe, it, expect } from 'vitest';
import { QuestSystem } from '../../src/game/systems/QuestSystem.js';
import { SealSystem } from '../../src/game/systems/SealSystem.js';
import { BossEncounter } from '../../src/game/systems/BossEncounter.js';
import { createQuestState, setSealSite, setFinaleState, allSealsBroken } from '../../src/game/data/QuestState.js';
import { SEAL_IDS, SEAL_DEFINITIONS, FINALE_STATES } from '../../src/game/data/SealDefinitions.js';
import { QUEST_ORDER, QUEST_DEFINITIONS, OBJECTIVE_KINDS } from '../../src/game/data/QuestDefinitions.js';
import { BOSS_DEFINITIONS } from '../../src/game/mobs/bossDefinitions.js';
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

function newRun() {
  const questState = createQuestState();
  const inventory = mockInventory();
  const questSystem = new QuestSystem({ questState, inventory });
  const sealSystem = new SealSystem({ questSystem, inventory });
  const world = {
    blocks: new Map(),
    getBlockAtWorld(x, y, z) {
      const k = `${x},${y},${z}`;
      return this.blocks.has(k) ? this.blocks.get(k) : (y <= 64 ? 2 : 0);
    },
    setBlockAtWorld(x, y, z, b) { this.blocks.set(`${x},${y},${z}`, b); },
  };
  const mobs = {
    spawned: [], removed: [],
    spawnMobAt(type, position) {
      const m = { id: `m${this.spawned.length}`, mobType: type, position: { ...position }, health: 1, isDead: false };
      this.spawned.push(m);
      return m;
    },
    removeMob(id) { this.removed.push(id); },
  };
  const player = { position: { x: 0, y: 66, z: 0 } };
  for (const id of [...SEAL_IDS, 'finale']) setSealSite(questState, id, { x: 0, z: 0 });

  const encounter = new BossEncounter({
    questSystem, sealSystem, mobManager: mobs, world, inventory, player,
    localContributorId: 'char_solo', broadcast: null,
  });

  return { questState, questSystem, sealSystem, encounter, inventory, mobs, player };
}

function primeAndKill(run, sealId) {
  const def = sealId === 'finale'
    ? { keyItem: null, offering: [{ item: 'diamond', count: 10 }] }
    : SEAL_DEFINITIONS[sealId];
  if (def.keyItem) run.inventory._set(def.keyItem, 1);
  for (const req of def.offering || []) run.inventory._set(req.item, req.count);

  const offered = run.sealSystem.makeOffering(sealId);
  expect(offered.ok, `offering at ${sealId}: ${offered.reason}`).toBe(true);

  const boss = run.encounter.summon(sealId);
  expect(boss, `${sealId} summoned`).toBeTruthy();

  let guard = 0;
  while (run.encounter.boss && guard++ < 40000) {
    run.encounter.applyHit({ bossId: boss.id, damage: 30, contributorId: 'char_solo' });
    run.encounter.update(1 / 60);
  }
  expect(run.encounter.boss, `${sealId}'s boss died`).toBeNull();
  return boss;
}

describe('the finale has its own state machine', () => {
  it('uses its own five-state vocabulary', () => {
    expect(FINALE_STATES).toEqual(['sealed', 'open', 'primed', 'contested', 'defeated']);
  });

  it('starts sealed, and stays sealed while any seal stands', () => {
    const state = createQuestState();
    for (let i = 0; i < 4; i++) {
      expect(setFinaleState(state, 'open'), `with ${i} seals broken`).toBe(false);
      expect(state.finale.state).toBe('sealed');
      state.seals[SEAL_IDS[i]].state = 'broken';
    }
    expect(allSealsBroken(state)).toBe(false);
    state.seals[SEAL_IDS[4]].state = 'broken';
    expect(setFinaleState(state, 'open')).toBe(true);
  });

  it('refuses to skip straight to defeated with seals standing', () => {
    // The gate is on the state machine, so a second caller cannot route around it.
    const state = createQuestState();
    expect(setFinaleState(state, 'defeated')).toBe(false);
    expect(setFinaleState(state, 'contested')).toBe(false);
    expect(state.finale.state).toBe('sealed');
  });

  it('is monotonic, with the one legal retreat', () => {
    const state = createQuestState();
    for (const id of SEAL_IDS) state.seals[id].state = 'broken';
    setFinaleState(state, 'open');
    setFinaleState(state, 'primed');
    setFinaleState(state, 'contested');
    // §8.4's encounter reset.
    expect(setFinaleState(state, 'primed')).toBe(true);
    // But not further back.
    expect(setFinaleState(state, 'open')).toBe(false);
    expect(setFinaleState(state, 'sealed')).toBe(false);
  });

  it('stamps defeatedAt exactly once', () => {
    const state = createQuestState();
    for (const id of SEAL_IDS) state.seals[id].state = 'broken';
    setFinaleState(state, 'open');
    setFinaleState(state, 'primed');
    setFinaleState(state, 'contested');
    setFinaleState(state, 'defeated');
    const at = state.finale.defeatedAt;
    expect(at).toBeGreaterThan(0);
    setFinaleState(state, 'defeated');
    expect(state.finale.defeatedAt).toBe(at);
  });
});

describe('the spire refuses, and says how many are left — §3.7', () => {
  it('will not take the offering before the fifth seal breaks', () => {
    const run = newRun();
    run.inventory._set('diamond', 10);

    for (let i = 0; i < SEAL_IDS.length; i++) {
      const check = run.sealSystem.canMakeOffering('finale');
      expect(check.ok, `with ${i} seals broken`).toBe(false);
      expect(check.reason).toContain(`${i} of 5`);
      run.questSystem.setSeal(SEAL_IDS[i], 'broken');
    }

    expect(run.sealSystem.canMakeOffering('finale').ok).toBe(true);
    // And the diamonds were never taken by a refused offering.
    expect(run.inventory.countItem('diamond')).toBe(10);
  });

  it('will not summon the Overlord from a sealed spire', () => {
    const run = newRun();
    expect(run.encounter.summon('finale')).toBeNull();
  });

  it('opens the moment the fifth seal breaks, and not one earlier', () => {
    const run = newRun();
    for (let i = 0; i < 4; i++) {
      run.questSystem.setSeal(SEAL_IDS[i], 'broken');
      expect(run.sealSystem.getSealState('finale')).toBe('sealed');
    }
    run.questSystem.setSeal(SEAL_IDS[4], 'broken');
    expect(run.sealSystem.getSealState('finale')).toBe('open');
  });
});

describe('the Corruption Overlord', () => {
  const opened = () => {
    const run = newRun();
    for (const id of SEAL_IDS) run.questSystem.setSeal(id, 'broken');
    return run;
  };

  it('is summoned from a primed spire and fights through three phases', () => {
    const run = opened();
    run.inventory._set('diamond', 10);
    expect(run.sealSystem.makeOffering('finale').ok).toBe(true);
    expect(run.sealSystem.getSealState('finale')).toBe('primed');

    const boss = run.encounter.summon('finale');
    expect(boss.type).toBe('corruption_overlord');
    expect(run.sealSystem.getSealState('finale')).toBe('contested');

    const phasesSeen = new Set();
    let guard = 0;
    while (run.encounter.boss && guard++ < 40000) {
      phasesSeen.add(run.encounter.boss.phaseIndex);
      run.encounter.applyHit({ bossId: boss.id, damage: 10, contributorId: 'char_solo' });
      run.encounter.update(1 / 60);
    }
    // "It comes apart and reassembles three times before it is finished."
    expect(phasesSeen.size).toBe(3);
    expect(run.sealSystem.getSealState('finale')).toBe('defeated');
    expect(run.questState.finale.defeatedAt).toBeGreaterThan(0);
  }, 60000);

  it('consumes the offering', () => {
    const run = opened();
    run.inventory._set('diamond', 12);
    run.sealSystem.makeOffering('finale');
    expect(run.inventory.countItem('diamond')).toBe(2);
  });

  it('records who fought it', () => {
    const run = opened();
    run.inventory._set('diamond', 10);
    run.sealSystem.makeOffering('finale');
    const boss = run.encounter.summon('finale');

    // 25, not 50: `maxLegalHit()` is computed from the best weapon in `NAMED_ITEMS`
    // times three, and 50 is over it. The host rejecting it is correct — §6.3 — and
    // the first version of this test found that out the honest way.
    run.encounter.applyHit({ bossId: boss.id, damage: 25, contributorId: 'char_guest' });
    let guard = 0;
    while (run.encounter.boss && guard++ < 40000) {
      run.encounter.applyHit({ bossId: boss.id, damage: 30, contributorId: 'char_solo' });
      run.encounter.update(1 / 60);
    }
    expect(run.questState.finale.brokenBy).toContain('char_solo');
    expect(run.questState.finale.brokenBy).toContain('char_guest');
  }, 60000);

  it('has a shield that must be broken before damage resumes', () => {
    // Phase 2's mechanic, and the one thing the boss bar has to be able to say.
    const run = opened();
    run.inventory._set('diamond', 10);
    run.sealSystem.makeOffering('finale');
    const boss = run.encounter.summon('finale');

    boss.hp = boss.maxHp * 0.5;
    boss.updatePhase();
    expect(boss.phase.id).toBe('darkness');

    boss.shieldHp = 150;
    boss.shieldRemaining = 20;
    const before = boss.hp;
    run.encounter.applyHit({ bossId: boss.id, damage: 40, contributorId: 'char_solo' });
    expect(boss.hp).toBe(before);
    expect(boss.isShielded).toBe(true);
  });
});

describe('a complete run — §11, S8', () => {
  it('finishes all 28 quests, earns all 13 titles, and ends the game', () => {
    const run = newRun();
    const completed = [];
    let gameComplete = 0;
    run.questSystem.onQuestCompleted = (id) => completed.push(id);
    run.questSystem.onGameComplete = () => { gameComplete++; };

    let guard = 0;
    while (run.questSystem.getActiveQuest() && guard++ < 60) {
      const active = run.questSystem.getActiveQuest();

      for (const objective of active.objectives) {
        if (objective.kind === OBJECTIVE_KINDS.CONTRIBUTE_ITEM) {
          run.inventory._set(objective.items[0], objective.count);
          run.questSystem.observe(active.id, objective.key, 'char_solo', objective.count);
        } else if (objective.kind === OBJECTIVE_KINDS.DELIVER) {
          const def = SEAL_DEFINITIONS[objective.seal];
          run.inventory._set(def.keyItem, 1);
          for (const req of def.offering) run.inventory._set(req.item, req.count);
          expect(run.sealSystem.makeOffering(objective.seal).ok).toBe(true);
        } else if (objective.kind === OBJECTIVE_KINDS.BOSS_KILL) {
          const sealId = BOSS_DEFINITIONS[objective.boss].seal;
          if (run.sealSystem.getSealState(sealId) !== 'primed') primeAndKill(run, sealId);
          else {
            const boss = run.encounter.summon(sealId);
            let g = 0;
            while (run.encounter.boss && g++ < 40000) {
              run.encounter.applyHit({ bossId: boss.id, damage: 30, contributorId: 'char_solo' });
              run.encounter.update(1 / 60);
            }
          }
        }
      }

      expect(run.questSystem.getActiveQuest()?.id, `${active.id} advanced`).not.toBe(active.id);
    }

    // Twenty-eight quests, in order, start to finish.
    expect(completed).toEqual([...QUEST_ORDER]);
    expect(run.questSystem.getCompletionSummary()).toEqual({ completed: 28, total: 28 });

    // The game ended, exactly once. Q28's `complete` reward is the only thing that
    // fires it.
    expect(gameComplete).toBe(1);

    // Every title, `world_saver` included.
    const expected = Object.values(TITLE_DEFINITIONS).map((t) => t.id);
    expect([...run.questState.titles].sort()).toEqual([...expected].sort());
    expect(run.questState.titles).toContain('world_saver');

    // Five seals broken and the spire defeated. "The seals are quiet."
    for (const id of SEAL_IDS) expect(run.sealSystem.getSealState(id)).toBe('broken');
    expect(run.sealSystem.getSealState('finale')).toBe('defeated');

    // And there is nothing left to do — the HUD tracker hides on exactly this.
    expect(run.questSystem.getActiveQuest()).toBeNull();
    expect(run.questSystem.getTrackerView()).toBeNull();
  }, 180000);

  it('the quest log shows every quest completed and every title earned', () => {
    const run = newRun();
    for (const id of QUEST_ORDER) run.questState.quests[id] = { stage: 0, completed: true, completedAt: 1 };
    for (const t of Object.keys(TITLE_DEFINITIONS)) run.questState.titles.push(t);

    const rows = run.questSystem.getLogView();
    expect(rows).toHaveLength(28);
    expect(rows.every((r) => r.status === 'completed')).toBe(true);
    expect(run.questSystem.getTitles()).toHaveLength(13);
    // Q28's row is reachable now, so its narrative is no longer withheld.
    expect(QUEST_DEFINITIONS.q28.narrative).toContain('The world is yours again');
  });
});
