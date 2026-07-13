# Cuubz — Multiplayer Support: Status, Architecture & Action Plan

> **Last updated:** 2026-07-12
> **Scope:** All multiplayer code in `js/multiplayer/`, `server/`, `js/main.js` (SessionManager), and related tests.

---

## Architecture Overview

Cuubz uses a **client-host relay architecture** with three tiers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RELAY SERVER (separate service)              │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │  Matchmaking (8765)  │    │  Game Session (8766+, dynamic)   │   │
│  │  - Session discovery │    │  - Message forwarding            │   │
│  │  - Host/Join routing │    │  - Player tracking               │   │
│  │  - Session lifecycle │    │  - Heartbeat keepalive           │   │
│  └──────────────────────┘    └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                              │
         │  WS (matchmaking)            │  WS (game session)
         ▼                              ▼
┌──────────────────┐          ┌──────────────────────────┐
│   HOST PLAYER    │◄────────►│    REMOTE PLAYERS        │
│ (authoritative)  │  relay   │  (clients)               │
│ - Validates all  │  server  │  - Send MOVE/BREAK/PLACE │
│ - Broadcasts     │          │  - Render remote players │
│ - Persists world │          │  - Receive state updates │
└──────────────────┘          └──────────────────────────┘
```

### Key Design Decisions

- **Host is authoritative:** The host player runs game logic, validates all actions, and persists world state. The relay is a dumb message forwarder.
- **Relay is a separate service:** Runs independently on the web server (or any reachable server). The game client only needs the relay's hostname/IP — no coupling to the static file server.
- **Two WebSocket connections per player:** One to matchmaking (session discovery), one to the game session (live gameplay).
- **Max 4 players per session.**

---

## Relay Server Architecture

### Deployment Model

The relay server (`server/index.js`) is designed to run as its own process, completely separate from the static file server that serves the game:

```
┌──────────────────────┐         ┌──────────────────────┐
│  Static File Server   │         │  Relay Server         │
│  (nginx / built-in)   │         │  (Node.js)            │
│  Port: 80/443         │         │  Matchmaking: 8765    │
│  Serves: index.html   │         │  Sessions: 8766+      │
│  and all game assets  │         │                       │
└──────────────────────┘         └──────────────────────┘
                                      │
                                      │ Can be on a DIFFERENT machine
                                      │ as long as ports are reachable
                                      ▼
                              ┌──────────────────────┐
                              │  Game Clients         │
                              │  (browser tabs)       │
                              └──────────────────────┘
```

### Current Relay Components

| File | Purpose | Port |
|------|---------|------|
| `server/index.js` | Entry point — HTTP + WS servers, session lifecycle, graceful shutdown | 8765 + dynamic |
| `server/matchmaking.js` | Lobby — session creation, browsing, join routing | 8765 |
| `server/session.js` | Game session relay — player connections, message broadcasting, heartbeat | 8766+ (dynamic) |

### Configuration

```bash
# Environment variables
MATCHMAKING_PORT=8765          # Matchmaking lobby port
SESSION_BASE_PORT=8766         # First port for game sessions

# Systemd service file: cuubz-relay.service (already exists in repo root)
```

### What the Relay Does (and Should Do)

**Current behavior:** The relay does basic validation (bounds checking, distance checks) in `server/session.js`. This is redundant with host-side validation in `host.js`.

**Recommended behavior:** Make the relay a **pure forwarder** — no game logic, no validation. Its only responsibilities:

1. Route messages between connected players
2. Track who is connected to which session
3. Enforce heartbeat keepalive (disconnect stale players)
4. Broadcast `PLAYER_JOINED` / `PLAYER_LEFT` events

All validation (block breaks, places, movement, inventory) happens on the host client via `HostManager`.

### Why Separate the Relay?

1. **Independent deployment:** The relay can run on any machine — same server, different server, or even a dedicated VPS. The game client only needs the relay URL.
2. **No coupling to game assets:** The relay doesn't need to serve static files. It's pure WebSocket.
3. **Scalability:** If you ever want multiple relay instances (different regions), the architecture supports it.
4. **Security:** The relay can sit behind a firewall with only ports 8765+ open, while the game server handles HTTPS.
5. **Port forwarding is acceptable:** Two forwarded ports (8765 for matchmaking, 8766+ for sessions) is manageable. Session ports are ephemeral and allocated sequentially.

### Client Configuration

The game client connects to the relay via a single URL configured in `main.js`:

```javascript
// js/main.js — SessionManager.init()
sessionManager.init('ws://relay.example.com:8765');
// or for HTTPS-served games:
sessionManager.init('wss://relay.example.com/ws');
```

The relay URL is the **only** multiplayer configuration the client needs. Game session ports are returned by the matchmaking relay and connected to automatically.

---

## What's Implemented (Code Complete)

### ✅ `js/multiplayer/client.js` — WebSocket Client

**Status:** Solid, well-designed, production-ready.

- Dual connection management (matchmaking relay + game session)
- Message queue with bounded size (500) and flush-on-reconnect
- Heartbeat keepalive (15s interval, 5s timeout)
- Exponential backoff reconnection (1s → 30s cap, ±25% jitter)
- Event-driven architecture: `onMatchmaking()` / `onGame()` routing
- Protocol-aware convenience methods: `sendJoin()`, `sendMove()`, `sendBreakBlock()`, `sendPlaceBlock()`, `sendInventory()`
- Auto-detects `ws` vs `wss` based on page protocol
- Testable in Node.js with mock WebSocket factory

### ✅ `js/multiplayer/host.js` — Client-Side Authoritative Host

**Status:** Solid validation pipeline, but not wired into the game.

- Full validation: `validateBlockBreak()`, `validateBlockPlace()`, `validateMove()`, `validateInventory()`, `validateQuestUpdate()`
- Rate limiter (token bucket): 20 moves/sec per player, 100ms block change cooldown
- Remote player state tracking via `HostRemotePlayer`
- World state log (block changes, quest progress)
- Kick player support
- Host-initiated actions bypass validation (correct — host is authoritative)

### ✅ `js/multiplayer/playerSync.js` — Remote Player Rendering

**Status:** Complete implementation, not instantiated in game loop.

- Smooth interpolation (position lerp 0.15, rotation lerp 0.12)
- Staleness detection (5s threshold) with state machine: INACTIVE → LOADING → ACTIVE → STALE
- Ping tracker with rolling average/min/max
- Three.js voxel character mesh (head/body/arms/legs with color shading)
- Name tags (canvas sprites above head)
- Health bars (color-coded: green >60%, yellow >30%, red ≤30%)
- Proper geometry/material disposal

### ✅ `js/multiplayer/chunkStreamer.js` — Chunk Data Streaming

**Status:** Complete standalone system, not integrated.

- Multi-player position tracking — loads chunks around ALL players
- RLE compression for chunk data (efficient for air-heavy chunks)
- Dirty tracking — re-streams chunks with block changes
- Load/unload radius with hysteresis (load at 6, unload at 8)
- Tick-based streaming with max chunks per tick (4) to avoid flooding
- Chunk states: UNLOADED → LOADING → LOADED → DIRTY → STREAMING

### ✅ `js/multiplayer/inventorySync.js` — Inventory Synchronization

**Status:** Complete with validation, not wired into game loop.

- Full validation: `VALID_BLOCK_IDS`, `VALID_NAMED_ITEMS`, max stack sizes, per-item categories
- Diff-based sync (`computeInventoryDiff()`) for bandwidth efficiency
- Server-authoritative validator (`InventoryValidator`) with strict mode and auto-sanitization
- Block break/place validation against inventory (space check, selected slot check)
- Join/disconnect/save lifecycle with restore from save
- Periodic sync timer (5s default interval)

### ✅ `js/multiplayer/playerListHUD.js` — Player List UI

**Status:** Complete, DOM elements exist in `index.html`.

- Pure DOM manipulation with HTML escaping for XSS protection
- Mobile-responsive collapsible panel with resize listener
- Health bar color coding
- Testable state machine (`PlayerListState`) for Node.js tests

### ✅ `server/` — Relay Infrastructure

**Status:** Functional, runs as standalone Node.js process.

- Matchmaking relay with session creation, browsing, join routing
- Session manager with player tracking, message broadcasting, basic validation
- Dynamic port allocation (8766+)
- Graceful shutdown with SIGINT/SIGTERM handling
- Health check endpoint (`/health`) and session listing (`/sessions`)

### ✅ `js/main.js` — SessionManager Integration

**Status:** UI wired, lobby screen exists, but multiplayer is **hard-disabled**.

- Lobby screen with browse/host tabs (`index.html` lines 210-250)
- Session lifecycle: `init()` → `browseSessions()` → `startHosting()` / `joinSession()`
- Block change callbacks registered for host (persist to IndexedDB) and clients (visual only)
- Player list overlay in DOM (`index.html` lines 261-263)

### ✅ Test Coverage

| Test File | What It Covers |
|-----------|---------------|
| `test/test_multiplayerClient.js` | WebSocket client, message queue, reconnection |
| `test/test_multiplayerSync.js` | Host validation, player join/leave, block changes |
| `test/test_multiplayerStress.js` | Rate limiting, concurrent players, message flooding |
| `test/test_playerSync.js` | Remote player interpolation, mesh creation, staleness |
| `test/test_inventorySync.js` | Inventory validation, diff sync, sanitization |
| `test/test_chunkStreamer.js` | Chunk loading/unloading, RLE compression, streaming |
| `test/test_chunkStreamingIntegration.js` | End-to-end chunk streaming with host + clients |

---

## 🔴 Critical Issues (Blocking Multiplayer From Working)

### 1. Multiplayer Is Hard-Disabled in `main.js`

**Location:** `js/main.js` line ~1155

```javascript
SessionManager.init(serverUrl) {
    this._serverUrl = serverUrl || 'ws://localhost:8765';

    if (typeof MultiplayerClient !== 'undefined') {
        const urlObj = new URL(this._serverUrl);
        // TEMPORARY DISABLE: WebSocket proxy not configured yet.
        console.log('[Cuubz] Multiplayer disabled — WebSocket proxy at', this._serverUrl, 'not configured yet.');
        return;  // ← Exits here. MultiplayerClient is never created.

        this.client = new MultiplayerClient({ url: this._serverUrl });
        this._wireClientEvents();
    }
}
```

**Impact:** Everything downstream runs in offline simulation mode. The lobby shows empty lists, hosting "works" but creates nothing, joining does nothing.

**Fix:** Remove the `return` statement. Configure the relay URL to point at the actual relay server.

---

### 2. No Movement Sync in Game Loop

**Location:** `js/main.js` `renderLoop()` (~line 2216)

The render loop updates player physics every frame but **never sends position updates** to the game session. There is no `sessionManager.client.sendMove()` call anywhere in the game loop.

**Impact:** Even if multiplayer were enabled, remote players would never see anyone move. All remote player meshes would stay at spawn position forever.

**Fix:** Add periodic position broadcasting in the render loop:

```javascript
// Throttled movement sync (~20Hz)
if (game.frameCount % 3 === 0 && sessionManager && sessionManager.client && sessionManager.client.isGameSessionConnected) {
    sessionManager.client.sendMove(
        { x: player.position.x, y: player.position.y, z: player.position.z },
        { yaw: player.yaw, pitch: player.pitch }
    );
}
```

---

### 3. No Block Interaction Sync

**Location:** `js/main.js` — `blockInteraction` callbacks

When the local player breaks or places a block, the action is applied locally but **never sent** to the game session. `blockInteraction` doesn't know about `sessionManager`.

**Impact:** Remote players won't see any block changes initiated by the local player.

**Fix:** Wire block interaction callbacks to send over WebSocket:

```javascript
blockInteraction.onBlockBroken = (dropType, worldPos) => {
    droppedItems.addDrop(dropType, worldPos);
    if (sessionManager && sessionManager.client && sessionManager.client.isGameSessionConnected) {
        sessionManager.client.breakBlock(worldPos.x, worldPos.y, worldPos.z);
    }
};

blockInteraction.onBlockPlaced = (blockType, worldPos) => {
    if (sessionManager && sessionManager.client && sessionManager.client.isGameSessionConnected) {
        sessionManager.client.placeBlock(worldPos.x, worldPos.y, worldPos.z, blockType);
    }
};
```

---

### 4. PlayerSyncManager Not Instantiated

**Location:** `js/main.js` `startGame()`

`PlayerSyncManager` is never created, never added to the Three.js scene, and never updated in the render loop.

**Impact:** Even if `PLAYER_JOINED` and `PLAYER_MOVE` messages arrive, there's nothing to render the remote players. The game would have invisible multiplayer.

**Fix:** Add to `startGame()`:

```javascript
// Create player sync manager
const playerSync = new PlayerSyncManager();
playerSync.setGameMode(mode);

// Wire to session events
if (sessionManager && sessionManager.client) {
    sessionManager.client.onGame('PLAYER_JOINED', (data) => {
        const state = playerSync.addPlayer(data.playerId, {
            name: data.character?.name,
            color: data.character?.color,
            position: data.position,
        });
        if (state.mesh) renderer.scene.add(state.mesh);
        if (state.nameTag) renderer.scene.add(state.nameTag);
        if (state.healthBar) renderer.scene.add(state.healthBar);
    });

    sessionManager.client.onGame('PLAYER_MOVE', (data) => {
        playerSync.processServerUpdate(data.playerId, {
            position: data.position,
            yaw: data.rotation?.yaw,
            pitch: data.rotation?.pitch,
        });
    });

    sessionManager.client.onGame('PLAYER_LEFT', (data) => {
        playerSync.removePlayer(data.playerId);
    });
}

// In render loop:
if (playerSync) playerSync.update(game.delta);
```

---

### 5. HostManager Not Used — SessionManager Handles Host Logic Directly

**Location:** `js/main.js` `SessionManager.startHosting()`

The `HostManager` class in `host.js` has complete validation logic (rate limiting, movement validation, inventory validation, quest validation), but `SessionManager` doesn't use it. The host validation callbacks are registered on `SessionManager` directly.

**Impact:** The rate limiter, movement validation, and inventory validation from `host.js` are dead code. Remote players could spam actions without throttling, send impossible positions, or submit invalid inventory states.

**Fix:** Either:
- **Option A (recommended):** Instantiate `HostManager` in `SessionManager.startHosting()` and wire its callbacks to the game loop
- **Option B:** Remove `host.js` and consolidate validation into `SessionManager`

---

### 6. ChunkStreamer Not Integrated

**Location:** `js/multiplayer/chunkStreamer.js`

`ChunkStreamer` is a complete standalone system but is never instantiated. The host relies on the relay server's dumb forwarding of `CHUNK_DATA` messages.

**Impact:** The intelligent multi-player chunk loading with RLE compression sits unused. Chunks are never proactively streamed to remote players based on their positions.

**Fix:** Instantiate `ChunkStreamer` on host start, wire it to player positions, and use its `tick()` output to send `CHUNK_DATA` messages.

---

### 7. InventorySync Not Integrated

**Location:** `js/multiplayer/inventorySync.js`

`InventorySync` and `InventoryValidator` are complete but never instantiated in the game loop.

**Impact:** Inventory changes aren't synced between players. A player could have items in their inventory that don't exist on the host's authoritative copy.

**Fix:** Create `InventorySync` instance in `startGame()`, send initial inventory on join, and start periodic diff sync.

---

## 🟡 Design Issues (Should Fix Before Launch)

### 8. Dual Validation — Relay Server + Host Client

Both `server/session.js` and `host.js` validate block breaks/places independently. The relay does basic bounds/distance checks; the host does the same.

**Problem:** Redundant work + potential inconsistency. The relay might reject something the host would accept, or vice versa.

**Recommendation:** Make the relay a pure forwarder (no validation). All validation happens on the host client via `HostManager`. The relay's only job is routing messages and tracking connections.

### 9. Dynamic Ports and Internet Deployment

The architecture uses dynamic ports (8766+) for game sessions. This works on LAN and with port forwarding, but:

- Each session needs a new port forwarded
- Sessions are ephemeral — ports are allocated sequentially and never reused
- Firewalls may block the port range

**Current approach is acceptable** since port forwarding is not a concern. But for future-proofing:

**Recommendation:** Consider single-port relay with path-based routing (e.g., `ws://relay:8765/session/{id}`) as an alternative. This would require refactoring the relay to multiplex sessions over a single WebSocket connection. Not urgent — the current dual-port approach works fine with port forwarding.

### 10. No Rejoin/Reconnect for Game Session

If a client disconnects from the game session, `WSConnection` auto-reconnects to matchmaking but there's no mechanism to rejoin the game session automatically.

**Impact:** Players who drop connection have to manually browse and rejoin.

**Recommendation:** Store `currentSessionId` and auto-rejoin on reconnect. Add a "rejoin last session" button in the lobby.

### 11. Y Bounds Mismatch

| System | Y Min | Y Max |
|--------|-------|-------|
| `chunkData.js` | 0 | 96 |
| `host.js` | -32 | 64 |
| `server/session.js` | -32 | 64 |

**Impact:** The host and relay would reject valid block changes above Y=64, even though the world generates up to Y=95.

**Fix:** Align all Y bounds to `MIN_Y: 0` and `MAX_Y: 96`.

### 12. No Speed/Position Validation

The host accepts any position the client sends. A malicious player could teleport by sending a far position.

**Impact:** In a trusted LAN environment this is fine. For internet play, you'd need:
- Max speed check (reject positions that require impossible velocity)
- Position extrapolation (predict where player should be, reject outliers)

**Recommendation:** Add to `HostManager._handlePlayerMove()`:

```javascript
const maxSpeed = 20; // blocks per second
const dt = (now - player.lastMoveTime) / 1000;
const dx = data.position.x - player.position.x;
const dy = data.position.y - player.position.y;
const dz = data.position.z - player.position.z;
const speed = Math.sqrt(dx*dx + dy*dy + dz*dz) / Math.max(dt, 0.016);
if (speed > maxSpeed) {
    console.warn(`[HostManager] Speed violation from ${playerId}: ${speed.toFixed(1)} > ${maxSpeed}`);
    return;
}
```

### 13. No Cheating Prevention Beyond Basic Validation

- Inventory validator runs but isn't wired — players could craft impossible items
- No crafting validation on the host side
- No quest progress validation

**Recommendation:** Wire `InventoryValidator` into the host's block break/place pipeline. Validate that the player actually has the block they're placing.

---

## 🟢 Minor Issues

### 14. Typo in `playerSync.js`

`PingTracker.getMaximun()` should be `getMaximum()`.

### 15. `RemotePlayerState` vs `HostRemotePlayer` Duplication

Two nearly identical player state classes in different files:
- `HostRemotePlayer` (host.js) — tracks position, rotation, character, inventory, timestamps
- `RemotePlayerState` (playerSync.js) — tracks position, rotation, health, ping, mesh references

They share no base class and use different field names.

**Recommendation:** Extract a shared `PlayerState` base class or use a common interface.

### 16. No Session Persistence

If the relay server restarts, all sessions are lost. No way to recover active sessions.

**Recommendation:** For now, accept this as a limitation. Sessions are ephemeral. If you want persistence later, add Redis or a simple file-based session store to the relay.

### 17. Missing `QUEST_UPDATE` Handling in Relay

`QUEST_UPDATE` is defined in the protocol (`client.js`) and handled by `HostManager`, but `server/session.js` doesn't relay it.

**Fix:** Add `QUEST_UPDATE` to the message switch in `server/session.js._handleMessage()`.

---

## Action Plan: Making Multiplayer Work

### Phase 1: Enable & Wire (2-3 hours)

These are the minimum changes to get 2-player LAN multiplayer working:

1. **Remove the `return` in `SessionManager.init()`** — enable the WebSocket client
2. **Configure the relay URL** — point at the actual relay server address
3. **Add movement sync to render loop** — send position ~20Hz
4. **Wire block interaction** — send `breakBlock()`/`placeBlock()` over WebSocket
5. **Instantiate `PlayerSyncManager`** in `startGame()` — add meshes to scene, update in render loop
6. **Fix Y bounds** in `host.js` and `server/session.js` — align to `0`–`96`
7. **Run `server/index.js`** on the relay server

### Phase 2: Host Authority (1-2 hours)

8. **Wire `HostManager`** into `SessionManager.startHosting()` — enable rate limiting and validation
9. **Wire `InventorySync`** — send initial inventory on join, start periodic diff sync
10. **Wire `InventoryValidator`** on host — validate block breaks/places against inventory

### Phase 3: Polish (1-2 hours)

11. **Wire `ChunkStreamer`** on host — proactive chunk streaming to remote players
12. **Wire `PlayerListHUD`** — connect to `PlayerSyncManager` for live player count
13. **Add session rejoin** — store last session ID, auto-rejoin on reconnect
14. **Add speed validation** to `HostManager._handlePlayerMove()`
15. **Fix typo** — `getMaximun()` → `getMaximum()`

### Phase 4: Production-Ready (future)

16. **Make relay a pure forwarder** — remove validation from `server/session.js`
17. **Add session persistence** — Redis or file-based store
18. **Consider single-port relay** — path-based routing instead of dynamic ports
19. **Add crafting validation** on host side
20. **Add quest progress validation** on host side

---

## Relay Deployment

### Running the Relay Server

```bash
# Install dependencies
cd /home/dadmin/projects/cuubz
npm install

# Run directly (development)
node server/index.js

# Or via systemd (production)
sudo systemctl start cuubz-relay
sudo systemctl enable cuubz-relay
```

### Systemd Service

The repo includes `cuubz-relay.service` at the root. Verify it points to the correct paths:

```ini
[Unit]
Description=Cuubz Multiplayer Relay Server
After=network.target

[Service]
Type=simple
User=dadmin
WorkingDirectory=/home/dadmin/projects/cuubz
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=MATCHMAKING_PORT=8765
Environment=SESSION_BASE_PORT=8766

[Install]
WantedBy=multi-user.target
```

### Firewall Rules

```bash
# Allow matchmaking port
sudo ufw allow 8765/tcp

# Allow session port range (adjust as needed)
sudo ufw allow 8766:8800/tcp
```

### Client Configuration

In `js/main.js`, the relay URL is determined at boot. To configure for production:

```javascript
// Option 1: Hard-coded relay URL
sessionManager.init('ws://your-relay-server.com:8765');

// Option 2: Auto-detect from page origin (if relay is on same host)
const relayUrl = `ws://${window.location.hostname}:8765`;
sessionManager.init(relayUrl);

// Option 3: Environment-based (for builds)
// Could be injected via a config endpoint or build-time replacement
```

### Health Check

```bash
curl http://relay-server:8765/health
# Response: {"status":"ok","activeSessions":0,"uptime":1234.56}

curl http://relay-server:8765/sessions
# Response: [{"sessionId":"session_xxx","name":"My World","players":1,"maxPlayers":4,"mode":"survival","sessionPort":8766}]
```

---

## File Reference

### Multiplayer Client Files

| File | Lines | Purpose |
|------|-------|---------|
| `js/multiplayer/client.js` | ~650 | WebSocket client, message queue, dual connection management |
| `js/multiplayer/host.js` | ~650 | Host authority, validation, rate limiting, player tracking |
| `js/multiplayer/playerSync.js` | ~550 | Remote player rendering, interpolation, meshes |
| `js/multiplayer/chunkStreamer.js` | ~500 | Chunk data streaming, RLE compression, multi-player LOD |
| `js/multiplayer/inventorySync.js` | ~550 | Inventory sync, diff computation, validation |
| `js/multiplayer/playerListHUD.js` | ~350 | Player list overlay UI, mobile-responsive |

### Server Files

| File | Lines | Purpose |
|------|-------|---------|
| `server/index.js` | ~120 | Relay entry point, matchmaking + session servers |
| `server/matchmaking.js` | ~180 | Lobby, session creation, join routing |
| `server/session.js` | ~250 | Game session relay, player tracking, message forwarding |

### Integration Points in `main.js`

| Section | Line Range | Purpose |
|---------|-----------|---------|
| `SessionManager` class | ~1130-1480 | Browser-side multiplayer session lifecycle |
| `initSessionUI()` | ~1486-1504 | Create SessionManager, set relay URL |
| `startGame()` multiplayer wiring | ~1693-1723 | Register host/client block change callbacks |
| Lobby screen handlers | ~720-960 | Browse, host, join button handlers |

### UI Elements in `index.html`

| Element | ID | Purpose |
|---------|-----|---------|
| Lobby screen | `lobby-screen` | Multiplayer lobby with browse/host tabs |
| Session list | `session-list` | Available sessions to join |
| Host form | `host-panel` | Session name, world select, mode, max players |
| Player list overlay | `player-list-overlay` | In-game player count and health bars |
| Player count | `player-count` | Active player count badge |
| Player items | `player-list-items` | Individual player entries |

### Test Files

| File | Coverage |
|------|----------|
| `test/test_multiplayerClient.js` | Client connection, message queue, reconnection |
| `test/test_multiplayerSync.js` | Host validation, player join/leave, block changes |
| `test/test_multiplayerStress.js` | Rate limiting, concurrent players, message flooding |
| `test/test_playerSync.js` | Remote player interpolation, mesh creation, staleness |
| `test/test_inventorySync.js` | Inventory validation, diff sync, sanitization |
| `test/test_chunkStreamer.js` | Chunk loading/unloading, RLE compression, streaming |
| `test/test_chunkStreamingIntegration.js` | End-to-end chunk streaming with host + clients |
