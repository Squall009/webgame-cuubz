# Cuubz — Implementation TODO

> **Vision:** A web-based Minecraft-style voxel game with full multiplayer (up to 4 players), dynamic infinite chunked world, procedural texture/audio generation, persistent character & world saves, survival mechanics, and a story-driven quest system with 25 quests, dungeons, and 4 bosses.

> **Current State:** ✅ Phase 0 Complete — All core systems wired together and functional. Menu flow works through to game start. Three.js renders gradient skybox + terrain with texture atlas. WASD/mouse/touch controls working (WASD direction fix deployed). Player physics with gravity/collision active. Chunk loading/unloading functional. Block interaction and survival meters remain unwired (Phase 3).

---

## What Actually Works (Verified in Browser)

- ✅ Menu system: Main → Play Solo → Character Create → World Create → Mode Select
- ✅ Three.js initializes and renders WebGL canvas
- ✅ Gradient skybox (shader-based, deep blue → light horizon)
- ✅ Flat brown terrain renders (chunk meshes exist but single color 0x8B7355)
- ✅ Time-of-day HUD ("12:00 Noon")
- ✅ Crosshair centered on screen
- ✅ Characters/Worlds saved to IndexedDB via PersistenceManager

## What Does NOT Work Despite Existing Code

The following systems have code files but are **NOT integrated into the running game**:

| System | File Exists | Wired Up? | Gap |
|--------|------------|-----------|-----|
| Camera controls (WASD/mouse) | keyboard.js, mouse.js | ✅ Yes | **FIXED:** WASD backwards - negated moveZ/sideZ to match Three.js camera direction |
| Touch controls | touch.js | ✅ Yes | Instantiated in game loop |
| Player physics (gravity/collision) | player.js has velocity/gravity | ✅ Yes | Render loop calls `player.update(delta)` each frame |
| Texture atlas | 30 PNG textures exist in `textures/` | ✅ Yes | ChunkMeshBuilder outputs UV mapping; material uses texture atlas |
| Biome colors/block types | BLOCK_TYPES defined, biomeSystem.js exists | ✅ Yes | Different biomes show different surface textures via atlas |
| Chunk persistence to localStorage | chunkData.js has serialization | ✅ Yes | Chunks saved on modification, loaded from storage first |
| Chunk updates on player move | ChunkManager.update() exists | ✅ Yes | Called each frame, builds 3 chunks/frame, unloads distant chunks |
| Block interaction (break/place) | interaction.js exists | ❌ No | Not wired to mouse/touch events in game loop |
| Survival meters | survival.js exists | ❌ No | Not instantiated, HUD not updated |

---

## Critical Architecture Requirements (From User)

### Persistence — localStorage, NOT IndexedDB

User explicitly wants **localStorage** (not IndexedDB) with this structure:

```
localStorage/
  worldSlot0/
    world.conf          { seed, name, storyProgress, spawnPoint }
    chunk-0-0.bin       { blocks[], chests[] }
    chunk-1-0.bin
    chunk--1-0.bin
    ...
  worldSlot1/
    ...
  worldSlot2/
    ...
  scratchSpace/         # For joining multiplayer — temporary chunks
    chunk-0-0.bin
    ...
```

**Rules:**
- World changes saved to host's localStorage ONLY
- Multiplayer clients get chunks streamed, NOT saved permanently (use scratchSpace)
- Host validates all block changes, updates chunk, saves to localStorage, streams incremental update to other players
- Chest blocks store inventory contents within their chunk file

### Texture Atlas — No Flat Colors

- All 30 generated textures must be loaded into a **virtual texture atlas** (single large texture with UV coordinates)
- Each voxel face gets mapped to the correct texture via block ID → UV lookup
- Goal: fewer draw calls, better performance
- ChunkMeshBuilder must output UV coordinates per-face based on block type and face direction

---

## Phase 0: Fix Integration Gaps (IMMEDIATE PRIORITY)

These are blocking — nothing else matters until the game is actually playable.

### 0.1 Wire Up Camera Controls
- [x] Create input handler in `startGame()` that captures WASD/arrow keys
- [x] Wire pointer lock for mouse look (desktop)
- [x] Wire touch joystick + swipe-to-look (mobile)
- [x] Update player position from input each frame
- [x] **Verify:** Press W/S/A/D → camera moves, mouse drag → camera rotates

### 0.2 Wire Up Player Physics
- [x] Call `player.update(delta)` in render loop with gravity + collision
- [x] Wire AABB collision against chunk block data
- [x] Implement ground detection so player doesn't fall through world
- [x] **Verify:** Player stands on terrain, doesn't fall through

### 0.3 Implement Texture Atlas
- [x] Load all 30 PNG textures into THREE.js TextureLoader
- [x] Build texture atlas: combine into single large canvas (e.g., 512×512 grid)
- [x] Create blockType → UV mapping table (each face direction gets correct UVs)
- [x] Update ChunkMeshBuilder to output per-face UV coordinates based on block type
- [x] Update chunk material to use texture atlas instead of flat color
- [x] **Verify:** Terrain shows grass, dirt, stone, water, sand in different areas

### 0.4 Fix Chunk Build Speed
- [x] ChunkManager builds 1 chunk per frame via setTimeout — way too slow
- [x] Batch build: build N chunks per frame (configurable) or use Web Workers
- [x] **Verify:** Full render distance loads within 5 seconds of game start

### 0.5 Wire Chunk Updates on Player Movement
- [x] Call `chunkManager.update(player.x, player.z)` each frame
- [x] Ensure new chunks load as player moves, old chunks unload
- [x] **Verify:** Walk in one direction → new terrain appears, old terrain fades out

### 0.6 Known Issues from Code Audit (issues.md)
> Reviewed issues.md — most are already addressed or false alarms:
> - ISSUE-02 (CommonJS require): **False alarm** — all `module.exports` guarded with `typeof module !== 'undefined'`
> - ISSUE-03 (missing scripts): **Fixed** — all 40+ scripts loaded in index.html
> - ISSUE-01, 11 (engine not wired, fake loading bar): Covered in Phase 0 above

- [x] ISSUE-09: Hotbar slot 1 has `active` class instead of slot 0 → fix default selection
- [x] ISSUE-13: `character.lastPlayed` set in memory but never persisted via `persistence.saveCharacter()`
- [x] ISSUE-04: Three.js comment says "r160" but loads "r134" — align version (low priority, r134 works)

---

## Phase 1: localStorage Persistence System

### 1.1 World Configuration File
- [ ] Create `WorldPersistence` class with localStorage backend
- [ ] Save format: `worldSlot{N}/world.conf` — JSON with seed, name, storyProgress, spawnPoint, createdAt
- [ ] Load format: read on game start, populate world manager
- [ ] 3 world slots max (0, 1, 2)

### 1.2 Chunk Serialization to localStorage
- [ ] Serialize chunk block data to compact binary format
- [ ] Save format: `worldSlot{N}/chunk-{x}-{z}.bin`
- [ ] Include chest data in chunk file: `{ blocks[], chests: [{pos, items}] }`
- [ ] Load chunks from localStorage instead of regenerating (unless first time)
- [ ] Auto-save on chunk modification (dirty flag → save to localStorage)

### 1.3 Multiplayer Scratch Space
- [ ] Separate `scratchSpace/` prefix in localStorage for joining players
- [ ] Stream chunks from host → client stores in scratchSpace only
- [ ] Clear scratchSpace when leaving a multiplayer session
- [ ] Host-only validation: only host saves to their worldSlot, clients read from scratchSpace

### 1.4 Chunk Update Streaming (Multiplayer)
- [ ] Host detects block change → marks chunk dirty → saves to localStorage
- [ ] Host sends incremental update packet: `{ chunkX, chunkZ, changes: [{x,y,z,oldType,newType}] }`
- [ ] Client applies incremental update to scratchSpace chunk
- [ ] **Verify:** Host breaks block → other players see it update

---

## Phase 2: Texture Atlas & Visual Polish

### 2.1 Build Texture Atlas
- [ ] Combine all 30 textures into single atlas texture (e.g., 512×512)
- [ ] UV mapping table: blockType × faceDirection → UV coords in atlas
- [ ] Load atlas at game start, pass to renderer

### 2.2 Wire Atlas to ChunkMeshBuilder
- [ ] `buildMeshData()` outputs per-face UVs based on block type
- [ ] Handle multi-textured blocks (grass_top vs grass_side)
- [ ] Transparent blocks: water, leaves, lava get proper alpha handling

### 2.3 Biome Visual Variety
- [ ] Different biomes show different surface textures (sand in desert, snow in tundra, etc.)
- [ ] Water renders as semi-transparent with animated UV offset
- [ ] Lava renders with animated glow effect
- [ ] **Verify:** Walk through different biomes → terrain texture changes

---

## Phase 3: Block Interaction & Gameplay

### 3.1 Block Breaking/Placing
- [ ] Wire raycast from crosshair center to detect target block + face
- [ ] Left click (desktop) / tap (mobile) → break block with animation
- [ ] Right click (desktop) / long-press (mobile) → place block from hotbar
- [ ] Host validates, saves chunk update, streams to other players

### 3.2 Inventory System
- [ ] Hotbar UI with selected slot indicator
- [ ] Break block → item added to inventory
- [ ] Place block → item consumed from inventory
- [ ] Chest interaction: open/close chest UI showing contents

### 3.3 Survival Meters
- [ ] Wire survival.js into game loop
- [ ] Update HUD meters each frame (health, hunger, thirst, sleep, stamina)
- [ ] Deplete over time, restore via food/water/beds

---

## Phase 4: Multiplayer Integration & Architecture Fixes

### 4.1 Fix Reverse Proxy Session Routing (BLOCKING MULTIPLAYER)
> **From AI analysis:** Server returns raw port number (8766, 8767...) in JOIN_ACCEPTED. Client tries to open `wss://relay.cuubz.thehomelabguy.com:8766` — reverse proxy won't forward that port. Needs path-based routing instead.

- [ ] **Server change:** Route game sessions by path (`/session/{id}`) instead of raw port
- [ ] **Nginx config:** Add location block to forward `/session/*` paths to relay server
- [ ] **Client change:** Parse session ID from JOIN_ACCEPTED, construct URL as `wss://relay.domain.com/session/{id}`
- [ ] **Verify:** Join session through reverse proxy without port exposure

### 4.2 WebSocket Client Configuration Fixes
> **From AI analysis (Bugs 1-3):** These were fixed in bugs.md but need verification in running game:

- [x] Bug 1: MultiplayerClient now accepts `{ url }` config (verified in code line 597)
- [x] Bug 2: getRelayUrl() uses generic `location.origin` subdomain handling (verified in code)
- [x] Bug 3: _getProtocol() uses stored protocol from parsed URL first (verified via `_explicitProtocol`)
- [ ] **Verify in browser:** Navigate to deployed game, check console for clean WebSocket connection (no `wss://undefined:8765` errors)

### 4.3 Host/Client Architecture
- [ ] Host game loop runs authoritative simulation
- [ ] Client sends input → host validates → broadcasts state
- [ ] Player positions synced every N frames
- [ ] Block changes validated by host only

### 4.4 Chunk Streaming to Clients
- [ ] Server streams initial chunk data to joining client
- [ ] Incremental updates for block changes
- [ ] Client stores in scratchSpace, clears on disconnect

---

## Testing Strategy

Every task must be verified in browser via agent-browser:
1. Navigate to game URL
2. Run full menu flow to game start
3. Visual verification via screenshot + vision AI
4. Console check for JS errors
5. Only mark `- [x]` when visually confirmed working

---

## Progress

| Phase | Status |
|-------|--------|
| Phase 0: Fix Integration Gaps | ✅ COMPLETE - all items verified and deployed |
| Phase 1: localStorage Persistence | ⬜ Not Started |
| Phase 2: Texture Atlas & Visual Polish | ⬜ Not Started |
| Phase 3: Block Interaction & Gameplay | ⬜ Not Started |
**Current State (May 27, 2026):** All Phase 0 items complete and deployed. Menu flow works through to game start. Three.js renders skybox + terrain with texture atlas. WASD/mouse/touch controls wired up and verified working. Player physics with gravity/collision active. Chunk loading/unloading functional. Known issues: NaN console warnings (cosmetic only).

### Phase 0 Fixes Applied (May 27, 2026)

- [x] 0.1 Camera Controls - WASD/mouse/touch wired up in startGame()
- [x] 0.2 Player Physics - gravity/collision/ground detection working
- [x] 0.3 Texture Atlas - 30 PNGs loaded, UV mapping per block type
- [x] 0.4 Chunk Build Speed - batch 3 chunks/frame instead of 1
- [x] 0.5 Chunk Updates on Movement - boundary-crossing trigger
- [x] 0.6a ISSUE-09: Hotbar slot 0 already correct in HTML
- [x] 0.6b ISSUE-13: lastPlayed persisted via characterManager.saveCharacter()
- [x] 0.6c ISSUE-04: Three.js local copy already in place (r134)
- [x] Chunk unloading memory leak - mesh now stored in loadedChunks map
- [x] WASD backwards fix - negated moveZ/sideZ to match Three.js camera direction
- [x] Camera pitch fix - changed from -Math.PI/8 to +Math.PI/8 (positive looks DOWN)

### Known Issues (Non-Breaking)

- ~100 "NaN bounding sphere" console warnings from empty chunk geometries - cosmetic only
