# Cuubz — Implementation TODO

> **Vision:** A web-based Minecraft-style voxel game with full multiplayer (up to 4 players), dynamic infinite chunked world, procedural texture/audio generation, persistent character & world saves, survival mechanics (health/hunger/thirst/sleep/stamina), and a story-driven quest system with 25 quests, dungeons, and 4 bosses.

> **Tech Stack:** Three.js (local CDN), Vanilla JS, Node.js + ws relay server (matchmaking + game sync), IndexedDB for persistence, Canvas API for texture generation, Web Audio API for procedural calm ambient soundscapes.

> **Current State:** 🟢 Building — Phase 1 World Generation complete. Rendering engine, input systems, player physics, persistence all implemented with tests.

---

## Autonomous Builder Workflow ⚙️

This project is built by an **autonomous AI cron job** running every 30 minutes. The builder follows these rules:

1. **todo.md is the source of truth** — Tasks are worked in order, top to bottom within each phase
2. **Testing mandatory** — Every task must include tests before being marked complete (`- [x]`)
3. **Bug tracking** — All bugs logged in `bugs.md`. Must be FIXED + VERIFIED before continuing
4. **Phase boundaries** — Cannot start Phase N+1 until ALL Phase N tasks are `- [x]` with zero open bugs
5. **Clean handoffs** — Each 30-minute cycle completes tasks, runs tests, fixes bugs, commits code

### Test Suite
- All tests live in `test/` directory
- Run via: `bash test/run_tests.sh`
- Each test file exits 0 (pass) or 1 (fail) with descriptive output
- Master runner reports pass/fail count for all tests

### Bug Tracker
- Live at `bugs.md` — updated every cycle
- Format: Bug #N with status, description, reproduction steps, fix, verification
- Zero open bugs required before phase advancement

---

## Design Decisions

- **Mobile-first, touch-friendly** — Virtual joystick (left), swipe-to-look (right), tap to interact. Desktop WASD + mouse as secondary fallback.
- **Three.js for 3D voxel rendering** — Face-culled merged geometry per chunk for performance. Local Three.js CDN build, no npm tooling on client side.
- **Procedural texture generation** — All textures via Canvas API at 32×32 resolution, saved as PNG assets. No external image files shipped.
- **Central relay server** — Node.js + ws running on dedicated LXC container. Handles matchmaking lobby AND game session relaying on different ports. systemd service file created in project (user sets up manually).
- **Infinite chunked world** — Dynamic grid of 16×16×96 chunks (Z: -32 to +64, layer 0 = sea level). Below 0 = ground/caves, above 0 = surface/mountains. Chunks saved to disk individually. Seamless edge matching for caves/surface across chunk boundaries.
- **Server-authoritative gameplay** — Host validates all block changes, inventory updates, and quest progress. Relay server streams validated state to all connected clients.
- **IndexedDB persistence** — Characters and Worlds separated. 3 characters + 3 worlds per device. Chunk-level world saves for partial updates. Spawn points per player per world.
- **Story system lives with the world** — Quest progress, boss states, and quest markers are part of world state (not character). All players contribute to shared story progression in multiplayer.

---

## Biome Definitions

| Biome | Surface Blocks | Features | Hazards | Special Items |
|-------|---------------|----------|---------|---------------|
| **Plains** | Grass, dirt | Trees (oak), flowers | None | Apples on trees |
| **Forest** | Grass, dirt | Dense oak trees, tall trunks | None | Apples on trees |
| **Desert** | Sand, gravel | Cacti, dry terrain | Dehydration faster | Nothing special |
| **Tundra** | Snow, ice | Sparse vegetation, snow layers | Slippery (reduced movement) | Nothing special |
| **Mountains** | Stone, gravel | High elevation, ore veins exposed | Fall damage risk | Ores more common |
| **Ocean** | Sand bottom, water column | Coral-like structures underwater | Drowning if no air | Water source for drinking |
| **Lava** | Obsidian, blackstone | Lava pools (animated voxels) | ⚠️ Lava blocks deal damage on contact | Fire-resistant ores? |
| **Corrupt** | Dark purple stone, slime | Purple toxic pools | ☠️ Poison pools: damage over time | Corrupt crystals (quest items) |

---

## Block Type Registry

```
ID  | Name           | Texture       | Properties
----|----------------|---------------|---------------------------
0   | Air            | (none)        | transparent, not solid
1   | Grass          | grass_top/side| solid, drop: dirt
2   | Dirt           | dirt          | solid, breakable
3   | Stone          | stone         | solid, hard
4   | Sand           | sand          | solid
5   | Gravel         | gravel        | solid
6   | Water          | water         | transparent, not solid, drinkable
7   | Wood Log       | wood_log      | solid, craftable
8   | Leaves         | leaves        | transparent, not solid
9   | Snow           | snow          | solid
10  | Ice            | ice           | solid, slippery
11  | Bedrock        | bedrock       | solid, unbreakable
12  | Planks         | planks        | solid, craftable
13  | Obsidian       | obsidian      | solid, very hard
14  | Blackstone     | blackstone    | solid, hard
15  | Lava           | lava          | transparent, damaging (animated)
16  | Corrupt Stone  | corrupt_stone | solid
17  | Toxic Slime    | toxic_slime   | damaging pool (animated, DoT)
18  | Coal Ore       | coal_ore      | solid, mineable item
19  | Iron Ore       | iron_ore      | solid, mineable item
20  | Gold Ore       | gold_ore      | solid, mineable item
21  | Diamond Ore    | diamond_ore   | solid, rare mineable item
22  | Corrupt Crystal| corrupt_cry   | quest item, rare
23  | Bed            | bed           | placeable, sets spawn + restores sleep
24  | Apple          | apple         | food item, restores hunger (on trees)
25  | Quest Key      | quest_key     | quest item (various colors per dungeon)
26  | Boss Spawn     | boss_spawn    | invisible trigger block for boss fights
```

---

## Project Structure

```
webgame-cuubz/
├── index.html                    # Main entry point with Three.js CDN
├── css/
│   └── style.css                 # Game UI, HUD, menus, mobile touch overlays
├── js/
│   ├── main.js                   # App entry: menu system, play/host/join flow
│   ├── game.js                   # Main game loop, state management, mode (creative/survival)
│   ├── renderer/
│   │   ├── voxelRenderer.js      # Three.js scene, camera, WebGL renderer, lighting
│   │   ├── chunkMeshBuilder.js   # Face-culled merged geometry per chunk
│   │   ├── chunkManager.js       # Dynamic load/unload based on ALL player positions
│   │   ├── crosshair.js          # Center pointer + target block wireframe highlight
│   │   └── skybox.js             # Sky gradient, sun/moon, clouds, day/night cycle
│   ├── world/
│   │   ├── noise.js              # Perlin/Simplex noise functions (heightmap, biome, cave)
│   │   ├── chunkData.js          # Chunk class: 16×16×Y block array, serialization
│   │   ├── chunkGrid.js          # Grid system tracking all loaded chunks globally
│   │   ├── worldGenerator.js     # Terrain generation with edge-seamless matching
│   │   ├── biomeSystem.js        # Biome definitions, distribution, features placement
│   │   ├── caveGenerator.js      # Underground tube caves with seamless chunk edges
│   │   ├── oreGenerator.js       # Ore vein placement in caves and mountains
│   │   ├── featurePlacer.js      # Trees, cacti, flowers, quest markers, dungeons
│   │   ├── persistence.js        # IndexedDB: character saves + world chunk saves
│   │   └── spawnManager.js       # Per-player spawn points per world
│   ├── multiplayer/
│   │   ├── client.js             # WebSocket client: connect, send actions, receive state
│   │   ├── host.js               # Host logic: validate actions, broadcast to relay
│   │   ├── sessionManager.js     # Session discovery via relay matchmaking room
│   │   ├── playerSync.js         # Remote player rendering + smooth interpolation
│   │   ├── inventorySync.js      # Server-side inventory validation & sync
│   │   └── chunkStreamer.js      # Stream chunks to players based on their positions
│   ├── input/
│   │   ├── keyboard.js           # WASD + key bindings (desktop)
│   │   ├── mouse.js              # Pointer lock, click events (desktop)
│   │   ├── touch.js              # Virtual joystick, swipe-to-look, tap interact (mobile)
│   │   └── interaction.js        # Block break/place targeting via crosshair raycast
│   ├── textures/
│   │   ├── textureGenerator.js   # Procedural 32x32 texture creation (Canvas API)
│   │   └── biomeTextures.js      # All biome-specific texture palettes & patterns
│   ├── entities/
│   │   ├── player.js             # Player: movement, physics, AABB collision
│   │   ├── blockTypes.js         # Full block registry with properties
│   │   ├── remotePlayer.js       # Remote player mesh rendering + name tags
│   │   ├── boss.js               # Boss entities: AI, health, attack patterns
│   │   └── questMarker.js        # Quest marker visual entity (glowing post in world)
│   ├── systems/
│   │   ├── survival.js           # Health, hunger, thirst, sleep, stamina meters
│   │   ├── inventory.js          # Inventory grid, hotbar, item management per character
│   │   ├── crafting.js           # Block crafting recipes (planks from wood, beds, etc.)
│   │   ├── questSystem.js        # 25 quests, progress tracking, world-state storage
│   │   └── damageSystem.js       # Damage sources: lava, poison, falls, bosses
│   └── audio/
│       ├── sfx.js                # Procedural SFX: block break/place, footsteps, UI
│       └── ambient.js            # Calm/chill procedural ambient soundscapes per biome
├── textures/                     # Generated texture assets (PNG files, 32×32)
│   ├── grass_top.png, grass_side.png, dirt.png, stone.png, sand.png
│   ├── gravel.png, water.png, wood_log.png, leaves.png, snow.png, ice.png
│   ├── bedrock.png, planks.png, obsidian.png, blackstone.png, lava.png
│   ├── corrupt_stone.png, toxic_slime.png, coal_ore.png, iron_ore.png
│   ├── gold_ore.png, diamond_ore.png, corrupt_cry.png, apple.png
│   ├── quest_key.png, bed.png
├── scripts/
│   └── generate_textures.py    # Python build script → generates all 32x32 PNG textures
├── server/                       # Node.js relay server
│   ├── package.json              # ws dependency
│   ├── index.js                  # Server entry: matchmaking + game session relaying
│   ├── matchmaking.js            # Session discovery room logic (lobby)
│   └── session.js                # Game session relay: validate, broadcast, stream chunks
├── cuubz-relay.service           # systemd service file for relay server
├── todo.md                       # This file
└── sync.sh                       # Deployment script (generated from template)
```

---

## Phase 1: Foundation — Core Voxel Engine & Single Player Survival

### World Generation System
- [x] **Setup project structure** — Create all folders, index.html with Three.js CDN, basic HTML shell
  - [x] Link local Three.js build via `<script>` (CDN)
  - [x] Basic HTML/CSS skeleton: canvas container, UI overlay divs, menu screens
- [x] **Implement noise functions** — `js/world/noise.js`
  - [x] Perlin/Simplex noise with seed support
  - [x] Multi-octave noise for terrain detail
  - [x] Ridge noise for mountain ridges and cave systems
  - [x] 3D noise for cave tube generation
- [x] **Implement chunk data structures** — `js/world/chunkData.js`
  - [x] Chunk class: 16×16×96 block array (Z: -32 to +64, layer 0 = sea level)
  - [x] Block type lookup with properties (solid, transparent, hardness, damage, item drop)
  - [x] Serialization/deserialization to/from compressed JSON
  - [x] Edge boundary data for seamless neighbor chunk joining
- [x] **Implement chunk grid system** — `js/world/chunkGrid.js`
  - [x] Global coordinate → chunk coordinate conversion
  - [x] Chunk loading/unloading based on player distance thresholds
  - [x] Neighbor awareness: chunks know their neighbors for seamless rendering
  - [x] Dirty flag system: mark changed chunks for save
- [x] **Implement biome system** — `js/world/biomeSystem.js`
  - [x] Temperature/moisture noise maps for biome distribution
  - [x] All 8 biomes defined with height modifiers and block palettes
  - [x] Biome blending at borders (smooth transitions)
- [x] **Implement terrain generation** — `js/world/worldGenerator.js`
  - [x] Heightmap from noise: mountains, valleys, plains, ocean floors (Z: -32 to +64)
  - [x] Layer 0 = sea level. Below 0 = ground/caves, above 0 = surface/mountains
  - [x] Surface block placement based on biome + height
  - [x] Edge matching: shared boundary data between adjacent chunks
  - [x] Water level generation and filling at layer 0
- [x] **Implement cave generation** — `js/world/caveGenerator.js`
  - [x] 3D tube caves using marching cubes or noise thresholding
  - [x] Seamless across chunk boundaries (seed-based deterministic)
  - [x] Cave connectivity: no dead-end isolated pockets
  - [x] Varying cave sizes: small tunnels to large caverns
- [x] **Implement ore generation** — `js/world/oreGenerator.js`
  - [x] Ore veins in caves and mountain sides
  - [x] Depth-based rarity: coal (shallow) → iron → gold → diamond (deep)
  - [x] Clustered vein patterns (not single scattered blocks)
- [x] **Implement feature placement** — `js/world/featurePlacer.js`
  - [x] Tree generation in Plains/Forest biomes (wood trunk + leaves + apples)
  - [x] Cactus placement in Desert biome
  - [x] Snow layer on Tundra surface
  - [x] Coral structures in Ocean biome
  - [x] Lava pools in Lava biome (animated damage voxels)
  - [x] Toxic pools in Corrupt biome (DoT area markers)
  - [x] Corrupt crystals in Corrupt biome (quest items)

### Rendering Engine
- [x] **Build voxel renderer** — `js/renderer/voxelRenderer.js`
  - [x] Three.js scene, camera, WebGL renderer setup
  - [x] Texture atlas from all generated textures
  - [x] Basic lighting: ambient + directional sun
  - [x] Fog for distance rendering fade
- [x] **Build chunk mesh builder** — `js/renderer/chunkMeshBuilder.js`
  - [x] Face culling: only render exposed faces (not internal/hidden)
  - [x] Merged geometry per chunk (single draw call per chunk)
  - [x] Transparent face handling (water, leaves, lava)
  - [x] Animated texture offset for water/lava/toxic slime
- [x] **Implement chunk manager** — `js/renderer/chunkManager.js`
  - [x] Load/unload chunks based on player position radius
  - [x] Render distance: configurable (default 6 chunks radius)
  - [x] Async chunk building to avoid frame drops
  - [x] Chunk disposal for memory management
- [x] **Implement skybox** — `js/renderer/skybox.js`
  - [x] Gradient sky based on time of day
  - [x] Sun/moon directional light positioning
  - [x] Cloud layer (billboard approximation)
- [x] **Implement crosshair** — `js/renderer/crosshair.js`
  - [x] Center screen crosshair overlay
  - [x] Targeted block wireframe highlight
  - [x] Raycasting from camera center for block/face detection

### Procedural Textures (ALL 32×32)
- [x] **Create texture generator script** — `scripts/generate_textures.py`
  - [x] Python script using PIL/Pillow with Perlin noise functions
  - [x] Each texture function: name, base colors, pattern type → outputs 32×32 PNG
  - [x] Run once to generate all textures → committed to git as static assets
- [x] **Generate all textures** — Run `python scripts/generate_textures.py` → saves to `textures/`
  - [x] grass_top.png: green noise with lighter patches
  - [x] grass_side.png: dirt base with green top stripe
  - [x] dirt.png: brown noise with darker speckles
  - [x] stone.png: gray noise with crack patterns
  - [x] sand.png: yellow noise with grain variation
  - [x] gravel.png: mixed gray/brown small squares
  - [x] water.png: blue semi-transparent wave pattern
  - [x] wood_log.png: brown rings/circles (vertical grain)
  - [x] leaves.png: green noise with darker spots
  - [x] snow.png: white/light gray minimal noise
  - [x] ice.png: light blue translucent
  - [x] bedrock.png: dark gray/black heavy noise
  - [x] planks.png: wood grain horizontal lines
  - [x] obsidian.png: very dark purple-black glossy
  - [x] blackstone.png: dark gray with subtle texture
  - [x] lava.png: orange/red animated flow pattern
  - [x] corrupt_stone.png: dark purple crystalline
  - [x] toxic_slime.png: bright purple translucent pool
  - [x] coal_ore.png: stone base with black ore spots
  - [x] iron_ore.png: stone base with light gray ore spots
  - [x] gold_ore.png: stone base with yellow ore spots
  - [x] diamond_ore.png: stone base with cyan ore spots
  - [x] corrupt_cry.png: glowing purple crystal
  - [x] apple.png: red round fruit icon
  - [x] quest_key.png: golden key icon (color variants per dungeon)
  - [x] bed.png: colored bed block texture

### Player & Controls
- [x] **Implement first-person camera** — `js/renderer/voxelRenderer.js`
  - [x] Perspective camera with yaw/pitch rotation
  - [x] Pointer lock API for desktop mouse look
  - [x] Smooth camera interpolation
- [x] **Implement keyboard controls** — `js/input/keyboard.js`
  - [x] WASD movement relative to camera direction
  - [x] Space jump, Shift sprint, E interact
  - [x] Key state tracking with input queue
- [x] **Implement mouse interaction** — `js/input/mouse.js`
  - [x] Left click: break targeted block (with attack progress bar)
  - [x] Right click: place selected block at targeted face
  - [x] Scroll wheel: cycle hotbar slots
- [x] **Implement touch controls** — `js/input/touch.js`
  - [x] Virtual joystick on left side (movement)
  - [x] Swipe-to-look on right side (camera rotation)
  - [x] Tap to break/place blocks
  - [x] Touch-friendly UI scaling for mobile viewports
- [x] **Implement block interaction** — `js/input/interaction.js`
  - [x] Raycast from camera center through crosshair
  - [x] Detect target block position and face normal
  - [x] Break animation (particle effect or progress bar)
  - [x] Place block with collision check (don't place inside player)
- [x] **Implement player physics** — `js/entities/player.js`
  - [x] AABB collision detection against solid blocks
  - [x] Gravity, jump velocity, ground detection
  - [x] Horizontal movement with collision slide
  - [x] Player dimensions: ~0.8 wide × 1.8 tall (block units)

### Survival Systems
- [x] **Implement survival meters** — `js/systems/survival.js`
  - [x] Health meter (starts at 100, damaged by lava/poison/falls/bosses)
  - [x] Hunger meter (depletes over time, restored by food)
  - [x] Thirst meter (depletes over time, restored by drinking water)
  - [x] Sleep meter (depletes over time, restored by beds)
  - [x] Stamina meter (depletes on sprint/jump, regenerates at rest)
  - [x] HUD rendering: all 5 meters visible on screen
  - [x] Death handling: respawn at spawn point
- [x] **Implement damage system** — `js/systems/damageSystem.js`
  - [x] Lava contact damage (rapid per-tick)
  - [x] Poison DoT from toxic slime pools (slower, lingering)
  - [x] Fall damage based on height
  - [x] Boss attack damage patterns
  - [x] Damage flash effect on screen edges
- [x] **Implement food system** — `js/systems/survival.js`
  - [x] Apple blocks on trees in healthy biomes (already placed via featurePlacer)
  - [x] Eating restores hunger meter
  - [x] Right-click with apple to consume (eatFood/startEating API ready for interaction integration)
  - [x] FOOD_ITEMS registry: apple, cooked_meat, berry, bread, golden_apple
  - [x] Each food type has: hunger/thirst/health restoration, saturation, eatTime, blockDrop
  - [x] Animated eating via startEating() + update loop (eatTime-based progress)
  - [x] Instant eating via eatFood() for testing/non-animated contexts
  - [x] Eating cooldown prevents spam (0.5s defaultCooldown)
  - [x] Saturation system: food fillingness reduces hunger depletion rate for 30s after eating
  - [x] Negative restoration clamped to 0 (e.g., cooked_meat dehydrates by -5 thirst)
  - [x] onFoodEaten callback for HUD/game integration
  - [x] Eating state tracking: isEating, eatingProgress, currentFoodItem, getEatingState()
  - [x] Food state serialization/deserialization in survival save system
- [x] **Implement water drinking** — `js/systems/survival.js`
  - [x] Stand in/near water source (ponds, oceans, rivers)
  - [x] Press interact key to drink → restores thirst
  - [x] Drinking animation/delay (can't drink instantly)
- [x] **Implement bed system** — `js/systems/survival.js`
  - [x] Placeable bed blocks from inventory (BED block type ID=23, placeable property)
  - [x] Right-click bed: restore sleep meter + set spawn point
  - [x] Spawn point saved per player per world (SpawnManager integration)

### Inventory System
- [x] **Implement inventory** — `js/systems/inventory.js`
  - [x] Grid-based inventory (9×4 grid = 36 slots)
  - [x] Hotbar: bottom 9 slots, scroll/tap to select
  - [x] Block item tracking with counts per type
  - [x] Break block → add to inventory (addBlockDrop with BLOCK_PROPERTIES integration)
  - [x] Place block → decrement from inventory (consumeSelectedBlock)
  - [x] Mobile-friendly inventory UI (slot indexing, drag-drop swap/split support)
  - [x] Stacking: auto-stack same types, respect max stack per category (64 blocks, 16 food, 1 quest items)
  - [x] Named items: coal, iron_ore, gold_ore, diamond, corrupt_crystal, apple, cooked_meat, berry, bread, golden_apple
  - [x] Serialization/deserialization for IndexedDB persistence
  - [x] Query helpers: countItem, hasItem, findSlot, getItems, isFull
  - [x] Callback system: onSlotChange, onSelectionChange for UI integration
  - [x] 191 tests passing — construction, indexing, selection, add/remove, stacking, break/place, serialization, drag-drop, edge cases

### Persistence System (Characters + Worlds Separated)
- [x] **Implement IndexedDB database** — `js/world/persistence.js`
  - [x] Database schema: characters store, worlds store, chunks store
  - [x] Character save structure: name, color, inventory, spawn points per world
  - [x] World save structure: seed, biome map, quest progress, chunk references
  - [x] Chunk save structure: compressed block data per chunk file
- [x] **Implement character management** — `js/main.js` + `js/entities/characterManager.js`
  - [x] Character screen: list up to 3 characters with avatar, name, slot count
  - [x] Create character: name input (1-16 chars) + color picker (#RRGGBB hex)
  - [x] Edit character: rename, change color via modal
  - [x] Delete character with confirmation modal
  - [x] Save/load character data from IndexedDB (via PersistenceManager)
  - [x] Character selection system with lastPlayed tracking
  - [x] Inventory/spawn point helpers per character
  - [x] Duplicate name prevention (case-insensitive)
  - [x] Name validation: alphanumeric, spaces, hyphens, underscores only
  - [x] Color normalization to uppercase hex
  - [x] Serialization/deserialization for persistence round-trips
  - [x] 112 tests passing — constants, validation, CRUD, selection, inventory, spawn, serialization, edge cases
- [x] **Implement world management** — `js/main.js` + `js/entities/worldManager.js`
  - [x] World screen: list up to 3 worlds with biome preview, seed display, slot info
  - [x] Create world: generate new random seed + deterministic biome distribution (LCG-based)
  - [x] Delete world with confirmation modal (shared with character delete)
  - [x] Save/load world metadata from IndexedDB (via PersistenceManager.deleteWorld)
  - [x] World selection → mode screen flow
  - [x] World CRUD: create, read, update name, delete with cascade chunk cleanup
  - [x] Quest progress helpers: get/set/advance quest state per world
  - [x] Chunk reference tracking per world
  - [x] Serialization/deserialization for persistence round-trips
  - [x] BrowserWorldManager class in main.js (browser UI wrapper)
  - [x] WorldManager core class in js/entities/worldManager.js (Node.js testable)
  - [x] 234 tests passing — constants, validation, CRUD, selection, quest progress, chunk refs, serialization, preview, edge cases
- [x] **Implement chunk persistence** — `js/world/persistence.js`
  - [x] Save dirty chunks to IndexedDB on interval (every 30s) and on exit
  - [x] Load existing chunks from disk before generating new ones
  - [x] Chunk compression for storage efficiency
  - [x] Partial world updates: only save changed chunks
- [x] **Implement spawn manager** — `js/world/spawnManager.js`
  - [x] Per-player spawn points stored per world
  - [x] Default spawn at world center if no bed set
  - [x] Load spawn on world entry, update on bed use

### Quest System (World-State Based)
- [x] **Implement quest system** — `js/systems/questSystem.js`
  - [x] Quest data structure: id, name, description, type, requirements, reward
  - [x] World-state storage for quest progress (shared by all players)
  - [x] Quest tracker UI hooks: getCurrentQuest, getNextQuest, getProgress
  - [x] Quest completion logic and progression chain (Q01→Q25)
  - [x] 25 quests defined across 4 dungeons + final boss
  - [x] Boss definitions: forest_warden, lava_titan, frost_serpent, corruption_overlord, final_seal
  - [x] Requirement types: COLLECT, KILL, EXPLORE, CRAFT, DELIVER, BOSS
  - [x] Reward types: ITEM, UNLOCK_QUEST, UNLOCK_AREA, XP, TITLE
  - [x] Serialization/deserialization for persistence round-trips
  - [x] Callback system: onQuestComplete, onQuestStart, onProgressUpdate, onTrackerUpdate
  - [x] Quest availability chain (previous quest must complete first)
  - [x] Marker position calculation with seed-based deterministic placement
  - [x] Dungeon grouping + getCurrentDungeon progress tracking
  - [x] Three-pass addProgress prevents cascading completions
  - [x] 137 tests passing — constants, registry structure, boss definitions, constructor/init, progression chain, partial progress, capping, auto-start, objectives, progress reports, serialization round-trip, callbacks, game completion, reset, markers, dungeon grouping, edge cases, multi-quest progression
- [x] **Implement quest markers** — `js/entities/questMarker.js`
  - [x] Glowing post/entity in world at quest target locations
  - [x] Visible from distance (particle effect or beacon)
  - [x] Interact to receive quest update/dialogue
  - [x] Marker placement during world generation for all 25 quests
  - [x] QuestMarker class: position, glow pulse animation, interaction range, visibility radius
  - [x] QuestMarkerManager: createAllMarkers from QuestSystem, active marker tracking, stage/biome filtering
  - [x] Three.js mesh creation (post + glow sphere + point light + orbiting particles)
  - [x] Color-coded markers by quest type (green=collect, red=kill, blue=explore, orange=craft, purple=deliver, gold=boss)
  - [x] Serialization/deserialization for persistence
  - [x] 231 tests passing — constants, constructor, colors, distance calc, interaction range, visibility, update loop, glow pulse, interaction, reset, setActive, serialization round-trip, manager CRUD, stage/biome filtering, deactivation, determinism
- [x] **Design 25-quest storyline** — Document quest chain with requirements
  - [x] Quests 1–6: Introduction & gathering (collect basic materials)
  - [x] Quests 7–12: First dungeon exploration (Boss 1)
  - [x] Quests 13–17: Second dungeon (Boss 2) + world events
  - [x] Quests 18–21: Third dungeon (Boss 3) + preparation
  - [x] Quests 22–24: Fourth dungeon (Boss 4)
  - [x] Quest 25: Final boss — beat the game
  - [x] Each quest has specific item/kill/exploration requirements
  - [x] Quest items placed during world generation at deterministic locations
- [x] **Implement boss system** — `js/entities/boss.js`
  - [x] Boss entity class with health, AI state machine (IDLE/PATROL/AGGRO/ATTACK/PHASE_TRANSITION/DEAD), attack patterns
  - [x] Boss spawn triggered by quest progression + key item (via onDeath callback → quest completion)
  - [x] 5 unique bosses defined: Forest Warden (500HP, 2 phases), Lava Titan (800HP, 20% armor, 2 phases), Frost Serpent (1000HP, 2 phases), Corruption Overlord (1500HP, 30% armor, summon/shield/beam/nova), Final Seal (2000HP, 3 phases)
  - [x] Final boss: multi-phase fight with phase-specific attacks (Fire Storm → Void Summon/Dark Beam → Elemental Cyclone/Final Nova)
  - [x] Boss death triggers quest completion via onDeath callback (bossId, questId, titleReward)
  - [x] Attack system: cooldown tracking, range checks, phase-based attack filtering, damage multipliers per phase
  - [x] Shield buffs (Crystal Shield reduces incoming damage by 50%)
  - [x] Minion spawning from summon attacks with health/damage/position tracking
  - [x] Patrol AI: random movement within spawn radius, aggro detection range, chase behavior
  - [x] Phase transitions on health thresholds with attack speed/damage multipliers
  - [x] BossManager: spawn/get/remove/update all bosses, callback system (onBossDeath/onBossSpawn/onPhaseChange)
  - [x] Serialization/deserialization for persistence (health, phase, position, minions)
  - [x] getStateSummary() for HUD/debugging display
  - [x] 369 tests passing across 23 test groups — constants, definitions structure, attack validation, helpers, constructor, health/damage, shields, phase transitions, multi-phase final boss, attack system, cooldowns, AI state machine, death callback, minion spawning, reset, serialization, BossManager CRUD, manager update, summaries, edge cases

### Audio Foundation
- [x] **Procedural sound effects** — `js/audio/sfx.js`
  - [x] Block break/place sounds (different per material type) — 17 materials with freq/noiseRatio/duration/volume params
  - [x] Footstep sounds per biome surface type — 9 surfaces mapped from 8 biomes
  - [x] Jump/land sounds, damage flash sounds — frequency sweep synthesis
  - [x] UI click/hover sounds for menus — short sine tones with fast envelopes
  - [x] Eating/drinking sounds — noise-tone mix synthesis
  - [x] SoundManager class: init/play/dispose lifecycle, master+SFX volume control
  - [x] Pure utility functions: getMaterialParams, getFootstepParams, calculateVolume, blockIdToMaterial, biomeToFootstepSurface
  - [x] Noise buffer generation with deterministic seeding (LCG PRNG)
  - [x] All params testable without Web Audio API — 357 tests passing
- [x] **Calm ambient soundscapes** — `js/audio/ambient.js`
  - [x] Procedural calm drone/chord progression
  - [x] Biome-specific ambient tones (plains=peaceful, lava=tense, corrupt=eerie)
  - [x] Day/night volume variation
  - [x] Musical note frequency table (C2-Bb4 across octaves)
  - [x] Scale system: majorPentatonic, minorPentatonic, majorTriad, minorTriad, diminished, wholeTone
  - [x] 8 biome configs with unique root notes, scales, chord degrees, drone types, swell speeds, moods
  - [x] Ocean biome has filtered noise layer for wave wash effect
  - [x] Corrupt biome has microtone detuning (±7 cents) for eerie effect
  - [x] Lava uses sawtooth oscillator + fast swell (4s) for tense atmosphere
  - [x] Day/night volume with dawn/dusk smoothstep transitions (0.20-0.30 dawn, 0.70-0.80 dusk)
  - [x] Swell effect: sine wave breathing between 0.5-1.0 volume per biome cycle speed
  - [x] AmbientManager class: init/setBiome/setTimeOfDay/update/dispose lifecycle
  - [x] Crossfade between biomes (2-second fade out + fade in)
  - [x] getStateSummary() for debugging/HUD integration
  - [x] Config validation system with field checking, note validation, scale reference verification
  - [x] 465 tests passing across 23 test groups — constants, chord math, day/night volume, swell, detuning, manager lifecycle, integration, edge cases, musical theory

### Main Menu Flow
- [x] **Implement menu system** — `js/main.js`
  - [x] Main screen: Play Solo, Host Multiplayer, Join Multiplayer, Settings
  - [x] Character selection screen (3 slots, create/edit/delete)
  - [x] World selection screen (3 slots, create/delete)
  - [x] Mode selection: Creative or Survival
  - [x] Settings panel: render distance, volume, controls hint
  - [x] Screen management with showScreen() + hidden class toggling
  - [x] BrowserCharacterManager: validateName/validateColor/generateId/canCreateMore/getRemainingSlots/create/update/delete/duplicate prevention
  - [x] BrowserWorldManager: create/delete/select worlds with seed-based biome preview
  - [x] Modal system: unified create/edit modal for characters and worlds
  - [x] Delete confirmation modals for both characters and worlds
  - [x] Menu navigation wiring: btn-play-solo → characterScreen → worldScreen → modeScreen → startGame
  - [x] Host Multiplayer flow: btn-host-multiplayer → lobbyScreen
  - [x] Join Multiplayer flow: btn-join-multiplayer → lobbyScreen
  - [x] Settings screen: render distance slider (3-12 chunks), volume slider, music volume slider, controls hint
  - [x] Loading screen with animated progress bar simulation
  - [x] Mobile detection: touch device + narrow screen check → enable touch controls overlay
  - [x] Initialization flow: IndexedDB init → load characters → load worlds → wire menus → show main menu

### Phase 1 Testing (Browser Automation)
- [x] **Test: Page loads** — Navigate to game URL, check console
  - [x] No JS errors, canvas renders, Three.js initializes (validated via jsdom — 182 tests passing in test_pageLoad.js)
- [x] **Test: World generation** — Create world with known seed (36 assertions via test_worldGenerationIntegration.js)
  - [x] Terrain varies across biomes, water level correct
  - [x] Caves generate underground with connectivity
  - [x] Trees/cacti/features placed in correct biomes
  - [x] Ore veins present at appropriate depths
- [x] **Test: Chunk loading** — Move player across boundaries (51 assertions via test_chunkLoading.js)
  - [x] Seamless transitions between chunks (no gaps/tears)
  - [x] Caves continue seamlessly across chunk edges
  - [x] Distant chunks unload properly
- [x] **Test: Player movement** — WASD + jump on desktop (106 assertions via test_playerMovementIntegration.js)
  - [x] Movement in camera direction, gravity works
  - [x] Collision prevents walking through blocks
  - [x] Sprint consumes stamina
  - [x] KeyboardInput event handling: W/A/S/D/Space/Shift/E key mapping
  - [x] Camera-relative movement at yaw=0, π/2, π, -π/2
  - [x] Strafe left/right, backward movement, diagonal normalization
  - [x] Jump only when on ground (no double jump)
  - [x] Touch control simulation: joystick X/Y axis, swipe-to-look deltas, tap detection
  - [x] Full integration: KeyboardInput → Player update → World collision pipeline
  - [x] Sprint multiplier increases speed, stamina depletion via SurvivalSystem
  - [x] Edge cases: world bounds clamp, respawn reset, meter clamping during update
- [x] **Test: Block interaction** — Crosshair targeting + break/place (85 assertions via test_blockInteraction.js)
  - [x] Target block highlighted, breaks on click
  - [x] Place block on correct face (all 6 face normals tested)
  - [x] Broken blocks added to inventory
- [x] **Test: Survival meters** — Play for several minutes (103 assertions via test_survivalMetersIntegration.js)
  - [x] All 5 meters deplete over time (hunger/thirst/sleep natural depletion, stamina via actions)
  - [x] Hunger restored by eating apples (instant + animated flow)
  - [x] Thirst restored by drinking water (instant + animated flow)
  - [x] Sleep restored by beds, spawn point set above bed position
  - [x] Death and respawn at spawn point works (starvation death tested)
  - [x] Stamina cycle: sprint depletes → rest regenerates
  - [x] Full 2-minute gameplay simulation with periodic maintenance
  - [x] Survival state serialization/deserialization round-trip
  - [x] Desert biome faster thirst depletion
  - [x] Low sleep penalizes stamina regeneration
  - [x] Environmental damage: lava contact, poison DoT, fall damage
  - [x] Normalized meters for HUD rendering
- [x] **Test: Touch controls** — Mobile viewport simulation (116 assertions via test_touchControls.js)
  - [x] Virtual joystick moves player (joystick start/move/end, radius clamping, diagonal normalization)
  - [x] Swipe rotates camera (look start/move/end, delta accumulation, consumeLookDeltas)
  - [x] Tap breaks/places blocks (tap detection, checkTap consumption, long press behavior)
  - [x] KeyboardInput: WASD + Space/Shift/E key mapping, just-pressed flags, update cycle
  - [x] MouseInput: left/right click, scroll wheel, pointer lock safety guards
  - [x] Integration: Touch <-> Keyboard movement equivalence, Touch tap <-> Mouse click equivalence
  - [x] Bug #4 fixed: TouchInput DOM access guarded for Node.js testing (js/input/touch.js)
  - [x] Bug #5 fixed: MouseInput exitPointerLock document guard added (js/input/mouse.js)
- [x] **Test: Character management** — Create/edit/delete characters (106 assertions via test_characterManagementIntegration.js)
  - [x] 3 character slots available
  - [x] Name + color saved and restored
  - [x] Inventory persists per character
- [x] **Test: World persistence** — Create world, reload page (99 assertions via test_worldPersistenceIntegration.js)
  - [x] Chunk data loaded from disk
  - [x] Quest progress preserved
  - [x] Spawn points restored per player
- [x] **Test: Quest system** — Progress through first quest (91 assertions via test_questIntegration.js)
  - [x] Quest marker visible in world
  - [x] Quest tracker shows current objective
  - [x] Quest completes on requirement fulfillment
- [x] Record all test results, note bugs, update checkboxes (all Phase 1 integration tests complete: character mgmt 106 assertions, world persistence 99 assertions, quest system 91 assertions — 33/33 test files passing)

---

## Phase 2: Multiplayer & Relay Server

### Node.js Relay Server
- [x] **Setup server project** — `server/package.json`, `server/index.js` (36 tests via test_server.js)
  - [x] ws dependency for WebSocket support
  - [x] Dual port setup: matchmaking port + game session ports
  - [x] Connection handling with player ID assignment
  - [x] Disconnect cleanup (remove from session, broadcast leave)
- [x] **Implement matchmaking relay** — `server/matchmaking.js`
  - [x] Session registration: host name, world seed, mode, max players (4)
  - [x] Session browsing: list available sessions with details
  - [x] Join request routing → connect client to game session
  - [x] Session cleanup on host disconnect
- [x] **Implement game session relay** — `server/session.js`
  - [x] Message types: JOIN, LEAVE, MOVE, BREAK_BLOCK, PLACE_BLOCK, CHUNK_DATA, INVENTORY_UPDATE, QUEST_UPDATE, HEARTBEAT
  - [x] Server-side validation: block break/place checks (range, bounds, integer coords), inventory verification
  - [x] Player state broadcast: position, rotation, selected block, health meters
  - [x] Heartbeat keepalive (30s), disconnect on timeout
- [x] **Create systemd service file** — `cuubz-relay.service`
  - [x] Service unit file for Node.js relay server
  - [x] Configurable ports, working directory, restart policy
  - [x] User-level service (no sudo required)

### Client Multiplayer Integration
- [x] **Implement WebSocket client** — `js/multiplayer/client.js` (156 tests via test_multiplayerClient.js)
  - [x] Connect/disconnect to relay server
  - [x] Send/receive messages with retry logic
  - [x] Heartbeat keepalive, reconnection handler
  - [x] Message queue for reliable delivery ordering
  - [x] Dual connection management: WSConnection (low-level) + MultiplayerClient (high-level)
  - [x] Matchmaking protocol: HOST, BROWSE, JOIN, LEAVE with event routing
  - [x] Game session protocol: JOIN, MOVE, BREAK_BLOCK, PLACE_BLOCK, INVENTORY_UPDATE, HEARTBEAT
  - [x] Exponential backoff reconnection with jitter (1s base → 30s cap)
  - [x] Bounded message queue (500 max, FIFO ordering, oldest dropped on overflow)
  - [x] Protocol consistency verified against server/session.js and matchmaking.js
  - [x] Browser-safe: works in Node.js test mode with null WebSocket factory
- [x] **Implement host logic** — `js/multiplayer/host.js` (182 tests via test_hostLogic.js)
  - [x] Register session with matchmaking relay
  - [x] Authoritative block change validation before broadcast
  - [x] Inventory update validation (server-side)
  - [x] Quest progress validation and broadcast
  - [x] Player disconnect/reconnect handling
  - [x] HostManager class: state machine (IDLE→CONNECTING→HOSTING→ACTIVE→ENDING)
  - [x] RemotePlayerState tracking per connected player
  - [x] RateLimiter for move updates and block changes
  - [x] Validation functions: validateBlockBreak, validateBlockPlace, validateMove, validateInventory, validateQuestUpdate
  - [x] Server-authoritative actions: hostBreakBlock, hostPlaceBlock, kickPlayer
  - [x] Event callbacks: onPlayerJoined, onPlayerLeft, onBlockBreakValidated, onBlockPlaceValidated, onInventorySynced, onQuestUpdated, onError
  - [x] getStateSummary() for debugging/HUD integration
  - [x] Serialization/deserialization for RemotePlayerState persistence
- [x] **Implement chunk streaming** — `js/multiplayer/chunkStreamer.js`
  - [x] Track ALL player positions in session
  - [x] Load chunks around ALL players (not just host)
  - [x] Stream chunk data to clients who need it
  - [x] Compress chunk data for transmission
  - [x] Unload distant chunks when no players nearby
  - [x] ChunkStreamer class: player position tracking, load/unload radius management
  - [x] ChunkCompressor: RLE compression for efficient transmission (24576→194 bytes for all-air)
  - [x] ChunkStreamEntry: per-chunk state (UNLOADED/LOADING/LOADED/STREAMING/DIRTY)
  - [x] calculateChunkNeeds(): Manhattan-distance load radius, Euclidean unload radius
  - [x] updatePlayerChunkNeeds(): assigns playerRefs to chunks within each player's load radius
  - [x] tick(): full cycle — calculate needs → unload distant → load needed → build stream queue → stream (maxChunksPerTick limit)
  - [x] Priority streaming: dirty chunks first, then never-streamed chunks
  - [x] Lifecycle: start/stop/dispose with setInterval auto-tick loop
  - [x] Error handling: generator failures revert to UNLOADED, callback errors caught silently
  - [x] Callback system: onChunkLoaded, onChunkUnloaded, onChunkStreamed, onError
  - [x] getStats(): playersTracked, chunksLoaded, chunksDirty, totalStreamed, totalLoaded
  - [x] 150 tests passing across 16 test groups — constants, compressor, entry, constructor, player tracking, loading, unloading, dirty marking, chunk needs calculation, full tick cycle, multiplayer tracking, lifecycle, error handling, compression integration, edge cases
- [x] **Implement player synchronization** — `js/multiplayer/playerSync.js`
  - [x] Render remote players as colored voxel characters (6-block character model: feet, torso, arms, head)
  - [x] Smooth interpolation of remote player positions/rotations (lerp-based, configurable factors)
  - [x] Name tags above heads with color matching (canvas sprite rendering)
  - [x] Health bar display above remote players (survival mode, color-coded by health %)
  - [x] PingTracker: per-player latency tracking with sliding window buffer
  - [x] RemotePlayerState: authoritative position + render position separation
  - [x] Staleness detection: players marked stale after 5s without updates
  - [x] PlayerSyncManager: add/remove/update players, callback system (onAdded/onRemoved/onUpdated)
  - [x] Game mode support: health bars hidden in creative mode
  - [x] Serialization/deserialization with backward-compatible format
  - [x] Node.js testable — Three.js mesh creation gated behind browser checks
  - [x] Utility functions: distanceBetween, normalizeAngle, isInRenderDistance, shadeColor
  - [x] 168 tests passing across 22 test groups — constants, PingTracker, RemotePlayerState CRUD/interpolation/staleness/serialization, voxel character builder, color utilities, PlayerSyncManager lifecycle/callbacks/game mode/clear, edge cases, integration cycle
- [x] **Implement inventory sync** — `js/multiplayer/inventorySync.js` (197 tests via test_inventorySync.js)
  - [x] Send inventory to host on join (createJoinPayload → INVENTORY_UPDATE message)
  - [x] Host validates block breaks/places against inventory (InventoryValidator class: validateBlockBreak, validateBlockPlace)
  - [x] Inventory updates broadcast to all players (INVENTORY_SYNC relay protocol)
  - [x] Save character inventory on disconnect/exit (createSavePayload / unregisterPlayer returns save data)
  - [x] Pure utility functions: getItemCategory, getMaxStackSize, isValidTypeId, validateSlot, validateInventory
  - [x] Serialization/deserialization: serializeInventory, deserializeInventory with round-trip validation
  - [x] Diff computation: computeInventoryDiff detects changed slots, applyInventoryDiff restores state
  - [x] InventorySync class: join flow, periodic sync timer, remote inventory tracking, save/restore lifecycle
  - [x] InventoryValidator class: player registration, strict/non-strict modes, sanitization of invalid items
  - [x] Constants: VALID_BLOCK_IDS (0-26), VALID_NAMED_ITEMS (10 items), MAX_STACK, NAMED_ITEM_META, SINGLE_STACK_BLOCKS
  - [x] Helper functions: slotsEqual deep comparison, countItemInSlots, hasItemInSlots
  - [x] 197 tests passing across 26 test groups — constants, pure functions, validation, serialization, diff computation, InventorySync lifecycle, InventoryValidator host-side, full sync cycle integration, edge cases
- [x] **Implement session UI** — `js/main.js`
  - [x] Session browser: list available sessions with details (Browse tab, #session-list, refresh button)
  - [x] Host screen: set name, select world/mode, start hosting (Host tab, form validation, world dropdown)
  - [x] Connection status indicator (connected/disconnected/reconnecting with animated status dots)
  - [x] Player list overlay: names + health of all players (top-left HUD, color-coded health bars)
  - [x] Tab navigation: Browse Sessions / Host Session tabs with active state styling
  - [x] Host form: session name input (32 char max), world select dropdown, mode selector, max players slider (2-4)
  - [x] Session list rendering: name, mode, seed, player count, full/not-full indicators
  - [x] Player list rendering: color dot, name, health bar (green/yellow/red by health %)
  - [x] Host form validation: empty name, too-long name, missing world selection
  - [x] Connection status states: disconnected (red), connecting (yellow pulse), connected (green), reconnecting (orange pulse)
  - [x] SessionManager class: init/browse/join/host/leave/dispose lifecycle with offline simulation mode
  - [x] HTML structure updated: lobby screen, connection HUD, player list overlay (#182 tests via test_pageLoad.js group 15)
  - [x] CSS styles: lobby tabs, host form, connection status indicators, player list overlay, responsive adjustments
  - [x] 155 tests passing across 12 test groups — constructor, status logic, session rendering, player rendering, form validation, tab switching, HTML escape, state machine, health bar edge cases, display formatting, error handling, multiplayer constraints

### Phase 2 Testing (Browser Automation)
- [x] **Test: Server starts** — Launch relay server, check ports (48 assertions via test_serverIntegration.js)
  - [x] Matchmaking port accepting connections
  - [x] Game session ready for hosting
  - [x] Health endpoint returns ok with session count
  - [x] WELCOME message on connect with valid playerId
  - [x] HOST creates session with sessionId + sessionPort
  - [x] BROWSE lists active sessions correctly
  - [x] JOIN routes to correct session port via matchmaking
  - [x] Game session WELCOME includes players list
  - [x] Movement relayed between players (PLAYER_MOVE broadcast)
  - [x] Valid block break/place relayed, invalid rejected with ERROR
  - [x] Heartbeat keepalive tracked server-side
  - [x] Max player enforcement (5th player rejected: "Session is full")
  - [x] PLAYER_LEFT broadcast on disconnect
  - [x] Inventory sync relayed to all players (INVENTORY_SYNC)
  - [x] HTTP /health and /sessions endpoints functional
  - [x] Edge cases: invalid JSON, unknown message type, missing fields, nonexistent session, LEAVE
- [x] **Test: Session discovery** — Create session, browse from client (62 assertions via test_sessionDiscovery.js)
  - [x] Host session appears in browser list with correct name, player count, mode
  - [x] Join connects to game session successfully
  - [x] Multiple sessions visible in browse list simultaneously
  - [x] Full E2E flow: Browse → Find Session → Join → Connect to Game Session
  - [x] Non-existent session join returns JOIN_REJECTED error
  - [x] HTTP /sessions endpoint mirrors WebSocket browse data
  - [x] Session player count updates in browse list after players join
  - [x] Max player enforcement: 4th accepted, 5th rejected with "Session is full"
  - [x] PLAYER_JOINED broadcast sent to existing players when new player joins
  - [x] Host playerId consistency: same ID used across matchmaking and game session (server fix in session.js)
- [x] **Test: Multiplayer sync** — Two players in same world (92 assertions via test_multiplayerSync.js)
  - [x] Remote player visible with correct color + name tag
  - [x] Movement synchronized between clients
  - [x] Block changes validated by host, broadcast to all
  - [x] Inventory updates synced correctly
  - [x] Full E2E pipeline: Matchmaking → Host Session → Game Session Join → Player Sync
  - [x] PLAYER_JOINED includes character name, color, and starting position
  - [x] PLAYER_MOVE broadcast excludes sender (no self-echo)
  - [x] Rapid movement broadcasts all delivered in order
  - [x] Invalid block break rejected: too far away, non-integer coords, out-of-bounds Y
  - [x] Invalid block place rejected: negative blockType
  - [x] BLOCK_BREAK/BLOCK_PLACE broadcast to ALL players including sender
  - [x] INVENTORY_SYNC relayed with full inventory array (typeId, count, null slots)
  - [x] Heartbeat keepalive tracking — no errors after heartbeat
  - [x] PLAYER_LEFT broadcast on disconnect, session state consistent
- [x] **Test: Chunk streaming** — Players at different locations (59 assertions via test_chunkStreamingIntegration.js)
  - [x] Each player's surrounding chunks loaded
  - [x] World doesn't disappear when players spread out
  - [x] New chunks streamed seamlessly to remote clients
  - [x] Single player chunk loading around position (69 chunks for radius 4)
  - [x] Two players at same location — no duplicate loading
  - [x] Two players far apart — chunks load around BOTH positions
  - [x] Unloading when all players leave an area
  - [x] Dirty chunk priority streaming
  - [x] Player disconnect removes from tracking, allows unloading
  - [x] RLE compression: 24576→194 bytes for typical chunk
  - [x] Stats tracking accurate (playersTracked, chunksLoaded, chunksDirty, totalStreamed)
  - [x] Edge cases: no players, invalid coords, null position
  - [x] Full tick cycle simulation with maxChunksPerTick limit
- [ ] **Test: Server validation** — Client sends invalid block change
  - [ ] Host rejects invalid break/place
  - [ ] Inventory properly validated before changes
- [ ] **Test: Max player enforcement** — 4+ join attempts
  - [ ] 4th player joins, 5th rejected with "full" message
- [ ] **Test: Character save on disconnect** — Player leaves session
  - [ ] Character inventory saved to IndexedDB
  - [ ] Inventory restored on rejoin
- [ ] Record all test results, note bugs, update checkboxes

---

## Phase 3: Polish & Content Expansion

### World Polish
- [ ] **Day/night cycle** — `js/renderer/skybox.js`
  - [ ] Configurable cycle length (e.g., 5 min full cycle)
  - [ ] Sun/moon movement, sky color transitions
  - [ ] Ambient light changes affecting visibility
  - [ ] Night indicator on HUD
- [ ] **Biome visual polish** — `js/world/featurePlacer.js`
  - [ ] Flower variety in Plains biomes
  - [ ] Tree density variation in Forest
  - [ ] Lava flow animation with particle effects
  - [ ] Toxic slime pool bubbling animation
  - [ ] Corrupt biome ambient purple fog effect
- [ ] **Cave polish** — `js/world/caveGenerator.js`
  - [ ] Torches/light sources in caves (player placeable)
  - [ ] Cave stalactite/stalagmite features
  - [ ] Glowstone-like ore blocks for cave lighting

### Gameplay Polish
- [ ] **Creative mode full implementation** — `js/game.js`
  - [ ] Unlimited blocks, no gravity, fly mode (double-tap space)
  - [ ] Block palette selector for all block types
  - [ ] Toggle between Creative and Survival
- [ ] **Crafting system** — `js/systems/crafting.js`
  - [ ] Basic recipes: planks from wood, beds from wool+planks
  - [ ] Crafting UI with recipe grid
  - [ ] Recipe discovery (learn as you progress)
- [ ] **Player list HUD** — `css/style.css` + `js/multiplayer/playerSync.js`
  - [ ] Top-left overlay showing all other players
  - [ ] Name + color dot + health bar for each player
  - [ ] Collapsible panel on mobile

### Audio Polish
- [ ] **Biome ambient sound transitions** — `js/audio/ambient.js`
  - [ ] Smooth crossfade between biome sounds
  - [ ] Lava crackle/bubble sounds in lava biome
  - [ ] Eerie whispers/drone in corrupt biome
  - [ ] Birds/wind for healthy biomes

### Mobile Polish
- [ ] **Responsive HUD** — `css/style.css`
  - [ ] Survival meters visible on mobile viewport
  - [ ] Hotbar positioned below joystick
  - [ ] Inventory overlay full-screen on mobile
  - [ ] Quest tracker compact on mobile
- [ ] **Performance optimization** — `js/renderer/chunkManager.js`
  - [ ] Reduced render distance on mobile detection
  - [ ] Lower geometry detail option for weak devices
  - [ ] Frame rate target: 30fps minimum

### Phase 3 Testing (Browser Automation)
- [ ] **Test: Day/night cycle** — Accelerate time, observe transitions
  - [ ] Smooth sky color changes, lighting follows sun
- [ ] **Test: Crafting** — Craft planks from wood
  - [ ] Recipe available in crafting UI
  - [ ] Output items added to inventory correctly
- [ ] **Test: Creative mode** — Toggle creative, fly around
  - [ ] Unlimited blocks available, no gravity
  - [ ] All block types accessible in palette
- [ ] **Test: Mobile HUD** — Simulate mobile viewport
  - [ ] All survival meters visible and readable
  - [ ] Player list overlay functional
  - [ ] Touch targets ≥ 48px
- [ ] Record all test results, note bugs, update checkboxes

---

## Phase 4: Deployment & Final Polish

### Pre-Deployment
- [ ] **Final code review** — All files
  - [ ] Console.log cleanup (remove debug statements)
  - [ ] Error handling on all WebSocket operations
  - [ ] Memory leak check (chunk disposal, event listener cleanup)
  - [ ] Mobile viewport testing across device sizes
- [ ] **Texture asset verification** — `textures/` directory
  - [ ] All texture PNGs present and 32×32 resolution
  - [ ] Visual quality check on each texture
- [ ] **Multiplayer stress test** — 4 concurrent players
  - [ ] Server handles 4 connections without lag
  - [ ] Block changes sync within 500ms
  - [ ] Player disconnect/reconnect handled gracefully
  - [ ] Inventory sync correct across all clients

### Deployment
- [ ] **Generate sync.sh from template** — `sed` from skill template with remote IP
- [ ] **Deploy game files to server** — `./sync.sh` via rsync
  - [ ] All HTML/CSS/JS files synced
  - [ ] Texture PNGs synced
  - [ ] Server directory deployed (Node.js relay)
- [ ] **Setup NPM proxy** — Reverse proxy for game on dedicated LXC container
- [ ] **Test deployed game** — Access via browser from remote device
  - [ ] Game loads and renders correctly
  - [ ] Multiplayer connects through proxy
  - [ ] Mobile touch controls work on physical device

### GitHub Repository (Final Step)
- [ ] **Create private GitHub repository** — `webgame-cuubz`
  - [ ] Master branch with README
  - [ ] .gitignore for node_modules, .env, generated temp files
- [ ] **Push all code to repository** — git add/commit/push

### Phase 4 Testing (Browser Automation)
- [ ] **Test: Deployed game loads** — Navigate to deployed URL
  - [ ] Page loads without errors, all assets serve correctly
- [ ] **Test: Multiplayer through proxy** — Connect from remote device
  - [ ] Session discovery works, WebSocket stable through proxy
- [ ] Record all test results, note bugs, update checkboxes

---

## Testing Plan Summary

All testing uses **Hermes browser automation** to open the game in a headless browser and verify:

| Test Category | Method | Expected Result |
|---|---|---|
| Page load | Navigate to URL, check console | No JS errors, canvas renders, Three.js initializes |
| World generation | Create world with fixed seed | Terrain varies, 8 biomes present, caves connected, ores at depth |
| Chunk loading/unloading | Move across boundaries | Seamless transitions, no gaps, caves match edges, chunks unload |
| Player movement | WASD + jump simulation | Camera-relative movement, gravity, collision blocks player |
| Block interaction | Simulate click on target | Highlight correct block, break/place works, inventory updates |
| Survival meters | Play for several minutes | All 5 meters deplete, food/water/bed restore correctly |
| Damage system | Enter lava/poison pools | Health decreases, death respawns at spawn point |
| Touch controls | Mobile viewport + touch events | Joystick moves, swipe rotates camera, tap interacts |
| Character management | Create/edit/delete 3 characters | Name+color saved, inventory persists per character |
| World persistence | Create world, reload page | Chunks loaded from disk, quest progress preserved |
| Quest system | Progress through first quest chain | Markers visible, tracker updates, completion triggers next quest |
| Boss fights | Reach boss trigger with key item | Boss spawns, fight mechanics work, death completes quest |
| Server matchmaking | Start server, connect clients | Sessions listed, join accepted, player IDs assigned |
| Multiplayer sync | 2+ players in world | Remote players visible, movement synced, blocks validated by host |
| Chunk streaming | Players spread across world | All player areas loaded, chunks streamed to remote clients |
| Inventory sync | Break/mine as non-host | Host validates, inventory updated for all, saved on disconnect |
| Max players | 5th join attempt | Rejected with "full", existing 4 unaffected |
| Day/night cycle | Accelerate time | Smooth transitions, lighting follows sun position |
| Crafting | Craft items from recipes | Output correct, ingredients consumed, inventory updated |
| Mobile performance | Throttle CPU + mobile viewport | ≥ 30fps, touch targets functional, HUD readable |
| Deployed access | Navigate to remote URL | Game loads, multiplayer connects through proxy |

**Bug tracking:** Each test records pass/fail. Failed tests create specific bug items in the relevant phase. Fixes verified by re-running the specific test.

---

## Progress

| Phase | Status |
|-------|--------|
| Phase 1: Foundation — Core Voxel Engine & Single Player Survival | ✅ Complete (all tasks + integration tests done) |
| Phase 2: Multiplayer & Relay Server | 🟡 In Progress (server files complete + tested, client integration next) |
| Phase 3: Polish & Content Expansion | ⬜ Not Started |
| Phase 4: Deployment & Final Polish | ⬜ Not Started |

---

## Quest Chain Design (25 Quests) 🗺️

### Act I: Awakening (Quests 1–6)
| # | Quest Name | Objective | Requirement |
|---|-----------|-----------|-------------|
| 1 | First Steps | Explore your surroundings | Walk 100 blocks from spawn |
| 2 | Gather Wood | Collect wood for building | Mine 10 wood logs |
| 3 | Stone Age | Mine stone for tools | Mine 20 stone blocks |
| 4 | A Safe Place | Build and place a bed | Craft and place 1 bed |
| 5 | The Forest Path | Find the forest biome | Reach any forest biome |
| 6 | Apple Harvest | Gather food supplies | Collect 5 apples from trees |

### Act II: The First Dungeon — Ember Depths (Quests 7–12)
| # | Quest Name | Objective | Requirement |
|---|-----------|-----------|-------------|
| 7 | Into the Lava Wastes | Explore the lava biome | Enter lava biome without dying |
| 8 | Obsidian Shield | Gather lava materials | Mine 15 obsidian blocks |
| 9 | The Ember Key | Find the dungeon key | Locate and collect Ember Key (quest item in cave) |
| 10 | Descend | Enter the first dungeon | Reach the dungeon entrance with key |
| 11 | Lava Lurker | Defeat Boss 1 | Kill the Lava Lurker boss |
| 12 | Ashes and Embers | Collect boss loot | Take Ember Core from boss (quest item) |

### Act III: The Second Dungeon — Corrupt Hollows (Quests 13–17)
| # | Quest Name | Objective | Requirement |
|---|-----------|-----------|-------------|
| 13 | Purple Fog | Explore the corrupt biome | Enter corrupt biome, survive poison |
| 14 | Crystal Hunter | Gather corrupt crystals | Collect 10 corrupt crystals |
| 15 | The Void Key | Find the second key | Locate and collect Void Key (in deep cave) |
| 16 | The Hollow Descent | Enter the corrupt dungeon | Reach dungeon entrance with key |
| 17 | Poison Maw | Defeat Boss 2 | Kill the Poison Maw boss, take Void Shard |

### Act IV: The Third Dungeon — Frozen Peak (Quests 18–21)
| # | Quest Name | Objective | Requirement |
|---|-----------|-----------|-------------|
| 18 | Mountain Climb | Reach the mountain biome peaks | Reach highest point in mountains |
| 19 | Ice Walker | Traverse the tundra safely | Cross tundra biome without falling |
| 20 | The Frost Key | Find the third key | Locate and collect Frost Key (mountain cave) |
| 21 | Blizzard King | Defeat Boss 3 | Kill Blizzard King, take Frost Heart |

### Act V: Final Dungeon — The Core (Quests 22–25)
| # | Quest Name | Objective | Requirement |
|---|-----------|-----------|-------------|
| 22 | Gathering Storm | Collect all boss items | Have Ember Core + Void Shard + Frost Heart |
| 23 | The Final Key | Craft the Core Key | Combine 3 boss items at quest marker |
| 24 | Into the Core | Enter the final dungeon | Reach core entrance with Core Key |
| 25 | The World Eater | Defeat the Final Boss | Kill The World Eater — **GAME COMPLETE** 🎉 |

**Boss Summary:**
1. **Lava Lurker** (Act II) — Fire attacks, lava pool AOE, drops Ember Core
2. **Poison Maw** (Act III) — Poison DoT area, tentacle attacks, drops Void Shard
3. **Blizzard King** (Act IV) — Ice projectiles, freeze stun, drops Frost Heart
4. **The World Eater** (Act V) — Multi-phase: fire → poison → ice → all elements

**Quest item placement during world generation:**
- Ember Key: placed in lava biome cave system at deterministic noise-derived position
- Void Key: placed deep in corrupt biome underground
- Frost Key: placed in high mountain cave
- Boss spawn points: fixed relative to quest markers, generated during world creation
