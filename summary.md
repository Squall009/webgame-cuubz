# Cuubz — Project Summary & Architecture Reference

## Overview

Cuubz is a web-based Minecraft-style voxel game with multiplayer support for up to 4 players. It uses **vanilla JavaScript with no build tooling** — every `.js` file is loaded as a `<script>` tag in dependency order via `index.html`. Classes and constants are exposed on the global scope (no module imports).

### Tech Stack
- **Three.js r134** (CDN) — 3D voxel rendering
- **Vanilla JavaScript** — no bundler, no transpiler
- **WebSocket** (`ws` library on server) — multiplayer networking
- **IndexedDB** — persistent world/character saves in browser
- **Canvas API** — procedural texture generation
- **Web Audio API** — procedural sound effects and ambient music

### Dual Runtime
Most files run in both **browser** (via `<script>` tags) and **Node.js** (server-side tests via `require()`). All `module.exports` are guarded with `if (typeof module !== 'undefined')`.

---

## File Layout

```
webgame-cuubz/
├── index.html              # Entry point — loads 42 JS files in dependency order
├── css/style.css           # All game UI styling (menu, HUD, mobile controls)
├── js/
│   ├── util/
│   │   └── logger.js       # CuubzLogger — debug logging utility
│   ├── world/              # World generation & data structures
│   │   ├── noise.js        # Perlin noise generator
│   │   ├── chunkData.js    # Chunk class, BLOCK_TYPES, BLOCK_PROPERTIES, dimensions
│   │   ├── biomeSystem.js  # Biome classification from noise values
│   │   ├── caveGenerator.js# Cave tunnels, stalactites, stalagmites, torches
│   │   ├── oreGenerator.js # Ore vein placement (coal, iron, gold, diamond)
│   │   ├── featurePlacer.js# Trees, flowers, cacti, lava pools, quest markers
│   │   ├── chunkGrid.js    # Chunk grid management with player tracking
│   │   ├── persistence.js  # IndexedDB persistence layer (characters, worlds, chunks)
│   │   ├── spawnManager.js # Spawn point storage per world
│   │   └── worldGenerator.js# Orchestrates terrain generation pipeline
│   ├── renderer/           # Three.js rendering
│   │   ├── chunkMeshBuilder.js  # Face culling + geometry building per chunk
│   │   ├── chunkManager.js      # Async chunk build/unload queue
│   │   ├── voxelRenderer.js     # Three.js scene, camera, raycasting
│   │   ├── crosshair.js         # Block target highlight wireframe
│   │   ├── skybox.js            # Day/night cycle, fog, sun/moon positioning
│   │   ├── biomeEffects.js      # Lava bubbles, toxic slime particles, corrupt fog
│   │   └── performanceOptimizer.js  # FPS monitoring, auto render-distance adjustment
│   ├── input/              # Input handlers
│   │   ├── keyboard.js     # WASD, space, shift, E, number keys
│   │   ├── mouse.js        # Pointer lock, click break/place, scroll wheel
│   │   ├── touch.js        # Virtual joystick, swipe-to-look, tap actions
│   │   └── interaction.js  # Block break/place via raycast from crosshair
│   ├── entities/           # Game objects
│   │   ├── player.js       # Player physics, movement, collision detection
│   │   ├── characterManager.js  # Character CRUD (Node.js version)
│   │   ├── worldManager.js   # World CRUD (Node.js version)
│   │   ├── boss.js         # Boss entities with phases, attacks, minions
│   │   └── questMarker.js  # Visual markers for quest objectives
│   ├── systems/            # Game systems
│   │   ├── inventory.js    # Inventory slots, hotbar, item stacking
│   │   ├── crafting.js     # Recipe system, discovery, crafting
│   │   ├── survival.js     # Health, hunger, thirst, sleep, stamina meters
│   │   ├── damageSystem.js # Environmental damage, boss attacks, fall damage
│   │   └── questSystem.js  # Quest chain, objectives, rewards, progress
│   ├── audio/              # Audio subsystems
│   │   ├── sfx.js          # Procedural sound effects (block break, footstep, UI)
│   │   └── ambient.js      # Biome-specific ambient music layers
│   ├── multiplayer/        # Multiplayer networking
│   │   ├── client.js       # WebSocket client (matchmaking + game session)
│   │   ├── host.js         # Host-side session management & validation
│   │   ├── playerSync.js   # Remote player state sync, interpolation
│   │   ├── chunkStreamer.js# Chunk data streaming to remote players
│   │   ├── inventorySync.js# Inventory diff sync between host and clients
│   │   └── playerListHUD.js# In-game player list overlay UI
│   ├── game.js             # Game loop, mode management (creative/survival)
│   └── main.js             # Browser entry — menus, screen flow, session manager
├── server/                 # Node.js multiplayer server
│   ├── index.js            # HTTP + WS server entry point
│   ├── matchmaking.js      # Session discovery relay (port 8765)
│   └── session.js          # Game session host (dynamic port per session)
├── textures/               # 32×32 PNG block textures
├── scripts/                # Python utility scripts
│   └── generate_textures.py# Procedural texture generator
├── test/                   # Node.js test suite (jsdom + mocked WebSocket)
│   ├── run_tests.sh        # Test runner script
│   └── test_*.js           # ~65 individual test files
├── sync.sh                 # Deploy to game server via rsync
└── package.json            # Dependencies: jsdom, ws
```

---

## Module Documentation

### `js/util/logger.js` — Debug Logger

**Purpose:** Conditional debug logging throughout the codebase.

**Global:** `CuubzLogger`

| Property/Method | Description |
|-----------------|-------------|
| `CuubzLogger.DEBUG` | Set to `true` to enable all logs (default: `false`) |
| `CuubzLogger.log(...)` | Logs if DEBUG is true, no-op otherwise |

**Usage:** Every file does `const _log = typeof CuubzLogger !== 'undefined' ? CuubzLogger.log : function() {};` for safe logging.

---

### `js/world/noise.js` — Noise Generator

**Purpose:** Perlin noise for terrain height, cave detection, ore placement.

**Class:** `NoiseGenerator`

| Method | Description |
|--------|-------------|
| `constructor(seed)` | Create with optional seed for deterministic output |
| `.perlin2(x, y)` | 2D Perlin noise, returns float in [-1, 1] |
| `.perlin3(x, y, z)` | 3D Perlin noise |
| `.octaveNoise2(x, y, octaves, persistence)` | Fractal Brownian Motion (layered noise) |
| `.octaveNoise3(x, y, z, octaves, persistence)` | 3D FBM |
| `.ridgeNoise(x, y, octaves, persistence)` | Ridge noise for mountain terrain |
| `.normalized(x, y, octaves, persistence)` | Normalized output in [0, 1] |
| `.hash(x, y, z)` | Integer hash function |
| `.createPRNG(seed)` | Returns a seeded PRNG function |

**Load Order:** First world module. Required by `caveGenerator.js`, `featurePlacer.js`, `oreGenerator.js`, `worldGenerator.js`.

---

### `js/world/chunkData.js` — Chunk Data Structure

**Purpose:** Core block data structure and type registry.

**Constants:**
| Constant | Value | Description |
|----------|-------|-------------|
| `BLOCK_TYPES` | Object | Maps names to IDs (AIR=0 through GLOWSTONE=30) |
| `BLOCK_PROPERTIES` | Object | Per-block: `{solid, transparent, hardness, damage, drop}` |
| `CHUNK_WIDTH` | 16 | Blocks per chunk X axis |
| `CHUNK_DEPTH` | 16 | Blocks per chunk Z axis |
| `CHUNK_HEIGHT` | 96 | Total height (-32 to +64) |
| `SEA_LEVEL` | 0 | Water surface level |
| `MIN_Y` | -32 | Bottom of world |
| `MAX_Y` | 64 | Top of world |

**Class:** `Chunk`

| Method | Description |
|--------|-------------|
| `constructor(chunkX, chunkZ)` | Create chunk at grid coordinates |
| `.getBlock(x, y, z)` | Get block type ID at local coords |
| `.setBlock(x, y, z, type)` | Set block, marks chunk dirty |
| `.getBlockAtWorld(wx, wy, wz)` | Get block at world coords (returns null if outside chunk) |
| `.getEdgeData(edge)` | Get boundary data for neighbor joining ('positiveX', 'negativeX', etc.) |
| `.serialize()` | Compress to `{indices, types}` arrays (non-air only) |
| `Chunk.deserialize(data)` | Restore from serialized format |
| `.isEmpty()` | Check if all blocks are air |
| `.markClean()` | Reset dirty flag after save |

**Properties:** `chunkX`, `chunkZ`, `worldX`, `worldZ`, `blocks` (Uint8Array), `neighbors`, `dirty`, `meshData`

**Load Order:** Required by nearly everything. Load before all other world modules.

---

### `js/world/biomeSystem.js` — Biome Classification

**Purpose:** Determine biome from noise values, select surface blocks.

**Constants:**
| Constant | Description |
|----------|-------------|
| `BIOMES` | Object with 8 biomes: Plains, Forest, Desert, Tundra, Mountains, Ocean, Lava, Corrupt |
| `BIOME_LIST` | Array of biome names |

Each biome has: `{name, temperature, humidity, surfaceBlock, subsurfaceBlock, waterColor, skyTint}`

**Class:** `BiomeSystem`

| Method | Description |
|--------|-------------|
| `.getBiome(temperature, humidity)` | Returns biome name from noise values |
| `.biomeFromValues(temp, hum)` | Same as getBiome |
| `.getBlendedBiome(t1, h1, t2, h2, weight)` | Blend between two biomes |
| `.getSurfaceBlock(biomeName)` | Get surface block type ID for biome |

**Load Order:** After `noise.js`, before `worldGenerator.js`.

---

### `js/world/caveGenerator.js` — Cave System

**Purpose:** Generate cave tunnels, formations, and torch placement.

**Class:** `CaveGenerator`

| Method | Description |
|--------|-------------|
| `constructor(noiseGen, options)` | Takes NoiseGenerator instance |
| `.applyCaves(chunk, worldX, worldZ)` | Carve caves into chunk using noise threshold |
| `.generateTunnelPaths(length, radius)` | Generate tunnel centerline paths |
| `.isConnected(x1, y1, z1, x2, y2, z2)` | Check if two points are in same cave space |
| `.generateFormations(chunk, worldX, worldZ)` | Add stalactites and stalagmites |
| `.placeTorchesInCaves(chunk, worldX, worldZ, spacing)` | Place cave_torch blocks in caves |
| `.countFormations()` | Return stalactite/stalagmite counts |

**Load Order:** After `noise.js` and `chunkData.js`.

---

### `js/world/oreGenerator.js` — Ore Placement

**Purpose:** Generate ore veins at appropriate depths.

**Class:** `OreGenerator`

| Method | Description |
|--------|-------------|
| `constructor(noiseGen)` | Takes NoiseGenerator instance |
| `.placeOres(chunk, worldX, worldZ)` | Place all ore types in chunk |
| `._placeVeins(chunk, type, count, size, minY, maxY)` | Place veins of specific ore |
| `.getOreDensity(depth)` | Ore density multiplier at given Y level |
| `.getOreList()` | Return configured ore list with depth ranges |

**Load Order:** After `noise.js` and `chunkData.js`.

---

### `js/world/featurePlacer.js` — Surface Features

**Purpose:** Place trees, flowers, cacti, lava pools, toxic slime, corrupt crystals, glowstone, quest markers.

**Class:** `FeaturePlacer`

| Method | Description |
|--------|-------------|
| `constructor(noiseGen, biomeSystem)` | Takes NoiseGenerator and BiomeSystem |
| `.placeFeatures(chunk, worldX, worldZ, biomeMap)` | Place all features based on biome |
| `._placeTree(chunk, x, z)` | Generate tree (trunk + leaves) |
| `._placeFlower(chunk, x, z)` | Random flower placement |
| `._placeCactus(chunk, x, z)` | Desert cactus |
| `._placeLavaPool(chunk, x, z)` | Lava pool in lava biome |
| `._placeToxicPool(chunk, x, z)` | Toxic slime pool |
| `._placeCorruptCrystal(chunk, x, z)` | Quest item placement |
| `.placeGlowstoneInCaves(chunk, worldX, worldZ)` | Glowstone clusters in caves |
| `.placeQuestMarkers(chunk, worldX, worldZ)` | Place quest_key and boss_spawn blocks |

**Load Order:** After `noise.js`, `biomeSystem.js`, `chunkData.js`.

---

### `js/world/chunkGrid.js` — Chunk Grid Manager

**Purpose:** Maintain a spatial grid of loaded chunks with player tracking.

**Class:** `ChunkGrid`

| Method | Description |
|--------|-------------|
| `constructor(chunkManager)` | Takes chunk build manager reference |
| `.getChunk(cx, cz)` | Get or create chunk at grid coords |
| `._updateNeighbors(chunk)` | Link adjacent chunks in neighbors map |
| `.addPlayerPosition(playerX, playerZ)` | Register player position for LOD |
| `.removePlayerPosition()` | Unregister player |
| `.updateChunks()` | Load/unload chunks based on player distance |
| `.getDirtyChunks()` | Return chunks marked dirty since last save |
| `.getChunkCount()` | Number of loaded chunks |

**Load Order:** After `chunkData.js`.

---

### `js/world/persistence.js` — IndexedDB Persistence

**Purpose:** Browser-side save/load for characters, worlds, and chunk data.

**Constants:**
| Constant | Value |
|----------|-------|
| `DB_NAME` | `'CuubzDB'` |
| `DB_VERSION` | `1` |

**Class:** `PersistenceManager`

| Method | Description |
|--------|-------------|
| `constructor()` | Initializes dirty chunk tracking |
| `.init()` | Open/create IndexedDB, returns Promise |
| `.saveCharacter(character)` | Save character object to 'characters' store |
| `.loadCharacters()` | Load all characters, returns Promise\<array\> |
| `.deleteCharacter(id)` | Remove character by ID |
| `.saveWorld(world)` | Save world object to 'worlds' store |
| `.loadWorlds()` | Load all worlds, returns Promise\<array\> |
| `.deleteWorld(id)` | Remove world by ID |
| `.queueChunk(chunkData)` | Add chunk to dirty queue for async save |
| `.saveDirtyChunks()` | Batch-save all dirty chunks |
| `.loadChunk(worldId, cx, cz)` | Load specific chunk from DB |
| `.periodicSave()` | Auto-save every 30 seconds |

**Load Order:** After `chunkData.js`. Used by `main.js` BrowserCharacterManager/BrowserWorldManager.

---

### `js/world/spawnManager.js` — Spawn Points

**Purpose:** Store and retrieve spawn points per world.

**Class:** `SpawnManager`

| Method | Description |
|--------|-------------|
| `.setSpawn(worldId, x, y, z)` | Set spawn for a world |
| `.getSpawn(worldId)` | Get `{x, y, z}` or null |
| `.setDefaultSpawn()` | Return default spawn at (0, 20, 0) |
| `.clearWorld(worldId)` | Remove spawn data for world |
| `.getWorldSpawns()` | Return all world spawns |
| `.serialize()` / `.deserialize(data)` | Save/restore state |

**Load Order:** After `chunkData.js`. Used by `survival.js`, `characterManager.js`.

---

### `js/world/worldGenerator.js` — World Generation Pipeline

**Purpose:** Orchestrate terrain generation for a single chunk.

**Class:** `WorldGenerator`

| Method | Description |
|--------|-------------|
| `constructor(seed)` | Create with world seed |
| `.generateChunk(chunkX, chunkZ)` | Full pipeline: height → surface → caves → ores → features |
| `._getHeight(x, z)` | Get terrain height at world coords |
| `._getUndergroundBlock(y, biome)` | Select underground block for depth/biome |
| `._getTransitionBlock(surface, subsurface)` | Grass/dirt transition logic |
| `.generateWorld(chunkCount)` | Generate multiple chunks in sequence |

**Pipeline Order:**
1. Noise → heightmap
2. BiomeSystem → biome classification
3. Fill surface + subsurface blocks
4. CaveGenerator → carve tunnels
5. OreGenerator → place veins
6. FeaturePlacer → trees, flowers, features

**Load Order:** Last world module. Depends on all other world modules.

---

### `js/renderer/chunkMeshBuilder.js` — Mesh Builder

**Purpose:** Build Three.js geometry from chunk data with face culling.

**Class:** `ChunkMeshBuilder`

| Method | Description |
|--------|-------------|
| `.buildMeshData(chunk)` | Generate vertex/UV/index arrays (face culling applied) |
| `._isTransparent(blockId)` | Check if block has transparent faces |
| `.buildThreeGeometry(meshData, materialIndex)` | Create Three.js BufferGeometry |
| `.estimateFaceCount(chunk)` | Approximate face count before building |

**Load Order:** After `chunkData.js`. Used by `chunkManager.js`.

---

### `js/renderer/chunkManager.js` — Chunk Render Manager

**Purpose:** Async queue for building/unloading chunk meshes based on player position.

**Class:** `ChunkManager`

| Method | Description |
|--------|-------------|
| `constructor(renderer, chunkGrid)` | Takes VoxelRenderer and ChunkGrid |
| `.update(delta)` | Process build/unload queue each frame |
| `._queueBuild(cx, cz)` | Queue chunk for mesh generation |
| `._processQueue()` | Build next pending chunk (async) |
| `._buildChunk(cx, cz)` | Generate mesh and add to scene |
| `._unloadChunk(cx, cz)` | Remove mesh from scene |
| `.setRenderDistance(chunks)` | Update render distance setting |
| `.getLoadedCount()` | Number of rendered chunks |
| `.getPerformanceState()` | Return queue depth + loaded count |
| `.dispose()` | Clean up all meshes |

**Load Order:** After `chunkData.js`, `chunkMeshBuilder.js`. Used by `voxelRenderer.js`.

---

### `js/renderer/voxelRenderer.js` — Three.js Renderer

**Purpose:** Three.js scene, camera, renderer, and raycasting.

**Class:** `VoxelRenderer`

| Method | Description |
|--------|-------------|
| `constructor(container)` | Initialize Three.js scene + WebGLRenderer |
| `._initThree()` | Create scene, camera, lights, fog |
| `.loadTexture(path)` | Load PNG texture into map |
| `.updateCamera(position, rotation)` | Update camera position and look direction |
| `.render()` | Call renderer.render(scene, camera) |
| `.onResize(width, height)` | Handle window resize |
| `.addChunkMesh(geometry, position)` | Add chunk mesh to scene |
| `.removeChunkMesh(id)` | Remove chunk mesh from scene |
| `.raycast(origin, direction, maxDistance)` | Raycast for block break/place |

**Load Order:** After `chunkData.js`, `chunkManager.js`.

---

### `js/renderer/crosshair.js` — Block Target Highlight

**Purpose:** Wireframe highlight on targeted block, break/place position detection.

**Class:** `Crosshair`

| Method | Description |
|--------|-------------|
| `constructor(renderer)` | Takes VoxelRenderer reference |
| `.update(delta)` | Raycast from camera, update highlight |
| `._updateHighlight(blockPos)` | Show wireframe on targeted block |
| `._hideHighlight()` | Remove wireframe |
| `.getTargetBlock()` | Return `{x, y, z}` of targeted block or null |
| `.getPlacePosition()` | Return adjacent position for block placement |
| `.dispose()` | Clean up highlight mesh |

**Load Order:** After `voxelRenderer.js`.

---

### `js/renderer/skybox.js` — Day/Night Cycle

**Purpose:** Sky color, fog density, sun/moon positioning, time-of-day display.

**Constants:**
| Constant | Value |
|----------|-------|
| `DEFAULT_CYCLE_DURATION` | 720 seconds (12 min full day) |
| `FOG_DENSITY_DAY` | 0.002 |
| `FOG_DENSITY_NIGHT` | 0.008 |
| `AMBIENT_LIGHT` | Object with day/night intensity values |
| `SKY_COLORS` | Color palette for dawn, day, dusk, night |

**Class:** `Skybox`

| Method | Description |
|--------|-------------|
| `constructor(renderer)` | Takes VoxelRenderer reference |
| `.init()` | Create sun/moon meshes, clouds |
| `._createClouds()` | Generate cloud layer |
| `._updateSkyState()` | Update sky color, fog, lights |
| `.update(delta)` | Advance time, update visuals |
| `.setCycleDuration(seconds)` | Override day length |
| `.getTime()` | Current game time in hours (0-24) |
| `.setTime(hours)` | Set absolute time |
| `.isDay()` | Boolean: is it daytime? |
| `.getPhase()` | String: 'dawn', 'day', 'dusk', 'night' |
| `.getTimeLabel()` | Human-readable time string |
| `.getTimeFraction()` | Normalized 0-1 for the day cycle |
| `.getFogDensity()` | Current fog density value |
| `.getAmbientIntensity()` | Current ambient light level |
| `.getStateSummary()` | Debug state object |
| `.dispose()` | Clean up meshes |

**Helper Functions (also exported):** `smoothstep()`, `lerp()`, `hexToRGB()`, `lerpColor()`, `hoursToFraction()`, `fractionToHours()`, `getSkyColorForTime()`, `isDaytime()`, `getSkyPhase()`, etc.

**Load Order:** After `voxelRenderer.js`. Used by `biomeEffects.js` for day/night volume.

---

### `js/renderer/biomeEffects.js` — Biome Particles & Atmosphere

**Purpose:** Lava bubbles, toxic slime particles, corrupt fog based on biome proximity.

**Class:** `BiomeEffects`

| Method | Description |
|--------|-------------|
| `.init(renderer)` | Create particle systems |
| `.update(delta)` | Update all active particles |
| `.setBiome(biomeName)` | Switch active biome effects |
| `.setDayNightFraction(f)` | Adjust intensity based on time of day |
| `.spawnLavaBubbles()` | Spawn rising bubble particles at lava blocks |
| `.spawnToxicBubbles()` | Spawn toxic slime particles |
| `.getFogDensity()` | Get corrupt fog density modifier |
| `.getFogColorHex()` | Get fog color override for corrupt biome |
| `.getActiveParticles()` | Count of active particles |
| `.dispose()` | Clean up particle systems |

**Class:** `ParticleEffect` — Individual particle with lifetime, velocity, alpha.

**Load Order:** After `skybox.js`.

---

### `js/renderer/performanceOptimizer.js` — Auto Performance Tuning

**Purpose:** Monitor FPS, auto-adjust render distance based on device tier.

**Classes:** `PerformanceMonitor`, `PerformanceOptimizer`

| Method | Description |
|--------|-------------|
| `.recordFrame(delta)` | Record frame time for FPS calculation |
| `.getCurrentFPS()` | Return current smoothed FPS |
| `.shouldCheckAdjustment()` | Check if FPS warrants render distance change |
| `.getAdjustment()` | Get recommended delta to render distance |
| `.getStateSummary()` | Debug state object |
| `.reset()` | Clear FPS history |
| `.getRenderDistance()` | Current recommended chunk count |
| `.setRenderDistance(chunks)` | Manually set render distance |
| `.getLowQualityMode()` | Boolean: is low-quality mode active? |
| `.checkAndAdjust()` | Auto-adjust based on current FPS |
| `.resetToDefaults()` | Restore device-tier defaults |

**Helper Functions:** `isTouchDevice()`, `isMobileViewport()`, `estimateDeviceTier()`, `calculateRecommendedRenderDistance()`, `calculateFPSTarget()`

**Load Order:** After `skybox.js`. Used by `chunkManager.js`.

---

### `js/input/keyboard.js` — Keyboard Input

**Purpose:** Track keyboard state for WASD, space, shift, E, number keys.

**Class:** `KeyboardInput`

| Method | Description |
|--------|-------------|
| `constructor()` | Bind keydown/keyup events |
| `._bindEvents()` | Register event listeners |
| `.update(delta)` | Process input each frame |
| `.isJustPressed(keyCode)` | Check if key was pressed this frame (one-shot) |
| `.dispose()` | Remove event listeners |

**Exposed Keys:** `this.keys` object with booleans for each tracked key.

**Load Order:** First input module. No dependencies on other game modules.

---

### `js/input/mouse.js` — Mouse Input

**Purpose:** Pointer lock, click detection, scroll wheel.

**Class:** `MouseInput`

| Method | Description |
|--------|-------------|
| `constructor(camera)` | Takes Three.js camera for look rotation |
| `.requestPointerLock()` | Request browser pointer lock |
| `.exitPointerLock()` | Exit pointer lock |
| `.update(delta)` | Process mouse movement + clicks |
| `.dispose()` | Remove event listeners |

**Properties:** `leftClick`, `rightClick`, `scrollDelta`, `movementX`, `movementY`

**Load Order:** After `keyboard.js`.

---

### `js/input/touch.js` — Touch Controls

**Purpose:** Virtual joystick (left), swipe-to-look (right), tap actions.

**Class:** `TouchInput`

| Method | Description |
|--------|-------------|
| `constructor(camera)` | Takes Three.js camera for look rotation |
| `._bindEvents()` | Register touchstart/touchmove/touchend |
| `.update(delta)` | Process touch input each frame |
| `.consumeLookDeltas()` | Return and clear accumulated look deltas |
| `.checkTap()` | Detect single tap (for break/place) |
| `.dispose()` | Remove event listeners |

**Properties:** `joystickX`, `joystickY` (-1 to 1), `lookDeltaX`, `lookDeltaY`, `isJumping`, `isBreaking`, `isPlacing`

**Load Order:** After `mouse.js`.

---

### `js/input/interaction.js` — Block Interaction

**Purpose:** Bridge between input and world — break/place blocks via raycast.

**Class:** `BlockInteraction`

| Method | Description |
|--------|-------------|
| `constructor(renderer, chunkGrid, keyboard, mouse)` | Takes renderer, grid, and input refs |
| `.update(delta)` | Process break/place actions |
| `._breakBlock()` | Remove block at crosshair target |
| `._placeBlock()` | Add block adjacent to targeted face |
| `._isBreaking()` | Check if currently holding break button |
| `._isPlacing()` | Check if currently holding place button |
| `._updateBreakUI()` | Update break progress indicator |

**Load Order:** Last input module. Depends on `renderer/`, `world/chunkGrid.js`.

---

### `js/entities/player.js` — Player Entity

**Purpose:** Player physics, movement, collision detection.

**Class:** `Player`

| Method | Description |
|--------|-------------|
| `constructor(options)` | Options: `{position, velocity, height, speed, jumpForce}` |
| `.setCreativeMode(enabled)` | Toggle gravity off and fly mode on |
| `.toggleFlyMode()` | Switch between walking and flying |
| `.update(delta)` | Physics update: gravity, movement, collision |
| `._moveWithCollision(dx, dy, dz)` | Move with AABB collision against chunks |
| `._checkCollision(x, y, z, chunkGrid)` | Check if position is solid |
| `._isSolid(blockId)` | Check if block type is solid |
| `.getEyePosition()` | Return camera-relative eye position |
| `.respawn(position)` | Reset to spawn point |

**Properties:** `position` `{x,y,z}`, `velocity` `{x,y,z}`, `onGround`, `isFlying`, `height`, `radius`

**Load Order:** After `chunkData.js`, `inventory.js`. Used by nearly all game systems.

---

### `js/entities/characterManager.js` — Character CRUD (Node.js)

**Purpose:** Server-side character management with persistence layer.

**Class:** `CharacterManager`

| Method | Description |
|--------|-------------|
| `constructor(persistence)` | Takes PersistenceManager instance |
| `.init()` | Load characters from DB |
| `.canCreateMore()` | Check if under MAX_CHARACTERS (3) |
| `.createCharacter(name, color)` | Create and save character |
| `.updateCharacter(id, updates)` | Update name/color |
| `.deleteCharacter(id)` | Remove character |
| `.getCharacter(id)` / `.getAllCharacters()` | Lookup |
| `.selectCharacter(id)` | Mark as selected |
| `.setInventory(id, inventory)` | Set character's inventory data |
| `.serialize()` / `.deserialize(data)` | Save/restore state |

**Constants:** `MAX_CHARACTERS = 3`, `DEFAULT_COLOR = '#4CAF50'`, `CHARACTER_COLORS` array

**Note:** Browser uses `BrowserCharacterManager` in `main.js` instead. This class is for server-side tests.

---

### `js/entities/worldManager.js` — World CRUD (Node.js)

**Purpose:** Server-side world management with persistence layer.

**Class:** `WorldManager`

| Method | Description |
|--------|-------------|
| `constructor(persistence)` | Takes PersistenceManager instance |
| `.init()` | Load worlds from DB |
| `.canCreateMore()` | Check if under MAX_WORLDS (3) |
| `.createWorld(name, seed)` | Create and save world with biome map |
| `.updateWorld(id, updates)` | Update name |
| `.deleteWorld(id)` | Remove world |
| `.getWorld(id)` / `.getAllWorlds()` | Lookup |
| `.selectWorld(id)` | Mark as selected |
| `.getQuestProgress(worldId)` / `.setQuestProgress(worldId, data)` | Quest save/load |
| `.addChunkReference(worldId, cx, cz)` | Track loaded chunks for world |
| `.serialize()` / `.deserialize(data)` | Save/restore state |

**Constants:** `MAX_WORLDS = 3`, `BIOME_NAMES` array

**Note:** Browser uses `BrowserWorldManager` in `main.js` instead. This class is for server-side tests.

---

### `js/entities/boss.js` — Boss Entities

**Purpose:** Multi-phase boss fights with attacks, minions, and shields.

**Classes:** `Boss`, `BossManager`

**Boss Methods:**
| Method | Description |
|--------|-------------|
| `.getHealthPercent()` | Current HP as 0-1 ratio |
| `.getAvailableAttacks()` | Attacks available in current phase |
| `.takeDamage(amount)` | Apply damage, check phase transitions |
| `.die()` | Boss death handler |
| `.checkPhaseTransition()` | Check if health threshold crossed |
| `.transitionToPhase(newPhase)` | Switch to next phase with effects |
| `.executeAttack(attackName)` | Execute specific attack pattern |
| `._spawnMinions()` | Spawn minion entities |
| `._applyShield()` | Activate shield effect |
| `.update(delta)` | AI update based on current behavior (idle/patrol/aggro) |
| `.reset()` | Reset boss to initial state |

**BossManager Methods:**
| Method | Description |
|--------|-------------|
| `constructor(scene)` | Takes Three.js scene reference |
| `.spawnBoss(bossId, position)` | Spawn boss with given ID |
| `.removeBoss(bossId)` | Despawn boss |
| `.getActiveBosses()` | Return all active bosses |
| `.update(delta)` | Update all boss AIs |

**Helper Functions:** `getBossDefinition(bossId)`, `getAllBossIds()`

**Load Order:** After `player.js`. Used by `damageSystem.js`.

---

### `js/entities/questMarker.js` — Quest Markers

**Purpose:** Visual markers for quest objectives in the 3D world.

**Classes:** `QuestMarker`, `QuestMarkerManager`

**QuestMarker Methods:**
| Method | Description |
|--------|-------------|
| `.createMesh()` | Create marker visual (floating icon) |
| `.updateVisuals()` | Update color based on quest state |
| `.interact()` | Trigger quest interaction |
| `.reset()` | Reset marker to inactive |
| `.setActive(bool)` | Toggle visibility |
| `.dispose()` | Remove from scene |

**QuestMarkerManager Methods:**
| Method | Description |
|--------|-------------|
| `constructor(scene)` | Takes Three.js scene reference |
| `.setQuestSystem(questSystem)` | Link to quest system for state |
| `.createAllMarkers()` | Create markers for all quests |
| `.update(delta)` | Update marker visuals + particles |
| `.getInteractableMarkers()` | Return markers within player range |
| `.getClosestMarker(playerPos)` | Find nearest visible marker |

**Load Order:** After `player.js`, `questSystem.js`.

---

### `js/systems/inventory.js` — Inventory System

**Purpose:** Slot-based inventory with hotbar, item stacking, categories.

**Class:** `Inventory`

| Method | Description |
|--------|-------------|
| `constructor(slotCount)` | Default 36 slots (27 storage + 9 hotbar) |
| `.slotIndex(row, col)` | Convert grid position to slot index |
| `.slotPosition(index)` | Convert index to `{row, col}` |
| `.isHotbarSlot(index)` | Check if slot is in hotbar (0-8) |
| `.getSlot(index)` | Return slot data `{typeId, count, name}` or null |
| `.setSlot(index, typeId, count)` | Set item in slot |
| `.clearSlot(index)` | Empty a slot |
| `.getSelectedItem()` | Get currently selected hotbar item |
| `.getSelectedTypeId()` | Get type ID of selected item |
| `.selectHotbarSlot(slotNum)` | Select hotbar slot 0-8 |
| `.cycleSelection(direction)` | Cycle forward/backward in hotbar |
| `.selectByNumber(key)` | Select by number key (1-9) |
| `.addItem(typeId, count)` | Add item with auto-stack |
| `.addToSlot(index, typeId, count)` | Force-add to specific slot |
| `.removeItem(typeId, count)` | Remove items with unstack |
| `.removeFromSlot(index, count)` | Remove from specific slot |

**Constants:** `ITEM_CATEGORIES` (blocks, ores, food, quest), `MAX_STACKS` per item type, `NAMED_ITEMS` display names

**Load Order:** Before `player.js`, `crafting.js`.

---

### `js/systems/crafting.js` — Crafting System

**Purpose:** Recipe discovery and crafting from inventory.

**Class:** `CraftingSystem`

| Method | Description |
|--------|-------------|
| `constructor(inventory)` | Takes Inventory reference |
| `.discoverRecipe(recipeId)` | Unlock a recipe |
| `.isRecipeDiscovered(recipeId)` | Check if recipe is known |
| `.getAvailableRecipes()` | Return discovered recipes |
| `.findMatchingRecipe(inputSlots)` | Match inventory slots to recipe |
| `.canCraft(recipeId)` | Check if player has materials |
| `.craft(recipeId)` | Consume materials, produce result |
| `._hasInInventory(typeId, count)` | Check inventory for item |
| `._removeFromInventory(typeId, count)` | Remove items |
| `._addToInventory(typeId, count)` | Add crafted item |
| `.getRecipeInfo(recipeId)` | Return recipe details |
| `.getAllRecipes()` | Return full recipe registry |

**Load Order:** After `inventory.js`.

---

### `js/systems/survival.js` — Survival Meters

**Purpose:** Health, hunger, thirst, sleep, stamina management.

**Class:** `SurvivalSystem`

| Method | Description |
|--------|-------------|
| `constructor(player)` | Takes Player reference |
| `.update(delta)` | Deplete meters, check death |
| `._depleteMeter(name, rate)` | Reduce meter value over time |
| `.takeDamage(amount, source)` | Apply damage to health |
| `._onDeath()` | Death handler — trigger respawn |
| `.respawn()` | Reset meters, move player to spawn |
| `.setSpawnPoint(x, y, z)` | Set custom spawn |
| `.getSpawnPoint()` | Get current spawn position |
| `.eatFood(foodId)` | Consume food item, restore hunger |
| `.startEating(foodId)` | Begin eating animation |
| `.cancelEating()` | Cancel mid-eat |
| `.isValidFood(typeId)` | Check if block type is edible |
| `.getAvailableFoods()` | Return all food items |

**Constants:** `DAMAGE_SOURCES`, `DEFAULT_METERS` (health/hunger/thirst/sleep/stamina), `STAMINA_COSTS`, `STAMINA_REGEN`, `RESTORATION` values, `FOOD_ITEMS`, `EATING` durations, `DRINKING` config, `BED` config, `BED_COLORS`

**Load Order:** After `player.js`, `spawnManager.js`.

---

### `js/systems/damageSystem.js` — Damage System

**Purpose:** Environmental damage, boss attacks, fall damage, poison.

**Class:** `DamageSystem`

| Method | Description |
|--------|-------------|
| `constructor(player, survival)` | Takes Player and SurvivalSystem refs |
| `.linkSurvivalSystem(survival)` | Set/update survival reference |
| `.update(delta)` | Check all damage sources each frame |
| `._checkEnvironmentalDamage()` | Lava, toxic slime, corrupt stone proximity |
| `._applyPoisonStack()` | Apply poison DoT |
| `._updateFallTracking()` | Track fall distance for impact damage |
| `.calculateFallDamage(fallDistance)` | Calculate damage from fall |
| `.spawnBoss(bossId, position)` | Trigger boss spawn event |
| `.removeBoss(bossId)` | Despawn boss |
| `.getActiveBosses()` | Return active boss list |
| `.damageBoss(bossId, amount)` | Deal damage to boss |
| `.serialize()` | Save damage state |

**Class:** `DamageFlashEffect` — Screen flash on damage taken.

**Helper Functions:** `getBlockDamageSource(blockId)`, `isDamagingBlock(blockId)`, `getEnvironmentalDamageRate()`, `calculateBossAttackDamage()`

**Load Order:** After `survival.js`, `boss.js`.

---

### `js/systems/questSystem.js` — Quest Chain

**Purpose:** Linear quest progression with objectives and rewards.

**Class:** `QuestSystem`

| Method | Description |
|--------|-------------|
| `constructor(worldManager)` | Takes WorldManager reference |
| `._initQuestStates()` | Initialize all quests to not-started |
| `._rebuildChain()` | Reconstruct quest dependency graph |
| `.getQuest(questId)` | Get specific quest data |
| `.getAllQuests()` | Return full quest registry |
| `.getCurrentQuest()` | Get active quest or null |
| `.getNextObjective()` | Get next objective for current quest |
| `.getProgress(questId)` | Get completion progress |
| `.startQuest(questId)` | Begin a quest |
| `.addProgress(questId, amount)` | Add progress toward objective |
| `._checkCompletion()` | Check if current objective is complete |
| `._completeQuest(questId)` | Mark quest done, grant rewards |
| `.isGameComplete()` | Check if all quests finished |
| `.getCompletedCount()` | Number of completed quests |
| `.getCompletionPercentage()` | Overall progress 0-100 |
| `.serialize()` / `.deserialize(data)` | Save/restore state |
| `.reset()` | Reset all quests to initial state |
| `.getMarkerPosition(questId)` | Get world position for quest marker |
| `.getQuestsByDungeon(dungeonId)` | Group quests by dungeon area |

**Constants:** `QUEST_TYPES`, `REWARD_TYPES`, `QUEST_STATES` (not_started, in_progress, completed), `QUEST_REGISTRY`

**Load Order:** After `inventory.js`. Used by `questMarker.js`.

---

### `js/audio/sfx.js` — Procedural Sound Effects

**Purpose:** Generate sound effects via Web Audio API — no audio files needed.

**Class:** `SoundManager`

| Method | Description |
|--------|-------------|
| `constructor()` | Creates AudioContext |
| `.init()` | Initialize audio (must be called after user gesture) |
| `.setMasterVolume(v)` | 0-1 master volume |
| `.setSfxVolume(v)` | 0-1 SFX-specific volume |
| `.playBlockBreak(blockId)` | Play break sound based on material |
| `.playBlockPlace(blockId)` | Play place sound |
| `.playFootstep(surface)` | Footstep based on biome surface |
| `.playJump()` | Jump sound effect |
| `.playLand()` | Landing thud |
| `.playDamage()` | Hurt sound |
| `.playUiClick()` / `.playUiHover()` | Menu sounds |
| `.playEating()` / `.playDrinking()` | Consumption sounds |
| `.stopAll()` | Stop all active sounds |
| `.dispose()` | Close AudioContext |

**Helper Functions:** `getMaterialParams(blockId)`, `getFootstepParams(surface)`, `generateNoiseBuffer(length)`

**Load Order:** No game dependencies. Used by `interaction.js` for break/place sounds.

---

### `js/audio/ambient.js` — Ambient Music

**Purpose:** Biome-specific ambient music layers with day/night volume adjustment.

**Class:** `AmbientManager`

| Method | Description |
|--------|-------------|
| `constructor()` | Creates AudioContext |
| `.init()` | Initialize audio system |
| `.setMasterVolume(v)` | 0-1 master volume |
| `.setTimeOfDay(fraction)` | 0-1 day fraction for volume adjustment |
| `.setBiome(biomeName)` | Switch ambient to biome-specific config |
| `.update(delta)` | Update music layers each frame |
| `.getCurrentBiome()` | Return active biome name |
| `.getEffectiveVolume()` | Current volume after day/night modifier |
| `.getStateSummary()` | Debug state object |
| `.stopAll()` | Stop all ambient layers |
| `.dispose()` | Close AudioContext |

**Helper Functions:** `getNoteFrequency(note)`, `calculateChordFrequencies()`, `getBiomeAmbientConfig(biome)`, `calculateDayNightVolume(fraction)`

**Sound Layer Types:** Atmospheric drone, crackle, whispers, birds, wind — each biome enables different combinations.

**Load Order:** No game dependencies. Used by main.js to set biome based on player position.

---

### `js/multiplayer/client.js` — WebSocket Client

**Purpose:** Dual-connection WebSocket client for matchmaking relay + game session servers.

**Classes:** `MessageQueue`, `WSConnection`, `MultiplayerClient`

**MessageQueue:**
| Method | Description |
|--------|-------------|
| `.enqueue(msg)` | Add message (drops oldest if full) |
| `.dequeue()` | Remove and return first message |
| `.peek()` | View first message without removing |
| `.clear()` | Empty queue |

**WSConnection:**
| Method | Description |
|--------|-------------|
| `constructor({url, wsFactory})` | WebSocket URL + factory function |
| `.connect()` | Open connection with heartbeat |
| `.disconnect()` | Graceful close with LEAVE message |
| `.dispose()` | Hard close, no reconnect |
| `.send(msg)` | Send or queue if disconnected |
| `.on(eventType, callback)` | Register event handler |
| `.off(eventType, callback)` | Remove handler |

**MultiplayerClient (High-Level API):**
| Method | Description |
|--------|-------------|
| `constructor({host, matchmakingPort})` | Server host + port |
| `.connectMatchmaking()` | Connect to matchmaking relay |
| `.onMatchmaking(eventType, callback)` | Matchmaking event handler |
| `.onGame(eventType, callback)` | Game session event handler |
| `.on(eventType, callback)` | Generic — auto-routes to matchmaking or game |
| `.browseSessions()` | Request session list from relay |
| `.hostSession(name, seed, mode)` | Create new session |
| `.joinSession(sessionId)` | Join existing session |
| `.joinGame(character, position, rotation)` | Enter game with player data |
| `.sendMove(position, rotation)` | Send movement update |
| `.breakBlock(x, y, z)` | Send block break |
| `.placeBlock(x, y, z, blockType)` | Send block place |
| `.sendInventory(inventory)` | Send inventory sync |
| `.leaveSession()` | Leave current session (alias for disconnect) |
| `.disconnect()` | Close all connections |
| `.dispose()` | Release all resources |

**Message Types:** `JOIN`, `LEAVE`, `MOVE`, `BREAK_BLOCK`, `PLACE_BLOCK`, `INVENTORY_UPDATE`, `QUEST_UPDATE`, `HEARTBEAT`, `HOST`, `BROWSE`, `WELCOME`, `PLAYER_JOINED`, `PLAYER_LEFT`, `PLAYER_MOVE`, `BLOCK_BREAK`, `BLOCK_PLACE`, `INVENTORY_SYNC`, `CHUNK_DATA`, `HOST_CREATED`, `SESSION_LIST`, `JOIN_ACCEPTED`, `JOIN_REJECTED`, `LEFT_LOBBY`, `ERROR`

**Load Order:** Required by `main.js` SessionManager.

---

### `js/multiplayer/host.js` — Host Session Manager

**Purpose:** Server-side host logic for game sessions — validates all client actions.

**Classes:** `RemotePlayerState`, `RateLimiter`, `HostManager`

**HostManager Methods:**
| Method | Description |
|--------|-------------|
| `constructor(client)` | Takes MultiplayerClient reference |
| `.startSession(config)` | Begin hosting with session config |
| `.endSession()` | Shut down session |
| `.dispose()` | Clean up all state |
| `._handlePlayerJoined(data)` | Process player join |
| `._handlePlayerLeft(data)` | Process player leave |
| `._handlePlayerMove(data)` | Validate + broadcast movement |
| `._handleRemoteBlockBreak(data)` | Validate + broadcast block break |
| `._handleRemoteBlockPlace(data)` | Validate + broadcast block place |
| `._handleInventorySync(data)` | Process inventory update |
| `.requestInventorySync()` | Request full inventory from client |
| `.handleQuestUpdate(data)` | Process quest progress |

**Helper Functions:** `validateBlockBreak()`, `validateBlockPlace()`, `validateMove()`, `validateInventory()`, `validateQuestUpdate()`

**Load Order:** Server-side only. Depends on `multiplayer/client.js`.

---

### `js/multiplayer/playerSync.js` — Remote Player Sync

**Purpose:** Track and interpolate remote player positions for smooth multiplayer movement.

**Classes:** `PingTracker`, `RemotePlayerState`, `PlayerSyncManager`

**PlayerSyncManager Methods:**
| Method | Description |
|--------|-------------|
| `constructor(renderer)` | Takes VoxelRenderer reference |
| `.addPlayer(playerId, data)` | Create remote player mesh |
| `.removePlayer(playerId)` | Remove remote player mesh |
| `.processServerUpdate(data)` | Apply server position update |
| `.update(delta)` | Interpolate all remote players |
| `.getPlayer(playerId)` | Get remote player state |
| `.getActivePlayers()` | Return all tracked players |
| `.setGameMode(mode)` | Update visual based on game mode |

**Helper Functions:** `buildVoxelCharacter(color)` — Create voxel mesh from character color, `shadeColor()`, `distanceBetween()`, `normalizeAngle()`, `isInRenderDistance()`

**Load Order:** After `player.js`. Used by host/client for remote player visuals.

---

### `js/multiplayer/chunkStreamer.js` — Chunk Data Streaming

**Purpose:** Stream chunk data to remote players based on their position and render distance.

**Classes:** `ChunkCompressor`, `ChunkStreamEntry`, `ChunkStreamer`

**ChunkStreamer Methods:**
| Method | Description |
|--------|-------------|
| `constructor(chunkGrid)` | Takes ChunkGrid reference |
| `.updatePlayerPosition(playerId, x, z)` | Track player position for LOD |
| `.calculateChunkNeeds(playerId)` | Determine which chunks player needs |
| `.loadChunk(playerId, cx, cz)` | Send chunk data to player |
| `.unloadChunk(playerId, cx, cz)` | Tell player to unload chunk |
| `.buildStreamQueue()` | Build priority queue of chunks to stream |
| `.tick(delta)` | Process streaming queue each frame |
| `.start()` | Begin periodic streaming |
| `.stop()` | Stop streaming |
| `.dispose()` | Clean up all state |

**Load Order:** After `chunkGrid.js`. Used by host to stream world data.

---

### `js/multiplayer/inventorySync.js` — Inventory Synchronization

**Purpose:** Diff-based inventory sync between host and clients.

**Classes:** `InventoryValidator`, `InventorySync`

**InventorySync Methods:**
| Method | Description |
|--------|-------------|
| `.startPeriodicSync(interval)` | Begin periodic diff sync |
| `.stopPeriodicSync()` | Stop syncing |
| `.applyRemoteSync(data)` | Apply host's inventory update |
| `.getRemoteInventory(playerId)` | Get last known remote inventory |
| `.createSavePayload()` | Create save request for host |
| `.restoreFromSave(data)` | Restore from host save |
| `.dispose()` | Clean up sync state |

**InventoryValidator Methods:**
| Method | Description |
|--------|-------------|
| `.registerPlayer(playerId, inventory)` | Track player inventory |
| `.validateBlockBreak(playerId, slot)` | Check if break is valid |
| `.validateBlockPlace(playerId, slot)` | Check if place is valid |
| `.processInventoryUpdate(playerId, data)` | Apply and validate update |

**Helper Functions:** `getItemCategory()`, `getMaxStackSize()`, `isValidTypeId()`, `computeInventoryDiff()`, `applyInventoryDiff()`, `serializeInventory()`, `deserializeInventory()`

**Load Order:** After `inventory.js`. Used by host/client.

---

### `js/multiplayer/playerListHUD.js` — Player List UI

**Purpose:** In-game player list overlay (top-left corner).

**Classes:** `PlayerListState`, `PlayerListHUD`

**PlayerListHUD Methods:**
| Method | Description |
|--------|-------------|
| `.show()` | Display player list |
| `.hide()` | Hide player list |
| `.toggleCollapse()` | Expand/collapse list |
| `.updatePlayers(players)` | Refresh player data |
| `.addPlayer(playerData)` | Add single player entry |
| `.removePlayer(playerId)` | Remove player entry |
| `.getPlayerCount()` | Number of players shown |
| `.getPlayers()` | Return all displayed players |
| `.clear()` | Clear list |
| `._render()` | Re-render DOM |
| `.destroy()` | Clean up DOM elements |

**Helper Functions:** `escapeHtml()`, `getHealthColor(percent)`, `isMobileViewport()`

**Load Order:** No game dependencies. Used by `main.js` for lobby + in-game HUD.

---

### `js/game.js` — Game Loop & Mode Management

**Purpose:** Main game loop, creative/survival mode switching.

**Classes:** `DoubleTapDetector`, `BlockPalette`, `Game`

**Game Methods:**
| Method | Description |
|--------|-------------|
| `constructor()` | Initialize with survival mode default |
| `.start(mode)` | Start game loop in specified mode |
| `.stop()` | Stop game loop |
| `.setMode(mode)` | Switch between 'survival' and 'creative' |
| `.isCreative()` | Check if creative mode active |
| `.isSurvival()` | Check if survival mode active |
| `.canPlaceBlock(blockId, inventory)` | Mode-dependent block placement check |
| `.update(timestamp)` | Main game loop tick (requestAnimationFrame) |

**Properties:** `running`, `mode`, `delta`, `player`, `blockPalette`, `onModeChange`

**Constants:** `Game.MODES = {SURVIVAL: 'survival', CREATIVE: 'creative'}`

**Global:** `window.CuubzGame`, `window.CuubzDoubleTapDetector`, `window.CuubzBlockPalette`

**Load Order:** After all systems. Used by `main.js` to start game after world selection.

---

### `js/main.js` — Browser Entry Point

**Purpose:** Menu system, screen management, character/world CRUD (browser), session manager, multiplayer UI wiring.

**Classes:** `BrowserCharacterManager`, `BrowserWorldManager`, `SessionManager`

**Screen Flow:**
```
mainMenu → characterScreen → worldScreen → modeScreen → loadingScreen → game
   ↓           ↓                  ↓            ↓
settings    createCharModal   createWorld   lobbyScreen (multiplayer)
```

**BrowserCharacterManager Methods:** Same API as `entities/characterManager.js` but runs in browser with IndexedDB.

**BrowserWorldManager Methods:** Same API as `entities/worldManager.js` but runs in browser with IndexedDB.

**SessionManager Methods:**
| Method | Description |
|--------|-------------|
| `constructor()` | Initialize multiplayer state |
| `.init(serverUrl)` | Create MultiplayerClient, wire events |
| `._wireClientEvents()` | Connect client events to UI callbacks |
| `.browseSessions()` | Request session list |
| `.startHosting()` | Validate form, create session |
| `.joinSession(sessionId)` | Join existing session |
| `.leaveSession()` | Disconnect and reset state |

**Global Functions (inside IIFE):** `showScreen()`, `renderCharacterSlots()`, `renderWorldSlots()`, `initMenuNavigation()`, `detectMobile()`, `initSessionUI()`, `escapeHtml()`, `openCreateModal()`, `openEditModal()`, `closeCharModal()`, `openDeleteModal()`, `closeDeleteModal()`, `showCharError()`, `hideCharError()`

**Global Variables:** `characterManager` (BrowserCharacterManager), `worldManager` (BrowserWorldManager), `sessionManager` (SessionManager)

**Initialization:**
1. DOMContentLoaded fires `init()`
2. Creates PersistenceManager → initializes IndexedDB
3. Creates BrowserCharacterManager → loads characters
4. Creates BrowserWorldManager → loads worlds
5. Calls `initMenuNavigation()` → wires button handlers
6. Shows main menu screen

**Load Order:** MUST be last — it depends on all other modules.

---

## Dependency Graph (Load Order)

```
Phase 1: Utilities
  └── js/util/logger.js

Phase 2: World Data (foundation)
  ├── js/world/noise.js
  ├── js/world/chunkData.js          ← Required by almost everything
  └── js/world/biomeSystem.js        ← Depends on noise.js, chunkData.js

Phase 3: World Generation
  ├── js/world/caveGenerator.js      ← Depends on noise.js, chunkData.js
  ├── js/world/oreGenerator.js       ← Depends on noise.js, chunkData.js
  ├── js/world/featurePlacer.js      ← Depends on noise.js, biomeSystem.js, chunkData.js
  ├── js/world/chunkGrid.js          ← Depends on chunkData.js
  ├── js/world/persistence.js        ← Depends on chunkData.js
  ├── js/world/spawnManager.js       ← Depends on chunkData.js
  └── js/world/worldGenerator.js     ← Depends on ALL above world modules

Phase 4: Renderer
  ├── js/renderer/chunkMeshBuilder.js    ← Depends on chunkData.js
  ├── js/renderer/chunkManager.js        ← Depends on chunkData.js, chunkMeshBuilder.js
  ├── js/renderer/voxelRenderer.js       ← Depends on chunkData.js, chunkManager.js
  ├── js/renderer/crosshair.js           ← Depends on voxelRenderer.js
  ├── js/renderer/skybox.js              ← Depends on voxelRenderer.js
  ├── js/renderer/biomeEffects.js        ← Depends on skybox.js
  └── js/renderer/performanceOptimizer.js

Phase 5: Input
  ├── js/input/keyboard.js
  ├── js/input/mouse.js                  ← Depends on keyboard.js
  ├── js/input/touch.js                  ← Depends on mouse.js
  └── js/input/interaction.js            ← Depends on all above + chunkGrid.js

Phase 6: Entities
  ├── js/entities/player.js              ← Depends on chunkData.js, inventory.js
  ├── js/entities/characterManager.js    ← (Node.js only) Depends on persistence.js, inventory.js
  ├── js/entities/worldManager.js        ← (Node.js only) Depends on persistence.js, chunkData.js
  ├── js/entities/boss.js                ← Depends on player.js
  └── js/entities/questMarker.js         ← Depends on player.js, questSystem.js

Phase 7: Systems
  ├── js/systems/inventory.js            ← Foundation for crafting/survival
  ├── js/systems/crafting.js             ← Depends on inventory.js
  ├── js/systems/survival.js             ← Depends on player.js, spawnManager.js
  ├── js/systems/damageSystem.js         ← Depends on survival.js, boss.js
  └── js/systems/questSystem.js          ← Depends on inventory.js

Phase 8: Audio
  ├── js/audio/sfx.js                    ← No game dependencies
  └── js/audio/ambient.js                ← No game dependencies

Phase 9: Multiplayer
  ├── js/multiplayer/client.js           ← Foundation for multiplayer
  ├── js/multiplayer/host.js             ← (Node.js only) Depends on client.js
  ├── js/multiplayer/playerSync.js       ← Depends on player.js, client.js
  ├── js/multiplayer/chunkStreamer.js    ← Depends on chunkGrid.js
  ├── js/multiplayer/inventorySync.js    ← Depends on inventory.js
  └── js/multiplayer/playerListHUD.js    ← No game dependencies

Phase 10: Game Loop
  └── js/game.js                         ← Depends on player.js, all systems

Phase 11: Browser Entry (MUST BE LAST)
  └── js/main.js                         ← Depends on EVERYTHING above
```

---

## Server-Side Code

### `server/index.js`
HTTP server that serves static files + WebSocket upgrade handler. Routes to matchmaking or session based on path.

### `server/matchmaking.js`
Session discovery relay (port 8765). Handles:
- `HOST` — Register new game session
- `BROWSE` — Return list of available sessions
- `JOIN_ACCEPTED` / `JOIN_REJECTED` — Forward join results
- `LEFT_LOBBY` — Notify when player leaves

### `server/session.js`
Game session host. Manages:
- Player connections (max 4)
- Block break/place validation and broadcasting
- Movement synchronization
- Inventory sync relay
- Quest progress tracking
- Chunk data streaming to clients

---

## Constants Reference

| Constant | File | Value | Description |
|----------|------|-------|-------------|
| `BLOCK_TYPES` | chunkData.js | Object (31 types) | Block type ID registry |
| `BLOCK_PROPERTIES` | chunkData.js | Object | Per-block solid/transparent/hardness/damage |
| `CHUNK_WIDTH/DEPTH/HEIGHT` | chunkData.js | 16/16/96 | Chunk dimensions |
| `SEA_LEVEL/MIN_Y/MAX_Y` | chunkData.js | 0/-32/64 | World height bounds |
| `BIOMES/BIOME_LIST` | biomeSystem.js | 8 biomes | Biome definitions |
| `MODES` | game.js | `{SURVIVAL, CREATIVE}` | Game mode constants |
| `MAX_CHARACTERS` | main.js | 3 | Browser character limit |
| `MAX_WORLDS` | main.js | 3 | Browser world limit |
| `DB_NAME/DB_VERSION` | persistence.js | `'CuubzDB'`, 1 | IndexedDB config |
| `DEFAULT_CYCLE_DURATION` | skybox.js | 720s | Day/night cycle length |
| `ITEM_CATEGORIES/MAX_STACKS` | inventory.js | Object | Item classification |
| `DAMAGE_SOURCES/DEFAULT_METERS` | survival.js | Object | Survival system config |
| `QUEST_STATES/QUEST_REGISTRY` | questSystem.js | Object | Quest definitions |

---

## Testing

- **Test Runner:** `test/run_tests.sh` — runs all test files with Node.js
- **Framework:** Custom assertion framework in `test/test_framework.js`
- **Environment:** jsdom for DOM simulation, mocked WebSocket connections
- **Test Count:** ~65 test files covering world gen, player physics, multiplayer sync, inventory, crafting, survival, quests, audio, rendering

Run with:
```bash
cd test && bash run_tests.sh
```

---

## Deployment

```bash
bash sync.sh  # rsync to game server at dadmin@10.0.30.160:/var/www/html
```

The game is served as static files — no build step required. All JS runs in the browser via script tags.

---

## Known Issues & TODOs

- Game loop in `game.js` has all system updates commented out — main.js handles the actual update cycle
- `BlockPalette` uses `require()` which fails in browser (falls back to hardcoded block list)
- Multiplayer requires running server (`server/index.js`) with matchmaking relay on port 8765
- No texture atlas — each block type loads individual PNG textures
