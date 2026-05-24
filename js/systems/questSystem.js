/**
 * Cuubz — Quest System (World-State Based)
 * 25 quests across 4 dungeons + final boss. Progress lives with the world,
 * shared by all players in multiplayer sessions.
 */

const QUEST_TYPES = {
  COLLECT:   'collect',
  KILL:      'kill',
  EXPLORE:   'explore',
  CRAFT:     'craft',
  DELIVER:   'deliver',
  BOSS:      'boss',
};

const REWARD_TYPES = {
  ITEM:        'item',
  UNLOCK_QUEST:'unlock_quest',
  UNLOCK_AREA: 'unlock_area',
  XP:          'xp',
  TITLE:       'title',
};

const QUEST_STATES = {
  LOCKED:     'locked',
  AVAILABLE:  'available',
  IN_PROGRESS:'in_progress',
  COMPLETE:   'complete',
};

const QUEST_REGISTRY = [
  { id: 'quest_01', name: 'First Steps', description: 'Welcome to Cuubz! Break some wood and gather dirt.', type: QUEST_TYPES.COLLECT, stage: 1, requirements: [{ item: 'wood_log', count: 5 }, { item: 'dirt', count: 10 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_02' }, markerBiome: 'plains', markerOffset: { x: 3, z: 5 } },
  { id: 'quest_02', name: 'Crafting Basics', description: 'Turn wood logs into planks.', type: QUEST_TYPES.CRAFT, stage: 2, requirements: [{ item: 'planks', count: 10 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_03' }, markerBiome: 'plains', markerOffset: { x: -4, z: 8 } },
  { id: 'quest_03', name: 'A Warm Meal', description: 'Find apples on trees and eat them.', type: QUEST_TYPES.COLLECT, stage: 3, requirements: [{ item: 'apple', count: 3 }], reward: { type: REWARD_TYPES.ITEM, items: [{ item: 'berry', count: 5 }] }, markerBiome: 'forest', markerOffset: { x: 10, z: -6 } },
  { id: 'quest_04', name: 'Mining the Depths', description: 'Mine coal underground.', type: QUEST_TYPES.COLLECT, stage: 4, requirements: [{ item: 'coal', count: 10 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_05' }, markerBiome: 'mountains', markerOffset: { x: -8, z: 12 } },
  { id: 'quest_05', name: 'Iron Will', description: 'Find iron ore deep underground.', type: QUEST_TYPES.COLLECT, stage: 5, requirements: [{ item: 'iron_ore', count: 8 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_06' }, markerBiome: 'mountains', markerOffset: { x: 15, z: -10 } },
  { id: 'quest_06', name: 'A Safe Place to Rest', description: 'Craft and place a bed.', type: QUEST_TYPES.CRAFT, stage: 6, requirements: [{ item: 'bed', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_07' }, markerBiome: 'plains', markerOffset: { x: 0, z: -12 } },
  { id: 'quest_07', name: 'Whispers in the Dark', description: 'Investigate the corruption.', type: QUEST_TYPES.EXPLORE, stage: 7, requirements: [{ item: 'corrupt_crystal', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_08' }, markerBiome: 'corrupt', markerOffset: { x: -20, z: 15 } },
  { id: 'quest_08', name: 'Gathering Defenses', description: 'Collect gold ore and diamonds.', type: QUEST_TYPES.COLLECT, stage: 8, requirements: [{ item: 'gold_ore', count: 5 }, { item: 'diamond', count: 3 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_09' }, markerBiome: 'mountains', markerOffset: { x: 22, z: -18 } },
  { id: 'quest_09', name: 'The First Key', description: 'Find the dungeon key.', type: QUEST_TYPES.COLLECT, stage: 9, requirements: [{ item: 'quest_key', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_10' }, markerBiome: 'corrupt', markerOffset: { x: -25, z: 20 } },
  { id: 'quest_10', name: 'Into the Dungeon', description: 'Collect corrupt crystals.', type: QUEST_TYPES.COLLECT, stage: 10, requirements: [{ item: 'corrupt_crystal', count: 5 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_11' }, markerBiome: 'corrupt', markerOffset: { x: -30, z: 25 } },
  { id: 'quest_11', name: 'Offering of Light', description: 'Deliver key and crystals to summon boss.', type: QUEST_TYPES.DELIVER, stage: 11, requirements: [{ item: 'quest_key', count: 1 }, { item: 'corrupt_crystal', count: 5 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_12' }, markerBiome: 'corrupt', markerOffset: { x: -30, z: 25 } },
  { id: 'quest_12', name: 'The Forest Warden', description: 'Defeat the Forest Warden.', type: QUEST_TYPES.BOSS, stage: 12, bossId: 'forest_warden', requirements: [{ item: 'boss_kill', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_13' }, markerBiome: 'corrupt', markerOffset: { x: -35, z: 30 } },
  { id: 'quest_13', name: 'Ashes of the Past', description: 'Explore the volcanic wasteland.', type: QUEST_TYPES.EXPLORE, stage: 13, requirements: [{ item: 'obsidian', count: 5 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_14' }, markerBiome: 'lava', markerOffset: { x: 30, z: 30 } },
  { id: 'quest_14', name: 'Fireproof Preparation', description: 'Gather obsidian and blackstone.', type: QUEST_TYPES.COLLECT, stage: 14, requirements: [{ item: 'obsidian', count: 15 }, { item: 'blackstone', count: 20 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_15' }, markerBiome: 'lava', markerOffset: { x: 35, z: 35 } },
  { id: 'quest_15', name: 'The Second Key', description: 'Find the second dungeon key.', type: QUEST_TYPES.COLLECT, stage: 15, requirements: [{ item: 'quest_key', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_16' }, markerBiome: 'lava', markerOffset: { x: 40, z: 40 } },
  { id: 'quest_16', name: 'Heart of Fire', description: 'Deliver key and materials to awaken the Lava Titan.', type: QUEST_TYPES.DELIVER, stage: 16, requirements: [{ item: 'quest_key', count: 1 }, { item: 'obsidian', count: 10 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_17' }, markerBiome: 'lava', markerOffset: { x: 45, z: 45 } },
  { id: 'quest_17', name: 'The Lava Titan', description: 'Defeat the Lava Titan.', type: QUEST_TYPES.BOSS, stage: 17, bossId: 'lava_titan', requirements: [{ item: 'boss_kill', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_18' }, markerBiome: 'lava', markerOffset: { x: 50, z: 50 } },
  { id: 'quest_18', name: 'Frozen Wastes', description: 'Explore the frozen dungeon.', type: QUEST_TYPES.EXPLORE, stage: 18, requirements: [{ item: 'ice', count: 10 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_19' }, markerBiome: 'tundra', markerOffset: { x: -40, z: -35 } },
  { id: 'quest_19', name: 'Winter Supplies', description: 'Gather food and resources.', type: QUEST_TYPES.COLLECT, stage: 19, requirements: [{ item: 'cooked_meat', count: 5 }, { item: 'bread', count: 3 }, { item: 'ice', count: 15 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_20' }, markerBiome: 'tundra', markerOffset: { x: -45, z: -40 } },
  { id: 'quest_20', name: 'The Third Key', description: 'Find the third dungeon key.', type: QUEST_TYPES.COLLECT, stage: 20, requirements: [{ item: 'quest_key', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_21' }, markerBiome: 'tundra', markerOffset: { x: -50, z: -45 } },
  { id: 'quest_21', name: 'The Frost Serpent', description: 'Defeat the Frost Serpent.', type: QUEST_TYPES.BOSS, stage: 21, bossId: 'frost_serpent', requirements: [{ item: 'boss_kill', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_22' }, markerBiome: 'tundra', markerOffset: { x: -55, z: -50 } },
  { id: 'quest_22', name: 'The Final Corruption', description: 'Find the Corruption Overlord.', type: QUEST_TYPES.EXPLORE, stage: 22, requirements: [{ item: 'corrupt_crystal', count: 10 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_23' }, markerBiome: 'corrupt', markerOffset: { x: -60, z: 55 } },
  { id: 'quest_23', name: 'Keys of Power', description: 'Collect quest keys for the final confrontation.', type: QUEST_TYPES.COLLECT, stage: 23, requirements: [{ item: 'quest_key', count: 1 }, { item: 'diamond', count: 10 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_24' }, markerBiome: 'corrupt', markerOffset: { x: -65, z: 60 } },
  { id: 'quest_24', name: 'The Corruption Overlord', description: 'Face the source of all corruption.', type: QUEST_TYPES.BOSS, stage: 24, bossId: 'corruption_overlord', requirements: [{ item: 'boss_kill', count: 1 }], reward: { type: REWARD_TYPES.UNLOCK_QUEST, target: 'quest_25' }, markerBiome: 'corrupt', markerOffset: { x: -70, z: 65 } },
  { id: 'quest_25', name: 'The World Remade', description: 'Seal the corruption forever. Final multi-phase battle.', type: QUEST_TYPES.BOSS, stage: 25, bossId: 'final_seal', requirements: [{ item: 'boss_kill', count: 1 }], reward: { type: REWARD_TYPES.TITLE, value: 'World Saver' }, markerBiome: 'corrupt', markerOffset: { x: -75, z: 70 } },
];

class QuestSystem {
  constructor(worldState, options = {}) {
    this.worldState = worldState || {};
    this.onQuestComplete = options.onQuestComplete || null;
    this.onQuestStart = options.onQuestStart || null;
    this.onProgressUpdate = options.onProgressUpdate || null;
    this.onTrackerUpdate = options.onTrackerUpdate || null;
    this._registryMap = new Map();
    QUEST_REGISTRY.forEach(q => this._registryMap.set(q.id, q));
    this._initQuestStates();
  }

  _initQuestStates() {
    QUEST_REGISTRY.forEach((quest, idx) => {
      if (!this.worldState[quest.id]) {
        const prevCompleted = idx === 0 || (this.worldState[QUEST_REGISTRY[idx - 1]?.id]?.completed === true);
        this.worldState[quest.id] = {
          state: prevCompleted ? QUEST_STATES.AVAILABLE : QUEST_STATES.LOCKED,
          progress: {}, completed: false, completedAt: null,
        };
      }
    });
    this._rebuildChain();
  }

  _rebuildChain() {
    QUEST_REGISTRY.forEach((quest, idx) => {
      const qs = this.worldState[quest.id];
      if (!qs || qs.completed) return;
      if (idx === 0) {
        qs.state = QUEST_STATES.AVAILABLE;
      } else {
        const prevQuestId = QUEST_REGISTRY[idx - 1].id;
        const prevState = this.worldState[prevQuestId];
        qs.state = (prevState && prevState.completed) ? QUEST_STATES.AVAILABLE : QUEST_STATES.LOCKED;
      }
    });
  }

  getQuest(questId) { return this._registryMap.get(questId) || null; }

  getAllQuests() {
    return QUEST_REGISTRY.map(q => ({
      ...q, state: this.worldState[q.id]?.state || QUEST_STATES.LOCKED,
      progress: this.worldState[q.id]?.progress || {},
      completed: this.worldState[q.id]?.completed || false,
      completedAt: this.worldState[q.id]?.completedAt || null,
    }));
  }

  getCurrentQuest() {
    for (const q of QUEST_REGISTRY) {
      const qs = this.worldState[q.id];
      if (qs && (qs.state === QUEST_STATES.AVAILABLE || qs.state === QUEST_STATES.IN_PROGRESS)) {
        return { ...q, state: qs.state, progress: qs.progress };
      }
    }
    return null;
  }

  getNextObjective(questId) {
    const quest = this.getQuest(questId);
    if (!quest) return null;
    const qs = this.worldState[questId];
    if (!qs || qs.completed) return null;
    for (const req of quest.requirements) {
      const collected = qs.progress[req.item] || 0;
      if (collected < req.count) {
        return { item: req.item, needed: req.count, collected, remaining: req.count - collected, description: `${req.item} (${collected}/${req.count})` };
      }
    }
    return null;
  }

  getProgress(questId) {
    const qs = this.worldState[questId];
    if (!qs) return null;
    const quest = this.getQuest(questId);
    if (!quest) return null;
    const objectives = quest.requirements.map(req => ({
      item: req.item, needed: req.count,
      collected: qs.progress[req.item] || 0,
      remaining: Math.max(0, req.count - (qs.progress[req.item] || 0)),
      met: (qs.progress[req.item] || 0) >= req.count,
    }));
    const totalNeeded = objectives.reduce((s, o) => s + o.needed, 0);
    const totalCollected = objectives.reduce((s, o) => s + o.collected, 0);
    return { questId, state: qs.state, completed: qs.completed, objectives, totalNeeded, totalCollected, percentage: Math.min(100, totalNeeded > 0 ? (totalCollected / totalNeeded) * 100 : 0) };
  }

  startQuest(questId) {
    const qs = this.worldState[questId];
    if (!qs || qs.state !== QUEST_STATES.AVAILABLE) return false;
    qs.state = QUEST_STATES.IN_PROGRESS;
    if (this.onQuestStart) this.onQuestStart(questId);
    return true;
  }

  addProgress(item, count = 1) {
    /* Three-pass: identify → apply → check completion */
    const affectedQuests = [];
    for (const quest of QUEST_REGISTRY) {
      const qs = this.worldState[quest.id];
      if (!qs || qs.completed || qs.state === QUEST_STATES.LOCKED) continue;
      const req = quest.requirements.find(r => r.item === item);
      if (!req) continue;
      if (qs.state === QUEST_STATES.AVAILABLE) {
        qs.state = QUEST_STATES.IN_PROGRESS;
        if (this.onQuestStart) this.onQuestStart(quest.id);
      }
      const current = qs.progress[item] || 0;
      const newProgress = Math.min(current + count, req.count);
      if (newProgress > current) affectedQuests.push({ questId: quest.id, item, newProgress });
    }
    if (affectedQuests.length === 0) return null;
    for (const entry of affectedQuests) {
      this.worldState[entry.questId].progress[entry.item] = entry.newProgress;
      if (this.onProgressUpdate) this.onProgressUpdate(entry.questId, entry.item, entry.newProgress);
    }
    let completedQuests = [];
    for (const entry of affectedQuests) {
      if (!completedQuests.some(c => c.questId === entry.questId)) {
        if (this._checkCompletion(entry.questId)) completedQuests.push(this._completeQuest(entry.questId));
      }
    }
    if (completedQuests.length > 0) this._rebuildChain();
    return completedQuests.length > 0 ? completedQuests[0] : null;
  }

  _checkCompletion(questId) {
    const quest = this.getQuest(questId);
    if (!quest) return false;
    const qs = this.worldState[questId];
    if (!qs || qs.completed) return false;
    for (const req of quest.requirements) {
      if ((qs.progress[req.item] || 0) < req.count) return false;
    }
    return true;
  }

  _completeQuest(questId) {
    const quest = this.getQuest(questId);
    if (!quest) return null;
    const qs = this.worldState[questId];
    qs.state = QUEST_STATES.COMPLETE;
    qs.completed = true;
    qs.completedAt = Date.now();
    if (this.onTrackerUpdate) this.onTrackerUpdate(questId, QUEST_STATES.COMPLETE);
    if (this.onQuestComplete) this.onQuestComplete(questId, quest.reward);
    return { questId, name: quest.name, reward: quest.reward, completedAt: qs.completedAt };
  }

  isGameComplete() { return this.worldState['quest_25']?.completed === true; }
  getCompletedCount() { return QUEST_REGISTRY.filter(q => this.worldState[q.id]?.completed).length; }
  getCompletionPercentage() { return (this.getCompletedCount() / QUEST_REGISTRY.length) * 100; }
  serialize() { return JSON.parse(JSON.stringify(this.worldState)); }
  deserialize(data) { if (!data || typeof data !== 'object') return; this.worldState = JSON.parse(JSON.stringify(data)); this._initQuestStates(); this._rebuildChain(); }
  reset() { this.worldState = {}; this._initQuestStates(); }

  getMarkerPosition(questId, seed) {
    const quest = this.getQuest(questId);
    if (!quest || !quest.markerOffset) return null;
    const hash = this._hashString(seed + questId);
    return { x: quest.markerOffset.x + ((hash % 10) - 5), y: 64, z: quest.markerOffset.z + (((hash >> 4) % 10) - 5), biome: quest.markerBiome };
  }

  _hashString(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return Math.abs(h); }

  getQuestsByDungeon() {
    return {
      introduction: QUEST_REGISTRY.filter(q => q.stage >= 1 && q.stage <= 6),
      dungeon1_forest_warden: QUEST_REGISTRY.filter(q => q.stage >= 7 && q.stage <= 12),
      dungeon2_lava_titan: QUEST_REGISTRY.filter(q => q.stage >= 13 && q.stage <= 17),
      dungeon3_frost_serpent: QUEST_REGISTRY.filter(q => q.stage >= 18 && q.stage <= 21),
      dungeon4_corruption_overlord: QUEST_REGISTRY.filter(q => q.stage >= 22 && q.stage <= 25),
    };
  }

  getCurrentDungeon() {
    const c = this.getCompletedCount();
    if (c < 6) return 'introduction';
    if (c < 12) return 'dungeon1_forest_warden';
    if (c < 17) return 'dungeon2_lava_titan';
    if (c < 21) return 'dungeon3_frost_serpent';
    if (c < 24) return 'dungeon4_corruption_overlord';
    return 'final_boss';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QUEST_TYPES, REWARD_TYPES, QUEST_STATES, QUEST_REGISTRY, QuestSystem };
}
