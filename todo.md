# Cuubz — Implementation TODO

> **Vision:** A web-based Minecraft-style voxel game with full multiplayer support (up to 4 players), procedural texture generation, persistent worlds, and mobile-first touch controls. Host/Join session model with 3-slot world saves per device.

> **Tech Stack:** Three.js (local CDN), Vanilla JS, WebSockets (ws library) for multiplayer server, IndexedDB for persistence, Web Audio API for procedural sound, Canvas API for texture generation.

> **Current State:** 🟡 Approved — Workspace created, plan pending review. No code written yet.

---

## Design Decisions

- **Mobile-first, touch-friendly** — Virtual joystick for movement, swipe-to-look on right side of screen, tap to interact with blocks. Desktop WASD + mouse as secondary fallback.
- **Three.js for 3D voxel rendering** — Instanced meshes or merged geometry per chunk for performance. Local Three.js CDN build, no npm tooling.
- **Procedural texture generation** — All textures generated via Canvas API (noise algorithms, color palettes) at 32×32 resolution, then saved as PNG assets. No external image files shipped.
- **WebSocket multiplayer** — Node.js + ws server for real-time sync. Host runs local game loop and broadcasts state; clients receive updates and send actions. Server-authoritative for block changes.
- **IndexedDB persistence** — 3 world slots per device, stored as compressed chunk data + metadata (seed, biome map, player position).
- **Chunk-based world** — 16×16×64 chunks loaded/unloaded based on player position. Render distance configurable.
- **Session discovery** — Host broadcasts session via WebSocket matchmaking room; clients browse available sessions by host name.
- **First-person camera** — Pointer lock on desktop, free-look swipe on mobile. Center crosshair for block targeting.

---

## Project Structure

```
webgame-cuubz/
├── index.html                    # Main entry point with Three.js CDN
├── css/
│   └── style.css                 # Game UI, HUD, menus, mobile touch overlays
├── js/
│   ├── main.js                   # App entry: menu system, play/host/join flow
│   ├── game.js                   # Main game loop, state management, render pipeline
│   ├── renderer/
│   │   ├── voxelRenderer.js      # Three.js scene setup, chunk mesh builder
│   │   ├── chunkManager.js       # Chunk loading/unloading, visibility culling
│   │   └── crosshair.js          # Center pointer/crosshair overlay
│   ├── world/
│   │   ├── worldGenerator.js     # Procedural world generation (noise, biomes)
│   │   ├── chunkData.js          # Chunk data structures, serialization
│   │   ├── biomeSystem.js        # Biome definitions, height maps, block distribution
│   │   └── persistence.js        # IndexedDB save/load, 3-slot management
│   ├── multiplayer/
│   │   ├── client.js             # WebSocket client: connect, join, send actions
│   │   ├── host.js               # Host logic: broadcast state, sync players
│   │   ├── sessionManager.js     # Session discovery, matchmaking room
│   │   └── playerSync.js         # Player position/rotation/action sync
│   ├── input/
│   │   ├── keyboard.js           # WASD + key bindings (desktop)
│   │   ├── mouse.js              # Pointer lock, click events (desktop)
│   │   ├── touch.js              # Virtual joystick, swipe-to-look (mobile)
│   │   └── interaction.js        # Block break/place targeting via crosshair
│   ├── textures/
│   │   ├── textureGenerator.js   # Procedural 32x32 texture creation (Canvas API)
│   │   └── biomeTextures.js      # Biome-specific texture palettes & patterns
│   ├── entities/
│   │   ├── player.js             # Player character: movement, physics, collision
│   │   └── blockTypes.js         # Block definitions: type, hardness, drop, texture
│   └── audio/
│       ├── sfx.js                # Procedural sound effects (Web Audio API)
│       └── music.js              # Ambient procedural music generation
├── textures/                     # Generated texture assets (PNG files)
│   ├── dirt.png                  # 32x32 dirt texture
│   ├── grass_top.png             # 32x32 grass top
│   ├── grass_side.png            # 32x32 grass side
│   ├── stone.png                 # 32x32 stone
│   ├── sand.png                  # 32x32 sand
│   ├── gravel.png                # 32x32 gravel
│   ├── water.png                 # 32x32 water (transparent)
│   ├── wood_log.png              # 32x32 wood log
│   ├── leaves.png                # 32x32 leaves
│   ├── snow.png                  # 32x32 snow
│   ├── ice.png                   # 32x32 ice
│   ├── bedrock.png               # 32x32 bedrock
│   └── planks.png                # 32x32 wood planks
├── sounds/                       # (Future: pre-rendered audio if needed)
├── server/                       # Node.js multiplayer server
│   ├── package.json              # ws dependency
│   ├── index.js                  # Server entry point, WebSocket setup
│   └── matchmaking.js            # Session discovery room logic
├── todo.md                       # This file
└── sync.sh                       # Deployment script (generated from template)
```

---

## Phase 1: Foundation — Core Voxel Engine & Single Player

### World Generation & Rendering
- [ ] **Setup project structure** — Create all folders, index.html with Three.js CDN, basic HTML shell
  - [ ] Link local Three.js build via `<script src="...">` (CDN)
  - [ ] Basic HTML/CSS skeleton with canvas container and UI overlay divs
- [ ] **Implement noise-based terrain generation** — `js/world/worldGenerator.js`
  - [ ] Perlin/Simplex noise function for heightmap generation
  - [ ] Seed-based deterministic generation (same seed = same world)
  - [ ] Height range: 0-64 blocks, surface variation with mountains/valleys
- [ ] **Implement biome system** — `js/world/biomeSystem.js`
  - [ ] Define biomes: Plains, Forest, Desert, Tundra, Mountains, Ocean
  - [ ] Temperature/moisture noise maps for biome distribution
  - [ ] Biome-specific height modifiers (mountains higher, oceans lower)
- [ ] **Implement chunk data structures** — `js/world/chunkData.js`
  - [ ] Chunk class: 16×16×64 block array
  - [ ] Block type enum/lookup with properties (solid, transparent, hardness)
  - [ ] Serialization/deserialization to/from JSON for persistence
- [ ] **Build voxel renderer** — `js/renderer/voxelRenderer.js`
  - [ ] Three.js scene, camera, WebGL renderer setup
  - [ ] Chunk mesh builder: merge visible faces into single geometry (face culling)
  - [ ] Texture atlas from generated textures
  - [ ] Basic lighting (ambient + directional sun)
- [ ] **Implement chunk manager** — `js/renderer/chunkManager.js`
  - [ ] Load/unload chunks based on player position
  - [ ] Render distance: configurable (default 4 chunks radius)
  - [ ] Async chunk building to avoid frame drops
- [ ] **Generate procedural textures** — `js/textures/textureGenerator.js`
  - [ ] Dirt texture: brown noise with darker speckles
  - [ ] Grass top: green noise with lighter patches
  - [ ] Grass side: dirt base with green top stripe
  - [ ] Stone: gray noise with crack patterns
  - [ ] Sand: yellow noise with grain variation
  - [ ] Gravel: mixed gray/brown small squares
  - [ ] Water: blue semi-transparent with wave pattern
  - [ ] Wood log: brown rings/circles
  - [ ] Leaves: green noise with darker spots
  - [ ] Snow: white/light gray minimal noise
  - [ ] Ice: light blue translucent
  - [ ] Bedrock: dark gray/black heavy noise
  - [ ] Planks: wood grain horizontal lines
  - [ ] Save all as 32×32 PNG files to `textures/` directory
- [ ] **Implement block types** — `js/entities/blockTypes.js`
  - [ ] Define all block types with properties: id, name, texture key, hardness, transparent, solid
  - [ ] Block lookup registry for generation and interaction

### Player & Controls (Mobile-First)
- [ ] **Implement first-person camera** — `js/renderer/voxelRenderer.js`
  - [ ] Three.js perspective camera with yaw/pitch rotation
  - [ ] Pointer lock API for desktop mouse look
  - [ ] Smooth camera interpolation
- [ ] **Implement crosshair overlay** — `js/renderer/crosshair.js`
  - [ ] Center screen crosshair (white lines or dot)
  - [ ] Highlight targeted block with wireframe outline
  - [ ] Raycasting from camera center to detect target block & face
- [ ] **Implement keyboard controls** — `js/input/keyboard.js`
  - [ ] WASD movement with relative direction (based on camera yaw)
  - [ ] Space for jump, Shift for sprint
  - [ ] Key state tracking with input queue
- [ ] **Implement mouse interaction** — `js/input/mouse.js`
  - [ ] Left click: break targeted block
  - [ ] Right click: place selected block type at targeted face
  - [ ] Scroll wheel: cycle through hotbar blocks
- [ ] **Implement touch controls** — `js/input/touch.js`
  - [ ] Virtual joystick on left side of screen (movement)
  - [ ] Swipe-to-look on right side (camera rotation)
  - [ ] Tap to break/place blocks
  - [ ] Touch-friendly UI scaling for mobile viewports
  - [ ] Visual joystick indicator with drag zone
- [ ] **Implement block interaction** — `js/input/interaction.js`
  - [ ] Raycast from camera center through crosshair
  - [ ] Detect target block position and face normal
  - [ ] Break animation (particle effect or instant)
  - [ ] Place block logic with collision check (don't place inside player)
- [ ] **Implement player physics** — `js/entities/player.js`
  - [ ] AABB collision detection against solid blocks
  - [ ] Gravity, jump velocity, ground detection
  - [ ] Horizontal movement with collision slide
  - [ ] Player dimensions: ~0.8 wide × 1.8 tall (block units)

### Persistence
- [ ] **Implement IndexedDB persistence** — `js/world/persistence.js`
  - [ ] Create database: worlds store, metadata store
  - [ ] Save world structure: seed, chunk data (compressed), player position
  - [ ] Load world structure: decompress chunks, restore player state
  - [ ] 3-slot management: create new, overwrite existing, delete slot
  - [ ] World metadata: name, creation date, play time, biome summary
- [ ] **Implement main menu flow** — `js/main.js`
  - [ ] Menu screen with options: Play, Host, Join
  - [ ] Play: show 3 world slots (create new or load existing)
  - [ ] Host: select world → start multiplayer session
  - [ ] Join: browse available sessions → connect
  - [ ] Settings panel: render distance, volume, controls hint

### Audio Foundation
- [ ] **Procedural sound effects** — `js/audio/sfx.js`
  - [ ] Block break sound: short noise burst with decay
  - [ ] Block place sound: thud/impact sound
  - [ ] Footstep sounds: different for each biome surface type
  - [ ] Jump/land sounds
- [ ] **Ambient procedural music** — `js/audio/music.js`
  - [ ] Procedural ambient drone/chord progression
  - [ ] Biome-specific ambient tones (calm for plains, windy for mountains)

### Phase 1 Testing (Browser Automation)
- [ ] **Test: Page loads without errors** — Navigate to game URL, check console
  - [ ] No JavaScript errors in console
  - [ ] Canvas element renders
  - [ ] Three.js scene initializes
- [ ] **Test: World generation** — Create new world with known seed
  - [ ] Terrain generates with variation (not flat)
  - [ ] Multiple biomes visible across terrain
  - [ ] Water level present at expected height
- [ ] **Test: Chunk rendering** — Move player to chunk boundary
  - [ ] Adjacent chunks load seamlessly
  - [ ] No texture gaps between chunks
  - [ ] Distant chunks unload properly
- [ ] **Test: Player movement** — WASD + jump on desktop
  - [ ] Player moves in camera direction
  - [ ] Jump works with gravity
  - [ ] Collision prevents walking through blocks
- [ ] **Test: Block interaction** — Crosshair targeting + break/place
  - [ ] Crosshair highlights target block
  - [ ] Left click removes block
  - [ ] Right click places block on correct face
- [ ] **Test: Touch controls** — Mobile viewport simulation
  - [ ] Virtual joystick responds to touch drag
  - [ ] Swipe rotates camera view
  - [ ] Tap triggers block interaction
- [ ] **Test: World save/load** — Create world, reload page
  - [ ] World persists across page reloads
  - [ ] Player position restored correctly
  - [ ] All 3 slots available for separate worlds
- [ ] Record all test results, note bugs, update checkboxes

---

## Phase 2: Multiplayer & Session System

### Multiplayer Server
- [ ] **Setup Node.js multiplayer server** — `server/package.json`, `server/index.js`
  - [ ] Install ws dependency for WebSocket support
  - [ ] WebSocket server setup with connection handling
  - [ ] Player ID assignment on connect
  - [ ] Disconnect cleanup (remove player from session)
- [ ] **Implement session management** — `server/matchmaking.js`
  - [ ] Matchmaking room: list of active sessions
  - [ ] Host registers session: name, world seed, max players (4)
  - [ ] Client browses sessions: host name, player count, world info
  - [ ] Session join request → accept → connect to host's game server
- [ ] **Implement multiplayer protocol** — `server/index.js`
  - [ ] Message types: JOIN, LEAVE, MOVE, BREAK_BLOCK, PLACE_BLOCK, CHUNK_DATA, HEARTBEAT
  - [ ] JSON message format with type + payload
  - [ ] Player state broadcast: position, rotation, selected block
  - [ ] Block change broadcast: position, old type, new type

### Client Multiplayer Integration
- [ ] **Implement WebSocket client** — `js/multiplayer/client.js`
  - [ ] Connect/disconnect to server
  - [ ] Send/receive messages with retry logic
  - [ ] Heartbeat keepalive (30s interval)
  - [ ] Reconnection handler with session restore attempt
- [ ] **Implement host logic** — `js/multiplayer/host.js`
  - [ ] Register session with matchmaking server
  - [ ] Broadcast world chunks to joining clients
  - [ ] Authoritative block changes (validate before broadcast)
  - [ ] Player position/rotation sync broadcast
  - [ ] Kick/disconnect player handling
- [ ] **Implement player synchronization** — `js/multiplayer/playerSync.js`
  - [ ] Render remote players as voxel characters in world
  - [ ] Smooth interpolation of remote player positions
  - [ ] Remote player name tags above heads
  - [ ] Sync block changes from host to client view
- [ ] **Implement session UI** — `js/main.js`
  - [ ] Session browser: list available sessions with details
  - [ ] Host screen: set session name, select world, start hosting
  - [ ] Connection status indicator (connected/disconnected/reconnecting)
  - [ ] Player list overlay showing connected players

### Mobile-First Multiplayer Controls
- [ ] **Touch-friendly multiplayer UI** — `css/style.css`
  - [ ] Session browser touch targets ≥ 48px
  - [ ] Host/Join buttons sized for thumb reach
  - [ ] Connection status visible on mobile HUD
  - [ ] Remote player indicators in mobile viewport

### Phase 2 Testing (Browser Automation)
- [ ] **Test: Server starts and accepts connections** — Launch server, connect client
  - [ ] WebSocket connection established
  - [ ] Player ID assigned
  - [ ] Heartbeat messages flowing
- [ ] **Test: Session discovery** — Create session, browse from second client
  - [ ] Host session appears in browser list
  - [ ] Session details correct (name, player count)
  - [ ] Join request accepted, connection established
- [ ] **Test: Multiplayer sync** — Two players in same world
  - [ ] Player A sees Player B's character model
  - [ ] Movement synchronized between clients
  - [ ] Block changes visible to all players
- [ ] **Test: Max player enforcement** — 4+ join attempts
  - [ ] 4th player joins successfully
  - [ ] 5th player rejected with "full" message
- [ ] Record all test results, note bugs, update checkboxes

---

## Phase 3: Polish & Content Expansion

### World & Biome Polish
- [ ] **Tree generation** — `js/world/worldGenerator.js`
  - [ ] Random tree placement in Forest biome (oak: wood trunk + leaves)
  - [ ] Cactus placement in Desert biome
  - [ ] Snow layer on Tundra biome surface blocks
- [ ] **Cave generation** — `js/world/worldGenerator.js`
  - [ ] 3D noise for underground cave systems
  - [ ] Cave connectivity (not isolated pockets)
  - [ ] Ore veins in caves (coal, iron visual variants)
- [ ] **Water & rivers** — `js/world/biomeSystem.js`
  - [ ] River generation using ridge noise
  - [ ] Water flow simulation (static: fill low areas)
  - [ ] Ocean biome with gradual depth increase
- [ ] **Skybox & atmosphere** — `js/renderer/voxelRenderer.js`
  - [ ] Gradient sky based on time of day
  - [ ] Sun/moon directional light positioning
  - [ ] Cloud layer (simple billboard or volumetric approximation)

### Gameplay Features
- [ ] **Inventory & hotbar system** — `js/game.js`
  - [ ] Hotbar with 9 slots, scroll/tap to select
  - [ ] Inventory screen: grid of collected blocks
  - [ ] Block count tracking per type
  - [ ] Mobile-friendly inventory UI with drag/slide
- [ ] **Day/night cycle** — `js/game.js`
  - [ ] Configurable cycle length (e.g., 5 minutes full cycle)
  - [ ] Sun/moon movement across sky
  - [ ] Ambient light changes (bright day → dark night)
  - [ ] Night indicator on HUD
- [ ] **Creative mode** — `js/game.js`
  - [ ] Unlimited blocks, no gravity, can fly
  - [ ] Toggle between Creative and Survival modes
  - [ ] Block palette selector for creative building

### Audio Polish
- [ ] **Biome-specific ambient sounds** — `js/audio/music.js`
  - [ ] Ocean waves for ocean biome
  - [ ] Wind for mountains/tundra
  - [ ] Birds chirping for forest/plains (procedural)
- [ ] **Interaction sound feedback** — `js/audio/sfx.js`
  - [ ] Different break sounds per block material type
  - [ ] UI click/hover sounds for menus

### Mobile Polish
- [ ] **Responsive HUD** — `css/style.css`
  - [ ] Crosshair adapts to mobile viewport
  - [ ] Hotbar positioned below joystick on mobile
  - [ ] Inventory overlay full-screen on mobile
- [ ] **Performance optimization for mobile** — `js/renderer/chunkManager.js`
  - [ ] Reduced render distance on mobile detection
  - [ ] Lower chunk geometry detail option
  - [ ] Frame rate target: 30fps minimum on mobile

### Phase 3 Testing (Browser Automation)
- [ ] **Test: Biome features** — Explore generated world
  - [ ] Trees appear in Forest biome
  - [ ] Cacti appear in Desert biome
  - [ ] Snow visible on Tundra surface
- [ ] **Test: Inventory system** — Break blocks, check inventory
  - [ ] Broken blocks added to inventory
  - [ ] Hotbar selection works (scroll + tap)
  - [ ] Placed blocks decrement from inventory
- [ ] **Test: Day/night cycle** — Wait for cycle or accelerate time
  - [ ] Sky color changes smoothly
  - [ ] Lighting transitions with sun position
  - [ ] Night darkness appropriate
- [ ] **Test: Mobile performance** — Simulate mobile device
  - [ ] Frame rate ≥ 30fps on reduced render distance
  - [ ] Touch controls responsive (< 100ms input lag)
  - [ ] UI elements touch-friendly (≥ 48px targets)
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
  - [ ] All 13 texture PNGs present and 32×32 resolution
  - [ ] Visual quality check on each texture
  - [ ] Texture atlas generation working correctly
- [ ] **Multiplayer stress test** — 4 concurrent players
  - [ ] Server handles 4 connections without lag
  - [ ] Block changes sync within 500ms
  - [ ] Player disconnect/reconnect handled gracefully

### Deployment
- [ ] **Generate sync.sh from template** — `sed` from skill template with remote IP
- [ ] **Deploy game files to server** — `./sync.sh` via rsync
  - [ ] All HTML/CSS/JS files synced
  - [ ] Texture PNGs synced
  - [ ] Server directory deployed for Node.js backend
- [ ] **Setup NPM proxy** — Reverse proxy for game on designated server IP
- [ ] **Test deployed game** — Access via browser from remote device
  - [ ] Game loads and renders correctly
  - [ ] Multiplayer connects through proxy
  - [ ] Mobile touch controls work on physical device

### GitHub Repository (Final Step)
- [ ] **Create private GitHub repository** — `webgame-cuubz`
  - [ ] Master branch with README
  - [ ] .gitignore for node_modules, .env, generated temp files
- [ ] **Push all code to repository** — git add/commit/push
  - [ ] Full workspace committed (excluding .git)
  - [ ] Verify repo contents match local

### Phase 4 Testing (Browser Automation)
- [ ] **Test: Deployed game loads** — Navigate to deployed URL
  - [ ] Page loads without errors
  - [ ] All assets served correctly
  - [ ] Three.js renderer initializes
- [ ] **Test: Multiplayer through proxy** — Connect from remote device
  - [ ] Session discovery works over internet
  - [ ] WebSocket connection stable
  - [ ] Block sync functional through proxy
- [ ] Record all test results, note bugs, update checkboxes

---

## Testing Plan Summary

All testing uses **Hermes browser automation** to open the game in a headless browser and verify:

| Test Category | Method | Expected Result |
|---|---|---|
| Page load | Navigate to game URL, check console | No JS errors, canvas renders, Three.js initializes |
| World generation | Create world with fixed seed, inspect chunks | Terrain varies, biomes distribute, water level correct |
| Chunk rendering | Move player across chunk boundaries | Seamless transitions, no gaps, proper unload distance |
| Player movement | WASD + jump simulation | Movement in camera direction, gravity works, collision blocks |
| Block interaction | Simulate click on targeted block | Block breaks/places correctly, visual update instant |
| Touch controls | Mobile viewport simulation with touch events | Joystick moves player, swipe rotates camera, tap interacts |
| Persistence | Create world, reload page, compare state | World data restored, player position correct, 3 slots available |
| Multiplayer connect | Start server, connect 2+ clients | WebSocket established, session joined, players visible |
| Block sync | Break/place block as host, check client view | All clients see change within 500ms |
| Max players | Attempt 5th join on full session | Rejected with error, existing 4 unaffected |
| Biome features | Generate and explore world | Trees in forest, cacti in desert, snow in tundra |
| Inventory | Break blocks, check counts | Blocks tracked correctly, hotbar selection works |
| Day/night cycle | Accelerate time, observe sky | Smooth color transition, sun/moon movement correct |
| Mobile performance | Throttle CPU, measure FPS | ≥ 30fps with reduced render distance |
| Deployed access | Navigate to remote URL | Game loads, assets serve, multiplayer connects |

**Bug tracking:** Each test records pass/fail. Failed tests create specific bug items in the relevant phase. Fixes verified by re-running the specific test.

---

## Progress

| Phase | Status |
|-------|--------|
| Phase 1: Foundation — Core Voxel Engine & Single Player | ⬜ Not Started |
| Phase 2: Multiplayer & Session System | ⬜ Not Started |
| Phase 3: Polish & Content Expansion | ⬜ Not Started |
| Phase 4: Deployment & Final Polish | ⬜ Not Started |

---

## Questions for Clarification ✨

Before implementation begins, I'd love your input on these~ (◕‿▽‿◕) ★

### Multiplayer Architecture
1. **Session discovery** — Do you want the matchmaking to work through a central relay server (like a lobby), or should it be peer-to-peer with host broadcasting? The plan assumes a relay server for session listing, but P2P is also possible with WebRTC.

2. **Server hosting** — Since the multiplayer server is Node.js-based, should the host player run the server locally (their browser can't directly host WebSocket servers), or should we deploy a persistent matchmaking server? I recommend deploying a small relay server on one of your LXC containers for session discovery, while the game world itself runs authoritative on the host's connection.

### World Generation
3. **Biome list** — The plan includes: Plains, Forest, Desert, Tundra, Mountains, Ocean. Do you want more or fewer biomes? Any specific ones you're dreaming of~? ♪

4. **World size** — Should worlds be bounded (e.g., 256×256) or infinite? The plan uses chunk-based loading which supports both, but infinite is more complex.

5. **Caves & ores** — Should underground caves and ore veins be part of the initial build? Currently in Phase 3 as stretch goals.

### Gameplay
6. **Creative vs Survival mode** — Should both be available from day one, or start with Creative only (unlimited blocks, flying)?

7. **Block types** — The plan includes ~13 block textures. Do you want more variety? Things like glass, wool colors, redstone-style logic blocks?

8. **Character customization** — Should players have customizable skins/names when joining sessions? Or just default voxel characters with name tags?

### Mobile Controls
9. **Touch control layout** — Virtual joystick (left) + swipe-to-look (right) is the plan. Any preferences for the hotbar placement or inventory access method on mobile~?

10. **Sound preference** — Procedural Web Audio API sounds are planned. Do you have a preference for ambient music style? (calm/chill, adventurous, minimal/no music?)
