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
 */

export const MOB_CATEGORIES = {
  PASSIVE: 'passive',
  HOSTILE: 'hostile',
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
    biomes: ['plains', 'forest', 'tundra'],
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
    biomes: ['badlands'], // D-68/decision 48: was ['corrupt'] — not a biome BiomeSystem can produce, so this mob had NEVER spawned
    spawnWeight: 25,
    spawnInDark: true,
    spawnMinY: 0,
    spawnMaxY: 80,
    despawnDistance: 112,
    leashDistance: 32,
    experience: 8,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      aggroRange: 20,
      attackRange: 1.5,
      attackCooldown: 1.2,
      loseInterestRange: 40,
      senseRange: 24,
      packAggro: true,
      packRadius: 10,
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
    biomes: ['mountains'], // D-68: dropped 'deepslate_caves' — BiomeSystem cannot produce it; zero behaviour change
    spawnWeight: 10,
    spawnInDark: true,
    spawnMinY: 0,
    spawnMaxY: 60,
    despawnDistance: 128,
    leashDistance: 16,
    experience: 20,
    behavior: MOB_BEHAVIORS.AGGRESSIVE,
    ai: {
      aggroRange: 15,
      attackRange: 2.5,
      attackCooldown: 1.8,
      loseInterestRange: 32,
      senseRange: 12,
      packAggro: false,
      packRadius: 0,
      wanderInterval: [5, 12],
      fleeRange: 0,
    },
    drops: [
      { item: 'cobblestone', minCount: 2, maxCount: 5, weight: 100 },
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
    biomes: ['badlands'], // D-68/decision 48: was ['corrupt'] — not a biome BiomeSystem can produce, so this mob had NEVER spawned
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
      aggroRange: 16,
      attackRange: 1.2,
      attackCooldown: 1.0,
      loseInterestRange: 32,
      senseRange: 20,
      packAggro: true,
      packRadius: 8,
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
};

/**
 * Get a mob definition by type key.
 * @param {string} mobType - Key in MOB_DEFINITIONS
 * @returns {object|null}
 */
export function getMobDefinition(mobType) {
  return MOB_DEFINITIONS[mobType] || null;
}

/**
 * Get all mob type keys.
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
