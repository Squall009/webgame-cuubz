/**
 * Cuubz — the quest state machine, the definitions, and one full Act 1 run (S1)
 *
 * Three groups, and the third is the one that matters:
 *
 *   1. **The definitions are self-consistent.** 28 quests, every `requires` and every
 *      `unlock` naming a real quest, every title granted being a defined title, every
 *      item id resolving to a real block or a real `NAMED_ITEMS` entry. That last one is
 *      the assertion that would have caught `obsidian` — three Act 3 quests asked for a
 *      block that could not be mined and dropped nothing, and nothing said so.
 *   2. **Advancement is definition-driven.** The function this replaced hard-coded
 *      `completed = nextStage >= 5`.
 *   3. **Act 1 completes, end to end, against a mock inventory** — six quests, in order,
 *      each unlocked by the last, with the tracker doing the observing.
 */

import { describe, it, expect } from 'vitest';
import { QuestSystem } from '../../../src/game/systems/QuestSystem.js';
import { QuestTracker, TRACKER_INTERVAL_FRAMES } from '../../../src/game/systems/QuestTracker.js';
import {
  QUEST_DEFINITIONS, QUEST_ORDER, ACTS, OBJECTIVE_KINDS, ANY_LOG, ANY_PLANKS,
} from '../../../src/game/data/QuestDefinitions.js';
import { TITLE_DEFINITIONS } from '../../../src/game/data/TitleDefinitions.js';
import { createQuestState } from '../../../src/game/data/QuestState.js';
import { BLOCK_BY_ID, BLOCK_TYPES, getBlockDrop, BLOCK_PROPERTIES } from '../../../src/engine/world/BlockRegistry.js';
import { NAMED_ITEMS } from '../../../src/game/data/ItemDefinitions.js';
import { RECIPES } from '../../../src/game/systems/CraftingSystem.js';

/** A stand-in for `Inventory` with just the two methods the quest code touches. */
function mockInventory(initial = {}) {
  const held = new Map(Object.entries(initial));
  return {
    countItem(typeId) {
      return held.get(String(typeId)) || 0;
    },
    addItem(typeId, count) {
      held.set(String(typeId), (held.get(String(typeId)) || 0) + count);
      return true;
    },
    /** Test-only: put items in the player's hands. */
    _set(typeId, count) {
      held.set(String(typeId), count);
    },
    _held: held,
  };
}

describe('the definitions are self-consistent', () => {
  it('has exactly 28 quests across seven acts', () => {
    expect(QUEST_ORDER).toHaveLength(28);
    expect(ACTS).toHaveLength(7);
  });

  it('numbers the stages 1..28 with no gaps and no repeats', () => {
    const stages = QUEST_ORDER.map((id) => QUEST_DEFINITIONS[id].stage);
    expect(stages).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it("gives every act the quest count the storyline's act table says", () => {
    const counts = {};
    for (const id of QUEST_ORDER) {
      const act = QUEST_DEFINITIONS[id].act;
      counts[act] = (counts[act] || 0) + 1;
    }
    // 6 + 6 + 5 + 4 + 3 + 2 + 2 = 28
    expect(counts).toEqual({ 1: 6, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 2 });
  });

  it('names only real quests in `requires`', () => {
    for (const id of QUEST_ORDER) {
      for (const req of QUEST_DEFINITIONS[id].requires) {
        expect(QUEST_DEFINITIONS[req], `${id} requires ${req}`).toBeDefined();
      }
    }
  });

  it('names only real quests in `unlock` rewards, and only ever the next one', () => {
    for (const id of QUEST_ORDER) {
      for (const reward of QUEST_DEFINITIONS[id].rewards) {
        if (reward.kind !== 'unlock') continue;
        const target = QUEST_DEFINITIONS[reward.questId];
        expect(target, `${id} unlocks ${reward.questId}`).toBeDefined();
        // An `unlock` and the target's `requires` are two statements of one fact, and
        // `_ensureActiveQuest` believes `requires`. If they ever disagree, the unlock is
        // the one that silently does nothing.
        expect(target.requires, `${reward.questId}.requires names ${id}`).toContain(id);
      }
    }
  });

  it('grants only defined titles', () => {
    for (const id of QUEST_ORDER) {
      for (const reward of QUEST_DEFINITIONS[id].rewards) {
        if (reward.kind !== 'title') continue;
        expect(TITLE_DEFINITIONS[reward.id], `${id} grants ${reward.id}`).toBeDefined();
        expect(TITLE_DEFINITIONS[reward.id].quest).toBe(id);
      }
    }
  });

  it('gives every objective a key that is unique within its quest', () => {
    for (const id of QUEST_ORDER) {
      const keys = QUEST_DEFINITIONS[id].objectives.map((o) => o.key);
      expect(new Set(keys).size, `${id} has duplicate objective keys`).toBe(keys.length);
    }
  });

  it('uses only the five defined objective kinds', () => {
    const kinds = new Set(Object.values(OBJECTIVE_KINDS));
    for (const id of QUEST_ORDER) {
      for (const o of QUEST_DEFINITIONS[id].objectives) {
        expect(kinds.has(o.kind), `${id}.${o.key} kind ${o.kind}`).toBe(true);
      }
    }
  });

  // ─── The assertion that would have caught `obsidian` ─────────────────
  //
  // Every `contribute_item` id has to be something a player can actually end up
  // holding: a `NAMED_ITEMS` key, or a block that is breakable and drops something.
  // Before S1 three Act 3 quests asked for `BLOCK_TYPES.OBSIDIAN`, which aliased
  // `crying_obsidian` at hardness -1 — unbreakable, and `getBlockDrop` returns null for
  // it. The quests were not hard; they were impossible, and silently.
  it('asks only for items a player can obtain', () => {
    for (const id of QUEST_ORDER) {
      for (const o of QUEST_DEFINITIONS[id].objectives) {
        if (o.kind !== OBJECTIVE_KINDS.CONTRIBUTE_ITEM) continue;
        expect(o.items.length, `${id}.${o.key} lists no items`).toBeGreaterThan(0);

        for (const typeId of o.items) {
          if (typeof typeId === 'string') {
            expect(NAMED_ITEMS[typeId], `${id}.${o.key} names item ${typeId}`).toBeDefined();
            continue;
          }
          const block = BLOCK_BY_ID[typeId];
          expect(block, `${id}.${o.key} names block id ${typeId}`).toBeDefined();

          const props = BLOCK_PROPERTIES[typeId];
          expect(props.hardness, `${id}.${o.key} wants unbreakable ${block.name}`).not.toBe(-1);
          expect(getBlockDrop(typeId), `${id}.${o.key} wants ${block.name}, which drops nothing`).not.toBeNull();
        }
      }
    }
  });

  it('has a recipe for every item a CRAFT quest asks for', () => {
    // Q06 wants a bed and Q19 wants bread. Both were listed in §2.5 as content the
    // storyline assumed and the game did not have — no bed block, no bed recipe, and
    // `bread` a defined item with no recipe and no source anywhere in the world.
    const outputs = new Set(Object.values(RECIPES).map((r) => String(r.output.typeId)));
    expect(outputs.has(String(BLOCK_TYPES.BED)), 'a bed can be crafted').toBe(true);
    expect(outputs.has('bread'), 'bread can be crafted').toBe(true);
  });

  it('accepts any wood type, not just oak', () => {
    // A player who spawns in a spruce forest still finishes Q01.
    expect(QUEST_DEFINITIONS.q01.objectives[0].items).toEqual(ANY_LOG);
    expect(QUEST_DEFINITIONS.q02.objectives[0].items).toEqual(ANY_PLANKS);
    expect(ANY_LOG.length).toBeGreaterThan(5);
    expect(ANY_PLANKS.length).toBeGreaterThan(5);
  });

  it('gives every seal key quest its own key item — never a shared one', () => {
    const keyItems = QUEST_ORDER
      .flatMap((id) => QUEST_DEFINITIONS[id].objectives)
      .filter((o) => o.key === 'seal_key')
      .flatMap((o) => o.items);
    expect(new Set(keyItems).size).toBe(keyItems.length);
    expect(keyItems).toHaveLength(5);
    for (const k of keyItems) {
      // Single-stack is exactly why there are five: two could never be carried.
      expect(NAMED_ITEMS[k].maxStack).toBe(1);
    }
  });
});

describe('prerequisite gating', () => {
  it('starts on q01 with everything else locked', () => {
    const q = new QuestSystem({ questState: createQuestState() });
    expect(q.getActiveQuest().id).toBe('q01');
    expect(q.isAvailable('q01')).toBe(true);
    expect(q.isAvailable('q02')).toBe(false);
    expect(q.isAvailable('q28')).toBe(false);
  });

  it('opens the next quest only when its prerequisite completes', () => {
    const q = new QuestSystem({ questState: createQuestState() });
    q.observe('q01', 'wood_log', 'char_a', 5);
    expect(q.isAvailable('q02')).toBe(false); // dirt still outstanding
    q.observe('q01', 'dirt', 'char_a', 10);
    expect(q.isCompleted('q01')).toBe(true);
    expect(q.isAvailable('q02')).toBe(true);
    expect(q.getActiveQuest().id).toBe('q02');
  });

  it('will not evaluate an objective on a quest that is not available', () => {
    // A player carrying 20 obsidian in Act 1 does not silently bank Act 3's pool — and
    // more to the point, Q14 does not complete the instant it unlocks, skipping the
    // trip to the Lava biome it exists to describe.
    const q = new QuestSystem({ questState: createQuestState() });
    expect(q.observe('q14', 'obsidian', 'char_a', 64)).toBe(0);
    expect(q.getState().quests.q14).toBeUndefined();
  });

  it('recovers when activeQuestId points at something impossible', () => {
    const state = createQuestState();
    state.activeQuestId = 'q_does_not_exist';
    const q = new QuestSystem({ questState: state });
    expect(q.getActiveQuest().id).toBe('q01');
  });
});

describe('advancement is definition-driven', () => {
  it('needs every objective on a multi-objective quest', () => {
    const q = new QuestSystem({ questState: createQuestState() });
    q.observe('q01', 'wood_log', 'char_a', 5);
    expect(q.isCompleted('q01')).toBe(false);
    q.observe('q01', 'dirt', 'char_a', 9);
    expect(q.isCompleted('q01')).toBe(false);
    q.observe('q01', 'dirt', 'char_a', 10);
    expect(q.isCompleted('q01')).toBe(true);
  });

  it('does not complete a quest after five of anything', () => {
    // The replaced `WorldManager.advanceQuest` had `completed = nextStage >= 5` under
    // the comment "simplified — actual quest system will define stages", so every quest
    // in the game was five stages long whatever its definition said. Q19 needs 5 meat,
    // 3 bread and 15 ice; five advances of anything must not finish it.
    const state = createQuestState();
    for (const id of ['q01', 'q02', 'q03', 'q04', 'q05', 'q06', 'q07', 'q08', 'q09',
      'q10', 'q11', 'q12', 'q13', 'q14', 'q15', 'q16', 'q17', 'q18']) {
      state.quests[id] = { stage: 0, completed: true, completedAt: 1 };
    }
    const q = new QuestSystem({ questState: state });
    expect(q.getActiveQuest().id).toBe('q19');

    q.observe('q19', 'cooked_meat', 'char_a', 5);
    expect(q.isCompleted('q19')).toBe(false);
    q.observe('q19', 'bread', 'char_a', 3);
    expect(q.isCompleted('q19')).toBe(false);
    q.observe('q19', 'ice', 'char_a', 14);
    expect(q.isCompleted('q19')).toBe(false);
    q.observe('q19', 'ice', 'char_a', 15);
    expect(q.isCompleted('q19')).toBe(true);
  });

  it('pools contributions from more than one player', () => {
    const q = new QuestSystem({ questState: createQuestState() });
    q.observe('q01', 'wood_log', 'char_a', 3);
    q.observe('q01', 'wood_log', 'char_b', 2);
    q.observe('q01', 'dirt', 'char_b', 10);
    expect(q.isCompleted('q01')).toBe(true);
  });
});

describe('rewards', () => {
  it('grants titles', () => {
    const state = createQuestState();
    for (const id of ['q01', 'q02', 'q03', 'q04', 'q05']) {
      state.quests[id] = { stage: 0, completed: true, completedAt: 1 };
    }
    const q = new QuestSystem({ questState: state });
    const granted = [];
    q.onTitleGranted = (id) => granted.push(id);

    q.observe('q06', 'bed', 'char_a', 1);
    expect(q.isCompleted('q06')).toBe(true);
    expect(granted).toEqual(['survivor']);
    expect(q.getState().titles).toEqual(['survivor']);
    expect(q.getTitles()[0].name).toBe('Survivor');
  });

  it('grants items into the inventory', () => {
    const state = createQuestState();
    state.quests.q01 = { stage: 0, completed: true, completedAt: 1 };
    state.quests.q02 = { stage: 0, completed: true, completedAt: 1 };
    const inventory = mockInventory();
    const q = new QuestSystem({ questState: state, inventory });

    q.observe('q03', 'apple', 'char_a', 3);
    expect(q.isCompleted('q03')).toBe(true);
    // Q03's reward is 5 berry.
    expect(inventory.countItem('berry')).toBe(5);
  });

  it('fires onGameComplete for Q28 and nothing else', () => {
    const state = createQuestState();
    for (const id of QUEST_ORDER.slice(0, 27)) {
      state.quests[id] = { stage: 0, completed: true, completedAt: 1 };
    }
    const q = new QuestSystem({ questState: state });
    let completed = 0;
    q.onGameComplete = () => { completed++; };

    expect(q.getActiveQuest().id).toBe('q28');
    q.recordBossDefeat('corruption_overlord');
    expect(q.isCompleted('q28')).toBe(true);
    expect(completed).toBe(1);
    // Everything is done; there is no next quest and the HUD panel hides.
    expect(q.getActiveQuest()).toBeNull();
    expect(q.getTrackerView()).toBeNull();
  });
});

describe('a guest evaluates but does not decide (§5.2)', () => {
  it('will not complete a quest locally', () => {
    const q = new QuestSystem({ questState: createQuestState(), authoritative: false });
    q.observe('q01', 'wood_log', 'char_a', 5);
    q.observe('q01', 'dirt', 'char_a', 10);
    // The pool moved — the guest can see its own progress — but the completion is the
    // host's to declare, and a guest granting itself Q06's title would be a second
    // source of truth for the world's state.
    expect(q.getState().quests.q01.objectives.dirt.n).toBe(10);
    expect(q.isCompleted('q01')).toBe(false);
    expect(q.getState().titles).toEqual([]);
  });

  it('takes the host state wholesale on replaceState, firing no rewards', () => {
    const q = new QuestSystem({ questState: createQuestState(), authoritative: false });
    let titles = 0;
    q.onTitleGranted = () => { titles++; };

    const hostState = createQuestState();
    hostState.quests.q01 = { stage: 1, completed: true, completedAt: 1 };
    hostState.titles = ['survivor'];
    hostState.activeQuestId = 'q02';
    q.replaceState(hostState);

    expect(q.getActiveQuest().id).toBe('q02');
    expect(q.getTitles()).toHaveLength(1);
    expect(titles).toBe(0);
  });
});

describe('boss, delivery and seal objectives', () => {
  const atQuest = (questId) => {
    const state = createQuestState();
    for (const id of QUEST_ORDER) {
      if (id === questId) break;
      state.quests[id] = { stage: 0, completed: true, completedAt: 1 };
    }
    return new QuestSystem({ questState: state });
  };

  it('completes a BOSS quest on the right boss and no other', () => {
    const q = atQuest('q12');
    expect(q.recordBossDefeat('lava_titan')).toBe(false);
    expect(q.isCompleted('q12')).toBe(false);
    expect(q.recordBossDefeat('forest_warden')).toBe(true);
    expect(q.isCompleted('q12')).toBe(true);
  });

  it('completes a DELIVER quest on the right seal', () => {
    const q = atQuest('q11');
    expect(q.recordDelivery('ember')).toBe(false);
    expect(q.recordDelivery('verdant')).toBe(true);
    expect(q.isCompleted('q11')).toBe(true);
  });

  it('opens the finale exactly when the fifth seal breaks', () => {
    const q = new QuestSystem({ questState: createQuestState() });
    for (const id of ['verdant', 'ember', 'frozen', 'sunken']) {
      q.setSeal(id, 'broken');
      expect(q.getState().finale.state).toBe('sealed');
    }
    q.setSeal('deepstone', 'broken');
    expect(q.getState().finale.state).toBe('open');
  });
});

describe('the tracker', () => {
  it('polls on the interval and not between', () => {
    const state = createQuestState();
    const q = new QuestSystem({ questState: state });
    const inventory = mockInventory();
    const tracker = new QuestTracker({ questSystem: q, inventory, contributorId: 'char_a' });

    inventory._set(BLOCK_TYPES.OAK_LOG, 5);

    tracker.tick(1, { x: 0, y: 0, z: 0 });
    expect(state.quests.q01?.objectives?.wood_log?.n || 0).toBe(0);

    tracker.tick(TRACKER_INTERVAL_FRAMES, { x: 0, y: 0, z: 0 });
    expect(state.quests.q01.objectives.wood_log.n).toBe(5);
  });

  it('sums across every accepted item type', () => {
    const state = createQuestState();
    const q = new QuestSystem({ questState: state });
    const inventory = mockInventory();
    const tracker = new QuestTracker({ questSystem: q, inventory, contributorId: 'char_a' });

    inventory._set(BLOCK_TYPES.OAK_LOG, 2);
    inventory._set(BLOCK_TYPES.BIRCH_LOG, 2);
    inventory._set(BLOCK_TYPES.SPRUCE_LOG, 1);
    tracker.tick(TRACKER_INTERVAL_FRAMES, { x: 0, y: 0, z: 0 });
    expect(state.quests.q01.objectives.wood_log.n).toBe(5);
  });

  it('does not lose progress when the player drops what they gathered', () => {
    const state = createQuestState();
    const q = new QuestSystem({ questState: state });
    const inventory = mockInventory();
    const tracker = new QuestTracker({ questSystem: q, inventory, contributorId: 'char_a' });

    inventory._set(BLOCK_TYPES.OAK_LOG, 4);
    tracker.tick(TRACKER_INTERVAL_FRAMES, null);
    expect(state.quests.q01.objectives.wood_log.n).toBe(4);

    inventory._set(BLOCK_TYPES.OAK_LOG, 0);           // died, dropped everything
    tracker.tick(TRACKER_INTERVAL_FRAMES * 2, null);
    expect(state.quests.q01.objectives.wood_log.n).toBe(4);

    inventory._set(BLOCK_TYPES.OAK_LOG, 4);           // gathered the same 4 again
    tracker.tick(TRACKER_INTERVAL_FRAMES * 3, null);
    expect(state.quests.q01.objectives.wood_log.n).toBe(4);

    inventory._set(BLOCK_TYPES.OAK_LOG, 5);           // one genuinely new log
    tracker.tick(TRACKER_INTERVAL_FRAMES * 4, null);
    expect(state.quests.q01.objectives.wood_log.n).toBe(5);
  });

  it('routes through the transport instead of applying locally, when one is set', () => {
    const state = createQuestState();
    const q = new QuestSystem({ questState: state, authoritative: false });
    const inventory = mockInventory();
    const sent = [];
    const tracker = new QuestTracker({
      questSystem: q, inventory, contributorId: 'char_guest',
      sendContribution: (...args) => sent.push(args),
    });

    inventory._set(BLOCK_TYPES.OAK_LOG, 3);
    tracker.tick(TRACKER_INTERVAL_FRAMES, null);
    expect(sent).toEqual([['q01', 'wood_log', 3, 'char_guest']]);

    // The same 3 on the next tick is not a new high, so nothing is sent — a guest that
    // re-reported its whole inventory twice a second would flood the host and, worse,
    // be credited for it every time.
    tracker.tick(TRACKER_INTERVAL_FRAMES * 2, null);
    expect(sent).toHaveLength(1);
  });
});

describe('Act 1, end to end, against a mock inventory', () => {
  it('completes all six quests in order and lands on q07', () => {
    const state = createQuestState();
    const inventory = mockInventory();
    const q = new QuestSystem({ questState: state, inventory });
    const tracker = new QuestTracker({ questSystem: q, inventory, contributorId: 'char_a' });

    const completions = [];
    q.onQuestCompleted = (id) => completions.push(id);

    let frame = 0;
    const poll = () => { frame += TRACKER_INTERVAL_FRAMES; tracker.tick(frame, { x: 0, y: 64, z: 0 }); };

    // Q01 — 5 logs and 10 dirt.
    inventory._set(BLOCK_TYPES.OAK_LOG, 5);
    inventory._set(BLOCK_TYPES.DIRT, 10);
    poll();
    expect(q.getActiveQuest().id).toBe('q02');

    // Q02 — 10 planks. The logs became planks, so the log count falls; the pool must
    // not, and Q01 is already banked anyway.
    inventory._set(BLOCK_TYPES.OAK_LOG, 0);
    inventory._set(BLOCK_TYPES.OAK_PLANKS, 10);
    poll();
    expect(q.getActiveQuest().id).toBe('q03');

    // Q03 — 3 apples, rewards 5 berry.
    inventory._set('apple', 3);
    poll();
    expect(inventory.countItem('berry')).toBe(5);
    expect(q.getActiveQuest().id).toBe('q04');

    // Q04 — 10 coal.
    inventory._set('coal', 10);
    poll();
    expect(q.getActiveQuest().id).toBe('q05');

    // Q05 — 8 iron ore.
    inventory._set('iron_ore', 8);
    poll();
    expect(q.getActiveQuest().id).toBe('q06');

    // Q06 — a bed, which needed a block and a recipe that did not exist (§2.5).
    inventory._set(BLOCK_TYPES.BED, 1);
    poll();

    expect(completions).toEqual(['q01', 'q02', 'q03', 'q04', 'q05', 'q06']);
    expect(q.getActiveQuest().id).toBe('q07');
    expect(q.getState().titles).toEqual(['survivor']);
    expect(q.getCompletionSummary()).toEqual({ completed: 6, total: 28 });
  });

  it('leaves Act 2 untouched throughout', () => {
    const state = createQuestState();
    const inventory = mockInventory();
    const q = new QuestSystem({ questState: state, inventory });
    const tracker = new QuestTracker({ questSystem: q, inventory, contributorId: 'char_a' });

    // The player is carrying Act 2's requirements the whole time.
    inventory._set('gold_ore', 64);
    inventory._set('diamond', 64);
    inventory._set(BLOCK_TYPES.OAK_LOG, 5);
    inventory._set(BLOCK_TYPES.DIRT, 10);
    tracker.tick(TRACKER_INTERVAL_FRAMES, null);

    expect(q.isCompleted('q01')).toBe(true);
    expect(state.quests.q08).toBeUndefined();
    expect(q.isCompleted('q08')).toBe(false);
  });
});

describe('the tracker view the HUD reads', () => {
  it('carries every objective with its live total', () => {
    const q = new QuestSystem({ questState: createQuestState() });
    q.observe('q01', 'wood_log', 'char_a', 2);

    const view = q.getTrackerView();
    expect(view.id).toBe('q01');
    expect(view.title).toBe('First Steps');
    expect(view.act).toBe(1);
    expect(view.objectives).toHaveLength(2);

    const logs = view.objectives.find((o) => o.key === 'wood_log');
    expect(logs).toMatchObject({ n: 2, target: 5, complete: false, label: 'Wood Logs' });
    const dirt = view.objectives.find((o) => o.key === 'dirt');
    expect(dirt).toMatchObject({ n: 0, target: 10, complete: false });
  });
});

describe('the quest log view', () => {
  it("withholds a locked quest's narrative", () => {
    // Q27's text is where the storyline turns — "You were never restoring the seals.
    // You were opening them." A log that printed it from Act 1 would give away the game.
    const q = new QuestSystem({ questState: createQuestState() });
    const rows = q.getLogView();
    const q27 = rows.find((r) => r.id === 'q27');
    expect(q27.status).toBe('locked');
    expect(q27.narrative).toBeNull();

    const q01 = rows.find((r) => r.id === 'q01');
    expect(q01.status).toBe('active');
    expect(q01.narrative).toContain('Gather what the land provides');
  });

  it('marks exactly one quest active', () => {
    const q = new QuestSystem({ questState: createQuestState() });
    q.observe('q01', 'wood_log', 'char_a', 5);
    q.observe('q01', 'dirt', 'char_a', 10);
    const rows = q.getLogView();
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
    expect(rows.find((r) => r.status === 'active').id).toBe('q02');
    expect(rows.find((r) => r.id === 'q01').status).toBe('completed');
  });
});
