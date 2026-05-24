/**
 * Cuubz - Quest System (NEW)
 * World-state quest tracking with 25 quests, progression chains, requirements, and rewards.
 */

'use strict';

const QUEST_TYPES = {
  COLLECT: 'collect',
  EXPLORE: 'explore',
  KILL: 'kill',
  CRAFT: 'craft',
  PLACE: 'place',
  DIALOGUE: 'dialogue',
  BOSS: 'boss',
};

const QUEST_DIFFICULTY = {
  TRIVIAL: 1,
  EASY: 2,
  MEDIUM: 3,
  HARD: 4,
  LEGENDARY: 5,
};

const REWARD_TYPES = {
  ITEM: 'item',
  UNLOCK: 'unlock',
  XP: 'xp',
  ACHIEVEMENT: 'achievement',
};

const QUEST_CATALOG = Object.freeze({
  Q01: Object.freeze({
    id: 'Q01', name: 'A New Beginning',
    description: 'Welcome to Cuubz! Take your first steps into the world.',
    type: QUEST_TYPES.EXPLORE, difficulty: QUEST_DIFFICULTY.TRIVIAL,
    requirements: { exploreBiomes: ['Plains'] },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'apple', count: 3 },
    nextQuest: 'Q02', markerBiome: 'Plains',
  }),
  Q02: Object.freeze({
    id: 'Q02', name: 'Gather Wood',
    description: 'Chop down trees and collect wood logs.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.TRIVIAL,
    requirements: { collectItem: 'wood_log', count: 10 },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'planks', count: 8 },
    nextQuest: 'Q03', markerBiome: 'Forest',
  }),
  Q03: Object.freeze({
    id: 'Q03', name: 'Stone Age',
    description: 'Mine stone blocks to upgrade your tools.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.EASY,
    requirements: { collectItem: 'stone', count: 20 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'stone_tools' },
    nextQuest: 'Q04', markerBiome: 'Mountains',
  }),
  Q04: Object.freeze({
    id: 'Q04', name: 'A Safe Place to Sleep',
    description: 'Craft and place a bed so you have somewhere safe to rest.',
    type: QUEST_TYPES.CRAFT, difficulty: QUEST_DIFFICULTY.EASY,
    requirements: { craftItem: 'bed', count: 1 },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'apple', count: 5 },
    nextQuest: 'Q05', markerBiome: 'Plains',
  }),
  Q05: Object.freeze({
    id: 'Q05', name: 'Diggers Delight',
    description: 'Dig down and find coal ore.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.EASY,
    requirements: { collectItem: 'coal_ore', count: 10 },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'cooked_meat', count: 3 },
    nextQuest: 'Q06', markerBiome: 'Mountains',
  }),
  Q06: Object.freeze({
    id: 'Q06', name: 'Into the Depths',
    description: 'Find iron ore hidden beneath the surface.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.MEDIUM,
    requirements: { collectItem: 'iron_ore', count: 15 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'iron_tools' },
    nextQuest: 'Q07', markerBiome: 'Mountains',
  }),
  Q07: Object.freeze({
    id: 'Q07', name: 'Whispers in the Dark',
    description: 'Investigate strange sounds and find the first dungeon.',
    type: QUEST_TYPES.EXPLORE, difficulty: QUEST_DIFFICULTY.MEDIUM,
    requirements: { exploreBiomes: ['Corrupt'] },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'quest_key', count: 1 },
    nextQuest: 'Q08', markerBiome: 'Corrupt',
  }),
  Q08: Object.freeze({
    id: 'Q08', name: 'Prepare for Battle',
    description: 'Gather supplies before entering the dungeon.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.MEDIUM,
    requirements: { collectItem: 'apple', count: 10 },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'golden_apple', count: 1 },
    nextQuest: 'Q09', markerBiome: 'Forest',
  }),
  Q09: Object.freeze({
    id: 'Q09', name: 'The Corrupted Roots',
    description: 'Clear toxic pools and find the dungeon heart.',
    type: QUEST_TYPES.EXPLORE, difficulty: QUEST_DIFFICULTY.MEDIUM,
    requirements: { exploreBiomes: ['Corrupt'], collectItem: 'corrupt_crystal', count: 3 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'dungeon_1_access' },
    nextQuest: 'Q10', markerBiome: 'Corrupt',
  }),
  Q10: Object.freeze({
    id: 'Q10', name: 'Keys to the Gate',
    description: 'Find three dungeon keys hidden in the corruption.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { collectItem: 'quest_key', count: 3 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'dungeon_1_inner' },
    nextQuest: 'Q11', markerBiome: 'Corrupt',
  }),
  Q11: Object.freeze({
    id: 'Q11', name: 'The Forest Guardian Awakens',
    description: 'Face the first boss - the Forest Guardian.',
    type: QUEST_TYPES.BOSS, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { killBoss: 'forest_guardian' },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'gold_ore', count: 10 },
    nextQuest: 'Q12', markerBiome: 'Corrupt',
  }),
  Q12: Object.freeze({
    id: 'Q12', name: 'Purified Lands',
    description: 'Collect purified crystals left by the defeated guardian.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.MEDIUM,
    requirements: { collectItem: 'corrupt_crystal', count: 5 },
    reward: { type: REWARD_TYPES.ACHIEVEMENT, achievementId: 'first_boss_slayer' },
    nextQuest: 'Q13', markerBiome: 'Plains',
  }),
  Q13: Object.freeze({
    id: 'Q13', name: 'Desert Horizons',
    description: 'Travel to the scorching desert.',
    type: QUEST_TYPES.EXPLORE, difficulty: QUEST_DIFFICULTY.MEDIUM,
    requirements: { exploreBiomes: ['Desert'] },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'cooked_meat', count: 5 },
    nextQuest: 'Q14', markerBiome: 'Desert',
  }),
  Q14: Object.freeze({
    id: 'Q14', name: 'Gold Rush',
    description: 'Mine enough gold to forge a powerful weapon.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { collectItem: 'gold_ore', count: 25 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'gold_weapons' },
    nextQuest: 'Q15', markerBiome: 'Desert',
  }),
  Q15: Object.freeze({
    id: 'Q15', name: 'The Sunken Temple',
    description: 'Navigate the ancient temple beneath the desert.',
    type: QUEST_TYPES.EXPLORE, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { exploreBiomes: ['Desert'], collectItem: 'quest_key', count: 3 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'dungeon_2_access' },
    nextQuest: 'Q16', markerBiome: 'Desert',
  }),
  Q16: Object.freeze({
    id: 'Q16', name: 'Sand Wraith Rising',
    description: 'Defeat the Sand Wraith to claim its treasures.',
    type: QUEST_TYPES.BOSS, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { killBoss: 'sand_wraith' },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'diamond', count: 5 },
    nextQuest: 'Q17', markerBiome: 'Desert',
  }),
  Q17: Object.freeze({
    id: 'Q17', name: 'Temple Treasures',
    description: 'Claim the temples ancient artifacts.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.MEDIUM,
    requirements: { collectItem: 'diamond', count: 3 },
    reward: { type: REWARD_TYPES.ACHIEVEMENT, achievementId: 'temple_explorer' },
    nextQuest: 'Q18', markerBiome: 'Plains',
  }),
  Q18: Object.freeze({
    id: 'Q18', name: 'Frozen Wastes',
    description: 'Something ancient stirs beneath the ice.',
    type: QUEST_TYPES.EXPLORE, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { exploreBiomes: ['Tundra'] },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'golden_apple', count: 2 },
    nextQuest: 'Q19', markerBiome: 'Tundra',
  }),
  Q19: Object.freeze({
    id: 'Q19', name: 'Ice Mining',
    description: 'Mine diamond veins in frozen caves.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { collectItem: 'diamond', count: 10 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'diamond_armor' },
    nextQuest: 'Q20', markerBiome: 'Tundra',
  }),
  Q20: Object.freeze({
    id: 'Q20', name: 'The Ice Fortress',
    description: 'Find keys to breach the ice fortress walls.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { collectItem: 'quest_key', count: 4 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'dungeon_3_access' },
    nextQuest: 'Q21', markerBiome: 'Tundra',
  }),
  Q21: Object.freeze({
    id: 'Q21', name: 'Frost Titans Wrath',
    description: 'Defeat the Frost Titan to thaw the frozen world.',
    type: QUEST_TYPES.BOSS, difficulty: QUEST_DIFFICULTY.HARD,
    requirements: { killBoss: 'frost_titan' },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'diamond', count: 10 },
    nextQuest: 'Q22', markerBiome: 'Tundra',
  }),
  Q22: Object.freeze({
    id: 'Q22', name: 'The Corrupt Heart Returns',
    description: 'A deeper corruption spreads in the most dangerous biome.',
    type: QUEST_TYPES.EXPLORE, difficulty: QUEST_DIFFICULTY.LEGENDARY,
    requirements: { exploreBiomes: ['Lava', 'Corrupt'] },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'golden_apple', count: 5 },
    nextQuest: 'Q23', markerBiome: 'Lava',
  }),
  Q23: Object.freeze({
    id: 'Q23', name: 'Gathering the Final Keys',
    description: 'Assemble all keys for the final dungeon.',
    type: QUEST_TYPES.COLLECT, difficulty: QUEST_DIFFICULTY.LEGENDARY,
    requirements: { collectItem: 'quest_key', count: 5 },
    reward: { type: REWARD_TYPES.UNLOCK, unlockId: 'dungeon_4_access' },
    nextQuest: 'Q24', markerBiome: 'Corrupt',
  }),
  Q24: Object.freeze({
    id: 'Q24', name: 'The Corruption Overlord',
    description: 'Face the ultimate evil - the Corruption Overlord.',
    type: QUEST_TYPES.BOSS, difficulty: QUEST_DIFFICULTY.LEGENDARY,
    requirements: { killBoss: 'corruption_overlord' },
    reward: { type: REWARD_TYPES.ITEM, itemId: 'diamond', count: 20 },
    nextQuest: 'Q25', markerBiome: 'Corrupt',
  }),
  Q25: Object.freeze({
    id: 'Q25', name: 'The World Reborn',
    description: 'Face the World Ender to restore Cuubz forever.',
    type: QUEST_TYPES.BOSS, difficulty: QUEST_DIFFICULTY.LEGENDARY,
    requirements: { killBoss: 'world_ender' },
    reward: { type: REWARD_TYPES.ACHIEVEMENT, achievementId: 'game_complete' },
    nextQuest: null, markerBiome: 'Plains',
  }),
});

const BOSS_DEFINITIONS = Object.freeze({
  forest_guardian: { name: 'Forest Guardian', health: 500, attackDamage: 15, phases: 2, attacks: [
    { name: 'Root Slam', damage: 15, cooldown: 3000, range: 5 },
    { name: 'Vine Whip', damage: 10, cooldown: 2000, range: 8 },
    { name: 'Spore Cloud', damage: 5, cooldown: 5000, range: 6, type: 'aoe' },
  ]},
  sand_wraith: { name: 'Sand Wraith', health: 750, attackDamage: 20, phases: 3, attacks: [
    { name: 'Sand Blast', damage: 20, cooldown: 2500, range: 10 },
    { name: 'Burrow Strike', damage: 25, cooldown: 4000, range: 3 },
    { name: 'Sandstorm', damage: 8, cooldown: 6000, range: 12, type: 'aoe' },
  ]},
  frost_titan: { name: 'Frost Titan', health: 1000, attackDamage: 25, phases: 3, attacks: [
    { name: 'Ice Slam', damage: 25, cooldown: 3000, range: 6 },
    { name: 'Frost Nova', damage: 15, cooldown: 5000, range: 8, type: 'aoe' },
    { name: 'Blizzard', damage: 10, cooldown: 8000, range: 15, type: 'aoe' },
  ]},
  corruption_overlord: { name: 'Corruption Overlord', health: 1500, attackDamage: 30, phases: 4, attacks: [
    { name: 'Dark Bolt', damage: 30, cooldown: 2000, range: 12 },
    { name: 'Corrupt Wave', damage: 20, cooldown: 4000, range: 10, type: 'aoe' },
    { name: 'Crystal Shield', damage: 0, cooldown: 8000, range: 0, type: 'buff' },
    { name: 'Summon Minions', damage: 5, cooldown: 10000, range: 0, type: 'summon', count: 3 },
  ]},
  world_ender: { name: 'World Ender', health: 2500, attackDamage: 40, phases: 5, attacks: [
    { name: 'Void Slash', damage: 40, cooldown: 2000, range: 8 },
    { name: 'Gravity Crush', damage: 30, cooldown: 3000, range: 6 },
    { name: 'Dimensional Rift', damage: 25, cooldown: 5000, range: 15, type: 'aoe' },
    { name: 'Reality Warp', damage: 20, cooldown: 7000, range: 10, type: 'aoe' },
    { name: 'Final Despair', damage: 50, cooldown: 12000, range: 20, type: 'ultimate' },
  ]},
});

class QuestTracker {
  constructor(worldId, callbacks = {}) {
    this.worldId = worldId;
    this.callbacks = callbacks;
    this.progress = {};
    for (const qid of Object.keys(QUEST_CATALOG)) {
      this.progress[qid] = {
        stage: 0, completed: false, completedAt: null,
        collectedItems: {}, exploredBiomes: new Set(), bossesKilled: new Set(), craftedItems: {},
      };
    }
    this.unlocks = new Set();
    this.achievements = new Set();
    this.totalXP = 0;
  }

  static getQuestDefinition(questId) { return QUEST_CATALOG[questId] || null; }
  static getAllQuests() { return Object.values(QUEST_CATALOG); }
  static getQuestCount() { return Object.keys(QUEST_CATALOG).length; }

  recordItemCollected(itemId, count = 1) {
    if (count <= 0) return;
    for (const qid of Object.keys(QUEST_CATALOG)) {
      const prog = this.progress[qid];
      if (prog.completed) continue;
      const def = QUEST_CATALOG[qid];
      if (def.requirements.collectItem === itemId) {
        prog.collectedItems[itemId] = (prog.collectedItems[itemId] || 0) + count;
        this._notifyProgress(qid);
        this._checkCompletion(qid);
      }
    }
  }

  recordBiomeExplored(biomeName) {
    for (const qid of Object.keys(QUEST_CATALOG)) {
      const prog = this.progress[qid];
      if (prog.completed) continue;
      const def = QUEST_CATALOG[qid];
      if (def.requirements.exploreBiomes && def.requirements.exploreBiomes.includes(biomeName)) {
        prog.exploredBiomes.add(biomeName);
        this._notifyProgress(qid);
        this._checkCompletion(qid);
      }
    }
  }

  recordBossKilled(bossId) {
    for (const qid of Object.keys(QUEST_CATALOG)) {
      const prog = this.progress[qid];
      if (prog.completed) continue;
      const def = QUEST_CATALOG[qid];
      if (def.requirements.killBoss === bossId) {
        prog.bossesKilled.add(bossId);
        this._notifyProgress(qid);
        this._checkCompletion(qid);
      }
    }
  }

  recordItemCrafted(itemId, count = 1) {
    if (count <= 0) return;
    for (const qid of Object.keys(QUEST_CATALOG)) {
      const prog = this.progress[qid];
      if (prog.completed) continue;
      const def = QUEST_CATALOG[qid];
      if (def.requirements.craftItem === itemId) {
        prog.craftedItems[itemId] = (prog.craftedItems[itemId] || 0) + count;
        this._notifyProgress(qid);
        this._checkCompletion(qid);
      }
    }
  }

  _checkCompletion(questId) {
    const prog = this.progress[questId];
    if (prog.completed) return;
    const def = QUEST_CATALOG[questId];
    const reqs = def.requirements;
    let allMet = true;
    if (reqs.collectItem !== undefined) {
      if ((prog.collectedItems[reqs.collectItem] || 0) < reqs.count) allMet = false;
    }
    if (reqs.exploreBiomes !== undefined) {
      for (const biome of reqs.exploreBiomes) {
        if (!prog.exploredBiomes.has(biome)) { allMet = false; break; }
      }
    }
    if (reqs.killBoss !== undefined && !prog.bossesKilled.has(reqs.killBoss)) allMet = false;
    if (reqs.craftItem !== undefined) {
      if ((prog.craftedItems[reqs.craftItem] || 0) < reqs.count) allMet = false;
    }
    if (allMet) this._completeQuest(questId);
  }

  _completeQuest(questId) {
    const prog = this.progress[questId];
    const def = QUEST_CATALOG[questId];
    prog.completed = true;
    prog.stage = 1;
    prog.completedAt = Date.now();
    this._applyReward(questId, def.reward);
    this.totalXP += def.difficulty * 100;
    if (this.callbacks.onQuestComplete) this.callbacks.onQuestComplete(questId);
  }

  _applyReward(questId, reward) {
    if (!reward) return;
    switch (reward.type) {
      case REWARD_TYPES.ITEM:
        this.pendingItemRewards = this.pendingItemRewards || [];
        this.pendingItemRewards.push({ questId, itemId: reward.itemId, count: reward.count });
        break;
      case REWARD_TYPES.UNLOCK:
        this.unlocks.add(reward.unlockId);
        if (this.callbacks.onUnlock) this.callbacks.onUnlock(questId, reward.unlockId);
        break;
      case REWARD_TYPES.XP:
        this.totalXP += reward.amount || 0;
        break;
      case REWARD_TYPES.ACHIEVEMENT:
        this.achievements.add(reward.achievementId);
        if (this.callbacks.onAchievement) this.callbacks.onAchievement(questId, reward.achievementId);
        break;
    }
  }

  getProgress(questId) {
    const prog = this.progress[questId];
    if (!prog) return null;
    return {
      stage: prog.stage, completed: prog.completed, completedAt: prog.completedAt,
      collectedItems: { ...prog.collectedItems },
      exploredBiomes: Array.from(prog.exploredBiomes),
      bossesKilled: Array.from(prog.bossesKilled),
      craftedItems: { ...prog.craftedItems },
    };
  }

  getCurrentQuest() {
    for (const qid of Object.keys(QUEST_CATALOG)) {
      if (!this.progress[qid].completed) {
        return { definition: QUEST_CATALOG[qid], progress: this.getProgress(qid) };
      }
    }
    return null;
  }

  getNextQuest(questId) {
    const def = QUEST_CATALOG[questId];
    if (!def || !def.nextQuest) return null;
    return { definition: QUEST_CATALOG[def.nextQuest], progress: this.getProgress(def.nextQuest) };
  }

  getCompletedQuests() {
    const completed = [];
    for (const qid of Object.keys(QUEST_CATALOG)) {
      if (this.progress[qid].completed) {
        completed.push({ id: qid, name: QUEST_CATALOG[qid].name, completedAt: this.progress[qid].completedAt });
      }
    }
    return completed;
  }

  getCompletionPercentage() {
    const total = Object.keys(QUEST_CATALOG).length;
    const completed = this.getCompletedQuests().length;
    return Math.round((completed / total) * 100);
  }

  getRequirementProgress(questId) {
    const prog = this.progress[questId];
    if (!prog || prog.completed) return { current: 100, required: 100, percentage: 100 };
    const def = QUEST_CATALOG[questId];
    const reqs = def.requirements;
    if (reqs.collectItem !== undefined) {
      const collected = prog.collectedItems[reqs.collectItem] || 0;
      return { current: collected, required: reqs.count, percentage: Math.min(100, Math.round((collected / reqs.count) * 100)) };
    }
    if (reqs.exploreBiomes !== undefined) {
      const explored = reqs.exploreBiomes.filter(b => prog.exploredBiomes.has(b)).length;
      return { current: explored, required: reqs.exploreBiomes.length, percentage: Math.min(100, Math.round((explored / reqs.exploreBiomes.length) * 100)) };
    }
    if (reqs.killBoss !== undefined) {
      const killed = prog.bossesKilled.has(reqs.killBoss) ? 1 : 0;
      return { current: killed, required: 1, percentage: killed * 100 };
    }
    if (reqs.craftItem !== undefined) {
      const crafted = prog.craftedItems[reqs.craftItem] || 0;
      return { current: crafted, required: reqs.count, percentage: Math.min(100, Math.round((crafted / reqs.count) * 100)) };
    }
    return { current: 0, required: 1, percentage: 0 };
  }

  isQuestAvailable(questId) {
    if (questId === 'Q01') return true;
    for (const qid of Object.keys(QUEST_CATALOG)) {
      if (QUEST_CATALOG[qid].nextQuest === questId) return this.progress[qid].completed;
    }
    return false;
  }

  hasUnlock(unlockId) { return this.unlocks.has(unlockId); }
  hasAchievement(achievementId) { return this.achievements.has(achievementId); }

  serialize() {
    const serialized = {};
    for (const qid of Object.keys(this.progress)) {
      const prog = this.progress[qid];
      serialized[qid] = {
        stage: prog.stage, completed: prog.completed, completedAt: prog.completedAt,
        collectedItems: { ...prog.collectedItems },
        exploredBiomes: Array.from(prog.exploredBiomes),
        bossesKilled: Array.from(prog.bossesKilled),
        craftedItems: { ...prog.craftedItems },
      };
    }
    return {
      worldId: this.worldId, progress: serialized,
      unlocks: Array.from(this.unlocks), achievements: Array.from(this.achievements),
      totalXP: this.totalXP, pendingItemRewards: this.pendingItemRewards || [],
    };
  }

  static deserialize(worldId, data, callbacks = {}) {
    const tracker = new QuestTracker(worldId, callbacks);
    if (data.progress) {
      for (const qid of Object.keys(data.progress)) {
        const saved = data.progress[qid];
        if (tracker.progress[qid]) {
          tracker.progress[qid].stage = saved.stage || 0;
          tracker.progress[qid].completed = saved.completed || false;
          tracker.progress[qid].completedAt = saved.completedAt || null;
          tracker.progress[qid].collectedItems = saved.collectedItems || {};
          tracker.progress[qid].exploredBiomes = new Set(saved.exploredBiomes || []);
          tracker.progress[qid].bossesKilled = new Set(saved.bossesKilled || []);
          tracker.progress[qid].craftedItems = saved.craftedItems || {};
        }
      }
    }
    if (data.unlocks) tracker.unlocks = new Set(data.unlocks);
    if (data.achievements) tracker.achievements = new Set(data.achievements);
    if (data.totalXP !== undefined) tracker.totalXP = data.totalXP;
    if (data.pendingItemRewards) tracker.pendingItemRewards = data.pendingItemRewards;
    return tracker;
  }

  _notifyProgress(questId) {
    if (this.callbacks.onProgressUpdate) this.callbacks.onProgressUpdate(questId, this.getProgress(questId));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QUEST_TYPES, QUEST_DIFFICULTY, REWARD_TYPES, QUEST_CATALOG, BOSS_DEFINITIONS, QuestTracker };
}
