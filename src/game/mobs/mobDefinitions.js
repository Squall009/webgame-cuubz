/**
 * Cuubz — Mob Definitions Registry
 * Single source of truth for all mob types: stats, behavior, 3D geometry, animations, drops.
 *
 * Each mob definition includes:
 *   - Core stats (health, speed, damage, hitbox)
 *   - Spawning rules (biomes, light level, elevation)
 *   - AI configuration (ranges, cooldowns, pack behavior)
 *   - Drops table (weighted item rolls)
 *   - Procedural 3D geometry (built from Three.js primitives at runtime)
 *   - Animation configuration (per-state type + parameters)
 *
 * ─── DROPS NAME REAL THINGS, AND THE TEST SAYS SO (D-125) ───────────────────
 *
 * A `drops[].item` is either a `NAMED_ITEMS` key or a **numeric block id from
 * `BLOCK_TYPES`** — never a block's *name* as a string. `Inventory.addItem` accepts any
 * string at all (unknown ones fall back to the RESOURCE stack size), so a mob dropping
 * `'cobblestone'` gave the player something they could hold, could not place
 * (`consumeSelectedBlock` requires a numeric typeId), could not craft with, and which
 * would not stack with the cobblestone they mined — because mining yields the id `3`.
 * `test/unit/game/mobBiomes.test.js` resolves every drop against `NAMED_ITEMS` and
 * `BLOCK_BY_ID`, which is the same guard S1 built for quest objectives after D-118.
 */

import { BLOCK_TYPES } from '../../engine/world/BlockRegistry.js';

export const MOB_CATEGORIES = {
  PASSIVE: 'passive',
  HOSTILE: 'hostile',
  // S6. A boss is a mob for rendering and animation purposes (§8.1 — the deleted
  // `Boss.js` had no renderer at all), and not one for spawning, capping or despawning
  // purposes. `MobManager` exempts this category from all three.
  BOSS: 'boss',
};

export const MOB_BEHAVIORS = {
  WANDER_FLEE: 'wander_flee',
  AGGRESSIVE: 'aggressive',
};

export const AI_STATES = {
  IDLE: 'idle',
  WANDER: 'wander',
  CHASE: 'chase',
  ATTACK: 'attack',
  FLEE: 'flee',
  HURT: 'hurt',
  DEAD: 'dead',
  RETURN_HOME: 'return_home',
};

export const ANIM_TYPES = {
  BREATHING: 'breathing',
  TWITCH: 'twitch',
  ROCKING: 'rocking',
  HOVER: 'hover',
  WALK: 'walk',
  HOP: 'hop',
  CUSTOM: 'custom',
};

export const MOB_DEFINITIONS = {
  // ═══════════════════════════════════════════════════════════════
  // DEER — Passive, roams plains & forest, flees when approached
  // ═══════════════════════════════════════════════════════════════
  deer: {
    name: 'Deer',
    category: MOB_CATEGORIES.PASSIVE,
    health: 10,
    damage: 0,
    attackSpeed: 0,
    knockback: 0,
    speed: 4.5,
    fleeSpeed: 7.0,
    hitbox: { width: 0.8, height: 1.2 },
    biomes: ['plains', 'forest'],
    spawnWeight: 30,
    spawnInDark: false,
    spawnMinY: 62,
    spawnMaxY: 80,
    despawnDistance: 128,
    leashDistance: 48,
    experience: 3,
    behavior: MOB_BEHAVIORS.WANDER_FLEE,
    ai: {
      aggroRange: 0,
      attackRange: 0,
      attackCooldown: 0,
      loseInterestRange: 48,
      senseRange: 20,
      packAggro: false,
      packRadius: 0,
      wanderInterval: [3, 8],
      fleeRange: 16,
    },
    drops: [
      { item: 'leather', minCount: 0, maxCount: 2, weight: 70 },
      { item: 'raw_venison', minCount: 1, maxCount: 3, weight: 100 },
    ],
    // ── 3D Geometry ──────────────────────────────────────────
    geometry: {
      material: { roughness: 0.8, metalness: 0.0 },
      parts: [
        // Body — elongated torso
        { type: 'box', id: 'body', size: [0.7, 0.5, 1.0], position: [0, 0.6, 0], color: 0x8B6348 },
        // Neck
        { type: 'cylinder', id: 'neck', radiusTop: 0.08, radiusBottom: 0.12, height: 0.35, position: [0, 0.9, 0.4], color: 0x8B6348 },
        // Head
        { type: 'sphere', id: 'head', radius: 0.18, position: [0, 1.1, 0.65], color: 0xA0765A },
        // Snout
        { type: 'box', id: 'snout', size: [0.12, 0.08, 0.15], position: [0, 1.05, 0.8], color: 0x3D2B1F },
        // Antlers (left)
        { type: 'cone', id: 'antler_L_base', radius: 0.03, height: 0.2, position: [-0.1, 1.25, 0.6], rotation: [0, 0, -0.4], color: 0x5C4033 },
        { type: 'cone', id: 'antler_L_tip', radius: 0.02, height: 0.15, position: [-0.1, 1.4, 0.55], rotation: [0.3, 0, -0.6], color: 0x5C4033 },
        // Antlers (right)
        { type: 'cone', id: 'antler_R_base', radius: 0.03, height: 0.2, position: [0.1, 1.25, 0.6], rotation: [0, 0, 0.4], color: 0x5C4033 },
        { type: 'cone', id: 'antler_R_tip', radius: 0.02, height: 0.15, position: [0.1, 1.4, 0.55], rotation: [0.3, 0, 0.6], color: 0x5C4033 },
        // Legs
        { type: 'cylinder', id: 'leg_FL', radiusTop: 0.05, radiusBottom: 0.06, height: 0.5, position: [-0.2, 0.25, 0.35], color: 0x6B4226 },
        { type: 'cylinder', id: 'leg_FR', radiusTop: 0.05, radiusBottom: 0.06, height: 0.5, position: [0.2, 0.25, 0.35], color: 0x6B4226 },
        { type: 'cylinder', id: 'leg_BL', radiusTop: 0.05, radiusBottom: 0.06, height: 0.55, position: [-0.2, 0.25, -0.35], color: 0x6B4226 },
        { type: 'cylinder', id: 'leg_BR', radiusTop: 0.05, radiusBottom: 0.06, height: 0.55, position: [0.2, 0.25, -0.35], color: 0x6B4226 },
        // Tail
        { type: 'sphere', id: 'tail', radius: 0.06, position: [0, 0.5, -0.55], color: 0xC4A882 },
      ],
      eyes: {
        color: 0x111111, size: 0.04,
        positions: [[-0.08, 1.12, 0.72], [0.08, 1.12, 0.72]],
      },
    },
    // ── Animations ──────────────────────────────────────────
    animations: {
      idle:   { speed: 1.0, type: ANIM_TYPES.BREATHING },
      wander: { speed: 0.8, type: ANIM_TYPES.WALK, gait: 'trot' },
      chase:  { speed: 1.4, type: ANIM_TYPES.WALK, gait: 'gallop' },
      flee:   { speed: 1.6, type: ANIM_TYPES.WALK, gait: 'gallop' },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.25 },
      dead:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 1.0 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // RABBIT — Passive, small, hops on plains & forest & tundra
  // ═══════════════════════════════════════════════════════════════
  rabbit: {
    name: 'Rabbit',
    category: MOB_CATEGORIES.PASSIVE,
    health: 5,
    damage: 0,
    attackSpeed: 0,
    knockback: 0,
    speed: 3.0,
    fleeSpeed: 6.0,
    hitbox: { width: 0.4, height: 0.5 },
    // S13, D-68: + desert, badlands and frozen_peaks. A hare is the animal all three of
    // those biomes actually have, and giving the existing mob three more homes is a
    // better answer than three near-identical new definitions.
    biomes: ['plains', 'forest', 'tundra', 'desert', 'badlands', 'frozen_peaks'],
    spawnWeight: 40,
    spawnInDark: false,
    spawnMinY: 62,
    spawnMaxY: 80,
    despawnDistance: 96,
    leashDistance: 24,
    experience: 1,
    behavior: MOB_BEHAVIORS.WANDER_FLEE,
    ai: {
      aggroRange: 0,
      attackRange: 0,
      attackCooldown: 0,
      loseInterestRange: 32,
      senseRange: 12,
      packAggro: false,
      packRadius: 0,
      wanderInterval: [2, 6],
      fleeRange: 12,
    },
    drops: [
      { item: 'rabbit_hide', minCount: 0, maxCount: 1, weight: 60 },
      { item: 'rabbit_meat', minCount: 0, maxCount: 1, weight: 80 },
    ],
    // ── 3D Geometry ──────────────────────────────────────────
    geometry: {
      material: { roughness: 0.8, metalness: 0.0 },
      parts: [
        // Body — round compact
        { type: 'sphere', id: 'body', radius: 0.22, position: [0, 0.2, 0], color: 0xD2B48C },
        // Head
        { type: 'sphere', id: 'head', radius: 0.14, position: [0, 0.32, 0.2], color: 0xD2B48C },
        // Ears
        { type: 'box', id: 'ear_L', size: [0.04, 0.22, 0.08], position: [-0.1, 0.5, 0.18], rotation: [0.2, 0, -0.15], color: 0xD2B48C },
        { type: 'box', id: 'ear_L_inner', size: [0.02, 0.18, 0.06], position: [-0.1, 0.5, 0.18], rotation: [0.2, 0, -0.15], color: 0xF5D0B0 },
        { type: 'box', id: 'ear_R', size: [0.04, 0.22, 0.08], position: [0.1, 0.5, 0.18], rotation: [0.2, 0, 0.15], color: 0xD2B48C },
        { type: 'box', id: 'ear_R_inner', size: [0.02, 0.18, 0.06], position: [0.1, 0.5, 0.18], rotation: [0.2, 0, 0.15], color: 0xF5D0B0 },
        // Legs — back legs thicker
        { type: 'cylinder', id: 'leg_FL', radiusTop: 0.03, radiusBottom: 0.04, height: 0.2, position: [-0.1, 0.1, 0.12], color: 0xC4A070 },
        { type: 'cylinder', id: 'leg_FR', radiusTop: 0.03, radiusBottom: 0.04, height: 0.2, position: [0.1, 0.1, 0.12], color: 0xC4A070 },
        { type: 'cylinder', id: 'leg_BL', radiusTop: 0.05, radiusBottom: 0.06, height: 0.25, position: [-0.1, 0.1, -0.15], color: 0xC4A070 },
        { type: 'cylinder', id: 'leg_BR', radiusTop: 0.05, radiusBottom: 0.06, height: 0.25, position: [0.1, 0.1, -0.15], color: 0xC4A070 },
        // Tail
        { type: 'sphere', id: 'tail', radius: 0.04, position: [0, 0.22, -0.24], color: 0xF5F5DC },
      ],
      eyes: {
        color: 0x000000, size: 0.03,
        positions: [[-0.06, 0.34, 0.28], [0.06, 0.34, 0.28]],
      },
    },
    // ── Animations ──────────────────────────────────────────
    animations: {
      idle:   { speed: 0.5, type: ANIM_TYPES.TWITCH },
      wander: { speed: 1.0, type: ANIM_TYPES.HOP },
      flee:   { speed: 2.0, type: ANIM_TYPES.HOP },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.2 },
      dead:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 0.8 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // CORRUPT WOLF — Hostile, found in corruption biome, pack aggro
  // ═══════════════════════════════════════════════════════════════
  corrupt_wolf: {
    name: 'Corrupt Wolf',
    category: MOB_CATEGORIES.HOSTILE,
    health: 20,
    damage: 6,
    attackSpeed: 1.2,
    knockback: 1.5,
    speed: 5.5,
    fleeSpeed: 0,
    hitbox: { width: 0.8, height: 0.9 },
    biomes: ['corrupt'], // D-68 closed by S4: `corrupt` is a real biome now, so this mob can finally spawn where it was always written to
    spawnWeight: 25,
    spawnInDark: true,
    spawnMinY: 0,
    spawnMaxY: 80,
    despawnDistance: 112,
    leashDistance: 32,
    experience: 8,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      // D-110: was aggro 20 / lose 40 / sense 24 / packRadius 10. A 20-block aggro on the
      // game's highest-weight hostile meant a player crossing badlands picked up wolves
      // faster than they could shed them, and a 40-block lose-interest — 2x the range that
      // gained it — meant they could not be shed by retreating at all. Lose-interest is now
      // ~1.6x aggro: enough hysteresis that a mob does not flicker at the boundary, little
      // enough that backing off is a real option.
      aggroRange: 10,
      attackRange: 1.5,
      attackCooldown: 1.2,
      loseInterestRange: 16,
      senseRange: 14,
      packAggro: true,
      packRadius: 6,
      wanderInterval: [3, 8],
      fleeRange: 0,
    },
    drops: [
      { item: 'rotten_flesh', minCount: 1, maxCount: 2, weight: 90 },
      { item: 'bone', minCount: 0, maxCount: 2, weight: 50 },
      { item: 'corrupt_fang', minCount: 0, maxCount: 1, weight: 20 },
    ],
    // ── 3D Geometry ──────────────────────────────────────────
    geometry: {
      material: { roughness: 0.7, metalness: 0.1 },
      parts: [
        // Body — muscular torso
        { type: 'box', id: 'body', size: [0.7, 0.5, 1.1], position: [0, 0.5, 0], color: 0x4a6741 },
        // Head
        { type: 'box', id: 'head', size: [0.35, 0.3, 0.4], position: [0, 0.7, 0.55], color: 0x3d5a35 },
        // Snout
        { type: 'box', id: 'snout', size: [0.18, 0.1, 0.22], position: [0, 0.62, 0.78], color: 0x2d3a25 },
        // Ears
        { type: 'cone', id: 'ear_L', radius: 0.06, height: 0.15, position: [-0.16, 0.9, 0.52], rotation: [0.2, 0, -0.3], color: 0x3d5a35 },
        { type: 'cone', id: 'ear_R', radius: 0.06, height: 0.15, position: [0.16, 0.9, 0.52], rotation: [0.2, 0, 0.3], color: 0x3d5a35 },
        // Legs
        { type: 'cylinder', id: 'leg_FL', radiusTop: 0.06, radiusBottom: 0.08, height: 0.4, position: [-0.25, 0.2, 0.35], color: 0x3d5a35 },
        { type: 'cylinder', id: 'leg_FR', radiusTop: 0.06, radiusBottom: 0.08, height: 0.4, position: [0.25, 0.2, 0.35], color: 0x3d5a35 },
        { type: 'cylinder', id: 'leg_BL', radiusTop: 0.06, radiusBottom: 0.08, height: 0.45, position: [-0.25, 0.2, -0.35], color: 0x3d5a35 },
        { type: 'cylinder', id: 'leg_BR', radiusTop: 0.06, radiusBottom: 0.08, height: 0.45, position: [0.25, 0.2, -0.35], color: 0x3d5a35 },
        // Tail
        { type: 'cone', id: 'tail', radius: 0.06, height: 0.25, position: [0, 0.45, -0.6], rotation: [0.5, 0, 0], color: 0x4a6741 },
        // Corruption spines on back
        { type: 'cone', id: 'spine_1', radius: 0.03, height: 0.12, position: [-0.2, 0.75, 0.1], rotation: [-0.3, 0, 0], color: 0x8b00ff },
        { type: 'cone', id: 'spine_2', radius: 0.03, height: 0.12, position: [0.2, 0.75, 0.1], rotation: [-0.3, 0, 0], color: 0x8b00ff },
        { type: 'cone', id: 'spine_3', radius: 0.03, height: 0.12, position: [-0.2, 0.75, -0.15], rotation: [-0.3, 0, 0], color: 0x8b00ff },
        { type: 'cone', id: 'spine_4', radius: 0.03, height: 0.12, position: [0.2, 0.75, -0.15], rotation: [-0.3, 0, 0], color: 0x8b00ff },
      ],
      eyes: {
        color: 0xff2222, size: 0.06,
        positions: [[-0.1, 0.74, 0.7], [0.1, 0.74, 0.7]],
      },
    },
    // ── Animations ──────────────────────────────────────────
    animations: {
      idle:   { speed: 1.0, type: ANIM_TYPES.BREATHING },
      wander: { speed: 0.9, type: ANIM_TYPES.WALK, gait: 'trot' },
      chase:  { speed: 1.5, type: ANIM_TYPES.WALK, gait: 'gallop' },
      attack: { speed: 2.0, type: ANIM_TYPES.CUSTOM, functionName: 'lungeAttack', duration: 0.3 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.25 },
      dead:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 1.0 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // STONE GOLEM — Hostile, slow but tanky, found in mountains/caves
  // ═══════════════════════════════════════════════════════════════
  stone_golem: {
    name: 'Stone Golem',
    category: MOB_CATEGORIES.HOSTILE,
    health: 60,
    damage: 12,
    attackSpeed: 0.6,
    knockback: 3.0,
    speed: 2.0,
    fleeSpeed: 0,
    hitbox: { width: 1.4, height: 2.8 },
    // D-68: dropped 'deepslate_caves' — BiomeSystem cannot produce it; zero behaviour
    // change. S13 adds `badlands`, where its own stone-and-ore silhouette belongs and
    // which lost its only mobs when S4 sent the two corrupt ones back to the Corrupt
    // biome they were written for.
    biomes: ['mountains', 'badlands'],
    spawnWeight: 10,
    spawnInDark: true,
    spawnMinY: 0,
    spawnMaxY: 60,
    despawnDistance: 128,
    leashDistance: 16,
    experience: 20,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      // D-110: was aggro 15 / lose 32. The golem moves at 2.0 — slower than a walking
      // player — so a long aggro leash bought nothing but a permanent escort. Its
      // leashDistance is already 16, the tightest of any mob; aggro now matches that scale.
      aggroRange: 8,
      attackRange: 2.5,
      attackCooldown: 1.8,
      loseInterestRange: 13,
      senseRange: 12,
      packAggro: false,
      packRadius: 0,
      wanderInterval: [5, 12],
      fleeRange: 0,
    },
    drops: [
      // D-125: was the string `'cobblestone'`, which is not a `NAMED_ITEMS` key and is
      // therefore not the same thing `getBlockDrop` hands out when you mine one.
      { item: BLOCK_TYPES.COBBLESTONE, minCount: 2, maxCount: 5, weight: 100 },
      { item: 'iron_ingot', minCount: 0, maxCount: 1, weight: 25 },
    ],
    // ── 3D Geometry ──────────────────────────────────────────
    geometry: {
      material: { roughness: 0.9, metalness: 0.0 },
      parts: [
        // Torso
        { type: 'box', id: 'torso', size: [1.0, 1.2, 0.7], position: [0, 1.2, 0], color: 0x7a7a7a },
        // Head
        { type: 'sphere', id: 'head', radius: 0.45, position: [0, 2.0, 0.1], color: 0x8a8a8a },
        // Arms
        { type: 'box', id: 'arm_L', size: [0.3, 0.7, 0.3], position: [-0.65, 1.1, 0], color: 0x6a6a6a },
        { type: 'box', id: 'arm_R', size: [0.3, 0.7, 0.3], position: [0.65, 1.1, 0], color: 0x6a6a6a },
        // Legs
        { type: 'cylinder', id: 'leg_L', radiusTop: 0.2, radiusBottom: 0.25, height: 0.65, position: [-0.3, 0.325, 0], color: 0x5a5a5a },
        { type: 'cylinder', id: 'leg_R', radiusTop: 0.2, radiusBottom: 0.25, height: 0.65, position: [0.3, 0.325, 0], color: 0x5a5a5a },
        // Shoulder pads
        { type: 'box', id: 'shoulder_L', size: [0.15, 0.15, 0.45], position: [-0.65, 1.55, 0], color: 0x6a6a6a },
        { type: 'box', id: 'shoulder_R', size: [0.15, 0.15, 0.45], position: [0.65, 1.55, 0], color: 0x6a6a6a },
        // Glowing energy core in chest
        { type: 'sphere', id: 'core', radius: 0.12, position: [0, 1.2, 0.38], emissive: 0xff6600, emissiveIntensity: 0.8, color: 0xff6600 },
        // Crack details (small wedges to suggest stone texture)
        { type: 'box', id: 'crack_1', size: [0.15, 0.04, 0.02], position: [-0.3, 1.4, 0.36], rotation: [0, 0, 0.3], color: 0x3a3a3a },
        { type: 'box', id: 'crack_2', size: [0.02, 0.2, 0.02], position: [0.25, 1.0, 0.36], rotation: [0, 0, -0.2], color: 0x3a3a3a },
      ],
      eyes: {
        color: 0xffaa00, size: 0.09,
        positions: [[-0.14, 2.05, 0.38], [0.14, 2.05, 0.38]],
      },
    },
    // ── Animations ──────────────────────────────────────────
    animations: {
      idle:   { speed: 0.3, type: ANIM_TYPES.ROCKING },
      wander: { speed: 0.4, type: ANIM_TYPES.WALK, gait: 'stomp' },
      chase:  { speed: 0.6, type: ANIM_TYPES.WALK, gait: 'stomp' },
      attack: { speed: 0.8, type: ANIM_TYPES.CUSTOM, functionName: 'slamAttack', duration: 0.8 },
      hurt:   { speed: 0.5, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.4 },
      dead:   { speed: 0.3, type: ANIM_TYPES.CUSTOM, functionName: 'crumbleDeath', duration: 2.0 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // CORRUPT WISP — Hostile, flying, found in corruption biome
  // ═══════════════════════════════════════════════════════════════
  corrupt_wisp: {
    name: 'Corrupt Wisp',
    category: MOB_CATEGORIES.HOSTILE,
    health: 10,
    damage: 4,
    attackSpeed: 1.5,
    knockback: 0.5,
    speed: 6.0,
    fleeSpeed: 0,
    hitbox: { width: 0.6, height: 0.6 },
    biomes: ['corrupt'], // D-68 closed by S4: `corrupt` is a real biome now, so this mob can finally spawn where it was always written to
    spawnWeight: 20,
    spawnInDark: true,
    spawnMinY: 0,
    spawnMaxY: 80,
    despawnDistance: 120,
    leashDistance: 24,
    experience: 5,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    flying: true,
    ai: {
      // D-110: was aggro 16 / lose 32 / sense 20 / packRadius 8. The wisp flies at 6.0 —
      // faster than any other mob and unobstructed by terrain — so its effective reach is
      // larger than the number suggests, and it is the second `packAggro` type. Cut hardest
      // in proportion for that reason.
      aggroRange: 9,
      attackRange: 1.2,
      attackCooldown: 1.0,
      loseInterestRange: 14,
      senseRange: 12,
      packAggro: true,
      packRadius: 5,
      wanderInterval: [2, 5],
      fleeRange: 0,
    },
    drops: [
      { item: 'glowstone_dust', minCount: 0, maxCount: 2, weight: 70 },
      { item: 'corrupt_fang', minCount: 0, maxCount: 1, weight: 15 },
    ],
    // ── 3D Geometry ──────────────────────────────────────────
    geometry: {
      material: { roughness: 0.3, metalness: 0.0 },
      parts: [
        // Core — bright purple sphere
        { type: 'sphere', id: 'core', radius: 0.15, position: [0, 0.3, 0], emissive: 0x8b00ff, emissiveIntensity: 1.0, color: 0x8b00ff },
        // Glow aura — larger semi-transparent sphere
        { type: 'sphere', id: 'aura', radius: 0.35, position: [0, 0.3, 0], emissive: 0xbb33ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.25, color: 0xbb33ff },
        // Orbiting corruption particles (small spheres)
        { type: 'sphere', id: 'particle_1', radius: 0.04, position: [0.3, 0.35, 0.2], emissive: 0xcc44ff, emissiveIntensity: 0.6, color: 0xcc44ff },
        { type: 'sphere', id: 'particle_2', radius: 0.04, position: [-0.25, 0.25, -0.25], emissive: 0xcc44ff, emissiveIntensity: 0.6, color: 0xcc44ff },
        { type: 'sphere', id: 'particle_3', radius: 0.03, position: [0.15, 0.45, -0.3], emissive: 0xcc44ff, emissiveIntensity: 0.6, color: 0xcc44ff },
        // Wisps (small trailing cones)
        { type: 'cone', id: 'wisp_1', radius: 0.03, height: 0.12, position: [-0.15, 0.25, -0.35], rotation: [0.5, 0.3, 0], emissive: 0xbb33ff, emissiveIntensity: 0.3, color: 0xbb33ff },
        { type: 'cone', id: 'wisp_2', radius: 0.03, height: 0.12, position: [0.15, 0.35, -0.35], rotation: [0.5, -0.3, 0], emissive: 0xbb33ff, emissiveIntensity: 0.3, color: 0xbb33ff },
      ],
      eyes: {
        color: 0xffffff, size: 0.05,
        positions: [[-0.07, 0.33, 0.14], [0.07, 0.33, 0.14]],
      },
    },
    // ── Animations ──────────────────────────────────────────
    animations: {
      idle:   { speed: 1.0, type: ANIM_TYPES.HOVER },
      wander: { speed: 1.0, type: ANIM_TYPES.HOVER },
      chase:  { speed: 1.5, type: ANIM_TYPES.HOVER },
      attack: { speed: 2.0, type: ANIM_TYPES.CUSTOM, functionName: 'chargeAttack', duration: 0.3 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.2 },
      dead:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'dissolveDeath', duration: 0.8 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // ASH CRAWLER — Hostile, the Lava biome's own mob (S13, D-68)
  // ═══════════════════════════════════════════════════════════════
  //
  // S4 built the Lava biome and gave it no inhabitant, which made the one place in the
  // game that can kill you also the emptiest — and Act 3 sends the player there for four
  // quests (Q13–Q16). Of the seven biomes on D-68's ledger this is the only one that is
  // *this* work's fault rather than inherited, so it is the one that had to be built.
  //
  // Low and wide rather than tall, so it reads against a landscape of basalt columns,
  // and slow enough to be escaped: the Lava biome's real threat is the floor, and a fast
  // hostile there would mean players dying to a chase rather than to their own footing.
  ash_crawler: {
    name: 'Ash Crawler',
    category: MOB_CATEGORIES.HOSTILE,
    health: 24,
    damage: 5,
    attackSpeed: 0.9,
    knockback: 1.0,
    // Below the player's walk speed of 5, deliberately and unlike a boss (D-124): a mob
    // you can walk away from is the right call when the ground between you and safety is
    // the actual danger.
    speed: 3.4,
    fleeSpeed: 0,
    hitbox: { width: 1.1, height: 0.6 },
    biomes: ['lava'],
    spawnWeight: 30,
    // Not a night mob. The Lava biome is lit by its own floor and a hostile that only
    // appeared after dark would leave Q13–Q16's daytime trips empty.
    spawnInDark: false,
    spawnMinY: 0,
    spawnMaxY: 128,
    despawnDistance: 112,
    leashDistance: 28,
    experience: 9,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      // D-110's ranges, scaled to a slow mob: short aggro, ~1.6x lose-interest so
      // retreating works, and no pack aggro at all — the biome is already the hazard.
      aggroRange: 9,
      attackRange: 1.8,
      attackCooldown: 1.4,
      loseInterestRange: 15,
      senseRange: 12,
      packAggro: false,
      packRadius: 0,
      wanderInterval: [4, 9],
      fleeRange: 0,
    },
    // Only items that already exist. Adding a "chitin" or "cinder" item means a texture,
    // a `NAMED_ITEMS` entry, a manifest row and the whole D-112/D-114 coverage gauntlet,
    // which is a lot of machinery for a drop name — and D-125, found writing this mob,
    // is what happens when a drop names something the registry does not have.
    drops: [
      { item: 'coal', minCount: 1, maxCount: 3, weight: 90 },
      { item: 'glowstone_dust', minCount: 0, maxCount: 2, weight: 40 },
      { item: 'gunpowder', minCount: 0, maxCount: 1, weight: 25 },
    ],
    // ── 3D Geometry ──────────────────────────────────────────
    // Cooled crust over a molten interior — the Lava Titan's own language (basalt-black
    // with bright seams), at one twentieth the size, so the biome reads as one place.
    geometry: {
      material: { roughness: 0.85, metalness: 0.05 },
      parts: [
        // Segmented carapace, front to back
        { type: 'box', id: 'seg_1', size: [0.7, 0.32, 0.42], position: [0, 0.34, 0.36], color: 0x2b1a12 },
        { type: 'box', id: 'seg_2', size: [0.8, 0.36, 0.42], position: [0, 0.36, 0], color: 0x241610 },
        { type: 'box', id: 'seg_3', size: [0.62, 0.3, 0.4], position: [0, 0.32, -0.38], color: 0x1d120c },
        // Head, low and blunt
        { type: 'box', id: 'head', size: [0.42, 0.24, 0.3], position: [0, 0.28, 0.68], color: 0x332014 },
        { type: 'cone', id: 'mandible_L', radius: 0.05, height: 0.22, position: [-0.13, 0.22, 0.86], rotation: [1.4, 0, -0.2], color: 0x120a06 },
        { type: 'cone', id: 'mandible_R', radius: 0.05, height: 0.22, position: [0.13, 0.22, 0.86], rotation: [1.4, 0, 0.2], color: 0x120a06 },
        // The molten seams between the plates — the only bright thing on it
        { type: 'box', id: 'seam_1', size: [0.72, 0.06, 0.08], position: [0, 0.36, 0.2], emissive: 0xff6a00, emissiveIntensity: 0.8, color: 0xff6a00 },
        { type: 'box', id: 'seam_2', size: [0.66, 0.06, 0.08], position: [0, 0.34, -0.2], emissive: 0xff8c1a, emissiveIntensity: 0.7, color: 0xff8c1a },
        { type: 'sphere', id: 'vent', radius: 0.11, position: [0, 0.52, -0.1], emissive: 0xffb300, emissiveIntensity: 0.6, color: 0xffb300 },
        // Six legs, splayed
        { type: 'cylinder', id: 'leg_FL', radiusTop: 0.04, radiusBottom: 0.05, height: 0.3, position: [-0.42, 0.15, 0.34], rotation: [0, 0, 0.5], color: 0x1d120c },
        { type: 'cylinder', id: 'leg_FR', radiusTop: 0.04, radiusBottom: 0.05, height: 0.3, position: [0.42, 0.15, 0.34], rotation: [0, 0, -0.5], color: 0x1d120c },
        { type: 'cylinder', id: 'leg_ML', radiusTop: 0.04, radiusBottom: 0.05, height: 0.32, position: [-0.46, 0.16, 0], rotation: [0, 0, 0.5], color: 0x1d120c },
        { type: 'cylinder', id: 'leg_MR', radiusTop: 0.04, radiusBottom: 0.05, height: 0.32, position: [0.46, 0.16, 0], rotation: [0, 0, -0.5], color: 0x1d120c },
        { type: 'cylinder', id: 'leg_BL', radiusTop: 0.04, radiusBottom: 0.05, height: 0.3, position: [-0.4, 0.15, -0.34], rotation: [0, 0, 0.5], color: 0x1d120c },
        { type: 'cylinder', id: 'leg_BR', radiusTop: 0.04, radiusBottom: 0.05, height: 0.3, position: [0.4, 0.15, -0.34], rotation: [0, 0, -0.5], color: 0x1d120c },
        // Tail spike
        { type: 'cone', id: 'tail', radius: 0.08, height: 0.3, position: [0, 0.34, -0.68], rotation: [1.9, 0, 0], color: 0x120a06 },
      ],
      eyes: {
        color: 0xffb300, size: 0.05,
        positions: [[-0.13, 0.34, 0.8], [0.13, 0.34, 0.8]],
      },
    },
    // ── Animations ──────────────────────────────────────────
    animations: {
      idle:   { speed: 0.5, type: ANIM_TYPES.BREATHING },
      wander: { speed: 0.8, type: ANIM_TYPES.WALK, gait: 'trot' },
      chase:  { speed: 1.2, type: ANIM_TYPES.WALK, gait: 'trot' },
      attack: { speed: 1.4, type: ANIM_TYPES.CUSTOM, functionName: 'lungeAttack', duration: 0.4 },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.25 },
      dead:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'crumbleDeath', duration: 1.2 },
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // SAND CRAB — Passive, the shoreline (S13, D-68)
  // ═══════════════════════════════════════════════════════════════
  //
  // `beach` had no mob, and it is the biome every player walks along before they have a
  // pickaxe. It is also the only one of D-68's remaining seven that a *land* animal can
  // honestly fill — see the two ocean rows, which are declined rather than deferred.
  //
  // Passive, and the third one in the game: deer, rabbit and this. `MobManager`'s
  // `hostileCap` (D-110) is separate from the overall cap, so ambience costs a hostile
  // nothing.
  sand_crab: {
    name: 'Sand Crab',
    category: MOB_CATEGORIES.PASSIVE,
    health: 8,
    damage: 0,
    attackSpeed: 0,
    knockback: 0.5,
    speed: 1.6,
    fleeSpeed: 4.5,
    hitbox: { width: 0.6, height: 0.35 },
    biomes: ['beach'],
    spawnWeight: 40,
    spawnInDark: false,
    spawnMinY: 0,
    spawnMaxY: 90,
    despawnDistance: 96,
    leashDistance: 20,
    experience: 2,
    behavior: MOB_BEHAVIORS.WANDER_FLEE,
    ai: {
      aggroRange: 0,
      attackRange: 0,
      attackCooldown: 0,
      loseInterestRange: 0,
      senseRange: 10,
      packAggro: false,
      packRadius: 0,
      wanderInterval: [2, 6],
      // Skittish and short-lived about it: it bolts early and gives up quickly, which is
      // what makes a shoreline feel inhabited rather than hostile.
      fleeRange: 7,
    },
    // There is no shell or chitin item and inventing one costs a texture, a manifest row
    // and the D-112/D-114 gauntlet for a name. It drops the two generic animal materials
    // that already exist, which is honest about what this is: ambience with a small
    // payout, not a resource the player farms.
    drops: [
      { item: 'bone', minCount: 0, maxCount: 1, weight: 60 },
      { item: 'leather', minCount: 0, maxCount: 1, weight: 30 },
    ],
    // ── 3D Geometry ──────────────────────────────────────────
    geometry: {
      material: { roughness: 0.55, metalness: 0.05 },
      parts: [
        { type: 'box', id: 'shell', size: [0.5, 0.18, 0.36], position: [0, 0.2, 0], color: 0xc2593a },
        { type: 'box', id: 'shell_top', size: [0.36, 0.1, 0.26], position: [0, 0.31, 0], color: 0xd66b48 },
        // Claws, one larger than the other
        { type: 'box', id: 'claw_L', size: [0.16, 0.12, 0.2], position: [-0.32, 0.18, 0.2], rotation: [0, 0.3, 0], color: 0xe07a56 },
        { type: 'box', id: 'claw_R', size: [0.12, 0.1, 0.16], position: [0.3, 0.16, 0.19], rotation: [0, -0.3, 0], color: 0xe07a56 },
        // Eye stalks
        { type: 'cylinder', id: 'stalk_L', radiusTop: 0.02, radiusBottom: 0.02, height: 0.12, position: [-0.09, 0.4, 0.1], color: 0xd66b48 },
        { type: 'cylinder', id: 'stalk_R', radiusTop: 0.02, radiusBottom: 0.02, height: 0.12, position: [0.09, 0.4, 0.1], color: 0xd66b48 },
        // Legs, three a side
        { type: 'cylinder', id: 'leg_FL', radiusTop: 0.02, radiusBottom: 0.03, height: 0.18, position: [-0.26, 0.09, 0.12], rotation: [0, 0, 0.6], color: 0xa8482e },
        { type: 'cylinder', id: 'leg_FR', radiusTop: 0.02, radiusBottom: 0.03, height: 0.18, position: [0.26, 0.09, 0.12], rotation: [0, 0, -0.6], color: 0xa8482e },
        { type: 'cylinder', id: 'leg_ML', radiusTop: 0.02, radiusBottom: 0.03, height: 0.18, position: [-0.28, 0.09, 0], rotation: [0, 0, 0.6], color: 0xa8482e },
        { type: 'cylinder', id: 'leg_MR', radiusTop: 0.02, radiusBottom: 0.03, height: 0.18, position: [0.28, 0.09, 0], rotation: [0, 0, -0.6], color: 0xa8482e },
        { type: 'cylinder', id: 'leg_BL', radiusTop: 0.02, radiusBottom: 0.03, height: 0.18, position: [-0.26, 0.09, -0.12], rotation: [0, 0, 0.6], color: 0xa8482e },
        { type: 'cylinder', id: 'leg_BR', radiusTop: 0.02, radiusBottom: 0.03, height: 0.18, position: [0.26, 0.09, -0.12], rotation: [0, 0, -0.6], color: 0xa8482e },
      ],
      eyes: {
        color: 0x000000, size: 0.03,
        positions: [[-0.09, 0.47, 0.11], [0.09, 0.47, 0.11]],
      },
    },
    // ── Animations ──────────────────────────────────────────
    animations: {
      idle:   { speed: 0.6, type: ANIM_TYPES.TWITCH },
      wander: { speed: 1.2, type: ANIM_TYPES.WALK, gait: 'trot' },
      flee:   { speed: 2.2, type: ANIM_TYPES.WALK, gait: 'gallop' },
      hurt:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'hurtReaction', duration: 0.2 },
      dead:   { speed: 1.0, type: ANIM_TYPES.CUSTOM, functionName: 'collapseDeath', duration: 0.6 },
    },
  },
};

/**
 * Definitions registered at runtime — the bosses (S6).
 *
 * ─── WHY A REGISTRY AND NOT A LINE IN `MOB_DEFINITIONS` ─────────────────────
 *
 * `bossDefinitions.js` imports `MOB_CATEGORIES`, `MOB_BEHAVIORS` and `ANIM_TYPES` from
 * this file. Putting the bosses in the table above would need this file to import that
 * one, and `src/` has no import cycles and must not gain one (**D-28**).
 *
 * The split is also the right shape on its own: `getMobDefinition` finds a boss, so
 * `Mob`, `mobModelBuilder`, `mobAnimator` and `mobRenderer` all work on one unchanged —
 * while `getAllMobTypes`, `getMobTypesForBiome` and `selectMobForBiome` read only
 * `MOB_DEFINITIONS`, so **no spawn path can ever pick a boss**. `biomes: []` makes that
 * true twice over, and the boss tests assert both.
 */
const REGISTERED = {};

/**
 * Add definitions to the lookup. Called once, at module load, by `bossDefinitions.js`.
 * @param {Object<string, object>} defs
 */
export function registerMobDefinitions(defs) {
  for (const [key, def] of Object.entries(defs || {})) {
    REGISTERED[key] = def;
  }
}

/**
 * Get a mob definition by type key. Finds registered bosses as well as ordinary mobs.
 * @param {string} mobType - Key in MOB_DEFINITIONS, or a registered boss
 * @returns {object|null}
 */
export function getMobDefinition(mobType) {
  return MOB_DEFINITIONS[mobType] || REGISTERED[mobType] || null;
}

/**
 * Get all mob type keys.
 *
 * **Spawnable mobs only** — the registered bosses are deliberately absent, which is what
 * keeps a boss out of every natural spawn path without relying on `biomes: []` alone.
 * @returns {string[]}
 */
export function getAllMobTypes() {
  return Object.keys(MOB_DEFINITIONS);
}

/**
 * Get mob types valid for a given biome.
 * @param {string} biome - Biome name (lowercase)
 * @returns {string[]} Array of mob type keys
 */
export function getMobTypesForBiome(biome) {
  const types = [];
  for (const [key, def] of Object.entries(MOB_DEFINITIONS)) {
    if (def.biomes.includes(biome)) {
      types.push(key);
    }
  }
  return types;
}

/**
 * Weighted random selection of a mob type for a biome.
 * @param {string} biome - Biome name
 * @returns {string|null} Selected mob type key or null if none available
 */
export function selectMobForBiome(biome) {
  const candidates = [];
  for (const [key, def] of Object.entries(MOB_DEFINITIONS)) {
    if (def.biomes.includes(biome)) {
      candidates.push({ key, weight: def.spawnWeight });
    }
  }
  if (candidates.length === 0) return null;

  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) return c.key;
  }
  return candidates[candidates.length - 1].key;
}
