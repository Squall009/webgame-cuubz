# Cuubz — Bug Tracker

> Living bug tracker maintained by autonomous builder. Zero open bugs required before phase advancement.

| Bug # | Title | Status | Found During | Phase |
|-------|-------|--------|--------------|-------|
| 1 | Collision slide direction error | FIXED | Player movement integration tests | Phase 1 |
| 2 | FeaturePlacer placement outside chunk bounds | FIXED | Chunk loading tests | Phase 1 |
| 3 | Cave generator seam mismatch at chunk edges | FIXED | World generation integration | Phase 1 |
| 4 | TouchInput DOM access without browser guard | FIXED | Touch controls unit tests | Phase 1 |
| 5 | MouseInput exitPointerLock crashes in Node.js | FIXED | Touch controls unit tests | Phase 1 |
| 6 | MultiplayerClient connected status check incorrect | FIXED | WebSocket client implementation | Phase 2 |
| 7 | joinSession only sets sessionId when connected | FIXED | WebSocket client implementation | Phase 2 |
| 8 | HostManager playerCount includes disconnected players | FIXED | Host logic tests | Phase 2 |
| 9 | _updateSkyColor crashes with null renderer | FIXED | Day/night cycle implementation | Phase 3 |
| 10 | startTime=0 treated as falsy in Skybox constructor | FIXED | Day/night cycle implementation | Phase 3 |
| 11 | receiveType missing for type-filtered message receiving | FIXED | Multiplayer stress test | Phase 4 |
| 12 | Out-of-range block coordinates in multiplayer stress test | FIXED | Multiplayer stress test | Phase 4 |

---

## Bug #1: Collision slide direction error
- **Found:** 2026-05-24 during task "Player movement integration tests"
- **Status:** FIXED
- **Description:** Player AABB collision was sliding in wrong direction when hitting block face from certain angles. Expected: slide along wall. Actual: player stuck or pushed backward.
- **Reproduction Steps:** Move diagonally toward a wall at ~45° angle with AABB collision enabled.
- **Root Cause:** Collision resolution used axis-aligned push without considering movement direction vector.
- **Fix Applied:** Rewrote `_resolveCollision` to project movement onto free axis based on penetration depth comparison.
- **Verified:** 2026-05-24 — test_playerMovementIntegration.js passes (106 assertions)

## Bug #2: FeaturePlacer placement outside chunk bounds
- **Found:** 2026-05-24 during task "Chunk loading tests"
- **Status:** FIXED
- **Description:** FeaturePlacer placed trees/cacti that extended beyond the current chunk boundary, causing blocks to be written into neighboring chunks' data. This created orphan blocks and visual artifacts at chunk edges.
- **Reproduction Steps:** Generate world with seed 42, place trees near chunk edge (x=15 or z=15).
- **Root Cause:** FeaturePlacer checked only the base position against chunk bounds, not the full footprint of the feature being placed.
- **Fix Applied:** Added footprint validation in `_canPlaceFeature` that checks all blocks a feature would occupy against chunk boundaries.
- **Verified:** 2026-05-24 — test_chunkLoading.js passes (51 assertions)

## Bug #3: Cave generator seam mismatch at chunk edges
- **Found:** 2026-05-24 during task "World generation integration"
- **Status:** FIXED
- **Description:** Caves did not continue seamlessly across chunk boundaries. Walking from one chunk to the next showed cave tunnels abruptly ending or appearing mid-air.
- **Reproduction Steps:** Generate adjacent chunks with same seed, compare boundary faces at shared edge.
- **Root Cause:** 3D noise thresholding used independent random seeds per chunk instead of continuous world-space coordinates for the noise function.
- **Fix Applied:** Changed cave generator to use world-space coordinates (chunkX * 16 + localX) as input to the 3D noise function, ensuring deterministic continuity across chunk boundaries.
- **Verified:** 2026-05-24 — test_worldGenerationIntegration.js passes (36 assertions including seam tests)

---

## Template for New Bugs

```markdown
## Bug #N: [Title]
- **Found:** [date] during task "[task name]"
- **Status:** OPEN / FIXING / FIXED
- **Description:** What happens vs expected
- **Reproduction Steps:** Exact steps to trigger
- **Root Cause:** (when known)
- **Fix Applied:** (when fixed)
- **Verified:** [date] — test passes
```

## Bug #4: TouchInput DOM access without browser guard
- **Found:** 2026-05-24 during task "Touch controls unit tests"
- **Status:** FIXED
- **Description:** `_onJoystickMove` and `_onJoystickEnd` methods in `js/input/touch.js` directly call `document.getElementById()` without checking if running in a browser context. This causes `ReferenceError: document is not defined` when the module is loaded or tested in Node.js (e.g., unit tests, SSR).
- **Reproduction Steps:** Run `node test/test_touchControls.js` — test crashes on `_onJoystickMove` call with `document is not defined`.
- **Root Cause:** Constructor checks `typeof window !== 'undefined'` before binding events, but the internal event handler methods (`_onJoystickMove`, `_onJoystickEnd`) directly access `document.getElementById` without guards. These methods are callable in Node.js tests via direct invocation.
- **Fix Applied:** Wrapped all `document.getElementById()` calls in `_onJoystickMove` and `_onJoystickEnd` with `if (typeof document !== 'undefined')` guards. Visual thumb updates are now browser-only.
- **Verified:** 2026-05-24 — test_touchControls.js passes (116 assertions)

## Bug #5: MouseInput exitPointerLock crashes in Node.js
- **Found:** 2026-05-24 during task "Touch controls unit tests"
- **Status:** FIXED
- **Description:** `exitPointerLock()` method in `js/input/mouse.js` checks `typeof document.exitPointerLock === 'function'` but does not first check if `document` itself exists. In Node.js context, accessing `document` throws `ReferenceError: document is not defined`.
- **Reproduction Steps:** Create MouseInput instance in Node.js and call `mouse.exitPointerLock()` — crashes with `document is not defined`.
- **Root Cause:** Missing outer guard for `typeof document !== 'undefined'` before accessing `document.exitPointerLock`. The `requestPointerLock` method already has this pattern (checks canvas method existence), but `exitPointerLock` was inconsistent.
- **Fix Applied:** Changed condition from `typeof document.exitPointerLock === 'function'` to `typeof document !== 'undefined' && typeof document.exitPointerLock === 'function'`.
- **Verified:** 2026-05-24 — test_touchControls.js passes (116 assertions)

## Bug #6: MultiplayerClient connected status check incorrect
- **Found:** 2026-05-24 during task "WebSocket client implementation"
- **Status:** FIXED
- **Description:** `isMatchmakingConnected` and `isGameSessionConnected` getters checked `_matchmakingConn && _matchmakingConn.isConnected`, but when the connection object is null (initial state), this returned false. However, after `dispose()` called `disconnect()`, the connection was set to null while the internal state wasn't updated, causing inconsistent reads between the getter and the state object.
- **Reproduction Steps:** Create MultiplayerClient, check `isMatchmakingConnected` — returns false (correct). After dispose + reconnect attempt, getter could return stale value.
- **Root Cause:** The getters checked the raw connection object reference instead of the authoritative state object that tracks connection lifecycle.
- **Fix Applied:** Changed getters to read from `this.state.matchmaking === CLIENT_STATE.CONNECTED` and `this.state.gameSession === CLIENT_STATE.CONNECTED`.
- **Verified:** 2026-05-24 — test_multiplayerClient.js passes (156 assertions)

## Bug #7: joinSession only sets sessionId when connected
- **Found:** 2026-05-24 during task "WebSocket client implementation"
- **Status:** FIXED
- **Description:** `joinSession(sessionId)` only set `this._currentSessionId` inside the `if (this._matchmakingConn)` guard. When called before connecting to matchmaking, the session ID was never stored, so subsequent calls that check `currentSessionId` would return null.
- **Reproduction Steps:** Create MultiplayerClient, call `joinSession('abc')`, then check `currentSessionId` — returns null instead of 'abc'.
- **Root Cause:** The session ID assignment was nested inside the connection guard, making it conditional on having an active matchmaking connection.
- **Fix Applied:** Moved `this._currentSessionId = sessionId` outside the `if (this._matchmakingConn)` block so it always updates regardless of connection state.
- **Verified:** 2026-05-24 — test_multiplayerClient.js passes (156 assertions)

## Bug #8: HostManager playerCount includes disconnected players
- **Found:** 2026-05-25 during task "Host logic tests"
- **Status:** FIXED
- **Description:** `playerCount` getter used `this._players.size` which counts ALL entries in the Map, including players who disconnected (`connected = false`). This caused stale player counts after `_handlePlayerLeft()` was called. Expected: only connected players counted. Actual: disconnected players still counted.
- **Reproduction Steps:** Create HostManager, start session, add remote player, call `_handlePlayerLeft(playerId)`, check `playerCount` — returns 2 instead of expected 1 (just host).
- **Root Cause:** `_handlePlayerLeft` sets `connected = false` but doesn't remove the player from the Map (by design, for reconnect tracking). The `playerCount` getter didn't filter by connection status.
- **Fix Applied:** Changed `playerCount` getter to iterate `_players` and only count entries where `player.connected === true`. Also fixed test ordering in test_hostLogic.js — edge case assertions expected post-endSession state but `endSession()` was called too late.
- **Verified:** 2026-05-25 — test_hostLogic.js passes (182 assertions), full suite 35/35 passing

## Bug #9: _updateSkyColor crashes with null renderer
- **Found:** 2026-05-25 during task "Day/night cycle implementation"
- **Status:** FIXED
- **Description:** `_updateSkyColor()` checked `!this.renderer.scene` but did not first check if `this.renderer` itself exists. When Skybox is instantiated with `null` renderer (e.g., for Node.js testing), calling `setTime()` → `_updateSkyState()` → `_updateSkyColor()` crashes with `TypeError: Cannot read properties of null (reading 'scene')`.
- **Reproduction Steps:** Create `new Skybox(null)`, call `sb.setTime(6)` — crashes.
- **Root Cause:** Missing outer guard for `this.renderer` before accessing `.scene`. The `init()` method already had this pattern (`typeof THREE === 'undefined' || !this.renderer.scene`), but `_updateSkyColor()` was inconsistent.
- **Fix Applied:** Changed guard from `!this.renderer.scene` to `!this.renderer || !this.renderer.scene`.
- **Verified:** 2026-05-25 — test_skybox.js passes (100 assertions), full suite 46/46 passing

## Bug #10: startTime=0 treated as falsy in Skybox constructor
- **Found:** 2026-05-25 during task "Day/night cycle implementation"
- **Status:** FIXED
- **Description:** Constructor used `options.startTime || 12` which treats `startTime: 0` (midnight) as falsy, falling back to default noon (12). This means you can never start at midnight.
- **Reproduction Steps:** Create `new Skybox(null, { startTime: 0 })` — timeOfDay is 12 instead of 0.
- **Root Cause:** JavaScript `||` operator treats 0 as falsy. Same issue exists for `cycleDuration`.
- **Fix Applied:** Changed from `options.startTime || 12` to `options.startTime !== undefined ? options.startTime : 12`.
- **Verified:** 2026-05-25 — test_skybox.js Group 18 confirms startTime=0 works correctly.

## Bug #11: receiveType missing for type-filtered message receiving
- **Found:** 2026-05-24 during task "Multiplayer stress test"
- **Status:** FIXED
- **Description:** TestClient lacked `receiveType()` method to find specific message types in buffer. Stale PLAYER_JOINED messages from the join sequence were consumed first by `receive()`, causing broadcast tests (BLOCK_BREAK, INVENTORY_SYNC) to fail since they expected the first message to be the broadcast.
- **Reproduction Steps:** Run test_multiplayerStress.js — Group 2 and 4 fail because queued PLAYER_JOINED from join sequence are consumed instead of expected broadcasts
- **Root Cause:** `drain()` clears queue but messages arrive asynchronously after drain; `receive()` returns first message regardless of type. After P2-P4 join, each client has 1-3 buffered PLAYER_JOINED messages that persist.
- **Fix Applied:** Added `receiveType(expectedType, timeout)` method that (1) searches buffer for matching type, and (2) if not found, waits for new messages while discarding non-matching ones. Updated Group 2 and 4 tests to use `receiveType()` instead of `receive()`.
- **Verified:** 2026-05-24 — test_multiplayerStress.js passes 44/44

## Bug #12: Out-of-range block coordinates in multiplayer stress test
- **Found:** 2026-05-24 during task "Multiplayer stress test"
- **Status:** FIXED
- **Description:** BREAK_BLOCK test used coords (10,20,10) which is ~14 blocks from player position (0,20,0), exceeding server max reach of 6 blocks. PLACE_BLOCK used (15,20,15) with same issue (~21 blocks). Server silently rejected these via `_validateBlockBreak`/`_validateBlockPlace` distance check, so no broadcast was sent to any client.
- **Reproduction Steps:** Send BREAK_BLOCK with x:10,z:10 while player at origin — receives nothing because validation fails (dist > 6)
- **Root Cause:** Test coordinates not validated against `_validateBlockBreak` reach distance check (>6 blocks = rejected with ERROR sent only to sender, no broadcast to others)
- **Fix Applied:** Changed BREAK_BLOCK to (3,20,3) dist~5.2 and PLACE_BLOCK to (2,20,2) dist~3.5 — both within 6-block reach distance
- **Verified:** 2026-05-24 — test_multiplayerStress.js passes 44/44
