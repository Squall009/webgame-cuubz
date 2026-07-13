# Cuubz — Multiplayer Support: Status, Architecture & Action Plan

> **Last updated:** 2026-07-13
> **Status:** Relay running on server with path-based routing. Client wired for movement, block changes, player sync, inventory sync. Ready for LAN testing.
> **Scope:** All multiplayer code in `js/multiplayer/`, `server/`, `js/main.js` (SessionManager), and related tests.

---

## Architecture Overview

Cuubz uses a **client-host relay architecture** with three tiers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RELAY SERVER (separate service)              │
│  Single port (8765) with path-based routing:                        │
│  /matchmaking  → session discovery, host/join routing               │
│  /session/:id  → game session relay                                 │
└─────────────────────────────────────────────────────────────────────┘
         │
         │  WS (single port, path-based routing)
         ▼
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
- **Relay is a separate service:** Runs independently on `cuubz-relay.thehomelabguy.com`. Nginx handles TLS termination → forwards to port 8765.
- **Path-based routing:** Single port, no dynamic ports. Everything goes through `/matchmaking` or `/session/:id`.
- **Max 4 players per session.**

---

## Relay Server Architecture

### Deployment Model

```
┌──────────────────────┐         ┌──────────────────────┐
│  Static File Server   │         │  Relay Server         │
│  (nginx / built-in)   │         │  (Node.js)            │
│  Port: 80/443         │         │  Port: 8765           │
│  Serves: index.html   │         │  /matchmaking         │
│  and all game assets  │         │  /session/:id         │
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
| `server/index.js` | Entry point — HTTP + WS server, path-based routing, session lifecycle, graceful shutdown | 8765 |
| `server/matchmaking.js` | Lobby — session creation, browsing, join routing | 8765 (path: `/matchmaking`) |
| `server/session.js` | Game session relay — player connections, message forwarding, heartbeat | 8765 (path: `/session/:id`) |

### Configuration

```bash
# Environment variables
MATCHMAKING_PORT=8765          # Single port for everything

# Systemd service file: cuubz-relay.service (in repo root)
```

### What the Relay Does

**Current behavior:** Pure message forwarder. No game logic, no validation. Responsibilities:

1. Route messages between connected players
2. Track who is connected to which session
3. Enforce heartbeat keepalive (disconnect stale players)
4. Broadcast `PLAYER_JOINED` / `PLAYER_LEFT` events

All validation (block breaks, places, movement, inventory) happens on the host client via `HostManager`.

### Why Path-Based Routing?

1. **Single port:** Only port 8765 needs to be open. No dynamic port forwarding.
2. **Nginx-friendly:** TLS termination on 443, forward to 8765. Clean.
3. **Scalable:** Multiple sessions multiplexed on single server.
4. **Clean separation:** Relay has its own identity (`cuubz-relay.thehomelabguy.com`), easy to move to different machine.
5. **Works everywhere:** Internal split DNS → internal IP, external → public IP. Same URL, same behavior.

### Client Configuration

The game client connects to the relay via a single URL configured in `main.js`:

```javascript
// js/main.js — getRelayUrl()
// Fixed relay subdomain — works regardless of how the game is accessed.
// Nginx handles TLS (wss://) and forwards to the relay on port 8765.
const protocol = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss' : 'ws';
return `${protocol}://cuubz-relay.thehomelabguy.com`;
```

Override via query parameter: `?relayUrl=wss://custom-host`

---

## What's Implemented (Code Complete)

### ✅ `js/multiplayer/client.js` — WebSocket Client

**Status:** Solid, well-designed, production-ready.

- Dual connection management (matchmaking relay + game session)
- Path-based routing: `/matchmaking` and `/session/:id`
- Message queue with bounded size (500) and flush-on-reconnect
- Heartbeat keepalive (15s interval, 5s timeout)
- Exponential backoff reconnection (1s → 30s cap, ±25% jitter)
- Event-driven architecture: `onMatchmaking()` / `onGame()` routing
- Protocol-aware convenience methods: `sendJoin()`, `sendMove()`, `sendBreakBlock()`, `sendPlaceBlock()`, `sendInventory()`
- Auto-detects `ws` vs `wss` based on page protocol
- Testable in Node.js with mock WebSocket factory

### ✅ `js/multiplayer/host.js` — Client-Side Authoritative Host

**Status:** Solid validation pipeline, wired into SessionManager.

- Full validation: `validateBlockBreak()`, `validateBlockPlace()`, `validateMove()`, `validateInventory()`, `validateQuestUpdate()`
- Rate limiter (token bucket): 20 moves/sec per player, 100ms block change cooldown
- Speed validation: rejects positions requiring >30 blocks/s
- Remote player state tracking via `HostRemotePlayer`
- World state log (block changes, quest progress)
- Kick player support
- Host-initiated actions bypass validation (correct — host is authoritative)

### ✅ `js/multiplayer/playerSync.js` — Remote Player Rendering

**Status:** Complete implementation, instantiated in startGame().

- Smooth interpolation (position lerp 0.15, rotation lerp 0.12)
- Staleness detection (5s threshold) with state machine: INACTIVE → LOADING → ACTIVE → STALE
- Ping tracker with rolling average/min/max
- Three.js voxel character mesh (head/body/arms/legs with color shading)
- Name tags (canvas sprites above head)
- Health bars (color-coded: green >60%, yellow >30%, red ≤30%)
- Proper geometry/material disposal

### ✅ `js/multiplayer/chunkStreamer.js` — Chunk Data Streaming

**Status:** Complete standalone system, not yet integrated.

- Multi-player position tracking — loads chunks around ALL players
- RLE compression for chunk data (efficient for air-heavy chunks)
- Dirty tracking — re-streams chunks with block changes
- Load/unload radius with hysteresis (load at 6, unload at 8)
- Tick-based streaming with max chunks per tick (4) to avoid flooding
- Chunk states: UNLOADED → LOADING → LOADED → DIRTY → STREAMING

### ✅ `js/multiplayer/inventorySync.js` — Inventory Synchronization

**Status:** Complete with validation, wired into startGame().

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

**Status:** Functional, runs as standalone Node.js process with path-based routing.

- Matchmaking relay with session creation, browsing, join routing
- Session manager with player tracking, message forwarding, heartbeat
- Single port (8765) with path-based routing (`/matchmaking`, `/session/:id`)
- Graceful shutdown with SIGINT/SIGTERM handling
- Health check endpoint (`/health`) and session listing (`/sessions`)

### ✅ `js/main.js` — SessionManager Integration

**Status:** Fully wired. Multiplayer enabled.

- Lobby screen with browse/host tabs (`index.html` lines 210-250)
- Session lifecycle: `init()` → `browseSessions()` → `startHosting()` / `joinSession()`
- Movement sync in render loop (~20Hz, every 3rd frame)
- Block interaction sync: `_lastBroken`/`_lastPlaced` tracking consumed by render loop
- `PlayerSyncManager` instantiated, meshes added to scene, events wired
- `HostManager` initialized in `startHosting()`
- `InventorySync` initialized, initial inventory sent on join, periodic diff sync (5s)
- JOIN message sent to game session in `startGame()`
- `startGame()` called after `startHosting()` and after joining a session
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

## 🔴 Critical Issues (Remaining)

### 1. ChunkStreamer Not Integrated

**Location:** `js/multiplayer/chunkStreamer.js`

`ChunkStreamer` is a complete standalone system but is never instantiated. The host relies on the relay server's dumb forwarding of `CHUNK_DATA` messages.

**Impact:** The intelligent multi-player chunk loading with RLE compression sits unused. Chunks are never proactively streamed to remote players based on their positions.

**Fix:** Instantiate `ChunkStreamer` on host start, wire it to player positions, and use its `tick()` output to send `CHUNK_DATA` messages.

### 2. PlayerListHUD Not Connected to Live Data

**Location:** `js/main.js`

`PlayerListHUD` exists and renders, but is not connected to `PlayerSyncManager` for live player count updates.

**Impact:** Player list overlay shows stale data or doesn't update when players join/leave.

**Fix:** Wire `PlayerSyncManager` events to update `PlayerListHUD`:
```javascript
playerSync.onPlayerAdded = (playerId, state) => {
    playerListHUD.addPlayer({ id: playerId, name: state.name, color: state.color, health: state.health });
};
playerSync.onPlayerRemoved = (playerId) => {
    playerListHUD.removePlayer(playerId);
};
```

### 3. No Session Rejoin/Reconnect

If a client disconnects from the game session, `WSConnection` auto-reconnects to matchmaking but there's no mechanism to rejoin the game session automatically.

**Impact:** Players who drop connection have to manually browse and rejoin.

**Recommendation:** Store `currentSessionId` and auto-rejoin on reconnect. Add a "rejoin last session" button in the lobby.

---

## 🟡 Design Issues (Should Fix Before Launch)

### 4. No Speed/Position Validation Beyond Basic Check

The host validates speed (>30 blocks/s) but doesn't do position extrapolation or predict where the player should be.

**Impact:** In a trusted LAN environment this is fine. For internet play, you'd need more sophisticated validation.

**Recommendation:** Add position extrapolation to `HostManager._handlePlayerMove()`:
```javascript
// Predict where player should be based on last known position and max speed
const predictedX = player.position.x + maxSpeed * dt * Math.cos(player.rotation.yaw);
const predictedZ = player.position.z + maxSpeed * dt * Math.sin(player.rotation.yaw);
const dx = data.position.x - predictedX;
const dz = data.position.z - predictedZ;
if (Math.sqrt(dx*dx + dz*dz) > maxSpeed * dt * 2) {
    console.warn(`[HostManager] Position extrapolation violation from ${playerId}`);
    return;
}
```

### 5. No Cheating Prevention Beyond Basic Validation

- Inventory validator runs but isn't fully wired — players could craft impossible items
- No crafting validation on the host side
- No quest progress validation

**Recommendation:** Wire `InventoryValidator` into the host's block break/place pipeline. Validate that the player actually has the block they're placing.

### 6. No Session Persistence

If the relay server restarts, all sessions are lost. No way to recover active sessions.

**Recommendation:** For now, accept this as a limitation. Sessions are ephemeral. If you want persistence later, add Redis or a simple file-based session store to the relay.

### 7. Missing `QUEST_UPDATE` Handling in Relay

`QUEST_UPDATE` is defined in the protocol (`client.js`) and handled by `HostManager`, but `server/session.js` doesn't relay it.

**Fix:** Add `QUEST_UPDATE` to the message switch in `server/session.js._handleMessage()`.

---

## 🟢 Minor Issues

### 8. Typo Fixed ✅

`PingTracker.getMaximun()` → `getMaximum()` — **FIXED** in `playerSync.js`.

### 9. `RemotePlayerState` vs `HostRemotePlayer` Duplication

Two nearly identical player state classes in different files:
- `HostRemotePlayer` (host.js) — tracks position, rotation, character, inventory, timestamps
- `RemotePlayerState` (playerSync.js) — tracks position, rotation, health, ping, mesh references

They share no base class and use different field names.

**Recommendation:** Extract a shared `PlayerState` base class or use a common interface.

---

## Action Plan: Making Multiplayer Work

### Phase 1: Enable & Wire ✅ DONE

These were the minimum changes to get 2-player LAN multiplayer working:

1. ✅ Remove the `return` in `SessionManager.init()` — enable the WebSocket client
2. ✅ Configure the relay URL — point at `cuubz-relay.thehomelabguy.com`
3. ✅ Add movement sync to render loop — send position ~20Hz
4. ✅ Wire block interaction — send `breakBlock()`/`placeBlock()` over WebSocket
5. ✅ Instantiate `PlayerSyncManager` in `startGame()` — add meshes to scene, update in render loop
6. ✅ Fix Y bounds in `host.js` and `server/session.js` — align to `0`–`96`
7. ✅ Run `server/index.js` on the relay server

### Phase 2: Host Authority ✅ DONE

8. ✅ Wire `HostManager` into `SessionManager.startHosting()` — enable rate limiting and validation
9. ✅ Wire `InventorySync` — send initial inventory on join, start periodic diff sync
10. ✅ Add speed validation to `HostManager._handlePlayerMove()` (reject >30 blocks/s)

### Phase 3: Polish (Partial)

11. ❌ Wire `ChunkStreamer` on host — proactive chunk streaming to remote players
12. ❌ Wire `PlayerListHUD` — connect to `PlayerSyncManager` for live player count
13. ❌ Add session rejoin — store last session ID, auto-rejoin on reconnect
14. ✅ Fix typo — `getMaximun()` → `getMaximum()`

### Phase 4: Production-Ready (future)

15. Add position extrapolation to `HostManager._handlePlayerMove()`
16. Add crafting validation on host side
17. Add quest progress validation on host side
18. Add session persistence — Redis or file-based store
19. Consider WebRTC P2P for direct player connections (relay as signaling only)

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

The repo includes `cuubz-relay.service` at the root. Current server config:

```ini
[Unit]
Description=Cuubz Multiplayer Relay Server
After=network.target

[Service]
Type=simple
User=dadmin
WorkingDirectory=/var/www/html/server
ExecStart=/home/dadmin/.local/node-v22.22.0-linux-x64/bin/node index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=MATCHMAKING_PORT=8765

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cuubz-relay

[Install]
WantedBy=multi-user.target
```

### Nginx Configuration

```nginx
server {
    listen 443 ssl;
    server_name cuubz-relay.thehomelabguy.com;

    ssl_certificate /path/to/cert;
    ssl_certificate_key /path/to/key;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### Health Check

```bash
curl http://relay-server:8765/health
# Response: {"status":"ok","activeSessions":0,"uptime":1234.56}

curl http://relay-server:8765/sessions
# Response: [{"sessionId":"session_xxx","name":"My World","players":1,"maxPlayers":4,"mode":"survival"}]
```

---

## File Reference

### Multiplayer Client Files

| File | Lines | Purpose |
|------|-------|---------|
| `js/multiplayer/client.js` | ~650 | WebSocket client, message queue, dual connection management, path-based routing |
| `js/multiplayer/host.js` | ~650 | Host authority, validation, rate limiting, player tracking, speed validation |
| `js/multiplayer/playerSync.js` | ~550 | Remote player rendering, interpolation, meshes |
| `js/multiplayer/chunkStreamer.js` | ~500 | Chunk data streaming, RLE compression, multi-player LOD |
| `js/multiplayer/inventorySync.js` | ~550 | Inventory sync, diff computation, validation |
| `js/multiplayer/playerListHUD.js` | ~350 | Player list overlay UI, mobile-responsive |

### Server Files

| File | Lines | Purpose |
|------|-------|---------|
| `server/index.js` | ~130 | Relay entry point, path-based routing, matchmaking + session servers |
| `server/matchmaking.js` | ~180 | Lobby, session creation, join routing |
| `server/session.js` | ~250 | Game session relay, player tracking, message forwarding |

### Integration Points in `main.js`

| Section | Line Range | Purpose |
|---------|-----------|---------|
| `SessionManager` class | ~1130-1480 | Browser-side multiplayer session lifecycle |
| `initSessionUI()` | ~1486-1504 | Create SessionManager, set relay URL |
| `startGame()` multiplayer wiring | ~1693-1723 | Register host/client block change callbacks |
| `startGame()` player sync | ~1852-1883 | Instantiate PlayerSyncManager, wire events |
| `startGame()` inventory sync | ~1910-1940 | Instantiate InventorySync, start periodic sync |
| Render loop movement sync | ~2263-2268 | Send position ~20Hz |
| Render loop block sync | ~2345-2355 | Send break/place over WebSocket |
| Render loop player sync | ~2335-2337 | Update remote player interpolation |
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
