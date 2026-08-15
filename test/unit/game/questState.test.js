/**
 * Cuubz — the quest state schema, its migration, and the pooled arithmetic (S0)
 *
 * The three things this file has to keep true, because the whole design rests on them:
 *
 *   1. **Every legacy shape migrates.** Three of them existed and disagreed (§2.1); a
 *      world config written by any of them has to load.
 *   2. **Nothing ever decreases.** Pools, high-water marks, seal states and titles are
 *      monotonic, and that is what lets reordered packets, late joins and
 *      rejoin-after-crash resolve with no conflict-resolution code anywhere.
 *   3. **It fits in localStorage.** ≤ 8 KB serialized, beside two other world configs
 *      and the character array.
 */

import { describe, it, expect } from 'vitest';
import {
  QUEST_STATE_VERSION,
  QUEST_STATE_BUDGET_BYTES,
  createQuestState,
  migrateQuestState,
  serializeQuestState,
  estimateSize,
  ensureQuest,
  ensureObjective,
  creditObservation,
  applyPooledDelta,
  isObjectiveComplete,
  areObjectivesComplete,
  completeQuest,
  setSealState,
  setSealSite,
  addSealContributor,
  countBrokenSeals,
  allSealsBroken,
  grantTitle,
} from '../../../src/game/data/QuestState.js';
import { SEAL_IDS } from '../../../src/game/data/SealDefinitions.js';

describe('createQuestState', () => {
  it('is a valid, empty v1 state', () => {
    const s = createQuestState();
    expect(s.v).toBe(QUEST_STATE_VERSION);
    expect(s.activeQuestId).toBe('q01');
    expect(s.quests).toEqual({});
    expect(s.titles).toEqual([]);
    expect(s.finale.state).toBe('sealed');
  });

  it('has all five seals, dormant and un-sited', () => {
    const s = createQuestState();
    expect(Object.keys(s.seals).sort()).toEqual([...SEAL_IDS].sort());
    for (const id of SEAL_IDS) {
      expect(s.seals[id].state).toBe('dormant');
      // §7.1 — a site is resolved from the seed on first entry and then frozen. A
      // default here would be a second source of truth for where the altar is.
      expect(s.seals[id].site).toBeNull();
      expect(s.seals[id].brokenBy).toEqual([]);
    }
  });

  it('returns a fresh object each call, not a shared one', () => {
    const a = createQuestState();
    const b = createQuestState();
    a.seals.verdant.state = 'broken';
    expect(b.seals.verdant.state).toBe('dormant');
  });
});

describe('migrateQuestState', () => {
  // The three shapes from §2.1, plus the two ways of having nothing at all.
  const LEGACY_SHAPES = [
    ['undefined', undefined],
    ['null', null],
    ['the empty object SessionRejoin/AutoRejoin used', {}],
    ["WorldManager's shape", { Q01: { stage: 5, completed: true, lastUpdated: 1754640000000 } }],
    ["Host's shape", { Q01: 7, Q02: 3 }],
    ['a string', 'not an object'],
    ['an array', [1, 2, 3]],
    ['a number', 42],
    ['a future version', { v: 99, quests: { q01: {} } }],
  ];

  for (const [label, input] of LEGACY_SHAPES) {
    it(`turns ${label} into a valid v1 state`, () => {
      const s = migrateQuestState(input);
      expect(s.v).toBe(QUEST_STATE_VERSION);
      expect(s.activeQuestId).toBe('q01');
      expect(Object.keys(s.seals)).toHaveLength(5);
      expect(s.finale.state).toBe('sealed');
      expect(Array.isArray(s.titles)).toBe(true);
    });
  }

  it('round-trips a real v1 state without loss', () => {
    const s = createQuestState();
    s.activeQuestId = 'q12';
    ensureObjective(s, 'q07', 'corrupt_crystal', 20);
    creditObservation(s, 'q07', 'corrupt_crystal', 'char_a', 9, 20);
    creditObservation(s, 'q07', 'corrupt_crystal', 'char_b', 5, 20);
    completeQuest(s, 'q06', 1754640000000);
    setSealState(s, 'verdant', 'keyed');
    setSealSite(s, 'verdant', { x: 812, z: -344 });
    addSealContributor(s, 'verdant', 'char_a');
    grantTitle(s, 'survivor');

    const round = migrateQuestState(JSON.parse(JSON.stringify(serializeQuestState(s))));

    expect(round.activeQuestId).toBe('q12');
    expect(round.quests.q07.objectives.corrupt_crystal.n).toBe(14);
    expect(round.quests.q07.objectives.corrupt_crystal.hw).toEqual({ char_a: 9, char_b: 5 });
    expect(round.quests.q06.completed).toBe(true);
    expect(round.quests.q06.completedAt).toBe(1754640000000);
    expect(round.seals.verdant.state).toBe('keyed');
    expect(round.seals.verdant.site).toEqual({ x: 812, z: -344 });
    expect(round.seals.verdant.brokenBy).toEqual(['char_a']);
    expect(round.titles).toEqual(['survivor']);
  });

  it('drops corrupt fields rather than carrying them into the live state', () => {
    const s = migrateQuestState({
      v: 1,
      activeQuestId: 12345,                                  // not a string
      quests: { q01: { stage: NaN, objectives: { a: { n: -5, target: 'x', hw: { c: -1, d: 3 } } } } },
      seals: { verdant: { state: 'nonsense', site: { x: 'no', z: 4 }, brokenBy: 'nope' } },
      finale: { state: 'wide open' },
      titles: [1, 'survivor', null],
    });

    expect(s.activeQuestId).toBe('q01');
    expect(s.quests.q01.stage).toBe(0);
    expect(s.quests.q01.objectives.a.n).toBe(0);
    expect(s.quests.q01.objectives.a.target).toBe(0);
    expect(s.quests.q01.objectives.a.hw).toEqual({ d: 3 }); // the negative mark is dropped
    expect(s.seals.verdant.state).toBe('dormant');
    expect(s.seals.verdant.site).toBeNull();
    expect(s.seals.verdant.brokenBy).toEqual([]);
    expect(s.finale.state).toBe('sealed');
    expect(s.titles).toEqual(['survivor']);
  });

  it('caps brokenBy at the four-player session limit', () => {
    const s = migrateQuestState({
      v: 1,
      seals: { verdant: { state: 'broken', brokenBy: ['a', 'b', 'c', 'd', 'e', 'f'] } },
    });
    expect(s.seals.verdant.brokenBy).toHaveLength(4);
  });
});

describe('pooled objectives — the high-water mechanism (§4.5)', () => {
  it('credits only the positive delta above a contributor’s previous high', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'wood_log', 20);

    expect(creditObservation(s, 'q01', 'wood_log', 'char_a', 5, 20)).toBe(5);
    expect(s.quests.q01.objectives.wood_log.n).toBe(5);

    // Same observation again — they still hold 5, they have not gathered more.
    expect(creditObservation(s, 'q01', 'wood_log', 'char_a', 5, 20)).toBe(0);
    expect(s.quests.q01.objectives.wood_log.n).toBe(5);

    // They gathered three more.
    expect(creditObservation(s, 'q01', 'wood_log', 'char_a', 8, 20)).toBe(3);
    expect(s.quests.q01.objectives.wood_log.n).toBe(8);
  });

  it('never decreases when a player drops, dies or disconnects', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'wood_log', 20);
    creditObservation(s, 'q01', 'wood_log', 'char_a', 12, 20);

    // The polling loop now observes 0 — they died and dropped everything. This is the
    // exact regression the high-water mark exists to prevent: a naive "pool = sum of
    // what everyone currently holds" would drop the party back to zero.
    expect(creditObservation(s, 'q01', 'wood_log', 'char_a', 0, 20)).toBe(0);
    expect(s.quests.q01.objectives.wood_log.n).toBe(12);
    expect(s.quests.q01.objectives.wood_log.hw.char_a).toBe(12);

    // And they cannot be credited again for re-gathering what they already banked.
    expect(creditObservation(s, 'q01', 'wood_log', 'char_a', 12, 20)).toBe(0);
    expect(s.quests.q01.objectives.wood_log.n).toBe(12);
  });

  it('sums across the party — work done by one counts for everyone', () => {
    const s = createQuestState();
    ensureObjective(s, 'q13', 'obsidian', 20);
    creditObservation(s, 'q13', 'obsidian', 'char_a', 12, 20);
    creditObservation(s, 'q13', 'obsidian', 'char_b', 8, 20);
    expect(s.quests.q13.objectives.obsidian.n).toBe(20);
    expect(areObjectivesComplete(s, 'q13')).toBe(true);
  });

  it('clamps at the target rather than overshooting', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'dirt', 10);
    creditObservation(s, 'q01', 'dirt', 'char_a', 64, 10);
    expect(s.quests.q01.objectives.dirt.n).toBe(10);
  });

  it('ignores a contribution with no contributor id', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'dirt', 10);
    expect(creditObservation(s, 'q01', 'dirt', '', 5, 10)).toBe(0);
    expect(creditObservation(s, 'q01', 'dirt', null, 5, 10)).toBe(0);
    expect(s.quests.q01.objectives.dirt.n).toBe(0);
  });

  it('a disconnected contributor’s mark survives, so a rejoin is not double-credited', () => {
    const s = createQuestState();
    ensureObjective(s, 'q13', 'obsidian', 40);
    creditObservation(s, 'q13', 'obsidian', 'char_guest', 15, 40);
    expect(s.quests.q13.objectives.obsidian.n).toBe(15);

    // The guest drops. The host keeps their mark keyed on the CHARACTER id, which is
    // device-persistent — unlike playerId, which the relay reassigns per connection.
    // They rejoin still holding the same 15 and the tracker re-observes them.
    expect(creditObservation(s, 'q13', 'obsidian', 'char_guest', 15, 40)).toBe(0);
    expect(s.quests.q13.objectives.obsidian.n).toBe(15);

    // Had the mark been keyed on a per-connection playerId, this is what would have
    // happened instead — the pool jumps to 30 for items that were only gathered once.
    expect(creditObservation(s, 'q13', 'obsidian', 'fresh_player_id', 15, 40)).toBe(15);
    expect(s.quests.q13.objectives.obsidian.n).toBe(30);
  });
});

describe('applyPooledDelta — the host’s half', () => {
  it('accumulates rather than taking a maximum', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'coal', 10);
    applyPooledDelta(s, 'q01', 'coal', 4, 10, 'char_a');
    const r = applyPooledDelta(s, 'q01', 'coal', 4, 10, 'char_b');
    expect(r.n).toBe(8);
    expect(r.complete).toBe(false);
  });

  it('reports completion exactly once the target is met', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'coal', 10);
    expect(applyPooledDelta(s, 'q01', 'coal', 9, 10).complete).toBe(false);
    expect(applyPooledDelta(s, 'q01', 'coal', 1, 10).complete).toBe(true);
  });

  it('refuses a zero or negative delta', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'coal', 10);
    applyPooledDelta(s, 'q01', 'coal', 5, 10);
    expect(applyPooledDelta(s, 'q01', 'coal', 0, 10).credited).toBe(0);
    expect(applyPooledDelta(s, 'q01', 'coal', -3, 10).credited).toBe(0);
    expect(s.quests.q01.objectives.coal.n).toBe(5);
  });
});

describe('completeQuest', () => {
  it('collapses the quest, dropping objectives and high-water maps', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'wood_log', 5);
    creditObservation(s, 'q01', 'wood_log', 'char_a', 5, 5);
    expect(s.quests.q01.objectives).toBeDefined();

    expect(completeQuest(s, 'q01', 1000)).toBe(true);
    expect(s.quests.q01.completed).toBe(true);
    expect(s.quests.q01.completedAt).toBe(1000);
    expect(s.quests.q01.objectives).toBeUndefined();
  });

  it('is idempotent', () => {
    const s = createQuestState();
    completeQuest(s, 'q01', 1000);
    expect(completeQuest(s, 'q01', 2000)).toBe(false);
    expect(s.quests.q01.completedAt).toBe(1000);
  });

  it('refuses to reopen a completed quest for contributions', () => {
    const s = createQuestState();
    completeQuest(s, 'q01');
    expect(ensureObjective(s, 'q01', 'wood_log', 5)).toBeNull();
    expect(creditObservation(s, 'q01', 'wood_log', 'char_a', 5, 5)).toBe(0);
  });
});

describe('seal state machine', () => {
  it('advances along the lifecycle', () => {
    const s = createQuestState();
    expect(setSealState(s, 'verdant', 'keyed')).toBe(true);
    expect(setSealState(s, 'verdant', 'primed')).toBe(true);
    expect(setSealState(s, 'verdant', 'contested')).toBe(true);
    expect(setSealState(s, 'verdant', 'broken')).toBe(true);
  });

  it('refuses to move backwards', () => {
    const s = createQuestState();
    setSealState(s, 'verdant', 'broken');
    expect(setSealState(s, 'verdant', 'primed')).toBe(false);
    expect(setSealState(s, 'verdant', 'dormant')).toBe(false);
    expect(s.seals.verdant.state).toBe('broken');
  });

  it('allows contested → primed, the one legal retreat (an encounter reset, §8.4)', () => {
    const s = createQuestState();
    setSealState(s, 'verdant', 'primed');
    setSealState(s, 'verdant', 'contested');
    expect(setSealState(s, 'verdant', 'primed')).toBe(true);
    expect(s.seals.verdant.state).toBe('primed');
  });

  it('rejects an unknown seal or an unknown state', () => {
    const s = createQuestState();
    expect(setSealState(s, 'nonexistent', 'broken')).toBe(false);
    expect(setSealState(s, 'verdant', 'exploded')).toBe(false);
  });

  it('freezes a site on first write and never recomputes it', () => {
    const s = createQuestState();
    expect(setSealSite(s, 'verdant', { x: 100, z: 200 })).toBe(true);
    expect(setSealSite(s, 'verdant', { x: 999, z: 999 })).toBe(false);
    expect(s.seals.verdant.site).toEqual({ x: 100, z: 200 });
  });

  it('counts broken seals and gates the finale on all five', () => {
    const s = createQuestState();
    expect(allSealsBroken(s)).toBe(false);
    for (const id of SEAL_IDS) {
      expect(allSealsBroken(s)).toBe(false);
      setSealState(s, id, 'broken');
    }
    expect(countBrokenSeals(s)).toBe(5);
    expect(allSealsBroken(s)).toBe(true);
  });

  it('records each contributor once, up to four', () => {
    const s = createQuestState();
    expect(addSealContributor(s, 'verdant', 'char_a')).toBe(true);
    expect(addSealContributor(s, 'verdant', 'char_a')).toBe(false);
    addSealContributor(s, 'verdant', 'char_b');
    addSealContributor(s, 'verdant', 'char_c');
    addSealContributor(s, 'verdant', 'char_d');
    expect(addSealContributor(s, 'verdant', 'char_e')).toBe(false);
    expect(s.seals.verdant.brokenBy).toHaveLength(4);
  });
});

describe('titles', () => {
  it('grants once and never removes', () => {
    const s = createQuestState();
    expect(grantTitle(s, 'survivor')).toBe(true);
    expect(grantTitle(s, 'survivor')).toBe(false);
    expect(grantTitle(s, '')).toBe(false);
    expect(s.titles).toEqual(['survivor']);
  });
});

describe('objective completion predicates', () => {
  it('treats a zero target as "any progress completes it"', () => {
    expect(isObjectiveComplete({ n: 0, target: 0 })).toBe(false);
    expect(isObjectiveComplete({ n: 1, target: 0 })).toBe(true);
    expect(isObjectiveComplete({ n: 4, target: 5 })).toBe(false);
    expect(isObjectiveComplete({ n: 5, target: 5 })).toBe(true);
  });

  it('a quest with no objectives is not complete', () => {
    const s = createQuestState();
    ensureQuest(s, 'q01');
    expect(areObjectivesComplete(s, 'q01')).toBe(false);
  });

  it('needs every objective, not just one', () => {
    const s = createQuestState();
    ensureObjective(s, 'q08', 'gold_ore', 5);
    ensureObjective(s, 'q08', 'diamond', 3);
    creditObservation(s, 'q08', 'gold_ore', 'char_a', 5, 5);
    expect(areObjectivesComplete(s, 'q08')).toBe(false);
    creditObservation(s, 'q08', 'diamond', 'char_a', 3, 3);
    expect(areObjectivesComplete(s, 'q08')).toBe(true);
  });
});

describe('the storage budget (§4.1)', () => {
  it('a fresh state is tiny', () => {
    expect(estimateSize(createQuestState())).toBeLessThan(1024);
  });

  it('a full 28-quest playthrough with four players fits in 8 KB', () => {
    const s = createQuestState();

    // 27 completed quests, collapsed. This is the case the collapse exists for: if
    // completed quests kept their objectives and `hw` maps, this alone would blow the
    // budget well before the finale.
    for (let i = 1; i <= 27; i++) {
      const id = `q${String(i).padStart(2, '0')}`;
      ensureObjective(s, id, 'some_item', 20);
      for (const c of ['char_a', 'char_b', 'char_c', 'char_d']) {
        creditObservation(s, id, 'some_item', c, 5, 20);
      }
      completeQuest(s, id, 1754640000000);
    }

    // The 28th is active, with two objectives and all four players' marks live.
    ensureObjective(s, 'q28', 'corrupt_crystal', 10);
    ensureObjective(s, 'q28', 'diamond', 10);
    for (const c of ['char_a', 'char_b', 'char_c', 'char_d']) {
      creditObservation(s, 'q28', 'corrupt_crystal', c, 2, 10);
      creditObservation(s, 'q28', 'diamond', c, 2, 10);
    }
    s.activeQuestId = 'q28';

    // Five broken seals, each with four contributors and a resolved site.
    for (const id of SEAL_IDS) {
      setSealSite(s, id, { x: -2048, z: 2048 });
      setSealState(s, id, 'broken');
      s.seals[id].brokenAt = 1754640000000;
      for (const c of ['char_a', 'char_b', 'char_c', 'char_d']) addSealContributor(s, id, c);
    }
    setSealSite(s, 'finale', { x: -1180, z: 260 });

    // Every title in the game.
    for (const t of [
      'survivor', 'seeker', 'warden_slayer', 'firewalker', 'titan_bane', 'icebound',
      'serpent_slayer', 'sandborn', 'colossus_breaker', 'deepwalker', 'kingsbane',
      'seal_master', 'world_saver',
    ]) grantTitle(s, t);

    const size = estimateSize(s);
    expect(size).toBeLessThanOrEqual(QUEST_STATE_BUDGET_BYTES);
  });
});

describe('serializeQuestState', () => {
  it('is a deep copy — mutating the result cannot reach the live state', () => {
    const s = createQuestState();
    ensureObjective(s, 'q01', 'wood_log', 5);
    creditObservation(s, 'q01', 'wood_log', 'char_a', 3, 5);
    setSealSite(s, 'verdant', { x: 1, z: 2 });
    grantTitle(s, 'survivor');

    const out = serializeQuestState(s);
    out.quests.q01.objectives.wood_log.n = 999;
    out.quests.q01.objectives.wood_log.hw.char_a = 999;
    out.seals.verdant.site.x = 999;
    out.seals.verdant.brokenBy.push('intruder');
    out.titles.push('cheater');

    expect(s.quests.q01.objectives.wood_log.n).toBe(3);
    expect(s.quests.q01.objectives.wood_log.hw.char_a).toBe(3);
    expect(s.seals.verdant.site.x).toBe(1);
    expect(s.seals.verdant.brokenBy).toEqual([]);
    expect(s.titles).toEqual(['survivor']);
  });
});
