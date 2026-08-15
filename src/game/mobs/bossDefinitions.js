/**
 * Cuubz — the six bosses, in `MOB_DEFINITIONS` format (S6/S7/S8)
 *
 * ─── THEY ARE MOBS, DELIBERATELY ────────────────────────────────────────────
 *
 * §8.1: the deleted `Boss.js` was 1,135 lines and **had no renderer at all**. Nothing
 * ever drew it. So these are written in the shape `mobModelBuilder`, `mobAnimator` and
 * `mobRenderer` already consume — `box`, `sphere`, `cylinder` and `cone` parts, an
 * `eyes` block, an `animations` table — and the boss work becomes a state machine on top
 * of an entity that draws itself, rather than a rendering project.
 *
 * ─── `biomes: []` IS LOAD-BEARING ───────────────────────────────────────────
 *
 * `getMobTypesForBiome` and `selectMobForBiome` both iterate `def.biomes.includes(biome)`
 * (`mobDefinitions.js:461-489`). An **empty array** excludes bosses from natural spawning
 * for free; a **missing** `biomes` throws. The difference is one character and one is a
 * crash on every spawn tick, so `bossDefinitions.test.js` asserts every boss has the
 * array and that it is empty.
 *
 * ─── PHASES, AND THE BUG THAT KILLED THE OLD ONE ────────────────────────────
 *
 * The deleted `Boss.js` left `phaseTransitionTimer` undefined, so a deserialized boss was
 * NaN-frozen and **unkillable**, and no test caught it (`src/index.js:73-75`). Every
 * timer here is initialised at construction in `BossEntity`, and the test constructs
 * each boss, drives it through every threshold, and asserts it dies.
 *
 * Phase thresholds are HP fractions, descending. The five seal bosses have two each
 * (an enrage below 40%); the Corruption Overlord has three.
 */

import { MOB_CATEGORIES, MOB_BEHAVIORS, ANIM_TYPES, registerMobDefinitions } from './mobDefinitions.js';

/** Ability kinds a phase may use. The runner switches on these. */
export const BOSS_ABILITIES = Object.freeze({
  MELEE: 'melee',           // a swing at anything in range
  CHARGE: 'charge',         // close the gap fast
  SUMMON: 'summon',         // spawn adds from the existing hostile roster
  HAZARD_POOL: 'hazard_pool', // write hazard blocks onto the arena floor
  SHIELD: 'shield',         // damage immunity until broken
});

/**
 * Shared shape for a seal boss's two phases. `enrage` is below 40% and does the same
 * things faster — a difficulty curve inside one fight, without new mechanics to learn
 * at the moment the player is closest to winning.
 */
const twoPhase = (opening, enraged) => ([
  { id: 'opening', from: 1.0, ...opening },
  { id: 'enraged', from: 0.4, ...enraged },
]);

export const BOSS_DEFINITIONS = {
  // ═══════════════════════════════════════════════════════════════
  // FOREST WARDEN — Verdant Seal, Corrupt biome. The first boss.
  // ═══════════════════════════════════════════════════════════════
  //
  // §8.3: melee + charge + summon + hazard pool only. Projectiles are their own stage
  // and must not block the first working seal.
  forest_warden: {
    name: 'Forest Warden',
    category: MOB_CATEGORIES.BOSS,
    boss: true,
    seal: 'verdant',
    health: 400,
    damage: 9,
    attackSpeed: 0.8,
    knockback: 4.0,
    speed: 3.2,
    fleeSpeed: 0,
    hitbox: { width: 2.6, height: 4.4 },
    // Empty, never missing. See the header.
    biomes: [],
    spawnWeight: 0,
    spawnInDark: false,
    spawnMinY: 0,
    spawnMaxY: 128,
    despawnDistance: 99999,
    leashDistance: 99999,
    experience: 500,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      aggroRange: 40,
      attackRange: 3.6,
      attackCooldown: 1.4,
      loseInterestRange: 64,
      senseRange: 48,
      packAggro: false,
      packRadius: 0,
      wanderInterval: [4, 8],
      fleeRange: 0,
    },
    phases: twoPhase(
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.4, damage: 9, range: 3.6 },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 9, speed: 11, range: 20 },
          { kind: BOSS_ABILITIES.SUMMON, cooldown: 16, mob: 'corrupt_wolf', count: 2, max: 4 },
        ],
        speedMultiplier: 1.0,
      },
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.0, damage: 12, range: 4.0 },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 6, speed: 13, range: 24 },
          { kind: BOSS_ABILITIES.SUMMON, cooldown: 11, mob: 'corrupt_wolf', count: 3, max: 6 },
          // §8.3's payoff: a poison-spore pool is the same block with the same damage
          // tick as a pool the world generated. Building the hazardous biomes first
          // made this almost free.
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 8, block: 'toxic_slime', radius: 3, duration: 12 },
        ],
        speedMultiplier: 1.25,
      }
    ),
    drops: [
      { item: 'corrupt_crystal', minCount: 3, maxCount: 5, weight: 100 },
      { item: 'diamond', minCount: 2, maxCount: 4, weight: 100 },
      { item: 'gold_ingot', minCount: 3, maxCount: 6, weight: 80 },
    ],
    geometry: {
      material: { roughness: 0.9, metalness: 0.0 },
      parts: [
        { type: 'box', id: 'body', size: [2.0, 2.2, 1.4], position: [0, 2.4, 0], color: 0x3a2d18 },
        { type: 'cylinder', id: 'trunk', radiusTop: 0.9, radiusBottom: 1.2, height: 1.4, position: [0, 0.9, 0], color: 0x2d2312 },
        { type: 'sphere', id: 'head', radius: 0.75, position: [0, 3.9, 0.1], color: 0x4a3a20 },
        { type: 'cone', id: 'horn_L', radius: 0.16, height: 1.1, position: [-0.45, 4.6, 0], rotation: [-0.25, 0, -0.35], color: 0x6b5a34 },
        { type: 'cone', id: 'horn_R', radius: 0.16, height: 1.1, position: [0.45, 4.6, 0], rotation: [-0.25, 0, 0.35], color: 0x6b5a34 },
        { type: 'cylinder', id: 'arm_L', radiusTop: 0.28, radiusBottom: 0.36, height: 2.2, position: [-1.35, 2.4, 0], rotation: [0, 0, 0.2], color: 0x3a2d18 },
        { type: 'cylinder', id: 'arm_R', radiusTop: 0.28, radiusBottom: 0.36, height: 2.2, position: [1.35, 2.4, 0], rotation: [0, 0, -0.2], color: 0x3a2d18 },
        { type: 'cylinder', id: 'leg_L', radiusTop: 0.34, radiusBottom: 0.42, height: 1.2, position: [-0.55, 0.6, 0], color: 0x2d2312 },
        { type: 'cylinder', id: 'leg_R', radiusTop: 0.34, radiusBottom: 0.42, height: 1.2, position: [0.55, 0.6, 0], color: 0x2d2312 },
        // The corruption that took it. Purple, and the only bright thing on it.
        { type: 'cone', id: 'thorn_1', radius: 0.1, height: 0.5, position: [-0.7, 3.3, -0.6], rotation: [-0.4, 0, -0.2], color: 0x8b00ff },
        { type: 'cone', id: 'thorn_2', radius: 0.1, height: 0.5, position: [0.7, 3.3, -0.6], rotation: [-0.4, 0, 0.2], color: 0x8b00ff },
        { type: 'cone', id: 'thorn_3', radius: 0.1, height: 0.5, position: [0, 3.5, -0.7], rotation: [-0.5, 0, 0], color: 0x8b00ff },
        { type: 'sphere', id: 'core', radius: 0.3, position: [0, 2.5, 0.7], color: 0xb44dff },
      ],
      eyes: { color: 0xb44dff, size: 0.16, positions: [[-0.28, 4.0, 0.7], [0.28, 4.0, 0.7]] },
    },
    animations: {
      idle:   { speed: 0.6, type: ANIM_TYPES.BREATHING },
      wander: { speed: 0.7, type: ANIM_TYPES.WALK, gait: 'trot' },
      chase:  { speed: 1.1, type: ANIM_TYPES.WALK, gait: 'trot' },
      attack: { speed: 1.4, type: ANIM_TYPES.CUSTOM, functionName: 'lungeAttack', duration: 0.5 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.3 },
      dead:   { speed: 0.7, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 2.0 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // LAVA TITAN — Ember Seal, Lava biome
  // ═══════════════════════════════════════════════════════════════
  lava_titan: {
    name: 'Lava Titan',
    category: MOB_CATEGORIES.BOSS,
    boss: true,
    seal: 'ember',
    health: 520,
    damage: 12,
    attackSpeed: 0.6,
    knockback: 6.0,
    speed: 2.6,
    fleeSpeed: 0,
    hitbox: { width: 3.0, height: 5.0 },
    biomes: [],
    spawnWeight: 0,
    spawnInDark: false,
    spawnMinY: 0,
    spawnMaxY: 128,
    despawnDistance: 99999,
    leashDistance: 99999,
    experience: 700,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      aggroRange: 44, attackRange: 4.2, attackCooldown: 1.8,
      loseInterestRange: 64, senseRange: 48, packAggro: false, packRadius: 0,
      wanderInterval: [4, 8], fleeRange: 0,
    },
    phases: twoPhase(
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.8, damage: 12, range: 4.2 },
          // The ground slam is a hazard pool that lands where the player is standing.
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 7, block: 'magma', radius: 4, duration: 14 },
        ],
        speedMultiplier: 1.0,
      },
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.3, damage: 16, range: 4.6 },
          // Below 40% it stops making the floor unpleasant and starts making it lethal.
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 5, block: 'lava', radius: 3, duration: 10 },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 10, speed: 10, range: 22 },
        ],
        speedMultiplier: 1.2,
      }
    ),
    drops: [
      { item: 'diamond', minCount: 3, maxCount: 6, weight: 100 },
      { item: 'netherite_ingot', minCount: 1, maxCount: 2, weight: 60 },
      { item: 'gold_ingot', minCount: 4, maxCount: 8, weight: 90 },
    ],
    geometry: {
      material: { roughness: 0.5, metalness: 0.2 },
      parts: [
        { type: 'box', id: 'body', size: [2.4, 2.6, 1.8], position: [0, 2.9, 0], color: 0x2b1208 },
        { type: 'sphere', id: 'head', radius: 0.85, position: [0, 4.6, 0.1], color: 0x3d1a0a },
        { type: 'cylinder', id: 'arm_L', radiusTop: 0.4, radiusBottom: 0.52, height: 2.6, position: [-1.6, 2.9, 0], rotation: [0, 0, 0.18], color: 0x2b1208 },
        { type: 'cylinder', id: 'arm_R', radiusTop: 0.4, radiusBottom: 0.52, height: 2.6, position: [1.6, 2.9, 0], rotation: [0, 0, -0.18], color: 0x2b1208 },
        { type: 'cylinder', id: 'leg_L', radiusTop: 0.45, radiusBottom: 0.55, height: 1.6, position: [-0.65, 0.8, 0], color: 0x1f0d05 },
        { type: 'cylinder', id: 'leg_R', radiusTop: 0.45, radiusBottom: 0.55, height: 1.6, position: [0.65, 0.8, 0], color: 0x1f0d05 },
        // Molten seams. The only colour on an otherwise black silhouette, which is what
        // makes it read as cooling rock rather than as a shadow.
        { type: 'box', id: 'seam_1', size: [2.1, 0.18, 0.2], position: [0, 3.4, 0.9], color: 0xff6a00 },
        { type: 'box', id: 'seam_2', size: [1.7, 0.15, 0.2], position: [0, 2.5, 0.9], color: 0xff8c1a },
        { type: 'sphere', id: 'core', radius: 0.42, position: [0, 2.9, 0.85], color: 0xffb300 },
        { type: 'cone', id: 'spike_L', radius: 0.18, height: 0.9, position: [-0.9, 4.4, -0.6], rotation: [-0.4, 0, -0.3], color: 0x1f0d05 },
        { type: 'cone', id: 'spike_R', radius: 0.18, height: 0.9, position: [0.9, 4.4, -0.6], rotation: [-0.4, 0, 0.3], color: 0x1f0d05 },
      ],
      eyes: { color: 0xffdd00, size: 0.2, positions: [[-0.32, 4.7, 0.75], [0.32, 4.7, 0.75]] },
    },
    animations: {
      idle:   { speed: 0.5, type: ANIM_TYPES.BREATHING },
      wander: { speed: 0.5, type: ANIM_TYPES.WALK, gait: 'trot' },
      chase:  { speed: 0.8, type: ANIM_TYPES.WALK, gait: 'trot' },
      attack: { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'lungeAttack', duration: 0.7 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.3 },
      dead:   { speed: 0.6, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 2.4 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // FROST SERPENT — Frozen Seal, Tundra
  // ═══════════════════════════════════════════════════════════════
  frost_serpent: {
    name: 'Frost Serpent',
    category: MOB_CATEGORIES.BOSS,
    boss: true,
    seal: 'frozen',
    health: 480,
    damage: 10,
    attackSpeed: 1.0,
    knockback: 3.0,
    speed: 5.0,
    fleeSpeed: 0,
    hitbox: { width: 2.0, height: 2.6 },
    biomes: [],
    spawnWeight: 0,
    spawnInDark: false,
    spawnMinY: 0,
    spawnMaxY: 128,
    despawnDistance: 99999,
    leashDistance: 99999,
    experience: 650,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      aggroRange: 44, attackRange: 3.4, attackCooldown: 1.1,
      loseInterestRange: 64, senseRange: 48, packAggro: false, packRadius: 0,
      wanderInterval: [3, 6], fleeRange: 0,
    },
    phases: twoPhase(
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.1, damage: 10, range: 3.4 },
          // "Ice breath that slows movement" becomes a hazard field of ice: the player
          // is slowed by having to path around it rather than by a status effect, which
          // §3.5 rules out on purpose.
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 8, block: 'ice', radius: 4, duration: 16, harmless: true },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 7, speed: 14, range: 26 },
        ],
        speedMultiplier: 1.0,
      },
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 0.8, damage: 13, range: 3.8 },
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 5, block: 'ice', radius: 5, duration: 16, harmless: true },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 4.5, speed: 16, range: 30 },
        ],
        speedMultiplier: 1.35,
      }
    ),
    drops: [
      { item: 'diamond', minCount: 3, maxCount: 5, weight: 100 },
      { item: 'iron_ingot', minCount: 6, maxCount: 12, weight: 90 },
    ],
    geometry: {
      material: { roughness: 0.2, metalness: 0.1 },
      parts: [
        { type: 'sphere', id: 'head', radius: 0.9, position: [0, 2.0, 1.2], color: 0x9fd8f0 },
        { type: 'box', id: 'jaw', size: [0.8, 0.3, 0.9], position: [0, 1.6, 1.7], color: 0x7cc4e4 },
        { type: 'sphere', id: 'coil_1', radius: 0.85, position: [0, 1.6, 0], color: 0x8ccce8 },
        { type: 'sphere', id: 'coil_2', radius: 0.8, position: [0.3, 1.2, -1.2], color: 0x7cc4e4 },
        { type: 'sphere', id: 'coil_3', radius: 0.7, position: [-0.3, 0.9, -2.3], color: 0x6bb8dc },
        { type: 'sphere', id: 'coil_4', radius: 0.55, position: [0.2, 0.7, -3.2], color: 0x5aacd4 },
        { type: 'cone', id: 'tail', radius: 0.4, height: 1.2, position: [0, 0.6, -4.1], rotation: [1.4, 0, 0], color: 0x4aa0cc },
        { type: 'cone', id: 'crest_1', radius: 0.12, height: 0.7, position: [0, 2.8, 0.9], rotation: [-0.3, 0, 0], color: 0xdff4ff },
        { type: 'cone', id: 'crest_2', radius: 0.12, height: 0.6, position: [0, 2.4, 0.2], rotation: [-0.3, 0, 0], color: 0xdff4ff },
        { type: 'cone', id: 'fang_L', radius: 0.07, height: 0.4, position: [-0.25, 1.5, 1.9], rotation: [3.0, 0, 0], color: 0xffffff },
        { type: 'cone', id: 'fang_R', radius: 0.07, height: 0.4, position: [0.25, 1.5, 1.9], rotation: [3.0, 0, 0], color: 0xffffff },
      ],
      eyes: { color: 0x2196f3, size: 0.15, positions: [[-0.35, 2.2, 1.8], [0.35, 2.2, 1.8]] },
    },
    animations: {
      idle:   { speed: 0.8, type: ANIM_TYPES.HOVER },
      wander: { speed: 1.0, type: ANIM_TYPES.HOVER },
      chase:  { speed: 1.6, type: ANIM_TYPES.HOVER },
      attack: { speed: 2.0, type: ANIM_TYPES.CUSTOM, functionName: 'lungeAttack', duration: 0.4 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.25 },
      dead:   { speed: 0.8, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 2.0 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // DUNE COLOSSUS — Sunken Seal, Desert
  // ═══════════════════════════════════════════════════════════════
  //
  // "It fights patiently, the way a desert does." Slow, enormous, and the only boss
  // that is not a corrupted guardian — it is what the corruption made *out of* the
  // grave the builders dug.
  dune_colossus: {
    name: 'Dune Colossus',
    category: MOB_CATEGORIES.BOSS,
    boss: true,
    seal: 'sunken',
    health: 620,
    damage: 15,
    attackSpeed: 0.5,
    knockback: 7.0,
    speed: 2.2,
    fleeSpeed: 0,
    hitbox: { width: 3.4, height: 5.6 },
    biomes: [],
    spawnWeight: 0,
    spawnInDark: false,
    spawnMinY: 0,
    spawnMaxY: 128,
    despawnDistance: 99999,
    leashDistance: 99999,
    experience: 800,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      aggroRange: 48, attackRange: 4.8, attackCooldown: 2.2,
      loseInterestRange: 72, senseRange: 56, packAggro: false, packRadius: 0,
      wanderInterval: [5, 9], fleeRange: 0,
    },
    phases: twoPhase(
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 2.2, damage: 15, range: 4.8 },
          // "Burrow and surface" — it closes the distance the only way something that
          // size plausibly can.
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 11, speed: 9, range: 30, teleport: true },
        ],
        speedMultiplier: 1.0,
      },
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.6, damage: 19, range: 5.2 },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 7, speed: 11, range: 34, teleport: true },
          { kind: BOSS_ABILITIES.SUMMON, cooldown: 14, mob: 'stone_golem', count: 2, max: 4 },
        ],
        speedMultiplier: 1.15,
      }
    ),
    drops: [
      { item: 'diamond', minCount: 4, maxCount: 7, weight: 100 },
      { item: 'gold_ingot', minCount: 6, maxCount: 12, weight: 90 },
      { item: 'iron_ingot', minCount: 4, maxCount: 8, weight: 70 },
    ],
    geometry: {
      material: { roughness: 1.0, metalness: 0.0 },
      parts: [
        { type: 'box', id: 'body', size: [3.0, 3.0, 2.2], position: [0, 3.4, 0], color: 0xd9c187 },
        { type: 'box', id: 'head', size: [1.5, 1.2, 1.3], position: [0, 5.4, 0.1], color: 0xc4a869 },
        { type: 'box', id: 'arm_L', size: [0.9, 3.0, 0.9], position: [-2.0, 3.2, 0], color: 0xd9c187 },
        { type: 'box', id: 'arm_R', size: [0.9, 3.0, 0.9], position: [2.0, 3.2, 0], color: 0xd9c187 },
        { type: 'box', id: 'fist_L', size: [1.2, 1.0, 1.2], position: [-2.0, 1.4, 0], color: 0xb59450 },
        { type: 'box', id: 'fist_R', size: [1.2, 1.0, 1.2], position: [2.0, 1.4, 0], color: 0xb59450 },
        { type: 'box', id: 'leg_L', size: [1.0, 1.8, 1.0], position: [-0.8, 0.9, 0], color: 0xb59450 },
        { type: 'box', id: 'leg_R', size: [1.0, 1.8, 1.0], position: [0.8, 0.9, 0], color: 0xb59450 },
        // The buried hall it is wearing: pillars and lintels still embedded in it.
        { type: 'box', id: 'ruin_1', size: [0.4, 1.6, 0.4], position: [-1.1, 4.4, -1.0], rotation: [0.2, 0, 0.15], color: 0x9c7f42 },
        { type: 'box', id: 'ruin_2', size: [0.4, 1.2, 0.4], position: [1.2, 4.0, -1.0], rotation: [-0.15, 0, -0.2], color: 0x9c7f42 },
        { type: 'box', id: 'ruin_3', size: [1.8, 0.35, 0.35], position: [0, 5.0, -1.2], color: 0x8a6f38 },
        { type: 'sphere', id: 'core', radius: 0.35, position: [0, 3.6, 1.1], color: 0x8b00ff },
      ],
      eyes: { color: 0xb44dff, size: 0.18, positions: [[-0.4, 5.5, 0.75], [0.4, 5.5, 0.75]] },
    },
    animations: {
      idle:   { speed: 0.4, type: ANIM_TYPES.BREATHING },
      wander: { speed: 0.4, type: ANIM_TYPES.WALK, gait: 'trot' },
      chase:  { speed: 0.7, type: ANIM_TYPES.WALK, gait: 'trot' },
      attack: { speed: 0.9, type: ANIM_TYPES.CUSTOM, functionName: 'lungeAttack', duration: 0.9 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.35 },
      dead:   { speed: 0.5, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 2.6 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // HOLLOW KING — Deepstone Seal, below Y 30
  // ═══════════════════════════════════════════════════════════════
  //
  // "It does not roar. It calls, once, and every golem in the depths turns toward the
  // sound and starts walking." The summon is the fight.
  hollow_king: {
    name: 'Hollow King',
    category: MOB_CATEGORIES.BOSS,
    boss: true,
    seal: 'deepstone',
    health: 680,
    damage: 14,
    attackSpeed: 0.6,
    knockback: 5.0,
    speed: 2.8,
    fleeSpeed: 0,
    hitbox: { width: 3.0, height: 5.2 },
    biomes: [],
    spawnWeight: 0,
    spawnInDark: false,
    spawnMinY: 0,
    spawnMaxY: 128,
    despawnDistance: 99999,
    leashDistance: 99999,
    experience: 900,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      aggroRange: 40, attackRange: 4.4, attackCooldown: 1.8,
      loseInterestRange: 64, senseRange: 48, packAggro: false, packRadius: 0,
      wanderInterval: [4, 8], fleeRange: 0,
    },
    phases: twoPhase(
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.8, damage: 14, range: 4.4 },
          { kind: BOSS_ABILITIES.SUMMON, cooldown: 12, mob: 'stone_golem', count: 2, max: 5 },
        ],
        speedMultiplier: 1.0,
      },
      {
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.3, damage: 18, range: 4.8 },
          { kind: BOSS_ABILITIES.SUMMON, cooldown: 8, mob: 'stone_golem', count: 3, max: 8 },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 9, speed: 10, range: 24 },
        ],
        speedMultiplier: 1.2,
      }
    ),
    drops: [
      { item: 'diamond', minCount: 5, maxCount: 8, weight: 100 },
      { item: 'netherite_ingot', minCount: 1, maxCount: 3, weight: 70 },
      { item: 'iron_ingot', minCount: 6, maxCount: 10, weight: 80 },
    ],
    geometry: {
      material: { roughness: 0.85, metalness: 0.05 },
      parts: [
        { type: 'box', id: 'body', size: [2.4, 2.8, 1.8], position: [0, 3.0, 0], color: 0x2f3540 },
        { type: 'box', id: 'head', size: [1.2, 1.1, 1.1], position: [0, 4.9, 0.05], color: 0x3a414d },
        { type: 'cone', id: 'crown_1', radius: 0.1, height: 0.8, position: [-0.4, 5.7, 0], color: 0x6d7684 },
        { type: 'cone', id: 'crown_2', radius: 0.12, height: 1.0, position: [0, 5.9, 0], color: 0x6d7684 },
        { type: 'cone', id: 'crown_3', radius: 0.1, height: 0.8, position: [0.4, 5.7, 0], color: 0x6d7684 },
        { type: 'cylinder', id: 'arm_L', radiusTop: 0.38, radiusBottom: 0.46, height: 2.8, position: [-1.6, 3.0, 0], color: 0x2f3540 },
        { type: 'cylinder', id: 'arm_R', radiusTop: 0.38, radiusBottom: 0.46, height: 2.8, position: [1.6, 3.0, 0], color: 0x2f3540 },
        { type: 'cylinder', id: 'leg_L', radiusTop: 0.42, radiusBottom: 0.5, height: 1.8, position: [-0.7, 0.9, 0], color: 0x232830 },
        { type: 'cylinder', id: 'leg_R', radiusTop: 0.42, radiusBottom: 0.5, height: 1.8, position: [0.7, 0.9, 0], color: 0x232830 },
        // Hollowed out. The gap in the chest is the whole idea of the thing.
        { type: 'box', id: 'hollow', size: [0.9, 1.0, 0.5], position: [0, 3.2, 0.75], color: 0x0d0f13 },
        { type: 'sphere', id: 'core', radius: 0.28, position: [0, 3.2, 0.85], color: 0x59d9ff },
      ],
      eyes: { color: 0x59d9ff, size: 0.14, positions: [[-0.3, 5.0, 0.6], [0.3, 5.0, 0.6]] },
    },
    animations: {
      idle:   { speed: 0.4, type: ANIM_TYPES.BREATHING },
      wander: { speed: 0.5, type: ANIM_TYPES.WALK, gait: 'trot' },
      chase:  { speed: 0.8, type: ANIM_TYPES.WALK, gait: 'trot' },
      attack: { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'lungeAttack', duration: 0.8 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.3 },
      dead:   { speed: 0.5, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 2.6 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // CORRUPTION OVERLORD — the Final Seal. Three phases.
  // ═══════════════════════════════════════════════════════════════
  //
  // "It comes apart and reassembles three times before it is finished."
  //
  //   1 Guardian  — wears the broken guardians. Every ability is an echo of a boss the
  //                 player has already beaten.
  //   2 Darkness  — sheds the borrowed shapes. Continuous summons, spreading corruption,
  //                 and a shield that must be broken to resume damage.
  //   3 True Form — everything at once, faster, no shield and no pause. The arena is
  //                 mostly corruption by now, which is the point.
  corruption_overlord: {
    name: 'Corruption Overlord',
    category: MOB_CATEGORIES.BOSS,
    boss: true,
    seal: 'finale',
    health: 1200,
    damage: 16,
    attackSpeed: 0.9,
    knockback: 6.0,
    speed: 3.6,
    fleeSpeed: 0,
    hitbox: { width: 3.2, height: 6.0 },
    biomes: [],
    spawnWeight: 0,
    spawnInDark: false,
    spawnMinY: 0,
    spawnMaxY: 128,
    despawnDistance: 99999,
    leashDistance: 99999,
    experience: 2000,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      aggroRange: 56, attackRange: 4.6, attackCooldown: 1.2,
      loseInterestRange: 96, senseRange: 72, packAggro: false, packRadius: 0,
      wanderInterval: [3, 6], fleeRange: 0,
    },
    phases: [
      {
        id: 'guardian', from: 1.0, name: 'Guardian',
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.2, damage: 16, range: 4.6 },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 8, speed: 12, range: 26 },
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 9, block: 'magma', radius: 3, duration: 12 },
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 11, block: 'ice', radius: 4, duration: 12, harmless: true },
        ],
        speedMultiplier: 1.0,
      },
      {
        id: 'darkness', from: 0.66, name: 'Darkness',
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 1.1, damage: 18, range: 4.6 },
          { kind: BOSS_ABILITIES.SUMMON, cooldown: 6, mob: 'corrupt_wisp', count: 3, max: 10 },
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 5, block: 'corrupt_grass', radius: 5, duration: 999 },
          { kind: BOSS_ABILITIES.SHIELD, cooldown: 22, hp: 150, duration: 20 },
        ],
        speedMultiplier: 1.15,
      },
      {
        id: 'true_form', from: 0.33, name: 'True Form',
        abilities: [
          { kind: BOSS_ABILITIES.MELEE, cooldown: 0.8, damage: 22, range: 5.0 },
          { kind: BOSS_ABILITIES.CHARGE, cooldown: 4, speed: 15, range: 32 },
          { kind: BOSS_ABILITIES.SUMMON, cooldown: 5, mob: 'corrupt_wolf', count: 3, max: 12 },
          { kind: BOSS_ABILITIES.HAZARD_POOL, cooldown: 3, block: 'toxic_slime', radius: 4, duration: 999 },
        ],
        speedMultiplier: 1.4,
      },
    ],
    drops: [
      { item: 'diamond', minCount: 10, maxCount: 16, weight: 100 },
      { item: 'netherite_ingot', minCount: 3, maxCount: 6, weight: 100 },
      { item: 'corrupt_crystal', minCount: 5, maxCount: 8, weight: 100 },
    ],
    geometry: {
      material: { roughness: 0.4, metalness: 0.3 },
      parts: [
        { type: 'box', id: 'body', size: [2.6, 3.2, 1.8], position: [0, 3.6, 0], color: 0x1a0a2b },
        { type: 'sphere', id: 'head', radius: 0.95, position: [0, 5.7, 0.1], color: 0x2a1140 },
        { type: 'cylinder', id: 'arm_L', radiusTop: 0.34, radiusBottom: 0.44, height: 3.2, position: [-1.8, 3.6, 0], rotation: [0, 0, 0.2], color: 0x1a0a2b },
        { type: 'cylinder', id: 'arm_R', radiusTop: 0.34, radiusBottom: 0.44, height: 3.2, position: [1.8, 3.6, 0], rotation: [0, 0, -0.2], color: 0x1a0a2b },
        { type: 'cylinder', id: 'leg_L', radiusTop: 0.4, radiusBottom: 0.5, height: 2.0, position: [-0.7, 1.0, 0], color: 0x120720 },
        { type: 'cylinder', id: 'leg_R', radiusTop: 0.4, radiusBottom: 0.5, height: 2.0, position: [0.7, 1.0, 0], color: 0x120720 },
        // The five broken guardians it is wearing, one crystal each. They come off with
        // the borrowed shapes at phase 2 — narratively; the geometry is static.
        { type: 'cone', id: 'shard_1', radius: 0.14, height: 0.9, position: [-1.0, 5.0, -0.7], rotation: [-0.4, 0, -0.3], color: 0x4fae4a },
        { type: 'cone', id: 'shard_2', radius: 0.14, height: 0.9, position: [-0.5, 5.3, -0.8], rotation: [-0.4, 0, -0.15], color: 0xe0631c },
        { type: 'cone', id: 'shard_3', radius: 0.14, height: 0.9, position: [0, 5.5, -0.85], rotation: [-0.45, 0, 0], color: 0x8fc9e8 },
        { type: 'cone', id: 'shard_4', radius: 0.14, height: 0.9, position: [0.5, 5.3, -0.8], rotation: [-0.4, 0, 0.15], color: 0xcfae6a },
        { type: 'cone', id: 'shard_5', radius: 0.14, height: 0.9, position: [1.0, 5.0, -0.7], rotation: [-0.4, 0, 0.3], color: 0x5a616d },
        { type: 'sphere', id: 'core', radius: 0.55, position: [0, 3.8, 0.9], color: 0xb44dff },
        { type: 'sphere', id: 'halo', radius: 0.22, position: [0, 6.9, 0], color: 0x8b00ff },
      ],
      eyes: { color: 0xff2bd0, size: 0.22, positions: [[-0.36, 5.85, 0.8], [0.36, 5.85, 0.8]] },
    },
    animations: {
      idle:   { speed: 0.7, type: ANIM_TYPES.HOVER },
      wander: { speed: 0.8, type: ANIM_TYPES.WALK, gait: 'trot' },
      chase:  { speed: 1.3, type: ANIM_TYPES.WALK, gait: 'gallop' },
      attack: { speed: 1.6, type: ANIM_TYPES.CUSTOM, functionName: 'lungeAttack', duration: 0.5 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.25 },
      dead:   { speed: 0.6, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 3.5 },
    },
  },
};

// Registered at module load, so `getMobDefinition('forest_warden')` resolves and `Mob`,
// `mobModelBuilder`, `mobAnimator` and `mobRenderer` all work on a boss unchanged. The
// spawn paths read `MOB_DEFINITIONS` directly and never see these — see the comment on
// `registerMobDefinitions`.
registerMobDefinitions(BOSS_DEFINITIONS);

/** Every boss type id, in the order the storyline fights them. */
export const BOSS_ORDER = Object.freeze([
  'forest_warden', 'lava_titan', 'frost_serpent',
  'dune_colossus', 'hollow_king', 'corruption_overlord',
]);

/** @param {string} type @returns {object|null} */
export function getBossDefinition(type) {
  return BOSS_DEFINITIONS[type] || null;
}

/** The boss a seal's altar summons. */
export function bossForSeal(sealId) {
  for (const type of BOSS_ORDER) {
    if (BOSS_DEFINITIONS[type].seal === sealId) return type;
  }
  return null;
}
