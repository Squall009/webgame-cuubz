# 🧟 Cuubz Mob System — Implementation Checklist

> **Goal**: Add procedurally-generated 3D mobs to the voxel world with health, AI, pathfinding, combat, and item drops. Mobs are built from Three.js primitives (boxes, spheres, cylinders, cones) at runtime — no external model files. All animations are code-generated, not keyframed.

---

## Phase 0 — Project Setup & Scaffolding

- [x] Create directory structure:
  ```
  src/game/mobs/
    mobManager.js
    mob.js
    mobDefinitions.js
    ai/
      pathfinding.js
      mobAI.js
      mobSenses.js
    movement/
      mobMovement.js
    rendering/
      mobModelBuilder.js
      mobAnimator.js
      mobRenderer.js
      animTypes/
        walkCycle.js
        hopCycle.js
        bodyLanguage.js
        attackAnim.js
        deathAnim.js
        hurtAnim.js
    drops/
      mobDropTable.js
  src/multiplayer/
    mobSync.js      (deferred — build after single-player works)
  ```
- [x] Add new `NAMED_ITEMS` to `src/game/systems/InventorySystem.js` for mob drops:
  - `rotten_flesh`, `bone`, `rabbit_hide`, `rabbit_meat`, `raw_venison`, `corrupt_fang`
- [x] Add `DAMAGE_SOURCES.MOB` to `src/game/systems/SurvivalSystem.js`
- [x] Add weapon `damage` property lookup `getAttackDamage()` in `src/game/systems/InventorySystem.js`
- [x] Create `mobIntegration.js` module to wire into game loop
- [x] Wire `mobIntegration.update()` call into `src/main.js`'s render loop

---

## Phase 1 — Mob Definitions (`mobDefinitions.js`)

- [ ] Define block-level constants: mob categories, behavior types, AI state enum
- [ ] Create `MOB_DEFINITIONS` registry with **at least these mob types**:

  | Mob | Category | Biome | Key Stats |
  |-----|----------|-------|-----------|
  | **Deer** | passive | plains, forest | HP 20, speed 4.5 |
  | **Rabbit** | passive | plains, forest, tundra | HP 6, speed 3.0 |
  | **Corrupt Wolf** | hostile | corrupt | HP 40, dmg 6, speed 5.5 |
  | **Stone Golem** | hostile | mountains, deepslate_caves | HP 100, dmg 12, speed 2.0 |
  | **Corrupt Wisp** | hostile | corrupt | HP 15, dmg 4, speed 6.0 (flying) |

- [x] Each mob definition includes:
  - [x] `name` — display name
  - [x] `category` — `'passive'` or `'hostile'`
  - [x] `health`, `damage`, `attackSpeed`, `knockback`
  - [x] `speed`, `fleeSpeed` (passive only)
  - [x] `hitbox` — `{ width, height }` for AABB collision
  - [x] `biomes` — array of biome strings where it spawns
  - [x] `spawnWeight` — relative probability (higher = more common)
  - [x] `spawnInDark` — only spawn when light level < 7
  - [x] `spawnMinY`, `spawnMaxY` — elevation constraints
  - [x] `despawnDistance`, `leashDistance` — range limits
  - [x] `behavior` — `'wander_flee'` (passive) or `'aggressive'` (hostile)
  - [x] `ai` block — aggroRange, attackRange, attackCooldown, loseInterestRange, senseRange, packAggro, packRadius
  - [x] `drops` — weighted table array: `{ item, minCount, maxCount, weight }`
  - [x] `experience` — XP rewarded on kill
  - [x] `geometry` — 3D model definition
  - [x] `animations` — per-state animation configs

---

## Phase 2 — Base Mob Class (`mob.js`)

- [x] Constructor: `Mob(mobType, spawnPosition, worldSeed)`
  - [x] Deep-copy definition from `MOB_DEFINITIONS`
  - [x] Initialize health, maxHealth
  - [x] Set position, spawnPosition, velocity, yaw
  - [x] Set aiState to `'idle'`, animationTimer to 0
  - [x] Initialize attackCooldownTimer to 0
- [x] **Properties:**
  - [x] `mobType`, `definition`, `id` (unique, timestamp + random)
  - [x] `health`, `maxHealth`
  - [x] `position` `{x,y,z}`, `velocity` `{x,y,z}`, `yaw`
  - [x] `spawnPosition` (for leash constraint)
  - [x] `aiState` — `'idle' | 'wander' | 'chase' | 'attack' | 'flee' | 'hurt' | 'dead'`
  - [x] `aiTimer`, `animationTimer`
  - [x] `attackCooldownTimer`
  - [x] `targetEntity` — reference to the player (or other mob)
  - [x] `onGround` — for gravity integration
  - [x] `stuckTimer` — for detecting pathfinding failures
  - [x] `isDead` flag
- [x] **Methods:**
  - [x] `update(deltaTime, blockAccess, playerPosition, otherMobs)` — main simulation tick
  - [x] `takeDamage(amount, source)` — reduce health, transition to hurt state, check death
  - [x] `die()` — set state to dead, trigger drop table roll, schedule removal
  - [x] `knockback(dx, dz)` — apply knockback impulse from player attacks
  - [x] `heal(amount)` — restore health (for future taming/potions)
  - [x] `getDropItems()` — roll weighted tables → array of `{typeId, count}`
  - [x] `distanceTo(entity)` — Euclidean distance helper
  - [x] `facingAngleToward(target)` — compute yaw to face a target
  - [x] `serialize()` / `static deserialize(data)` — for persistence
  - [x] `canSee(target, blockAccess)` — line-of-sight check (raycast through blocks)

---

## Phase 3 — AI State Machine (`ai/mobAI.js`)

- [ ] Define state transitions diagram:

  ```
                  ┌─────────┐
      spawn ─────▶│  IDLE   │◀────────────┐
                  └────┬────┘              │
                       │ timer expired     │
                       ▼                   │
                  ┌─────────┐              │
         ┌───────▶│ WANDER  │──────────────┘
         │        └────┬────┘  reached target / timer
         │             │ player in aggroRange (hostile)
         │             ▼
         │        ┌─────────┐
         │        │  CHASE  │──────────────┐
         │        └────┬────┘              │
         │             │ in attackRange    │ player out of range
         │             ▼                   │
         │        ┌─────────┐             │
         │        │ ATTACK  │             │
         │        └────┬────┘             │
         │             │ cooldown done     │
         │             └──────────┐        │
         │                        ▼        ▼
         │                   ┌─────────┐
         │                   │ RETURN  │ (go back to spawnPosition)
         │                   │  HOME   │
         │                   └────┬────┘
         │                        │ arrived at spawn
         └────────────────────────┘
         
    Passive mobs: IDLE ↔ WANDER, with FLEE triggered by player in senseRange
  ```

- [ ] Implement `MobAI.update(deltaTime, playerPosition, mobSensesResult)`:
  - [ ] **IDLE**: count down aiTimer (2–5s random), transition to WANDER
  - [ ] **WANDER**: pick random point within leashDistance, move toward it, timer for direction change (3–8s). If player in senseRange and hostile → CHASE. If passive → FLEE.
  - [ ] **CHASE**: move toward target player using direct-chase (Phase 4). If in attackRange → ATTACK. If player beyond loseInterestRange → RETURN_HOME.
  - [ ] **ATTACK**: single-frame attack execution (deal damage, set cooldown), then back to CHASE. Cooldown from `mobDefinition.attackSpeed`.
  - [ ] **FLEE**: (passive mobs) run away from player in opposite direction at fleeSpeed, for 2–4 seconds, then WANDER.
  - [ ] **HURT**: 0.25s stun animation, then return to previous state (or CHASE if hostile).
  - [ ] **DEAD**: do nothing, wait for animator to finish then trigger removal.
  - [ ] **RETURN_HOME**: path back to spawnPosition. When within 1 block, transition to IDLE.
  - [ ] **PACK AGGRESSION**: when a hostile mob aggros, notify nearby same-type mobs within `packRadius` to also aggro (set target to same player).

---

## Phase 4 — Pathfinding (`ai/pathfinding.js`)

### Tier 1: Direct Chase (80% of frames, cheap)

- [ ] Straight-line movement toward target with simple obstacle avoidance:
  - [ ] Cast forward ray at mob eye height for 2-block distance
  - [ ] If ray hits solid block → try lateral offset (±0.5 blocks), pick the side with more open space
  - [ ] If both sides blocked → trigger Tier 2 (A*)
  - [ ] If velocity stagnates (`stuckTimer > 1s`) → trigger Tier 2
- [ ] Step-up handling: if next horizontal block is a 1-block wall and head space is clear → apply jump velocity
- [ ] Stuck detection: if `velocity.length() < 0.01` for 1+ seconds → increment `stuckTimer`

### Tier 2: A* Escape (only when stuck)

- [ ] 2D grid search (x, z) on block coordinates, 6-neighbor (cardinal + diagonals)
- [ ] Node limit: 64 max (search terminates if not found)
- [ ] Heuristic: Manhattan distance to target
- [ ] Walkable check: block at feet level is solid, block at head level is air
- [ ] Cached per mob: waypoint list + cached goal position
- [ ] Invalidate cache when goal moves >4 blocks from cached position
- [ ] Walk waypoints in sequence at mob speed
- [ ] After reaching final waypoint → switch back to Tier 1

### Tier 3: Flying Pathfinding (for Wisps, future bats)

- [ ] 3D A* with same node limit (64)
- [ ] No step-up needed — full 3D movement through air
- [ ] Height clamp: mob.definition.spawnMinY to spawnMaxY
- [ ] Avoid lava and water blocks as paths

---

## Phase 5 — Mob Senses (`ai/mobSenses.js`)

- [ ] `canSeeTarget(mob, target, blockAccess)`:
  - [ ] Check `distanceTo(target) ≤ mob.definition.ai.senseRange`
  - [ ] DDA raycast from mob eye level to target (reuse `VoxelRenderer._voxelRaycast` logic)
  - [ ] If ray hits a solid block before reaching target → cannot see (obstructed)
  - [ ] If unobstructed → can see
- [ ] `shouldAggro(mob, player, blockAccess)`:
  - [ ] If player distance ≤ aggroRange AND line of sight is clear → aggro
  - [ ] Hostile mobs have a small chance to aggro on sound (player breaking blocks nearby)
- [ ] `shouldLoseAggro(mob, player)`:
  - [ ] If player distance > loseInterestRange → stop chasing
  - [ ] If line of sight broken for >5 seconds and distance > aggroRange → stop chasing
- [ ] `detectPackMembers(mob, otherMobs)`:
  - [ ] Scan other mobs of same `mobType` within `packRadius`
  - [ ] If one is in CHASE/ATTACK state → trigger aggro on the same target

---

## Phase 6 — Mob Movement (`movement/mobMovement.js`)

- [ ] `applyMovement(mob, targetX, targetZ, deltaTime, blockAccess)`:
  - [ ] Compute direction vector toward target
  - [ ] Set `mob.yaw` to face movement direction (smoothly interpolated)
  - [ ] Compute velocity from direction × mob.definition.speed
  - [ ] Apply gravity if mob is ground-based (`velocity.y -= 25 * deltaTime`)
  - [ ] Collision resolution (X→Y→Z axis-separated AABB, same as `Player._moveAndCollide`)
  - [ ] Update `mob.onGround` flag
  - [ ] Clamp to world bounds (min Y)
- [ ] `applyFleeMovement(mob, threatPosition, deltaTime, blockAccess)`:
  - [ ] Direction = away from threat
  - [ ] Speed = mob.definition.fleeSpeed
  - [ ] Same collision resolution as above
- [ ] Flying movement (for Corrupt Wisp):
  - [ ] 3D direction toward target + height maintenance
  - [ ] No gravity — hover with gentle vertical oscillation
  - [ ] Float at consistent Y, weave side to side

---

## Phase 7 — Procedural 3D Model Builder (`rendering/mobModelBuilder.js`)

- [ ] `MobModelBuilder.build(mobDefinition) → THREE.Group`
  - [ ] Create empty `THREE.Group`
  - [ ] Iterate `geometry.parts` array, build each primitive:
    - [ ] `type: 'box'` → `new THREE.BoxGeometry(w, h, d)`
    - [ ] `type: 'sphere'` → `new THREE.SphereGeometry(radius, segs, segs)`
    - [ ] `type: 'cylinder'` → `new THREE.CylinderGeometry(rTop, rBot, h, segs)`
    - [ ] `type: 'cone'` → `new THREE.ConeGeometry(radius, height, segs)`
    - [ ] `type: 'capsule'` → `new THREE.CylinderGeometry(r, r, h) + 2 half-spheres`
  - [ ] Apply `MeshStandardMaterial` with `flatShading: true` (low-poly look)
  - [ ] Set `position`, `rotation`, `scale` from part definition
  - [ ] Name each mesh with its `id` for animation lookup
  - [ ] Add eye highlights as separate emissive `SphereGeometry` meshes
  - [ ] Store `group.userData.parts = { id → mesh }` for animation access
  - [ ] Store `group.userData.initialTransforms` (clone of all initial positions/rotations)
  - [ ] Enable `castShadow` and `receiveShadow` on all meshes
  - [ ] Return the assembled group

### Geometry Definition Examples per Mob Type

- [ ] **Deer geometry**:
  - Body: box(0.8, 0.5, 1.2) — elongated torso
  - Head: sphere(r=0.2) — small head on neck
  - Neck: cylinder(r=0.08, h=0.3) — connecting head to body
  - Legs: 4x cylinders (thin, tall) — FL, FR, BL, BR
  - Antlers: 2x cone pairs branching off head (if male)
  - Tail: small sphere at back
  - Eyes: 2x tiny emissive spheres (white)
  - Color: brown `0x8B6348`, belly lighter `0xC4A882`

- [ ] **Rabbit geometry**:
  - Body: sphere(r=0.25) — round, compact
  - Head: sphere(r=0.15) — attached to front
  - Ears: 2x boxes(0.05, 0.25, 0.1) — tall, pointing up
  - Legs: 4x small cylinders, back legs thicker (for hopping)
  - Tail: tiny sphere(r=0.04)
  - Eyes: 2x tiny spheres (black)
  - Color: `0xD2B48C` brown, belly `0xF5F5DC`

- [ ] **Corrupt Wolf geometry**:
  - Body: box(0.8, 0.55, 1.3) — muscular torso
  - Head: box(0.4, 0.35, 0.45) — angular snout
  - Snout: box(0.2, 0.12, 0.25) — protruding
  - Ears: 2x cones — pointed, tilted
  - Legs: 4x cylinders — FL, FR, BL, BR
  - Tail: cone — drooping
  - Eyes: emissive red spheres — `0xff2222`
  - Teeth: small white boxes in snout (optional detail)
  - Color: corrupted green `0x4a6741`, with dark stripes

- [ ] **Stone Golem geometry**:
  - Torso: box(1.2, 1.4, 0.9) — bulky
  - Head: sphere(r=0.5) — rounded boulder
  - Arms: 2x boxes(0.3, 0.8, 0.3) — thick
  - Legs: 2x cylinders(r=0.2, h=0.7) — pillar-like
  - Core: emissive sphere(r=0.15) in chest — `0xff6600`
  - Eyes: emissive orange spheres — `0xffaa00`
  - Color: various grays `0x5a5a5a` to `0x8a8a8a`, random crack details

- [ ] **Corrupt Wisp geometry** (flying):
  - Core: sphere(r=0.2) — bright center
  - Glow aura: larger transparent sphere(r=0.4) with `opacity: 0.3`, emissive purple
  - Trail particles (optional): small spheres trailing behind
  - Eyes: 2x tiny bright white points
  - Color: `0x8b00ff` purple core, `0xcc66ff` aura

---

## Phase 8 — Code-Generated Animation (`rendering/mobAnimator.js`)

- [ ] **`MobAnimator` class:**
  - [ ] On creation: store mob reference, render group, initial transforms
  - [ ] `update(deltaTime)` — main per-frame tick:
    - [ ] Track `animationTime` (accumulated)
    - [ ] Detect state changes → crossfade (0.15s blend between old/new pose)
    - [ ] Reset all parts to initial transforms at start of each frame
    - [ ] Dispatch to state-specific animation function
    - [ ] Apply global body bob (all states get subtle vertical oscillation)
    - [ ] Maintain mob yaw rotation on the root group

### Shared Animation Types (`rendering/animTypes/`)

- [ ] `walkCycle.js` — `walkCycle(group, time, speed, gait)`:
  - [ ] **Gait: trot** (default 4-leg) — diagonal leg pairs swing together
    - [ ] FL+BR swing forward while FR+BL swing back, alternating
    - [ ] Leg rotation on X axis: `Math.sin(time * speed) * legSwing`
  - [ ] **Gait: gallop** (fast, for chase) — same as trot but faster + more extreme angles
  - [ ] **Gait: stomp** (heavy, for golem) — each leg lifts high, stomps down with body drop
  - [ ] **2-leg walk** (future: humanoid mobs) — alternating left/right leg + arm swing
  - [ ] Body vertical bob: `Math.abs(Math.sin(time)) * bobAmount`
  - [ ] Head slight vertical bob to match gait
  - [ ] Tail sway (if tail exists)

- [ ] `hopCycle.js` — `hopCycle(group, time, speed)`:
  - [ ] Body compresses (z-scale) on takeoff, extends on landing
  - [ ] Vertical position: parabolic hop arc (not sin — looks wrong for hops)
  - [ ] Back legs tuck during hop, extend on landing
  - [ ] Ears flop (rotate on Z axis) during hop for rabbits

- [ ] `bodyLanguage.js` — shared idle subtleties:
  - [ ] `breathingIdle(group, time)` — body y-bob, gentle head sway
  - [ ] `twitchIdle(group, time)` — random ear flicks, nose twitch (by periodically rotating ear meshes + scaling snout z slightly)
  - [ ] `rockingIdle(group, time)` — slow body roll (z rotation), head pendulum sway
  - [ ] `hoverIdle(group, time)` — gentle figure-8 motion for flying mobs

- [ ] `attackAnim.js` — shared attack patterns:
  - [ ] `lungeAttack(group, time, duration)` — body lunges forward, head snaps down at midpoint (for wolf/bite attack)
  - [ ] `slamAttack(group, time, duration)` — arms raise then slam down, body drops (for golem)
  - [ ] `chargeAttack(group, time, duration)` — brief pause to wind up, then fast forward burst (for ramming mobs)

- [ ] `hurtAnim.js` — `hurtReaction(group, time, duration)`:
  - [ ] Brief red emissive flash on all meshes (sin wave, 4 cycles)
  - [ ] Body translation: push back (inverse of attack direction)
  - [ ] Subtle rotation: roll slightly on Z axis
  - [ ] Reset emissive to 0 after animation completes

- [ ] `deathAnim.js` — shared death sequences:
  - [ ] `collapseDeath(group, time, duration)` — rotate entire group 90° on X axis (fall sideways), fade opacity in last 50% of duration
  - [ ] `crumbleDeath(group, time, duration)` — scale oscillates (parts shrink at staggered rates), group sinks into ground
  - [ ] `dissolveDeath(group, time, duration)` — fade out with upward positional offset + particle-like scatter (for wisps/energy mobs)

### State Transition Crossfade

- [ ] On state change: snapshot old transforms, compute new, lerp all parts between them over 0.15s
- [ ] Store `transitionProgress` (0→1) and `previousState`
- [ ] In `update()`: if transitioning, blend old snapshot with current animation output

---

## Phase 9 — Mob Spawner (`mobManager.js`)

- [ ] **`MobManager` class:**
  - [ ] `mobs` — `Map<mobId, Mob>` of all active mobs
  - [ ] `renderer` — reference to `MobRenderer`
  - [ ] `mobCap` — 60 total mobs across render area
  - [ ] `mobsPerChunk` — max 8 mobs per loaded chunk
  - [ ] `spawnTimer` — runs every 2s, spread across ticks to avoid lag spikes

- [ ] **`spawnTick(playerPosition, chunkManager, biomeSystem)`**:
  - [ ] Get list of loaded chunk coordinates within render distance
  - [ ] For each chunk, count existing mobs in that area
  - [ ] If under cap and below `mobsPerChunk`:
    - [ ] Get biome at chunk center from `biomeSystem`
    - [ ] Build candidate list: all mobs whose `biomes` array includes this biome
    - [ ] Weighted random selection by `spawnWeight`
    - [ ] `findSpawnPosition(chunk, mobDef)`:
      - [ ] Pick random x,z within chunk bounds
      - [ ] Find surface Y from chunk data (first solid block scanning down)
      - [ ] Check light level at surface (if `spawnInDark`, require light < 7)
      - [ ] Check elevation within `spawnMinY`/`spawnMaxY`
      - [ ] Check no existing mob within 5-block radius of spawn point
      - [ ] Check solid ground below feet, air at head level
      - [ ] Try 5 positions max per chunk per tick; if all fail, skip
    - [ ] Instantiate `new Mob(mobType, position, worldSeed)`
    - [ ] Call `mobRenderer.addMob(mob)` → builds 3D model + adds to scene
    - [ ] Track in `this.mobs`

- [ ] **`update(deltaTime, playerPosition, blockAccess, otherMobs)`**:
  - [ ] Run spawn tick (on cooldown)
  - [ ] Update all mobs: `mob.update(deltaTime, blockAccess, playerPosition, allMobs)`
  - [ ] Update renderer: `mobRenderer.update(deltaTime)`
  - [ ] Check despawn: `distanceToPlayer > mob.definition.despawnDistance` → mark for removal

- [ ] **Mob removal pipeline:**
  - [ ] Death animation completes → remove from mobs map → remove from renderer → dispose Three.js resources
  - [ ] Despawn → immediately remove (no drops, no animation)

- [ ] **Day/night cycling:**
  - [ ] At dawn (light level ≥ 7), hostile mobs near player enter FLEE toward dark areas
  - [ ] Distant hostile mobs (beyond 64 blocks) despawn at dawn
  - [ ] Passive mobs don't spawn at night (light level < 7)

- [ ] **Mob count debugging** (expose via console):
  - [ ] `mobManager.getStats()` — total count, per-type count, per-biome count

---

## Phase 10 — Mob Drops (`drops/mobDropTable.js`)

- [ ] `rollDropTable(drops, seed) → [{typeId, count}]`:
  - [ ] For each entry in the drops array:
    - [ ] Generate random 0–99
    - [ ] If random < weight → item drops
    - [ ] `count = randomInt(minCount, maxCount)`
    - [ ] If `typeId` is a string → named item; if number → block type
  - [ ] Returns array of item objects

- [ ] **Drop entity rendering** (optional, or just add directly to inventory):
  - [ ] When mob dies, spawn small floating item icons at death position
  - [ ] Player walks within 2 blocks → auto-loot into inventory
  - [ ] Unlooted items despawn after 30 seconds
  - [ *Simpler alternative*: just add drops directly to player inventory on kill* ]

- [ ] **Experience orbs** (for future XP system):
  - [ ] Spawn small glowing orbs equal to `mob.definition.experience`
  - [ ] Float toward player within 4 blocks
  - [ ] Track total XP (future use: enchanting, level gates)

---

## Phase 11 — Combat Integration

### 11a. Player Attacks Mobs

- [ ] In `src/game/systems/BlockInteractionSystem.js` or `src/main.js`:
  - [ ] On left-click (or touch tap), after block raycast, also raycast against mob AABBs
  - [ ] `getMobsInRay(origin, direction, maxDist)`:
    - [ ] Iterate all active mobs within maxDist
    - [ ] Test ray-AABB intersection for each mob's hitbox
    - [ ] Return closest hit (mobId, distance, hitPoint)
  - [ ] If mob hit is closer than block hit → target is mob, not block
  - [ ] Calculate damage:
    - [ ] Base: 2 (fist)
    - [ ] If holding weapon: `NAMED_ITEMS[itemType].damage` or 0 if not a weapon
  - [ ] Call `mob.takeDamage(damage, 'player_attack')`
  - [ ] Apply knockback: `mob.knockback(kx, kz)` based on player facing direction
  - [ ] Play attack animation on player's first-person hand

### 11b. Mobs Attack Players

- [ ] In `MobAI._stateAttack()`:
  - [ ] Call `player.takeDamage(mob.definition.damage, DAMAGE_SOURCES.MOB)`
  - [ ] Actually, route through `survivalSystem.takeDamage(amount, DAMAGE_SOURCES.MOB)`
  - [ ] Apply knockback to player: `player.velocity.x += kx; player.velocity.z += kz`
  - [ ] Trigger `DamageFlashEffect` (existing system handles the screen flash)
  - [ ] Set attack cooldown: `this.attackCooldownTimer = 1 / mob.definition.attackSpeed`

### 11c. Armor Calculation

- [ ] In `survival.js` or a new `combat.js`:
  - [ ] `calculateArmorReduction(damage, equippedArmor) → number`
  - [ ] Sum `armorValue` from all equipped armor pieces (helmet, chestplate, leggings, boots)
  - [ ] Formula: `reduced = damage * (1 - Math.min(0.8, totalArmor / 30))`
  - [ ] Apply before passing damage to `takeDamage()`

### 11d. Death & Loot

- [ ] On `mob.isDead === true`:
  - [ ] Call `mob.getDropItems()`
  - [ ] For each item, call `player.inventory.addItem(typeId, count)`
  - [ ] If inventory full, drop items on ground as floating entities
  - [ ] Fire `onMobKilled(mobType)` event for quest system listening

---

## Phase 12 — Scene Integration (`rendering/mobRenderer.js`)

- [ ] `MobRenderer(scene, mobManager)`:
  - [ ] `renderObjects` — `Map<mobId, { group, animator }>`
  - [ ] `addMob(mob)` — call `MobModelBuilder.build(mob.definition)`, create `MobAnimator`, add group to scene
  - [ ] `removeMob(mobId)` — remove group from scene, dispose geometry + materials
  - [ ] `update(deltaTime)`:
    - [ ] For each mob, sync position/yaw from mob data model to THREE.Group
    - [ ] Call `animator.update(deltaTime)`
    - [ ] Remove entries for dead/despawned mobs when their death animation finishes
  - [ ] `clear()` — remove all mob groups from scene (world unload)

---

## Phase 13 — Game Loop Integration

### 13a. In `src/core/Game.js`

- [ ] Add `this.mobManager = null` in constructor
- [ ] Add `initMobs(world, renderer)` method:
  - [ ] Create `MobManager`, pass world seed
  - [ ] Create `MobRenderer(scene, mobManager)`
  - [ ] Wire references
- [ ] In main update loop: `this.mobManager.update(deltaTime, playerPos, chunkManager)`

### 13b. In `src/main.js`

- [ ] After chunk system is initialized and world is ready:
  - [ ] `game.initMobs(chunkManager, voxelRenderer)`
- [ ] On world unload (player goes back to menu):
  - [ ] `mobRenderer.clear()` — remove all 3D objects from scene
  - [ ] `mobManager.clear()` — clear all mob data

---

## Phase 14 — Multiplayer Sync (`multiplayer/mobSync.js`) *[deferred]*

- [ ] Host is authoritative for mob simulation
- [ ] Host sends delta state every 100ms: `{ mobId, x, y, z, yaw, state, health }`
- [ ] Clients interpolate between received states
- [ ] Client sends attack intent → host resolves damage → broadcasts result
- [ ] Mob drops are deterministic (seeded by spawn time + position)
- [ ] Mob spawning only happens on host; clients receive spawn/despawn events

---

## Phase 15 — Persistence

- [x] **INTENTIONALLY SKIPPED** — Mobs are regenerated fresh by the spawn system on every world load.
- [x] `serialize()`/`deserialize()` exist on the `Mob` class as utility methods but are **never called**.
- [x] The spawn system (`mobManager._spawnTick`) handles all mob population dynamically.
- [x] This avoids stale mob state, desync between saved positions and chunk geometry, and the complexity of saving/loading ~60 mobs per world.

---

## Phase 16 — Polish & Balance

- [ ] **Mob sound effects** integration with `src/engine/audio/SFX.js`:
  - [ ] Per-mob sounds: idle, hurt, death, attack
  - [ ] Positional audio (proximity-based volume)
  - [ ] Ambient mob sounds at distance (chirps, growls, rustles)

- [ ] **Mob HUD indicators**:
  - [ ] Health bar above mob (small) when damaged
  - [ ] Aggro indicator (exclamation mark) when mob first notices player
  - [ ] Damage numbers floating on hit (optional)

- [ ] **Mob cap tuning**:
  - [ ] `mobManager.getPerformanceReport()` — CPU time per tick, render count
  - [ ] Adjust `mobsPerChunk` and total `mobCap` based on frame budget

- [ ] **Despawn visuals**:
  - [ ] Mobs don't pop — they fade out over 0.5s when despawning
  - [ ] Death animation always plays (can't skip by walking away)

- [ ] **Quest integration**:
  - [ ] `QUEST_TYPES.KILL` — track mob kills per quest
  - [ ] Boss system already exists in `src/game/entities/Boss.js` — mob system does not duplicate it

---

## Appendix A: Mob Definition Template

```js
mobTypeKey: {
  name: 'Display Name',
  category: 'passive' | 'hostile',

  // ── Stats ──
  health: 20,
  damage: 0,           // 0 for passive mobs
  attackSpeed: 0,      // attacks per second (0 for passive)
  knockback: 0,        // blocks knocked back on hit (0 for passive)
  speed: 4.5,
  fleeSpeed: 7.0,      // only for passive
  hitbox: { width: 0.8, height: 1.2 },

  // ── Spawning ──
  biomes: ['plains', 'forest'],
  spawnWeight: 30,
  spawnInDark: false,
  spawnMinY: 62,
  spawnMaxY: 80,
  despawnDistance: 128,
  leashDistance: 48,    // max wander distance from spawn point
  experience: 3,

  // ── Behavior ──
  behavior: 'wander_flee' | 'aggressive',
  ai: {
    aggroRange: 20,
    attackRange: 1.5,
    attackCooldown: 1.2,
    loseInterestRange: 40,
    senseRange: 20,
    packAggro: true,
    packRadius: 10,
  },

  // ── Drops ──
  drops: [
    { item: 'leather', minCount: 0, maxCount: 2, weight: 70 },
  ],

  // ── 3D Model (procedural geometry) ──
  geometry: {
    material: { roughness: 0.7, metalness: 0.0 },
    parts: [
      { type: 'box', id: 'body',
        size: [0.8, 0.5, 1.2],
        position: [0, 0.3, 0],
        color: 0x8B6348,
      },
      // ... more parts ...
    ],
    eyes: {
      color: 0xffffff, size: 0.06,
      positions: [[-0.12, 0.5, 0.7], [0.12, 0.5, 0.7]],
    },
  },

  // ── Animations ──
  animations: {
    idle:   { speed: 1.0, type: 'breathing' },
    wander: { speed: 0.8, type: 'walk', gait: 'trot' },
    chase:  { speed: 1.5, type: 'walk', gait: 'gallop' },
    attack: { speed: 2.0, type: 'custom', function: 'lungeAttack', duration: 0.3 },
    hurt:   { speed: 1.0, type: 'custom', function: 'hurtReaction', duration: 0.25 },
    flee:   { speed: 1.8, type: 'walk', gait: 'gallop' },
    dead:   { speed: 1.0, type: 'custom', function: 'collapseDeath', duration: 1.0 },
  },
}
```

---

## Appendix B: File Dependency Graph

```
mobDefinitions.js          ← stand-alone (includes geometry + animation defs)
       │
       ▼
mob.js                     ← depends on mobDefinitions.js
       │
       ├──▶ ai/mobSenses.js    ← depends on mob.js
       ├──▶ ai/mobAI.js        ← depends on mob.js, mobSenses.js
       ├──▶ ai/pathfinding.js  ← depends on chunkmanager.js (block access)
       ├──▶ movement/mobMovement.js ← depends on mob.js, pathfinding.js
       │
       ▼
mobManager.js              ← depends on mob.js, mobAI.js, mobMovement.js
       │
       ├──▶ drops/mobDropTable.js ← depends on inventory.js (NAMED_ITEMS)
       │
       │        rendering/
       │            ├── animTypes/walkCycle.js
       │            ├── animTypes/hopCycle.js
       │            ├── animTypes/bodyLanguage.js
       │            ├── animTypes/attackAnim.js
       │            ├── animTypes/deathAnim.js
       │            └── animTypes/hurtAnim.js
       │                      │
       │                      ▼
       ├──▶ rendering/mobAnimator.js  ← depends on all animTypes
       ├──▶ rendering/mobModelBuilder.js  ← depends on THREE
       │
       ▼
rendering/mobRenderer.js   ← depends on mobModelBuilder, mobAnimator, mobManager
       │
       ▼
game.js                    ← wires mobManager + mobRenderer into game loop
main.js                    ← initializes everything
```

---

## Appendix C: Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Procedural 3D geometry** (not sprites) | Each mob type has a unique, recognizable silhouette that fits the voxel aesthetic. Low-poly with `flatShading: true`. |
| **Code-generated animations** (not keyframes) | No external animation files. Animations are functions of time that transform mesh parts — cheap, deterministic, and easy to tune. |
| **Two-tier pathfinding** | Direct chase handles 90% of cases (cheap). A* only when stuck (limited to 64 nodes). No per-frame navmesh rebuild. |
| **Weighted drop tables** | Each entry rolls independently — flexible loot without complex logic. Seeded by spawn time for deterministic multiplayer. |
| **Mob cap per chunk** | Prevents clustering. 8 per chunk, 60 total. Spreads mobs naturally across the world. |
| **No bone rig / skinning** | Simpler than skeletal animation. Each part (leg, head, tail) is an independent mesh in a group. Animations translate/rotate them directly. |
| **Hostile mobs despawn at dawn** | Keeps the world from being overrun. They flee to caves if near the player, despawn if distant. |
| **Drops added directly to inventory** | Simpler than floating item entities for V1. Can add fancy drop entities later. |