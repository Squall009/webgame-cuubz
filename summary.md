# Cuubz — Project Summary & Architecture Reference

## Overview

Cuubz is a web-based Minecraft-style voxel game with multiplayer support for up to 4 players. It uses **vanilla JavaScript with no build tooling** — every `.js` file is loaded as a `<script>` tag in dependency order via `index.html`. Classes and constants are exposed on the global scope (no module imports).

### Tech Stack
- **Three.js r134** (local copy) — 3D voxel rendering
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
│   │   ├── textureAtlas.js      # Dynamic atlas from textures/ manifest.json
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
├── textures/               # 32×32 PNG block textures (30 files + manifest.json)
├── scripts/                # Python utility scripts
│   ├── generate_textures.py# Procedural texture generator
│   └── check_pillow.py     # Pillow library availability checker
├── test/                   # Node.js test suite (jsdom + mocked WebSocket)
│   ├── run_tests.sh        # Test runner script
│   └── test_*.js           # ~58 individual test files
├── sync.sh                 # Deploy to game server via tar-over-SSH
├── package.json            # Dependencies: jsdom, ws (in server/)
├── todo.md                 # Implementation phases and tracking
├── summary.md              # This file — architecture reference
└── README.md               # Project overview
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
|| `CHUNK_HEIGHT` | 96 | Total height (MIN_Y=0 to MAX_Y=95) ||
|| `SEA_LEVEL` | 32 | Water surface level — aquifer threshold ||
|| `MIN_Y` | 0 | Bottom of world (bedrock layer) ||
|| `MAX_Y` | 96 | Top of world (exclusive, valid Y: 0–95) ||

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

**Purpose:** Determine biome from four noise-derived climate values, select surface/subsurface/fluid blocks.

**Class:** `BiomeSystem`

|| Property/Method | Description ||
|-----------------|-------------||
| `BIOMES` | Object with 8 biomes: OCEAN, PLAINS, FOREST, DESERT, TUNDRA, MOUNTAINS, LAVA, CORRUPT — each has `{id, fluid, surface: [topBlock, subBlock]}` ||
| `.getBiome(temp, humidity, continentalness, erosion)` | Classify biome from climate values (see thresholds below) ||

**Biome Thresholds:**
1. **Ocean** — continentalness < 0.35
2. **Lava/Corrupt** — erosion > 0.8 (lava if temp > 0.5, corrupt otherwise)
3. **Mountains** — continentalness > 0.7 AND erosion < 0.4
4. **Desert** — temp > 0.6 AND humidity < 0.35
5. **Forest** — temp > 0.6 AND humidity ≥ 0.35, OR temp ≤ 0.6 AND humidity > 0.5
6. **Tundra** — temp < 0.35
7. **Plains** — default (temp 0.35–0.6, humidity ≤ 0.5)

**Biome Surface Blocks:**
| Biome | Fluid | Top Block | Sub Block |
|-------|-------|-----------|-----------|
| Plains | WATER | GRASS | DIRT |
| Forest | WATER | GRASS | DIRT |
| Desert | AIR | SAND | SAND |
| Tundra | ICE | SNOW | STONE |
| Mountains | WATER | STONE* | STONE |
| Ocean | WATER | SAND | GRAVEL |
| Lava | LAVA | BLACKSTONE | BLACKSTONE |
| Corrupt | TOXIC_SLIME | CORRUPT_STONE | OBSIDIAN |

*Mountains use SNOW above Y=78.

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

### `js/world/worldGenerator.js` — World Generation Pipeline (12-Phase)

**Purpose:** Orchestrate terrain generation for a single chunk using density-based voxel placement with biome shaping, cave carving, and aquifer resolution.

**Class:** `WorldGenerator`

|| Method | Description ||
|--------|-------------||
| `constructor(seed)` | Create with world seed; initializes NoiseGenerator + BiomeSystem |
| `.generateChunk(chunkX, chunkZ)` | Full 12-phase pipeline (see below) |
| `._sampleClimate(wx, wz)` | Sample temperature/humidity/continentalness/erosion grid for a chunk |
| `._calculateDensity(wx, y, wz, climate, biome)` | Density function: continentalness + noise terms − gravity |
| `._sampleCaves(wx, y, wz, biome)` | Cave threshold via low/high frequency noise comparison |
| `._applySurfacePass(chunk, lx, lz, biome)` | Replace top stone with biome-specific surface blocks |
| `._getOreAt(wx, wy, wz)` | Ore placement by depth (diamond <12, gold <22, iron <35) |
| `._applyCarvers(chunk)` | Random sphere carver for caves/chambers |
| `._carveSphere(chunk, wx, wy, wz, r)` | Carve air sphere, preserving water blocks below sea level |
| `._placeDecor(chunk, x, y, z, biome)` | Trees, flowers, cacti based on biome + noise hash |

**12-Phase Pipeline (per chunk):**
1. **Climate Sampling** — Generate 16×16 grid of temp/humidity/continentalness/erosion values via Perlin noise with contrast stretching
2. **Biome Classification** — For each column, classify biome from climate values (ocean <0.35 cont, lava/corrupt >0.8 eros, mountains high cont+low eros, then temp/humidity grid)
3. **Density Calculation** — Per-column density = base continentalness + erosion noise + ridge noise + detail noise − exponential gravity
4. **Biome Shaping** — Mountains: reduce gravity ×0.6, boost ridge ×1.8; Plains: flatten ridge ×0.3, push down gravity ×1.2
5. **River Carving** — Low river noise values carve deep trenches (density −25)
6. **Block Placement** — density > 0 → stone; else water/air based on aquifer threshold
7. **Aquifer Resolution** — Water fills columns below `32 + aqNoise × 12` capped at sea level 32
8. **Bedrock** — y=0 always set to BEDROCK
9. **Ore Placement** — Density check for ore thresholds by depth
10. **Carver Application** — Random sphere carvers (3% chance per chunk) carve tunnels/chambers
11. **Surface Pass** — Scan top-down, replace first stone/ore with biome surface blocks (grass/dirt, sand, snow, etc.)
12. **Decoration Placement** — Trees in forest, flowers in plains, cacti in desert

**Load Order:** Last world module. Depends on `noise.js`, `biomeSystem.js`, `chunkData.js`.

---

### `js/main.js` — Browser Entry & Spawn Logic

**Purpose:** Menu navigation, screen flow, chunk loading, player spawn, and game loop bootstrap.

**Key spawn behavior (lines ~1560–1672):**
- After all initial chunks are loaded (~17×17 area with renderDistance 8), scans **every loaded chunk** for plains surface blocks (`GRASS` or `DIRT`)
- For each candidate, verifies:
  - Ground block is above sea level (y > 28)
  - Column directly above ground has ZERO blocks from y+1 all the way to Y=95 (top of world) — no trees, overhangs, water, or anything blocking sky
  - All 8 adjacent columns at spawn height are clear of solid/fluid blocks (player won't clip into walls), **peeking into neighboring chunks** when a candidate is near a chunk boundary
- Tracks the **actual world coordinates** `(bestSpawnX, bestSpawnZ)` of the highest valid dry spawn point found across all chunks
- Player spawns centered in that column: `x = bestSpawnX + 0.5`, `z = bestSpawnZ + 0.5` at height = `bestSpawnY + 1.625 + 2` — the `+2` ensures a clean drop onto the surface
- Falls back to `(0, 34, 0)` if no valid dry spawn found (shouldn't happen with large initial area)

**Debug output (check browser console):**
```
[Cuubz] Spawn search: N grass/dirt candidates, M accepted, X rejected (column not clear), Y rejected (adjacent blocked)
[Cuubz] WARNING: No valid dry spawn found! Falling back to Y=Z   ← if no candidate passed all checks
[Cuubz] Spawn selected at world (X, Y, Z)                     ← final chosen coordinates
[Cuubz] Player placed at (X.XX, Y.YY, Z.ZZ)                  ← actual player position
```

**World creation flow:**
- Clicking "Create New World" opens a modal that pre-fills a random seed in the **Seed** input field
- User can edit the seed or leave it blank — blank means generate another random seed on save
- On save, the seed is parsed as an integer (supports negative values) and passed to `BrowserWorldManager.createWorld(name, seed)`
- The world object stores the seed in both `world.seed` and `world.biomeMap.seed`
- When starting a game (solo or multiplayer host), `currentWorld.seed` is passed to `new WorldGenerator(seed)` for deterministic terrain generation

**Load Order:** Last file loaded in `index.html`. Depends on all other modules.

---

### `js/renderer/textureAtlas.js` — Dynamic Texture Atlas Builder

**Purpose:** Dynamically scan `textures/` folder for PNG files matching the naming convention (`BLOCKID_SIDENUM-basefilename.png`) and build a single Three.js texture atlas with UV mapping computed from the manifest.

**Class:** `TextureAtlas`

| Method | Description |
|--------|-------------|
| `constructor()` | Initialize empty atlas state |
| `.buildAtlas()` | Async: load manifest.json, scan textures, build canvas + THREE.Texture |
| `_discoverTextures()` | Parse manifest or fall back to known block ID ranges |
| `.getDebugInfo()` | Return array of `{blockId, sideNum, col, row}` for overlay rendering |

**Key Properties:**
- `sideMap[blockId]` → `{ count, baseSlot, tiles: [{file, col, row}] }` — maps each block ID to its atlas tile positions (supports multi-side blocks like grass_top/grass_side)
- `nameToId[baseName]` → block ID — reverse lookup from texture name
- `idToName[blockId]` → base name — display name for tooltips
- `tileSize` — read from first loaded texture (default 32px)
- `gridW/gridH/totalTiles` — atlas grid dimensions

**Naming Convention:** Files must match `^(\d+)_(\d+)-(.+)\.png$` → `{blockId}_{sideNum}-{basename}.png`. Example: `1_0-grass_top.png`, `1_1-grass_side.png`, `2_0-dirt.png`.

**Adding new textures:** Just drop a PNG in `textures/` with the correct naming convention — the next game load picks it up automatically.

**Load Order:** Before `chunkMeshBuilder.js`. Used by `ChunkManager` to pass texture atlas to mesh builder for UV coordinate generation.

---

### `js/renderer/chunkMeshBuilder.js` — Mesh Builder

**Purpose:** Build Three.js geometry from chunk data with face culling and UV mapping from the texture atlas.

**Class:** `ChunkMeshBuilder`

| Method | Description |
|--------|-------------|
| `.buildMeshData(chunk)` | Generate vertex/UV/index arrays (face culling applied) |
| `._isTransparent(blockId)` | Check if block has transparent faces |
| `.buildThreeGeometry(meshData, materialIndex)` | Create Three.js BufferGeometry |
| `.estimateFaceCount(chunk)` | Approximate face count before building |

**Load Order:** After `chunkData.js`, `textureAtlas.js`. Used by `chunkManager.js`.

---

### `js/renderer/chunkManager.js` — Chunk Render Manager

**Purpose:** Async queue for building/unloading chunk meshes based on player position.

**Class:** `ChunkManager`

| Method | Description |
|--------|-------------|
| `constructor(renderer, generateFn, options)` | Takes renderer, world gen function, and config (textureAtlas, renderDistance, persistence, worldId) |
| `.update(delta, playerX, playerZ, now)` | Process build/unload queue each frame |
| `._queueBuild(cx, cz)` | Queue chunk for mesh generation |
| `_processQueue()` | Build next pending chunk (async via setTimeout) |
| `._buildChunk(cx, cz)` | Generate mesh and add to scene |
| `._unloadChunk(cx, cz)` | Remove mesh from scene |
| `.setRenderDistance(chunks)` | Update render distance setting |
| `.getLoadedCount()` | Number of rendered chunks |
| `.linkNeighbors()` | Link neighbor references for face culling |
| `.rebuildChunkMesh(cx, cz)` | Rebuild a chunk's mesh with updated neighbor data |
| `.dispose()` | Clean up all meshes |

**Load Order:** After `chunkData.js`, `textureAtlas.js`, `chunkMeshBuilder.js`. Used by `voxelRenderer.js` and the main game loop.

---

### `js/renderer/voxelRenderer.js` — Three.js Renderer

**Purpose:** Three.js scene, camera, renderer, and raycasting.

**Class:** `VoxelRenderer`

| Method | Description |
|--------|-------------|
| `constructor(container, width, height)` | Initialize Three.js scene + WebGLRenderer |
| `._initThree()` | Create scene, camera, lights, fog |
| `.loadTexture(path)` | Load PNG texture into map |
| `.updateCamera(position, yaw, pitch)` | Update camera position and look direction |
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
| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_CYCLE_DURATION` | 720 seconds (12 min full day) | Day cycle length |
| `FOG_DENSITY_DAY` | 0.002 | Fog density during daytime |
| `FOG_DENSITY_NIGHT` | 0.008 | Fog density at night |

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
| `.dispose()` | Clean up meshes |

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
| `.dispose()` | Clean up particle systems |

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
| `.update(delta)` | Process input each frame |
| `.isJustPressed(keyCode)` | Check if key was pressed this frame (one-shot) |
| `.dispose()` | Remove event listeners |

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

---

### `js/input/touch.js` — Touch Controls

**Purpose:** Virtual joystick (left), swipe-to-look (right), tap actions.

**Class:** `TouchInput`

| Method | Description |
|--------|-------------|
| `constructor(camera)` | Takes Three.js camera for look rotation |
| `.update(delta)` | Process touch input each frame |
| `.consumeLookDeltas()` | Return and clear accumulated look deltas |
| `.checkTap()` | Detect single tap (for break/place) |
| `.dispose()` | Remove event listeners |

**Properties:** `joystickX`, `joystickY` (-1 to 1), `lookDeltaX`, `lookDeltaY`, `isJumping`, `isBreaking`, `isPlacing`

---

### `js/input/interaction.js` — Block Interaction

**Purpose:** Bridge between input and world — break/place blocks via raycast.

**Class:** `BlockInteraction`

| Method | Description |
|--------|-------------|
| `constructor(options)` | Takes `{renderer, chunkManager, mouse, player}` |
| `.update(delta)` | Process break/place actions each frame |
| `._breakBlock()` | Remove block at crosshair target |
| `._placeBlock()` | Add block adjacent to targeted face |

**Load Order:** Last input module. Depends on renderer and world modules.

---

### `js/entities/player.js` — Player Entity

**Purpose:** Player physics, movement, collision detection.

**Class:** `Player`

| Method | Description |
|--------|-------------|
| `constructor(options)` | Options: `{position, velocity, height, speed, jumpForce}` |
| `.setCreativeMode(enabled)` | Toggle gravity off and fly mode on |
| `.toggleFlyMode()` | Switch between walking and flying |
| `.update(delta, inputState, chunkWorld)` | Physics update with collision against chunk data |
| `._moveWithCollision(dx, dy, dz)` | Move with AABB collision against chunks |
| `.getEyePosition()` | Return camera-relative eye position |

**Properties:** `position {x,y,z}`, `velocity {x,y,z}`, `onGround`, `isFlying`, `height`, `radius`, `yaw`, `pitch`

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
| `.deleteCharacter(id)` | Remove character |
| `.selectCharacter(id)` | Mark as selected |

**Note:** Browser uses `BrowserCharacterManager` in `main.js` instead. This class is for server-side tests.

---

### `js/entities/worldManager.js` — World CRUD (Node.js)

**Purpose:** Server-side world management with persistence layer.

**Class:** `WorldManager`

| Method | Description |
|--------|-------------|
| `.createWorld(name, seed)` | Create and save world with biome map |
| `.deleteWorld(id)` | Remove world |
| `.selectWorld(id)` | Mark as selected |
| `.getQuestProgress(worldId)` / `.setQuestProgress(worldId, data)` | Quest save/load |

**Note:** Browser uses `BrowserWorldManager` in `main.js` instead. This class is for server-side tests.

---

### `js/entities/boss.js` — Boss Entities

**Purpose:** Multi-phase boss fights with attacks, minions, and shields.

**Classes:** `Boss`, `BossManager`

| Method | Description |
|--------|-------------|
| `.getHealthPercent()` | Current HP as 0-1 ratio |
| `.takeDamage(amount)` | Apply damage, check phase transitions |
| `.transitionToPhase(newPhase)` | Switch to next phase with effects |
| `.executeAttack(attackName)` | Execute specific attack pattern |
| `.update(delta)` | AI update based on current behavior (idle/patrol/aggro) |

**BossManager Methods:** `spawnBoss(bossId, position)`, `removeBoss(bossId)`, `getActiveBosses()`, `update(delta)`

---

### `js/entities/questMarker.js` — Quest Markers

**Purpose:** Visual markers for quest objectives in the 3D world.

**Classes:** `QuestMarker`, `QuestMarkerManager`

| Method | Description |
|--------|-------------|
| `.createMesh()` | Create marker visual (floating icon) |
| `.updateVisuals()` | Update color based on quest state |
| `.interact()` | Trigger quest interaction |
| `.setActive(bool)` | Toggle visibility |

**QuestMarkerManager:** `createAllMarkers()`, `update(delta)`, `getInteractableMarkers(playerPos)`, `getClosestMarker(playerPos)`

---

### `js/systems/inventory.js` — Inventory System

**Purpose:** Slot-based inventory with hotbar, item stacking, categories.

**Class:** `Inventory`

| Method | Description |
|--------|-------------|
| `constructor(slotCount)` | Default 36 slots (27 storage + 9 hotbar) |
| `.getSlot(index)` | Return slot data `{typeId, count, name}` or null |
| `.setSlot(index, typeId, count)` | Set item in slot |
| `.addItem(typeId, count)` | Add item with auto-stack |
| `.removeItem(typeId, count)` | Remove items with unstack |
| `.selectHotbarSlot(slotNum)` | Select hotbar slot 0-8 |
| `.getSelectedItem()` | Get currently selected hotbar item |

**Constants:** `ITEM_CATEGORIES` (blocks, ores, food, quest), `MAX_STACKS` per item type, `NAMED_ITEMS` display names

---

### `js/systems/crafting.js` — Crafting System

**Purpose:** Recipe discovery and crafting from inventory.

**Class:** `CraftingSystem`

| Method | Description |
|--------|-------------|
| `.discoverRecipe(recipeId)` | Unlock a recipe |
| `.isRecipeDiscovered(recipeId)` | Check if recipe is known |
| `.canCraft(recipeId)` | Check if player has materials |
| `.craft(recipeId)` | Consume materials, produce result |

---

### `js/systems/survival.js` — Survival Meters

**Purpose:** Health, hunger, thirst, sleep, stamina management.

**Class:** `SurvivalSystem`

| Method | Description |
|--------|-------------|
| `.update(delta)` | Deplete meters, check death |
| `.takeDamage(amount, source)` | Apply damage to health |
| `.respawn()` | Reset meters, move player to spawn |
| `.eatFood(foodId)` | Consume food item, restore hunger |

**Constants:** `DAMAGE_SOURCES`, `DEFAULT_METERS` (health/hunger/thirst/sleep/stamina), `STAMINA_COSTS/REGEN`, `FOOD_ITEMS`, `EATING` durations, `BED` config

---

### `js/systems/damageSystem.js` — Damage System

**Purpose:** Environmental damage, boss attacks, fall damage, poison.

**Class:** `DamageSystem`

| Method | Description |
|--------|-------------|
| `.update(delta)` | Check all damage sources each frame |
| `._checkEnvironmentalDamage()` | Lava, toxic slime, corrupt stone proximity |
| `.calculateFallDamage(fallDistance)` | Calculate damage from fall |
| `.damageBoss(bossId, amount)` | Deal damage to boss |

**Class:** `DamageFlashEffect` — Screen flash on damage taken.

---

### `js/systems/questSystem.js` — Quest Chain

**Purpose:** Linear quest progression with objectives and rewards.

**Class:** `QuestSystem`

| Method | Description |
|--------|-------------|
| `.getCurrentQuest()` | Get active quest or null |
| `.getNextObjective()` | Get next objective for current quest |
| `.startQuest(questId)` | Begin a quest |
| `.addProgress(questId, amount)` | Add progress toward objective |
| `._checkCompletion()` | Check if current objective is complete |
| `.isGameComplete()` | Check if all quests finished |

**Constants:** `QUEST_TYPES`, `REWARD_TYPES`, `QUEST_STATES` (not_started, in_progress, completed), `QUEST_REGISTRY`

---

### `js/audio/sfx.js` — Procedural Sound Effects

**Purpose:** Generate sound effects via Web Audio API — no audio files needed.

**Class:** `SoundManager`

| Method | Description |
|--------|-------------|
| `.init()` | Initialize audio (must be called after user gesture) |
| `.playBlockBreak(blockId)` | Play break sound based on material |
| `.playBlockPlace(blockId)` | Play place sound |
| `.playFootstep(surface)` | Footstep based on biome surface |
| `.playJump()` / `.playLand()` | Jump/landing sounds |
| `.stopAll()` | Stop all active sounds |

---

### `js/audio/ambient.js` — Ambient Music

**Purpose:** Biome-specific ambient music layers with day/night volume adjustment.

**Class:** `AmbientManager`

| Method | Description |
|--------|-------------|
| `.init()` | Initialize audio system |
| `.setBiome(biomeName)` | Switch ambient to biome-specific config |
| `.update(delta)` | Update music layers each frame |
| `.getEffectiveVolume()` | Current volume after day/night modifier |

**Sound Layer Types:** Atmospheric drone, crackle, whispers, birds, wind — each biome enables different combinations.

---

### `js/multiplayer/client.js` — WebSocket Client

**Purpose:** Dual-connection WebSocket client for matchmaking relay + game session servers.

**Classes:** `MessageQueue`, `WSConnection`, `MultiplayerClient`

| Method | Description |
|--------|-------------|
| `.connectMatchmaking()` | Connect to matchmaking relay |
| `.browseSessions()` | Request session list from relay |
| `.hostSession(name, seed, mode)` | Create new session |
| `.joinSession(sessionId)` | Join existing session |
| `.breakBlock(x, y, z)` | Send block break |
| `.placeBlock(x, y, z, blockType)` | Send block place |

**Message Types:** `JOIN`, `LEAVE`, `MOVE`, `BREAK_BLOCK`, `PLACE_BLOCK`, `INVENTORY_UPDATE`, `QUEST_UPDATE`, `HEARTBEAT`, `HOST`, `BROWSE`, `WELCOME`, `PLAYER_JOINED`, `PLAYER_LEFT`, `PLAYER_MOVE`, `BLOCK_BREAK`, `BLOCK_PLACE`, `INVENTORY_SYNC`, `CHUNK_DATA`, `HOST_CREATED`, `SESSION_LIST`, `JOIN_ACCEPTED`, `JOIN_REJECTED`, `LEFT_LOBBY`, `ERROR`

---

### `js/multiplayer/host.js` — Host Session Manager

**Purpose:** Server-side host logic for game sessions — validates all client actions.

**Classes:** `RemotePlayerState`, `RateLimiter`, `HostManager`

| Method | Description |
|--------|-------------|
| `.startSession(config)` | Begin hosting with session config |
| `.endSession()` | Shut down session |
| `._handlePlayerJoined(data)` | Process player join |
| `._handleRemoteBlockBreak(data)` | Validate + broadcast block break |

---

### `js/multiplayer/playerSync.js` — Remote Player Sync

**Purpose:** Track and interpolate remote player positions for smooth multiplayer movement.

**Classes:** `PingTracker`, `RemotePlayerState`, `PlayerSyncManager`

| Method | Description |
|--------|-------------|
| `.addPlayer(playerId, data)` | Create remote player mesh |
| `.processServerUpdate(data)` | Apply server position update |
| `.update(delta)` | Interpolate all remote players |

**Helper Functions:** `buildVoxelCharacter(color)` — Create voxel mesh from character color.

---

### `js/multiplayer/chunkStreamer.js` — Chunk Data Streaming

**Purpose:** Stream chunk data to remote players based on their position and render distance.

**Classes:** `ChunkCompressor`, `ChunkStreamEntry`, `ChunkStreamer`

| Method | Description |
|--------|-------------|
| `.updatePlayerPosition(playerId, x, z)` | Track player position for LOD |
| `.calculateChunkNeeds(playerId)` | Determine which chunks player needs |
| `.loadChunk(playerId, cx, cz)` | Send chunk data to player |

---

### `js/multiplayer/inventorySync.js` — Inventory Synchronization

**Purpose:** Diff-based inventory sync between host and clients.

**Classes:** `InventoryValidator`, `InventorySync`

| Method | Description |
|--------|-------------|
| `.startPeriodicSync(interval)` | Begin periodic diff sync |
| `.applyRemoteSync(data)` | Apply host's inventory update |

---

### `js/multiplayer/playerListHUD.js` — Player List UI

**Purpose:** In-game player list overlay (top-left corner).

**Classes:** `PlayerListState`, `PlayerListHUD`

| Method | Description |
|--------|-------------|
| `.show()` / `.hide()` | Display/hide player list |
| `.updatePlayers(players)` | Refresh player data |
| `.addPlayer(playerData)` / `.removePlayer(playerId)` | Manage entries |

---

### `js/game.js` — Game Loop & Mode Management

**Purpose:** Main game loop, creative/survival mode switching.

**Classes:** `DoubleTapDetector`, `BlockPalette`, `Game`

| Method | Description |
|--------|-------------|
| `.start(mode)` | Start game loop in specified mode |
| `.stop()` | Stop game loop |
| `.setMode(mode)` | Switch between 'survival' and 'creative' |
| `.canPlaceBlock(blockId, inventory)` | Mode-dependent block placement check |

**Creative Mode Features:** Unlimited blocks, no gravity, fly mode (double-tap space), block palette selector.

---

### `js/main.js` — Browser Entry Point

**Purpose:** Menu system, screen management, character/world CRUD (browser), session manager, game initialization.

**Screen Flow:**
```
mainMenu → characterScreen → worldScreen → modeScreen → loadingScreen → game
   ↓           ↓                  ↓            ↓
settings    createCharModal   createWorld   lobbyScreen (multiplayer)
```

**BrowserCharacterManager / BrowserWorldManager:** Same API as server-side versions but runs in browser with IndexedDB.

**SessionManager:** Manages multiplayer client, wires matchmaking events to UI callbacks.

**startGame(mode):** The main game initialization function. Creates VoxelRenderer → TextureAtlas → ChunkManager → Player → BlockInteraction → starts renderLoop.

**renderLoop (in startGame):** Each frame updates: keyboard input, mouse pointer lock, player physics with collision, block interaction, camera follow, chunk manager for LOD, periodic save, and renders the scene. Also includes a debug raycasting tooltip showing hovered block ID/name.

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
  ├── js/renderer/textureAtlas.js    ← New! Dynamic atlas from textures/ manifest
  ├── js/renderer/chunkMeshBuilder.js    ← Depends on chunkData.js, textureAtlas.js
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
| `MIN_Y/MAX_Y` | chunkData.js | 0/96 | World height bounds (indices) |
| `SEA_LEVEL` | chunkData.js | 32 | Water surface level |
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
- **Test Count:** ~58 test files covering world gen, player physics, multiplayer sync, inventory, crafting, survival, quests, audio, rendering

Run with:
```bash
cd test && bash run_tests.sh
```

---

## Deployment

```bash
bash sync.sh  # rsync to game server at dadmin@10.0.30.160:/var/www/html
```

The game is served as static files — no build step required. All JS runs in the browser via script tags. Server-side multiplayer requires running `server/index.js` with Node.js (ws dependency).

---

## Quest Storyline

A complete 25-quest storyline document exists at `js/systems/questStoryline.md`:

**Theme:** Five ancient elemental seals are failing, corruption spreads from beneath the world. As the last Seal Bearer, restore balance by defeating corrupted guardians across four dungeons and sealing the corruption forever.

| Act | Quests | Theme | Dungeon/Boss | Biomes |
|-----|--------|-------|-------------|--------|
| **Act 1: Awakening** | Q01–Q06 | Survival & Preparation | None | Plains, Forest, Mountains |
| **Act 2: The First Seal** | Q07–Q12 | Discovery & Corruption | Forest Warden | Corrupt, Mountains |
| **Act 3: Fire and Ash** | Q13–Q17 | Descent into Danger | Lava Titan | Lava |
| **Act 4: Frozen Truth** | Q18–Q21 | Revelation & Resolve | Frost Serpent | Tundra |
| **Act 5: The Final Seal** | Q22–Q25 | Confrontation & Resolution | Corruption Overlord + Final Seal | Corrupt (deep) |

---

## What Actually Works (Wired in Game Loop)

The following systems are instantiated and actively updated each frame in `startGame()` → `renderLoop()`:

| System | Status | Details |
|--------|--------|---------|
| **Menu system** | ✅ | Main → Play Solo → Character Create → World Create → Mode Select |
| **Three.js renderer** | ✅ | WebGL canvas, scene, camera, raycasting |
| **Texture atlas** | ✅ | Dynamic build from `textures/manifest.json`, UV mapping per block type |
| **Chunk generation** | ✅ | Full pipeline: noise → biomes → caves → ores → features |
| **Chunk loading/unloading** | ✅ | Async queue, player-position-based LOD, neighbor linking |
| **Player physics** | ✅ | Gravity, movement, AABB collision against chunk data |
| **Keyboard controls** | ✅ | WASD, space (jump), shift (sprint) |
| **Mouse look** | ✅ | Pointer lock, yaw/pitch rotation |
| **Block interaction** | ✅ | Break/place via raycast from crosshair center |
| **Touch controls** | ✅ | Virtual joystick + swipe-to-look on mobile devices |
| **Periodic save** | ✅ | IndexedDB auto-save every 30 seconds |
| **Creative mode** | ✅ | Unlimited blocks, fly mode (double-tap space), block palette |

---

## What Does NOT Work (Code Exists but Not Wired)

The following systems have complete code files but are **NOT instantiated or updated in the game loop**:

| System | File(s) | Gap |
|--------|---------|-----|
| **Day/night cycle** | skybox.js | Skybox not instantiated, no time-of-day updates |
| **Biome particles/fog** | biomeEffects.js | Particle systems not created |
| **Performance optimizer** | performanceOptimizer.js | FPS monitoring not active |
| **Crosshair wireframe** | crosshair.js | Highlight mesh not shown (debug tooltip exists instead) |
| **Inventory HUD** | inventory.js | Hotbar slots not populated, no item display |
| **Crafting UI** | crafting.js | No recipe discovery or crafting interface |
| **Survival meters** | survival.js | Health/hunger/thirst/sleep/stamina not updated in HUD |
| **Damage system** | damageSystem.js | Environmental/fall/boss damage not calculated |
| **Quest system** | questSystem.js | Quest chain not started, no objectives tracked |
| **Boss entities** | boss.js | Bosses never spawned or AI-updated |
| **Quest markers** | questMarker.js | Visual markers not placed in world |
| **Sound effects** | sfx.js | AudioContext never created (needs user gesture) |
| **Ambient music** | ambient.js | Biome-specific audio layers not initialized |
| **Multiplayer in-game** | client.js, host.js, playerSync.js, chunkStreamer.js, inventorySync.js, playerListHUD.js | Only menu UI exists; no game session connection or state sync |

---

## Known Issues & TODOs

- `game.js` update loop has system updates commented out — the actual update cycle is in `main.js`'s `renderLoop()`
- `BlockPalette` uses try/catch fallback for BLOCK_TYPES (works when loaded as script tag)
- Multiplayer requires running server (`server/index.js`) with matchmaking relay on port 8765
- ~100 "NaN bounding sphere" console warnings from empty chunk geometries — cosmetic only
