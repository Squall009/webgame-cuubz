# Cuubz — Refactoring Plan (v2, verified)

> **Goal:** Turn a 34k-line, script-tag, single-global-scope codebase into a modular ES-module architecture — without losing player data, breaking deployment, or silently changing gameplay.
>
> **This version was written by running the code, not skimming it.** Every number below was measured on 2026-07-29. v1 of this document was rejected: its diagnosis was directionally right but its facts were wrong, its safety gate (the test suite) does not exist, and it omitted deployment entirely. See [Appendix B](#appendix-b--what-changed-from-v1) for the diff.
>
> **Handoff format:** numbered PRs, each independently verifiable with its own acceptance criteria and rollback point. Not weeks. Do not batch PRs.

> ### Every bug goes in [`BUGS.md`](./BUGS.md), with a severity and an owner PR
>
> Added by PR 6c. **"Documented and unowned" is not an acceptable end state** — it is how
> this codebase reached the state Phase 0 is unpicking. `DEPLOY.md` §8 shipped with six
> unowned rows, one of which (**H-1**) was live data corruption that destroyed ~90% of a
> world's saved chunks per cross-world visit and sat unowned through two PRs.
>
> So: every bug found gets a row in `BUGS.md` **when it is found**, and **either a fix in
> the current PR or an explicit PR slot** — created here if none exists. A bug found
> mid-task that is out of scope is logged with an owner and left, not silently absorbed and
> not merely mentioned in a paragraph. **Prose is not a ledger**; the defects that were
> loose in PR 4's and PR 5's prose with no ID (D-20, D-21, D-22) are the proof.

---

## Table of Contents

1. [Read This First — Hard Constraints](#1-read-this-first--hard-constraints)
2. [Why Modules: The Global Scope Is Actively Broken](#2-why-modules-the-global-scope-is-actively-broken)
3. [Measured Current State](#3-measured-current-state)
4. [Architecture Target](#4-architecture-target)
5. [Phase 0 — Stop The Bleeding (PR 1–6, plus 6b and 6c)](#5-phase-0--stop-the-bleeding-pr-16-plus-6b-and-6c)
6. [Phase 1 — Vite + ES Modules (PR 7–11)](#6-phase-1--vite--es-modules-pr-711)
7. [Phase 2 — Hoist Closure State onto `Game` (PR 12–13)](#7-phase-2--hoist-closure-state-onto-game-pr-1213)
8. [Phase 3 — Decompose main.js (PR 14–19)](#8-phase-3--decompose-mainjs-pr-1419)
9. [Phase 4 — Systems, EventBus, Split Monoliths (PR 20–25)](#9-phase-4--systems-eventbus-split-monoliths-pr-2025)
10. [Phase 5 — UI / HTML / CSS (PR 26–29)](#10-phase-5--ui--html--css-pr-2629)
11. [Phase 6 — Shared Protocol & Test Migration (PR 30–33)](#11-phase-6--shared-protocol--test-migration-pr-3033)
12. [Deferred: Three.js Upgrade (separate project)](#12-deferred-threejs-upgrade-separate-project)
13. [File Migration Map](#13-file-migration-map)
14. [Anti-Patterns](#14-anti-patterns)
15. [Appendices](#appendix-a--full-file-inventory)

---

## 1. Read This First — Hard Constraints

These are the things that will destroy the project if ignored. Each is verified.

### 1.1 There is no green baseline. The suite is red *now*.

```
$ bash test/run_tests.sh
53 test files → 21 pass, 32 fail
```

Three source files **crash on `require`** because `module.exports` references identifiers that only exist as script-tag globals:

| File | Error |
|---|---|
| `js/systems/crafting.js:?` | `ReferenceError: BLOCK_TYPES is not defined` |
| `js/systems/damageSystem.js:?` | `ReferenceError: DAMAGE_SOURCES is not defined` |
| `js/entities/worldManager.js:462` | `ReferenceError: MIN_NAME_LENGTH is not defined` |

The remaining failures are real assertion failures and missing deps (`test_skybox`: fog density 0.008 vs expected 0.001; `test_responsiveHUD`: 26 failing assertions; `test_pageLoad`: **jsdom is not installed**).

> **You cannot verify "feature parity" against a red baseline.** Phase 0 exists solely to produce a trustworthy gate. Do not start Phase 1 until PR 4 lands.

Also: `"test": "node test/run_tests.sh"` (proposed in v1) **cannot work** — it's a bash script. Use `bash test/run_tests.sh`.

### 1.2 Pin `three@0.134.0`. Do NOT run `npm install three`.

`js/three.min.js` is **r134 (2021)**. The renderer silently depends on r134 defaults:

- `js/renderer/pbrShader.js` is **843 hand-written lines** with **7 `ShaderMaterial`** instances, `fog: true` on 6 of them (lines 710, 734, 752, 781, 798, 826), custom world-space lighting, and custom shadow-map uniforms.
- There is **zero** occurrence of `outputEncoding`, `sRGBEncoding`, `outputColorSpace`, `physicallyCorrectLights`, or `useLegacyLights` anywhere in `js/`.

Modern Three (r15x+) flipped color management to sRGB-by-default and changed light units. A blind upgrade changes **every colour in the game** and breaks the custom shader's fog/shadow integration.

Good news, verified: neither worker uses THREE at all (`workerGeneration.js`: 0 refs, `meshWorker.js`: 0 refs), and no removed APIs (`THREE.Geometry`, `CanvasRenderer`, `JSONLoader`) are used. So a pinned r134 module install is a pure no-op visually.

→ Phase 1 installs `three@0.134.0` **exactly**. The upgrade is [§12](#12-deferred-threejs-upgrade-separate-project), a separate project gated on screenshot diffing.

### 1.3 Web Workers are fetch+Blob and will break under Vite.

`js/chunkmanager.js` builds both worker pools by fetching source text and wrapping it in a Blob:

```js
// chunkmanager.js:222   (world gen)
const blob = new Blob([source], { type: 'application/javascript' });
// chunkmanager.js:239   (mesh builder)
const response = await fetch('js/renderer/meshWorker.js?v=20260726-1');
```

Problems:
- Hardcoded `js/...` paths break the instant files move to `src/`.
- `js/renderer/meshWorker.js` **is not in any `<script>` tag** — Vite will not emit it unless told to.
- `js/world/workerGeneration.js` is **dual-mode**: an IIFE taking `globalScope` (`typeof globalScope !== 'undefined'` ×2), *and* it's script-tagged at `index.html:523` for a main-thread inline fallback, *and* it's fetched for the worker. That triple contract must be preserved deliberately or removed deliberately.

→ PR 9 must convert to `new Worker(new URL('./meshWorker.js', import.meta.url), { type: 'module' })` or Vite's `?worker` / `?url` imports, and state explicitly what happens to the inline fallback.

### 1.4 Deployment is the single biggest risk. A build step breaks it.

- `sync.sh` tars the repo → `scp` → extracts into `/var/www/html` on `10.0.30.160`, served as **raw static files**.
- `cuubz-relay.service` has `WorkingDirectory=/var/www/html/server`, `ExecStart=node index.js`.
- **`sync.sh` excludes `dist/`** (line: `--exclude='dist'`) **and `.gitignore` ignores `dist/`.**

→ The first `./sync.sh` after Phase 1 would ship **a site with no JavaScript at all**. PR 10 must land a build-then-sync `sync.sh` in the same PR as the Vite switch, and confirm the systemd unit's `WorkingDirectory` still resolves after the layout change.

> **PR 6 consolidated this section into [`DEPLOY.md`](./DEPLOY.md) — read that before deploying.** It documents the full deploy path line by line and adds nine defects this section does not mention, of which the three that matter most are: **`sync.sh` never restarts the relay** (no `systemctl` anywhere in the repo, so `server/` changes are silently inert), **`tar xzf` never deletes** (the stale `js/` tree stays live next to `src/` after PR 9), and **there is no rollback mechanism at all** — extraction is in-place with no backup retained. PR 10 owns all three. `DEPLOY.md` §8 is the defect table with owners.

### 1.5 Player data must survive byte-for-byte.

Hard invariants — never change these strings or the schema behind them:

| Key | Location | Value |
|---|---|---|
| IndexedDB name | `js/chunkmanager.js:20` | `'cuubz-worlds'` |
| IndexedDB version | `js/chunkmanager.js:21` | `2` |
| localStorage | `js/renderer/performanceSettings.js:34,52` | `'cuubz:settings'` |
| localStorage | `js/main.js:1272,1284,1593,1768,1785` | `'cuubz_last_session'` |

→ **Save/load test at every single checkpoint:** create a world, place blocks, quit to menu, reload the page, re-enter, confirm blocks persist. **PR 6b automated most of it early — run `npm run test:e2e`** (104 assertions, real browser, reads IndexedDB and localStorage directly). Three steps stay manual until PR 12–13 hoists the closure locals: placing/breaking blocks, quit-to-menu (blocked by `DEPLOY.md` D-14), and multiplayer. See the [PR 6b outcome](#pr-6b--automate-the-saveload-gate--done).

> **PR 6 found this table incomplete and superseded it — the authoritative list is now [`DEPLOY.md` §2](./DEPLOY.md#2-do-not-change-player-data-invariants).** The four rows above are real, but they miss: the three `js/world/persistence.js` localStorage keys (**`cuubz:characters`** — every character the player has ever made — plus `cuubz:slotMap` and `cuubz:worldSlot:{N}:conf`), both IndexedDB object stores and their key paths, and the entire chunk binary format (magic `"CUUB"`, version `3`, 20-byte header, FNV-1a checksum constants). It also misses the two hazards that make the table load-bearing: **bumping `DB_VERSION` destroys every player's worlds** (`onupgradeneeded` deletes all object stores before recreating them — **H-2, still open, owned by [PR 6d](#pr-6d--rewrite-onupgradeneeded-so-a-schema-change-can-migrate-h-2-h-3)**), and **chunk primary keys were not world-scoped, so the three world slots overwrote each other's terrain** — a live bug, confirmed by measurement in PR 6b and **fixed in [PR 6c](#pr-6c--storage-integrity-h-1--d-15-in-one-migration--done)**, which world-scoped the storage key and migrated existing records at runtime. The chunk store's primary key is therefore now `` `${worldName}:${cx},${cz}` ``; the *logical* key `` `${cx},${cz}` `` is unchanged and must stay that way. The executable 14-step checklist is [`DEPLOY.md` §7](./DEPLOY.md#7-saveload-checklist); it includes the save-timing rules (chunks flush on a 5 s timer, player state every 30 s / on Escape) without which the naive version of this test produces false failures.

### 1.6 `renderLoop` cannot be extracted as written.

`startGame()` (`js/main.js:2156`) wraps everything in `setTimeout(async () => { try { ... } })`. About 1,845 lines sit at ≥10 spaces of indentation. `renderLoop` (`js/main.js:3908`) is a closure over **~184 local variables**, including `renderer, chunkManager, player, inventory, skybox, biomeEffects, blockInteraction, chunkStreamer, playerSync, droppedItems, firstPersonHand, itemAtlas` and ~170 more.

→ [Phase 2](#7-phase-2--hoist-closure-state-onto-game-pr-1213) exists purely to hoist those locals onto an explicit `Game` object **before** any file splitting. Skip it and every extraction in Phase 3 breaks.

### 1.7 `js/mobs/` is untracked. Commit or park it.

18 files, **3,516 lines**, entirely absent from git. `MOB_PLAN.md` is **56 checked / 253 unchecked** — a half-built subsystem. Additionally **16 tracked files are modified right now** (`index.html`, `js/main.js`, `js/chunkmanager.js`, `js/input/interaction.js`, `js/multiplayer/chunkStreamer.js`, `js/multiplayer/client.js`, `js/renderer/firstPersonHand.js`, `js/renderer/voxelRenderer.js`, `js/systems/inventory.js`, `server/session.js`, `package.json`, `package-lock.json`, + 4 textures) plus 6 untracked texture PNGs.

→ PR 1 commits everything and tags a rollback point. Refactoring on top of uncommitted work has no undo.

### 1.8 Textures: 118 MB, 3,370 files, already in git.

3,364 are tracked; `.git` is 117 MB. v1 said `cp -r textures/* public/textures/` — that **duplicates 118 MB on disk and in the repo**.

→ Use `git mv`, or better: point Vite's `publicDir` at the existing `textures/` location and don't move anything. Also note `js/renderer/textureAtlas.js` fetches with **relative** paths (`textures/blocks/manifest.json:213`, `textures/blocks/${base}.png:233,235,237,254,256,258`) which break if the base URL changes — needs a leading `/` or an `import.meta.env.BASE_URL` prefix.

### 1.9 `scripts/generate-manifest.js` eval-parses source with a regex.

```js
// scripts/generate-manifest.js:22
const BLOCK_REGISTRY = eval('(' + registrySource.match(/const BLOCK_REGISTRY = (\[.*?\]);/s)[1] + ')');
```

`export const BLOCK_REGISTRY = [...]` still matches. Any reformatting of that array does not. Add a smoke test for this script in PR 4.

---

## 2. Why Modules: The Global Scope Is Actively Broken

**This is the strongest argument for the refactor, and it's not theoretical.** All 64 `<script>` tags share one scope. I parsed `index.html`'s actual load order and enumerated top-level declarations: **355 unique symbols, 8 of them declared in more than one file.** Later scripts win.

### 2.1 Three are live production bugs

| Symbol | Loser | Winner (loads later) | Consequence |
|---|---|---|---|
| `getBossDefinition` | `js/entities/boss.js:317` (reads `BOSS_DEFINITIONS`) | `js/systems/damageSystem.js:130` (reads `BOSS_ATTACKS`) | `boss.js:362` — `new Boss()` calls the *wrong* function, gets `null`, and **throws `Unknown boss: ...`**. Boss spawning is broken in production. |
| `validateInventory` | `js/multiplayer/host.js:205` — `(playerId, inventory)` | `js/multiplayer/inventorySync.js:189` — `(slots, maxSlots)` | `host.js:934` passes a playerId **string** as `slots` → `Array.isArray` false → **every client→host inventory sync is rejected**. The error log then reads `valid.reason`, which is `undefined`. |
| `isMobileViewport` | `js/renderer/performanceOptimizer.js:54` — `(screenWidth)`, `< 768` | `js/multiplayer/playerListHUD.js:63` — `()`, `<= 600` | `performanceOptimizer.js:400` passes an argument that is silently ignored, and the mobile threshold is **600, not 768**. Mobile perf tuning is misapplied. |

Load order confirming the winners: `boss.js:556` < `damageSystem.js:563`; `host.js:572` < `inventorySync.js:575`; `performanceOptimizer.js:544` < `playerListHUD.js:576` (all `index.html` line numbers).

### 2.2 Five more are currently harmless but prove the pattern

`smoothstep` (`skybox.js` → `ambient.js`, identical impls) · `distanceBetween` (`boss.js` → `playerSync.js`, same math) · `fbm2` and `applySpline` (`noise.js` → `biomeSystem.js`, aliases) · `_log` (`client.js`, `host.js`, `game.js` — three-way).

### 2.3 Do this deliberately, in Phase 0, with tests

ES modules will **silently fix all eight**. If you don't fix them first, your "behavior is identical" verification becomes a lie: boss spawning starts working, host inventory sync starts working, and the mobile breakpoint shifts from 600 to 768. Fix them in PR 3 with regression tests so the change is attributable.

### 2.4 The mechanism is implicit globals, not `window.*`

v1 blamed `window.GlobalName` exports. There are only **4** such assignments in the whole codebase:

```
js/util/logger.js:39        window.CuubzLogger = CuubzLogger;
js/game.js:274              window.CuubzGame = Game;
js/game.js:275              window.CuubzBlockPalette = BlockPalette;
js/mobs/mobIntegration.js:125  window.MobIntegration = MobIntegration;
```

The real mechanism is **implicit top-level `const`/`let`/`class`/`function` in classic scripts**, which share one scope with no export marker at all.

`typeof X !== 'undefined'` totals **126** occurrences across 63 files — but **62 are `typeof module`** (the CommonJS test shim) and 15 are `typeof window`. Excluding host builtins, only **29** are genuine cross-module guards:

```
CuubzLogger ×4 · QUEST_REGISTRY ×2 · globalScope ×2 · sessionManager · mobIntegration
inventoryOpen · _INLINE_BLOCK_PROPERTIES · Skybox · PlayerSyncManager · PlayerListHUD
NAMED_ITEMS · MultiplayerClient · InventorySync · HostManager · FirstPersonHand · (+ ~10 more)
```

`main.js` has 16 of them. That's a bounded, tractable list — not "littered everywhere". Don't send the implementer hunting ghosts.

---

## 3. Measured Current State

### 3.1 Totals

| Metric | Value |
|---|---|
| JS files in `js/` (excl. `three.min.js`) | **64** |
| Total lines in `js/` (excl. `three.min.js`) | **33,912** |
| `<script>` tags in `index.html` | **64** (v1 said ~50) |
| `index.html` lines | 604 |
| Inline `style="` attributes in `index.html` | **24** |
| `css/style.css` | ~2,100 lines |
| Test files | **53** (v1 said 55) — 21 pass, 32 fail |
| `server/*.js` | ~1,110 lines, CommonJS, **not the problem** |
| Untracked mob subsystem | 18 files, 3,516 lines |
| `textures/` | 118 MB, 3,370 files (3,364 tracked) |

### 3.2 The 15 largest files (all of these need a destination in the target tree)

```
4919  js/main.js                       1048  js/systems/inventory.js
1664  js/chunkmanager.js               1048  js/multiplayer/client.js
1175  js/multiplayer/host.js           1031  js/renderer/skybox.js
1170  js/audio/ambient.js               846  js/multiplayer/playerSync.js
1160  js/systems/survival.js            843  js/renderer/pbrShader.js
1152  js/entities/boss.js               813  js/multiplayer/inventorySync.js
1064  js/world/workerGeneration.js      788  js/renderer/chunkMeshBuilder.js
                                        769  js/multiplayer/chunkStreamer.js
```

Then: `voxelRenderer.js` 667 · `damageSystem.js` 634 · `sfx.js` 621 · `questMarker.js` 613 · `interaction.js` 589 · `textureAtlas.js` 549 · `performanceOptimizer.js` 541 · `crafting.js` 527 · `mobDefinitions.js` 486. Full inventory in [Appendix A](#appendix-a--full-file-inventory).

> v1 never mentioned 52 of the 64 files, including 11 of the 15 largest. Its target tree had **no `src/audio/` directory at all** and no destination for `boss.js`, `performanceSettings.js`, `performanceOptimizer.js`, `meshWorker.js`, or `persistence.js`. The tree in [§4.1](#41-target-directory-structure) is complete.

### 3.3 Real symbol landmarks in `main.js`

**Use symbol names, never line numbers.** v1's entire §8.1 line table was wrong (e.g. it put `renderLoop` at 3950–4350 and `startGame` at 1850–2150). Actual, as of the current working tree:

| Symbol | Line |
|---|---|
| IIFE opens | 6 |
| `class BrowserCharacterManager` | **69** (v1: 60–200) |
| `class BrowserWorldManager` | **428** (v1: 420–610) |
| `function renderWorldSlots` | **606** (v1: 615–700) |
| `function initMenuNavigation` | 804 |
| `const REJOIN_STORAGE_KEY` | 1593 |
| `class SessionManager` | **1723** |
| `async function startGame` | **2156** (v1: 1850–2150) |
| `new CuubzGame()` | 2569 |
| `function renderLoop` | **3908** (v1: 3950–4350) |
| `function updateDebugStats` | 4394 |
| `function setupPauseMenu` | 4428 |
| `new BrowserCharacterManager(persistence)` | 4749 |

These will drift after the first edit. Grep for the symbol.

### 3.4 Duplicate managers — decide before touching them

| In `main.js` | Duplicates | Status |
|---|---|---|
| `BrowserCharacterManager` (L69) | `js/entities/characterManager.js` (392 lines) | Script-tagged, **has tests**, `require`s cleanly. `main.js` does **not** use it. |
| `BrowserWorldManager` (L428) | `js/entities/worldManager.js` (463 lines) | Script-tagged, **has tests**, currently **crashes on require**. `main.js` does **not** use it. |

v1's §4.1 said move `BrowserCharacterManager` → `src/game/entities/CharacterManager.js`, which **collides with the existing tested file**. PR 14 must make an explicit reconcile-or-delete decision and record it here.

Similarly, `js/game.js` (280 lines) is mostly a stub, touched only at `new CuubzGame()` (`main.js:2569`). State plainly: **`core/Game.js` is a rewrite, not a move.**

### 3.5 Protocol duplication — v1 was half wrong

`MESSAGE_TYPES` is defined in exactly two places: `js/multiplayer/client.js:40` and `server/session.js:30`. It is **referenced** in `js/multiplayer/host.js` — which never defines it, another silent load-order dependency. `matchmaking.js` and `server/index.js` have **zero** references (v1 claimed four-way duplication).

Un-noticed by v1: the **face/quad table is duplicated** — `var FACES = [...]` at `js/renderer/meshWorker.js:36` and an equivalent `sides` array at `js/renderer/chunkMeshBuilder.js:371`, in different formats. Worth its own task (PR 24).

### 3.6 Source-text tests conflict with Phase 5

Six tests `readFileSync` + regex over CSS/HTML/source rather than exercising behavior:

```
test_responsiveHUD  test_mobileViewports  test_pageLoad
test_textureAssets  test_textureGenerator test_chunkBinaryCodec
```

Slimming `index.html` and splitting CSS **invalidates all of them**. v1 scheduled that work (its Phase 4) *before* its test migration (Phase 5). → Resolved here: PR 26 rewrites or deletes them in the same PR that changes the HTML/CSS. No orphan window.

### 3.7 Root causes (corrected)

1. **No module system.** 64 script tags, one shared scope, 355 top-level symbols, 8 collisions, invisible dependency graph.
2. **`main.js` absorbed everything** — screens, character CRUD, world CRUD, sessions, game init, the whole render loop, inventory UI, crafting UI, hotbar, pause menu, perf settings, multiplayer wiring, mob attacks, biome effects, debug stats, audio toggles.
3. **`renderLoop` is a 184-variable closure** — extraction is blocked until state is hoisted.
4. **Inconsistent export style** — 4 `window.*`, 62 CommonJS shims, dual-mode IIFEs, bare classes.
5. **Ad-hoc state** — `game.frameCount`, `game.attackCooldown`, `game._shadowMissingCount`, `game._noPbrCount`.
6. **Fragile multiplayer wiring** — long inline `if (sessionManager && ...)` chains.
7. **No CI.** 34k lines, red suite, no automated gate on any push.

---

## 4. Architecture Target

### 4.1 Target Directory Structure

Complete — every one of the 64 files has a destination.

```
cuubz/
├── index.html                  # Vite entry, stays at root (~80 lines after PR 26)
├── textures/                   # STAYS PUT — Vite publicDir points here (118 MB, do not copy)
├── src/
│   ├── index.js                # Bootstrap (<50 lines)
│   ├── core/
│   │   ├── Game.js             # REWRITE (js/game.js is a stub) — owns loop, systems, state
│   │   ├── GameState.js        # Absorbs the ~184 hoisted renderLoop closure locals
│   │   └── EventBus.js
│   ├── engine/
│   │   ├── loop/{RenderLoop.js, SystemRunner.js}
│   │   ├── renderer/
│   │   │   ├── VoxelRenderer.js          ← js/renderer/voxelRenderer.js
│   │   │   ├── PBRShader.js              ← js/renderer/pbrShader.js (843, keep intact)
│   │   │   ├── SkyRenderer.js            ← js/renderer/skybox.js (1031, split cycle out)
│   │   │   ├── ChunkMeshBuilder.js       ← js/renderer/chunkMeshBuilder.js
│   │   │   ├── meshWorker.js             ← js/renderer/meshWorker.js  (?worker import)
│   │   │   ├── TextureAtlas.js           ← js/renderer/textureAtlas.js
│   │   │   ├── ItemTextureAtlas.js       ← js/renderer/itemTextureAtlas.js
│   │   │   ├── FirstPersonHand.js        ← js/renderer/firstPersonHand.js
│   │   │   ├── BiomeEffects.js           ← js/renderer/biomeEffects.js
│   │   │   ├── PerformanceOptimizer.js   ← js/renderer/performanceOptimizer.js
│   │   │   └── PerformanceSettings.js    ← js/renderer/performanceSettings.js
│   │   ├── world/
│   │   │   ├── ChunkManager.js      ← coordinator + public API   (~300)
│   │   │   ├── WorkerPool.js        ← extracted from chunkmanager (~80)
│   │   │   ├── ChunkStorage.js      ← IndexedDB + flushDirtyChunks (~200)
│   │   │   ├── ChunkCache.js        ← memoryCache Map (~100)
│   │   │   ├── RegionTracker.js     ← checkRegion/startRegionCheck (~150)
│   │   │   ├── workerGeneration.js  ← js/world/workerGeneration.js (?worker; resolve dual-mode)
│   │   │   ├── ChunkBinaryCodec.js  ← js/world/chunkBinaryCodec.js
│   │   │   ├── BiomeSystem.js       ← js/world/biomeSystem.js (drop fbm2/applySpline aliases)
│   │   │   ├── Noise.js             ← js/world/noise.js (canonical fbm2/applySpline)
│   │   │   ├── BlockRegistry.js     ← js/world/blockRegistry.js (keep manifest regex compatible)
│   │   │   ├── ChunkData.js         ← js/world/chunkData.js
│   │   │   ├── Persistence.js       ← js/world/persistence.js
│   │   │   └── SpawnManager.js      ← js/world/spawnManager.js
│   │   ├── audio/                              # ← MISSING ENTIRELY FROM v1
│   │   │   ├── AmbientAudio.js      ← js/audio/ambient.js (1170)
│   │   │   └── SFX.js               ← js/audio/sfx.js (621)
│   │   └── input/{InputManager.js, Keyboard.js, Mouse.js, Touch.js}
│   ├── game/
│   │   ├── data/
│   │   │   ├── ItemDefinitions.js   ← NAMED_ITEMS, ITEM_CATEGORIES, MAX_STACKS
│   │   │   ├── BossDefinitions.js   ← BOSS_DEFINITIONS from js/entities/boss.js
│   │   │   ├── BossAttacks.js       ← BOSS_ATTACKS from js/systems/damageSystem.js
│   │   │   └── FaceTable.js         ← single source for meshWorker + ChunkMeshBuilder
│   │   ├── entities/
│   │   │   ├── Player.js            ← js/entities/player.js
│   │   │   ├── Boss.js             ← js/entities/boss.js (1152)
│   │   │   ├── QuestMarker.js       ← js/entities/questMarker.js
│   │   │   ├── CharacterManager.js  ← RECONCILE: js/entities/characterManager.js vs main.js:69
│   │   │   └── WorldManager.js      ← RECONCILE: js/entities/worldManager.js vs main.js:428
│   │   ├── systems/
│   │   │   ├── System.js            # abstract base
│   │   │   ├── InventorySystem.js   ← js/systems/inventory.js (slots/stacking/serialize)
│   │   │   ├── EquipmentSystem.js   ← equipment half of inventory.js
│   │   │   ├── CraftingSystem.js    ← js/systems/crafting.js
│   │   │   ├── SurvivalSystem.js    ← js/systems/survival.js (1160)
│   │   │   ├── DamageSystem.js      ← js/systems/damageSystem.js
│   │   │   ├── QuestSystem.js       ← js/systems/quests.js
│   │   │   ├── DroppedItemsSystem.js ← js/systems/droppedItems.js
│   │   │   ├── BlockInteractionSystem.js ← js/input/interaction.js (589)
│   │   │   ├── MobSystem.js         ← wraps js/mobs/mobIntegration.js
│   │   │   └── TimeOfDaySystem.js   ← day/night cycle extracted from skybox.js
│   │   └── mobs/                    ← js/mobs/* (18 files, structure unchanged)
│   ├── multiplayer/
│   │   ├── SessionManager.js  ← main.js:1723 (inline class) + rejoin panel + conn status
│   │   ├── Client.js          ← js/multiplayer/client.js
│   │   ├── Host.js            ← js/multiplayer/host.js (import MESSAGE_TYPES explicitly!)
│   │   ├── PlayerSync.js      ← js/multiplayer/playerSync.js
│   │   ├── ChunkStreamer.js   ← js/multiplayer/chunkStreamer.js
│   │   ├── InventorySync.js   ← js/multiplayer/inventorySync.js
│   │   └── PlayerListHUD.js   ← js/multiplayer/playerListHUD.js
│   ├── ui/
│   │   ├── UIManager.js       # screen routing + modal management
│   │   ├── screens/{MainMenu,Character,World,Mode,Lobby,Settings,Loading}Screen.js
│   │   ├── hud/{HUD,Hotbar,SurvivalMeters,Crosshair,QuestTracker,FlyModeIndicator,ConnectionHUD,DebugStats}.js
│   │   ├── overlays/{InventoryScreen,CraftingScreen,PauseMenu,EquipmentPanel}.js
│   │   ├── components/{Button,Modal,Slider}.js
│   │   └── css/               # split from css/style.css (see §10.2)
│   └── util/
│       ├── Logger.js          ← js/util/logger.js
│       ├── MathUtils.js       ← canonical smoothstep, distanceBetween
│       ├── HTMLUtils.js       ← escapeHtml
│       └── StorageHelper.js   ← 'cuubz_last_session' / 'cuubz:settings' access
├── shared/
│   └── protocol.js            # MESSAGE_TYPES — single source for src/ AND server/
├── server/                    # UNCHANGED (CommonJS, already clean)
├── test/{helpers,unit,integration}/
├── scripts/generate-manifest.js   # keep regex-compatible with BLOCK_REGISTRY
├── .github/workflows/ci.yml
├── vite.config.js
├── eslint.config.js           # FLAT config — ESLint 9+ (NOT .eslintrc.cjs)
├── .prettierrc
├── sync.sh                    # REWRITTEN: build, then ship dist/ (+ rollback — DEPLOY.md §6.4)
├── cuubz-relay.service        # verify WorkingDirectory after layout change
└── DEPLOY.md                  # deploy + rollback + data invariants (PR 6) — update in PR 10
```

### 4.2 Key Patterns

**EventBus (pub/sub)** — replaces direct cross-module calls and inline `if (sessionManager && ...)` chains:

```js
EventBus.emit('block:broken', { x, y, z, blockType });
EventBus.on('block:broken', ({ x, y, z }) => chunkManager.applyBlockChange(x, y, z, 0));
EventBus.on('block:broken', ({ x, y, z }) => multiplayerClient.sendBlockBreak(x, y, z));
```

**System interface** — every system is uniform, so `SystemRunner` needs no special cases:

```js
export class System {
  static priority = 100;   // lower runs earlier
  init(game) { this.game = game; }
  update(dt) {}
  dispose() {}
}
```

**GameState** — single source of truth, and the landing zone for the hoisted closure locals:

```js
export class GameState {
  mode = 'survival';        // 'survival' | 'creative'
  isRunning = false;
  isPaused = false;
  frameCount = 0;
  player = null;
  currentWorld = null;
  currentCharacter = null;
  systems = new Map();
  stats = { fps: 0, activeChunks: 0, dirtyCount: 0 };
}
```

**Vite** — `index.html` → `<script type="module" src="/src/index.js">`; no script ordering, no `window.*`, no `typeof X !== 'undefined'`; HMR in dev; hashed bundle in `dist/`.

---

## 5. Phase 0 — Stop The Bleeding (PR 1–6, plus 6b and 6c)

> **Nothing else in this document is safe until Phase 0 lands.** v1 had no equivalent phase.

### PR 1 — Commit everything, tag a rollback point ✅ DONE
- `git add js/mobs/ MOB_PLAN.md refactor.md textures/items/*.png` and the 16 modified tracked files.
- Commit with a message naming the mob subsystem as work-in-progress.
- `git tag pre-refactor-baseline` and push the tag.
- **Decide and record here:** finish mobs, or explicitly park them (freeze `js/mobs/` and `MOB_PLAN.md`) until Phase 4. Refactoring on top of 253 unchecked plan items is a moving target.
- **Accept:** `git status` clean. Tag exists on the remote.
- **Rollback:** n/a (this *is* the rollback point).

**Outcome (2026-07-29):**
- Working tree was already clean; `js/mobs/` (18 files) and `MOB_PLAN.md` are tracked as of commit `27959d3`.
- Tag `pre-refactor-baseline` created locally at `27959d3`. **Push it manually** — the automation environment has no git credentials: `git push origin pre-refactor-baseline`.
- **Decision: mobs are PARKED.** `js/mobs/` and `MOB_PLAN.md` are frozen — no new mob features until PR 25. The 253 unchecked `MOB_PLAN.md` items are explicitly out of scope for Phases 0–4. Mob files still get migrated mechanically in PR 9 (`js/mobs/` → `src/game/mobs/`) but their *behavior* does not change. Rationale: a half-built subsystem that is still growing cannot serve as a parity baseline.

### PR 2 — Fix the 3 crash-on-require exports ✅ DONE
- `js/systems/crafting.js` — `BLOCK_TYPES is not defined`
- `js/systems/damageSystem.js` — `DAMAGE_SOURCES is not defined`
- `js/entities/worldManager.js:462` — `MIN_NAME_LENGTH is not defined`
- Minimal fix: guard the `module.exports` object, or (better) define the constants locally in the file that exports them.
- **Accept:** `node -e "require('./js/systems/crafting.js')"` and the other two exit 0. Browser still loads and plays.
- **Rollback:** revert commit; 3 files only.

**Outcome (2026-07-29):**
- Used the **existing in-repo shim pattern** from `js/world/biomeSystem.js:7-9` rather than defining the constants locally. Defining them locally would have created *new* duplicate top-level symbols (`BLOCK_TYPES`, `DAMAGE_SOURCES`, `MIN_NAME_LENGTH` are all already declared elsewhere) — i.e. it would have manufactured exactly the collision class PR 3 exists to eliminate. The shim is a no-op in the browser (`typeof module !== 'undefined'` is false there), so browser behavior is unchanged byte-for-byte.
  - `crafting.js` → `require('../world/blockRegistry').BLOCK_TYPES`
  - `damageSystem.js` → `require('./survival').DAMAGE_SOURCES`
  - `worldManager.js` → `require('./characterManager')` for `MIN_NAME_LENGTH` / `MAX_NAME_LENGTH`
- `characterManager.js` had to **add `MIN_NAME_LENGTH` / `MAX_NAME_LENGTH` to its `module.exports`** — it declared them but never exported them.
- Verified: all four files `require` with exit 0. No circular requires introduced.
- **Suite went 17/53 → 22/53.**

### PR 3 — Fix the 8 global collisions, with regression tests
For each, rename or consolidate, and **add a test that would have caught the bug**:

| Fix | Test to add |
|---|---|
| `getBossDefinition` → `getBossDefinition` (boss) / `getBossAttackProfile` (damageSystem) | `new Boss('<validId>')` constructs without throwing |
| `validateInventory` → `validateHostInventory` (host) / `validateInventorySlots` (inventorySync) | host accepts a well-formed client inventory sync; rejects a malformed one with a defined `.reason` |
| `isMobileViewport` → single canonical impl in `util/MathUtils.js` or a `viewport.js`; **pick one threshold and document it** | breakpoint assertion at 599/600/601/767/768/769 |
| `smoothstep` → one impl (`util/MathUtils.js`) | — |
| `distanceBetween` → one impl (`util/MathUtils.js`) | — |
| `fbm2`, `applySpline` → keep in `noise.js`, delete the `biomeSystem.js` aliases | existing noise tests must still pass |
| `_log` ×3 → per-module prefixed loggers via `util/Logger.js` | — |

- **Note in the changelog that behavior intentionally changes here:** boss spawning starts working, host inventory sync starts working, and the mobile breakpoint moves. Doing this in Phase 0 keeps Phase 1's "no behavior change" claim honest.
- **Accept:** the 3 new regression tests pass; no remaining duplicate top-level symbols (see the collision-detector script in PR 5).
- **Rollback:** revert commit.

**Outcome (2026-07-29):** ✅ DONE — `scripts/check-globals.js` now reports **0 duplicates** across 65 script-tagged files / 367 top-level symbols. `test/test_globalCollisions.js` added: **93 assertions, all passing.**

| Collision | Resolution |
|---|---|
| `getBossDefinition` | `damageSystem.js`'s copy renamed → **`getBossAttackProfile`**. `boss.js` keeps `getBossDefinition`. Test asserts the two key namespaces are disjoint, each lookup resolves only its own table, **and that `new Boss(id)` constructs for all 5 boss ids** (it previously always threw). |
| `validateInventory` | `host.js` → **`validateHostInventory`**; `inventorySync.js` → **`validateInventorySlots`**. Test asserts the host accepts a well-formed sync and that every rejection carries a **defined** `.reason` string (host.js:934 logs it). |
| `isMobileViewport` | New **`js/util/viewport.js`** — one impl, two named breakpoints. Boundary assertions at 599/600/601/767/768/769. |
| `smoothstep` | Moved to new **`js/util/mathUtils.js`**; `skybox.js` + `ambient.js` re-export it. |
| `distanceBetween` | Moved to **`js/util/mathUtils.js`**; `boss.js` + `playerSync.js` re-export it. |
| `fbm2`, `applySpline` | `biomeSystem.js`'s aliases deleted; its call sites now use its own private `_fbm2` / `_applySpline`. |
| `_log` ×3 | → `_clientLog` / `_hostLog` / `_gameLog`. |

**Two things the plan did not anticipate:**

1. **A fourth `_log` consumer.** `js/input/interaction.js` called a bare `_log(...)` at two sites (block break, block place) **without ever declaring it** — it was silently borrowing whichever of the three colliding globals loaded last. Renaming the three would have made breaking or placing a block throw `ReferenceError` in production. It now declares its own `_interactionLog`. *This is a bug the plan's own §2.1 audit missed, because a file that only consumes a colliding global is invisible to a duplicate-declaration scan.*

2. **Deviation on `isMobileViewport`.** The plan said "pick one threshold and document it". Not followed, deliberately. The two thresholds are not accidental duplication — 768px answers "is this device weak enough to need reduced draw distance?" and 600px answers "is this screen narrow enough to collapse the player list?". Collapsing them to one number would silently change either perf tuning or HUD layout with no gameplay justification. `js/util/viewport.js` therefore provides **one implementation with two named, documented breakpoints** (`MOBILE_MAX_WIDTH_PERF = 767`, `MOBILE_MAX_WIDTH_HUD = 600`, compared with `<=`, exactly reproducing the old `< 768` and `<= 600`). The collision is gone; both behaviors are preserved. Rationale is written into the file header.

**Behavior that intentionally changed in the browser** (all previously broken):
- Boss spawning now works — `new Boss(...)` no longer throws `Unknown boss: ...`.
- Client→host inventory sync is now actually validated instead of always rejected, and the warning log no longer reads `undefined`.
- Mobile **performance** tuning now applies below 768px as intended, not 600px. The player-list HUD still collapses at 600px, unchanged.

**New files:** `js/util/mathUtils.js`, `js/util/viewport.js` (both script-tagged in `index.html` immediately after `logger.js`, before every consumer), `scripts/check-globals.js`, `test/test_globalCollisions.js`.

**Regression check:** suite went 22/53 → 23/54. The 31 pre-existing failures are unchanged — no test that passed before PR 3 fails after it.

### PR 4 — Get the suite green, or quarantine explicitly ✅ DONE

- `npm i -D jsdom` (fixes `test_pageLoad`).
- Fix the real assertion failures. Start with `test_skybox` (fog density 0.008 vs 0.001 — **decide which is correct** and fix the code or the test, not whichever is easier) and `test_responsiveHUD` (26 failures).
- For anything that can't be fixed now, add `test/QUARANTINE.md` listing the file, the failure, why it's deferred, and the PR that will fix it. The runner must **skip quarantined files and exit 0**.
- Fix `package.json`: `"test": "bash test/run_tests.sh"`.
- Add a smoke test for `scripts/generate-manifest.js` (guards the eval-regex).
- **Accept:** `npm test` exits 0. Quarantine list is ≤5 files and every entry has an owner PR.
- **Rollback:** revert; Phase 1 is blocked until this lands.

**Outcome (2026-07-29):**

**Suite went 17/53 → 50/50 passing, 4 quarantined. `npm test` exits 0.** `scripts/check-globals.js` still reports 0 duplicates across 65 script-tagged files.

**Six genuine code bugs found and fixed.** Per the "the code is right, the test is stale" ruling, most failures were stale assertions — but that ruling only covered the value mismatches verified against git history. Everything else was investigated, and these turned out to be real:

1. **Block drops were resolved from a stale ID table** (`js/systems/inventory.js`, `js/input/interaction.js`). `_getBlockProperties` read `window.BLOCK_PROPERTIES`, but `blockRegistry.js` declares `BLOCK_PROPERTIES` as a top-level `const` in a classic script — a lexical global that is **never** a property of `window`. So the lookup was always `undefined` in the browser and silently fell through to `_INLINE_BLOCK_PROPERTIES`, a hand-maintained table keyed by **pre-renumbering** IDs. Player-visible effect: breaking andesite dropped cobblestone, breaking deepslate dropped coal. Fixed by moving drop resolution into `blockRegistry.getBlockDrop()`, keyed by block **name**, and deleting the stale table. Verified all 192 blocks resolve to a valid drop.

2. **Duplicate block ID in the registry** — `yellow_poplar_leaves` and `white_concrete` both claimed id `115`, so the leaves block was silently shadowed (`BLOCK_BY_ID` is built by iteration; the later entry wins). `BLOCK_TYPES.YELLOW_POPLAR_LEAVES === BLOCK_TYPES.WHITE_CONCRETE`. Moved the leaves to id `192` (the first free id) rather than shifting the 32 concrete/wool blocks, which would have reinterpreted every saved chunk. Caught by the new manifest smoke test, not by a pre-existing test.

3. **Creative palette used hard-coded pre-renumbering IDs** (`js/game.js`). `selectedBlock = 3` with a comment reading "Stone (ID=3)" — stone is now `2`, so creative mode silently defaulted to cobblestone. The `_getPlaceableBlocks` exclude set was likewise a literal id list, so it excluded granite/deepslate/ores while **admitting** water, lava, toxic slime and the quest items into the palette. Both now resolve by name. Same stale `3` default fixed in `interaction.js`.

4. **The require shims were order-dependent** (`chunkData.js`, `inventory.js`, `interaction.js`). Each guarded its whole block on `typeof BLOCK_TYPES === 'undefined'` while providing a *different* subset of symbols. Whichever module loaded first satisfied the guard for the rest, so e.g. requiring `interaction.js` before `chunkData.js` left `BLOCK_BY_ID` undefined and crashed on require. Each symbol is now guarded individually.

5. **`isMatchmakingConnected` / `isGameSessionConnected` returned `null`, not `false`** (`js/multiplayer/client.js`) when no connection object existed — contradicting the `is*` naming, and breaking strict comparison and JSON serialization. Coerced with `!!`. Every caller uses them for truthiness, so behaviour is unchanged.

6. **`test_websocketErrorHandling` would have hung the suite.** It only called `process.exit` on *failure*; passing fell off the end of the file with mock reconnect/heartbeat timers still pending, so Node never exited. Invisible while the file was red — it would have deadlocked `npm test` the moment it went green. Now exits explicitly in both directions.

(The `sfx` seeding bug fixed earlier in this PR makes seven in total.)

**Two handoff diagnoses were wrong, in the safe direction:**
- `test_creativeMode` was the **reverse** of the §3a table — the test correctly used `BLOCK_TYPES.STONE`; the *code* was stale. Fixed the code (bug 3 above).
- `test_questMarker` / `test_questIntegration` were **not** "inverted expectations". That harness's `assertEquals(actual, expected)` takes the literal in the *actual* slot, so "expected 0, got 25" actually meant `createAllMarkers()` returned **0**. Root cause: `questMarker.js` was missing a `QUEST_REGISTRY` require shim, so it silently produced no markers under Node. Browser was unaffected.

**Rewritten rather than patched** (the old APIs no longer exist; assertions were rewritten against the real surface, not invented to match):
- `test_biomeEffects` — targeted a `ParticleEffect` class plus `LAVA_ANIMATION` / `TOXIC_SLIME_ANIMATION` / `CORRUPT_FOG` and UV-offset state. `biomeEffects.js` exports only `{ BiomeEffects }` and none of those exist even as module-locals. Now covers biome fog/sky config, day/night blending, the particle pool, distance culling, the 200-particle cap and disposal. 136 assertions.
- `test_blockInteraction` — the Crosshair half still passes and was kept; the BlockInteraction half targeted `breakTarget`/`breakDuration`/`onBlockBreak`. Rewritten against `breakingBlock`/`breakProgress`/`_startBreak`/`_continueBreak`/`_completeBreak`, including tool efficiency, creative-mode placement and the mob-attack override. 137 assertions.
- `test_crafting` — the grid-based half (`craftingGrid`, `findMatchingRecipe`, `craft()`) is gone; crafting is inventory-driven via `getCraftableRecipes(inventory)` / `craftRecipe(id, inventory)`. 498 assertions.
- `test_noise` — asserted `NoiseGenerator.perm.length === 512`, now private to `createPerlin`. Replaced with the observable property that table exists for: the field is periodic with period 256 per axis.

**Harness bugs fixed** (not product bugs): `test_sessionDiscovery` built its own relay and dropped `sessionName`/`worldSeed`/`mode` when constructing `SessionManager`, so every name assertion failed against an `'Untitled'` fallback — the production path was intact throughout. `test_hostLogic` constructed a player and instantly moved it 2.2 blocks; with `dt` floored at 16ms that reads as ~140 blocks/s and the speed anti-cheat correctly rejected it — the test now backdates `lastMoveTime`.

**Deleted:** `test_textureGenerator.js` (asserted `scripts/generate_textures.py`, which no longer exists).

**New files:** `test/QUARANTINE.md`, `test/test_manifestGenerator.js`.

**Quarantined — 4 files, all owned by PR 26:** `test_pageLoad`, `test_responsiveHUD`, `test_mobileViewports`, `test_textureAssets`. All four `readFileSync` + regex over `index.html` / `css/style.css` rather than exercising behaviour; §3.6 has PR 26 rewriting them in the same PR that changes the markup, so fixing them now guarantees rework. `run_tests.sh` parses the **first column of the table** in `QUARANTINE.md` (matching any `test_*.js` anywhere in that file wrongly skipped three passing tests that the prose merely mentions) and reports them as `⏭️ SKIP` so they stay visible.

**The manifest smoke test** runs `scripts/generate-manifest.js` and cross-checks the entry count against a real `require()` of the block registry — that is the load-bearing assertion, because the script *scrapes* the registry with `eval('(' + match(/const BLOCK_REGISTRY = (\[.*?\]);/s)[1] + ')')`. A truncated parse still writes syntactically valid JSON, just missing most blocks. It snapshots and restores `textures/blocks/manifest.json` so the suite never dirties the tree. This test found bug 2 on its first run.

**Left alone deliberately:** `SurvivalSystem`'s default spawn is `{x:0, y:20, z:0}` while `SpawnManager` uses `SEA_LEVEL + 4` (68) — y=20 is 44 blocks underground. `SurvivalSystem.onDeath`/`onRespawn` are not wired to anything in production, so this is latent, not live. Changing a gameplay value is out of scope for a test-gate PR; flagged for a decision.

### PR 5 — Add CI
`.github/workflows/ci.yml`, on every push and PR:
```
node 22 · npm ci · npm test · npm run lint · npm run build (once Phase 1 lands)
```
Also add `scripts/check-globals.js` — parse the `<script src>` list from `index.html`, collect top-level `const|let|var|function|class` declarations, **fail on any duplicate**. This is what caught the 8 collisions; make it permanent so they can't come back during migration.

- **Accept:** CI green on a PR. `check-globals.js` fails when a duplicate is deliberately introduced.
- **Rollback:** delete the workflow.

**Outcome (2026-07-29):** ✅ DONE (one half of the accept criterion is pending a push — see *Not yet proven* below).

`.github/workflows/ci.yml` — one job, `ubuntu-latest`, on `push` and `pull_request`: `actions/checkout@v4` → `actions/setup-node@v4` (node 22, npm cache) → `npm ci` → `npm test` → `npm run check-globals`. `scripts/check-globals.js` already existed (PR 3); PR 5 only makes it a standing gate.

**`npm run lint` and `npm run build` are deliberately NOT steps.** Neither script exists in `package.json`. `npm run <missing-script>` exits 1, so adding them now makes CI red on its first run; adding them with `|| true` makes a gate that reports success without checking anything, which is worse than not having it. They are recorded as comments in the workflow naming the PR that adds each — **`npm run build` → PR 7** (Vite skeleton), **`npm run lint` → PR 11** (ESLint 9 flat config + Prettier). Each of those PRs adds its step in the same commit that adds its script.

**Four things the workflow does that the plan text did not ask for**, each because leaving it out has a concrete cost:
- **`timeout-minutes: 10`.** The suite runs in ~18 s but stands up real WebSocket servers and has no per-test timeout of its own. PR 4 bug 6 was a test that hung after passing; without this, the next one burns the 6-hour default.
- **`concurrency` + `cancel-in-progress`.** A newer push to the same ref supersedes the run in flight.
- **Full checkout — do not sparse-checkout `textures/` to save the 118 MB.** `test_manifestGenerator` runs `scripts/generate-manifest.js`, which `readdirSync()`s `textures/blocks/` (897 diffuse PNGs). That is the test that found PR 4's duplicate block id.
- **Explicit `shell: bash`** on both script steps. It is already the `ubuntu-latest` default; stating it keeps the requirement visible if the runner image ever changes.

**Verified without pushing.** The workflow has to be executed by GitHub, but everything inside it was reproduced locally: a fresh `git clone --depth 1` of `HEAD` into a scratch directory, then `npm ci` → `npm test` → `npm run check-globals` under **Node 22.22.0** (local dev is Node 24.18.0). Result: `npm ci` clean, **50/50 passing / 4 quarantined / exit 0**, **0 duplicates across 65 script-tagged files / 368 top-level symbols**, and `git status` clean afterwards — the manifest smoke test restores its snapshot correctly.

**Node 22 satisfies `jsdom`'s floor, but only just.** `jsdom@30.0.1` declares `engines: node ^22.22.2 || ^24.15.0 || >=26.0.0`. `node-version: '22'` resolves to the latest 22.x (22.23.2), which satisfies it; **pinning an exact older 22.x patch would emit `EBADENGINE`** (22.22.0 does). Noted in the workflow. `jsdom` is required only by `test_pageLoad`, which is quarantined, so it is not actually exercised in CI until PR 26 unquarantines it.

**Portability audit — the runner is a bash script, and the concern was that it only works in Windows Git Bash.** It does not; the toolchain is the same one, not merely a compatible one:
- **Line endings.** `core.autocrlf=true` normalizes on commit, and **zero tracked text blobs in `HEAD` contain a CR byte** (checked every tracked file, not just the shell scripts). A Linux checkout gets LF, so `bad interpreter: /bin/bash^M` cannot happen. There is no `.gitattributes`, and none is needed for this.
- **`grep -E` / `sed -E` / `sort -u` / `echo -e` / `local`.** Git Bash ships GNU coreutils and bash 5, exactly as `ubuntu-latest` does — `sed -E` is GNU `sed` in both. No BSD `sed` is in the picture on either side. `package.json` invokes `bash test/run_tests.sh` explicitly, so the `100755` mode bit is not load-bearing either.
- **Case sensitivity** (the risk that only shows up off NTFS), four sweeps, **0 mismatches**: the 65 `<script src>` and `<link href>` paths in `index.html`; **105 relative `require()` calls across 125 JS files**; 49 path-shaped string literals in `test/` + `scripts/`; and the texture pipeline — 92 named item textures in `itemTextureAtlas.js`, plus all 192 registry block textures, which the generator itself resolves through a case-sensitive `Set` lookup rather than `existsSync`, so it reports `✓ All registry textures found` identically on both platforms. Also **0 case-only duplicate paths** in the index (two such files can coexist on ext4 but not NTFS).
- **No platform coupling anywhere in Node-executed code**: no `process.platform` / `win32` branch, no `os.tmpdir` / `homedir` / `EOL`, no `toLocaleString` / `getTimezoneOffset` / `Intl` (CI runs UTC), no `os.cpus` / `availableParallelism` — the only concurrency probe is `navigator.hardwareConcurrency` in `chunkmanager.js`, which is browser-only.
- **`readdir` ordering.** ext4 returns directory entries in arbitrary order; NTFS does not. `generate-manifest.js` iterates `BLOCK_REGISTRY`, not `readdirSync`, so manifest order is registry-determined, and the smoke test asserts counts and shapes rather than bytes. Order cannot change the outcome.

**Both halves of the `check-globals` acceptance proof, run as the exact CI step** (`npm run check-globals`), then reverted:

| Injected collision | Result |
|---|---|
| `const SEA_LEVEL = 64;` appended to `js/util/mathUtils.js` (already owned by `chunkData.js:29`) | **exit 1** — `SEA_LEVEL: const at js/util/mathUtils.js:74 ← shadowed / const at js/world/chunkData.js:29 ← WINS (loads last)` |
| `function distanceBetween(a, b)` appended to `js/world/chunkData.js` (already owned by `mathUtils.js:38`) | **exit 1** — same report, correct load-order attribution |

The second shape matters because all three PR 3 collisions (`getBossDefinition`, `validateInventory`, `_log`) were **functions**, not `const`s. Both reverted with `git checkout --`; `git diff HEAD` empty and the gate back to exit 0.

**No code bugs found in this PR, and that is the finding.** For a CI PR the bug surface is portability — code that works on the author's machine and breaks on the runner — and the audit above came up empty across all six categories. Contrast PR 4, which found seven. Nothing was weakened to get here: no test was touched, `QUARANTINE.md` still holds 4 files against its cap of 5, and all four are still owned by PR 26.

**Flagged, not fixed** (both are out of scope for a CI PR, and neither fails silently):
- **The four relay tests call `http.listen()` on a fixed port with no `'error'` handler** — `test_serverIntegration` 18765, `test_multiplayerSync` 18770, `test_maxPlayerAndDisconnect` 18780, `test_sessionDiscovery` 18790. All four are free on a fresh runner and the tests run sequentially in separate processes, so this is fine in practice; but if one is ever occupied, the test dies on an unhandled `EADDRINUSE` and CI goes red with a misleading message instead of a clear one. Worth an `on('error')` for whoever next touches those files.
- **`on: push` with no branch filter plus `on: pull_request` double-runs a same-repo PR branch.** Kept literal to the plan ("on every push and PR"); `push: branches: [main]` is the one-line fix if the duplicate runs become annoying.

**Both halves of the accept criterion are now proven.** `actionlint 1.7.7` validated the workflow clean before it ever ran (schema, expression syntax, and `shellcheck` over the `run:` blocks). PR 1–5 were then pushed as branch **`refactor/phase-0`**, and the `push` trigger produced a **green run in 22 s** — [run 30494532166](https://github.com/Squall009/webgame-cuubz/actions/runs/30494532166). The portability audit held on the real runner:

```
Results: 50/50 passed, 0 failed, 4 skipped
⏭️  SKIP — test_mobileViewports / test_pageLoad / test_responsiveHUD / test_textureAssets
Scanned 65 script-tagged files from index.html
Found 368 unique top-level symbols
shell: /usr/bin/bash --noprofile --norc -e -o pipefail {0}
```

The four skips are the load-bearing detail: `run_tests.sh`'s `grep -E` + `sed -E` pass over the first column of the `QUARANTINE.md` table selected exactly the right four files under GNU sed on `ubuntu-latest`, which was the specific doubt about running a bash test runner authored in Windows Git Bash. `npm ci` installed 40 packages in 2 s with no `EBADENGINE`, confirming `node-version: '22'` resolved above `jsdom`'s 22.22.2 floor.

**The first real run found one defect in the workflow itself: `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime.** The runner forces them onto Node 24 and emits a warning annotation on every run; the shim is scheduled to go away, at which point this becomes a hard failure. Both are now pinned to the current latest major — **`checkout@v7`, `setup-node@v7`**. Every documented breaking change across v5/v6/v7 was checked against this workflow's actual usage and none applies: setup-node v5's automatic caching keys off a `packageManager` field that `package.json` does not have (and `cache: npm` is the explicit form), v6 only narrowed that same auto-detection, and checkout v7's fork-PR block only affects `pull_request_target` / `workflow_run`, neither of which is used. v5+ requires runner ≥ v2.327.1, which is noted in the workflow for the self-hosted case. Re-verified green after the bump.

**Still not pushed:** `main` itself (still at the PR 1 baseline `27959d3` on the remote — the six commits live only on `refactor/phase-0`) and the `pre-refactor-baseline` tag, which remains local. The **Phase 0 gate checkbox "CI runs on push" is satisfied in substance**; the gate list is left untouched because four of its seven items are still open and mixed ticking would obscure which.

### PR 6 — Write down the invariants ✅ DONE (one accept criterion deliberately unmet — see below)
Add to this file (or `DEPLOY.md`):
- The [§1.5](#15-player-data-must-survive-byte-for-byte) data-compatibility table, marked **do not change**.
- The full deployment plan: build → what gets tarred → what `sync.sh` excludes → how `cuubz-relay.service` is restarted → how to roll back a bad deploy.
- The manual save/load checklist run at every checkpoint.
- **Accept:** a fresh implementer can deploy and roll back from the doc alone.

**Outcome (2026-07-29):**

**Decision: standalone [`DEPLOY.md`](./DEPLOY.md), with §1.4 and §1.5 pointing at it.** The plan offered "this file (or `DEPLOY.md`)". Three reasons for the split, in order of weight:

1. **The accept criterion says "from the doc alone."** A deploy runbook nested inside an 84 KB refactor plan is not a standalone document — reaching it requires knowing that a *refactoring* plan contains *operational* instructions. `DEPLOY.md` sits beside `README.md` where a fresh implementer looks.
2. **The lifetimes differ.** `refactor.md` is transitional and gets archived when Phase 6 completes. The deploy path, the data invariants and the save/load checklist are permanent operational facts that outlive the refactor entirely. Putting them in a document scheduled for deletion is the wrong container.
3. **It is needed under pressure.** §6 is read during a broken deploy. 84 KB of migration planning between the reader and the rollback procedure is a real cost at exactly the wrong moment.

`DEPLOY.md` is 9 sections: short version → data invariants → topology → what `sync.sh` actually does → restarting the relay → rollback → save/load checklist → defect table with owners → verification status.

**The §1.5 table was incomplete. Six additions, two of them serious.** `DEPLOY.md` §2 supersedes it (§1.5 now says so). The four original rows are correct; found by reading every `localStorage` / `indexedDB` call site in `js/`:

| Added | Where | Why it matters |
|---|---|---|
| **`'cuubz:characters'`** | `js/world/persistence.js:20` | **every character the player has ever created.** Was entirely absent from §1.5 — the single most valuable key in the game. |
| `'cuubz:slotMap'`, `'cuubz:worldSlot:{N}:conf'` | `persistence.js:24,28` | world↔slot mapping and per-slot config; `MAX_WORLD_SLOTS = 3` is part of the key space |
| Object stores + key paths | `chunkmanager.js:23-24,273-275` | `chunks` (`keyPath: 'chunkKey'`), `manifests` (`keyPath: 'worldName'`), plus the non-unique `worldName` index |
| Chunk key format | `chunkmanager.js:455` | `` `${cx},${cz}` `` — see H-1 below |
| Chunk binary format | `chunkBinaryCodec.js:28-46` | magic `0x43555542` `"CUUB"`, version `3`, `LEGACY_LAYOUT_MAX = 2`, 20-byte header, height `256`, FNV-1a basis `0x811c9dc5` / prime `0x01000193`. Decode **throws** above version 3. |
| Block IDs are baked into saved chunks | `blockRegistry.js` | the format stores numeric IDs, not names. Renumbering reinterprets every chunk ever saved — PR 4 bug 2 already navigated this. |

**Two storage hazards found, both pre-existing, neither fixed here:**

- **H-1 — chunk keys are not world-scoped, so the three world slots overwrite each other's terrain. This is a live data-corruption bug.** `chunkKey` is only `` `${cx},${cz}` ``, and *no read path* filters on `worldName` — `loadChunk` (`chunkmanager.js:322-330`), `hasChunk` (`:332-340`) and `_batchLoadChunks` (`:857-880`) all do a bare `store.get(key)`. Writes set the `worldName` field and index it; nothing ever reads either. So chunk `(0,0)` is one shared record across all worlds: play world A at spawn, then world B at spawn, and B's chunk overwrites A's. Manifests *are* per-world, so world A's manifest still claims the chunk is generated — which is precisely what makes the stale record load instead of regenerating. `js/main.js:551` even contains the comment *"chunks remain orphaned but harmless — they're keyed by chunk coordinates"*: right premise, wrong conclusion. **Not fixed, deliberately** — the fix changes the primary key format, which is itself an invariant, so every already-saved chunk is orphaned without a migration. That is a data-migration PR with its own test plan, not a line in a docs PR. Currently **unowned**; needs a decision.
- **H-2 — bumping `DB_VERSION` destroys every player's worlds.** `onupgradeneeded` (`chunkmanager.js:264-276`) enumerates every existing object store, `deleteObjectStore`s all of them, then recreates them empty. Its comment describes this as "handles schema changes cleanly". §1.5 listed `version: 2` as a value to preserve without saying that incrementing that one character is unrecoverable total data loss. Now stated as a blocking warning.

(H-3, minor: `js/main.js:545` opens the DB with **no version argument** — creates a store-less v1 DB if none exists, then throws `NotFoundError` into a silent `catch {}`. Self-heals on the next `ChunkManager` open. Documented, not fixed.)

**The deployment reality is worse than §1.4 describes. Thirteen defects; §1.4 named one.** Full table with owners in `DEPLOY.md` §8. The ones that change how Phase 1 must be sequenced:

- **`sync.sh` never restarts the relay.** There is no `systemctl` / `service` / `pm2` call anywhere in the repo — the only such text is prose in `multiplayer.md:376`. So `server/` changes are deployed and **silently inert** until a human restarts by hand; the script prints `Sync complete!` either way. §1.4 does not mention this, and it is the most likely way to lose an afternoon.
- **`tar xzf` never deletes.** Files removed from the repo persist on the server forever. This is invisible today and concrete at PR 9: the stale `js/` tree stays live beside the new `src/`, `index.html` is overwritten to point at `src/`, and the host serves two full copies of the codebase — one dead, both fetchable, indistinguishable in a browser network tab. **PR 10's rewrite must handle deletion, not just the build.**
- **`node_modules` is excluded and nothing runs `npm ci` on the remote**, yet `server/index.js:14` and `server/matchmaking.js:21` both `require('ws')`. Production's `node_modules` was installed by hand at some point. Consequence: **dependency changes never reach production** — bump `ws` and the relay throws `Cannot find module` on its next restart.
- **The `chmod` is the fragile step.** `find /var/www/html -type f -exec chmod 644 {} +` runs over the *entire* web root, not the project. If any file there is not owned by `dadmin` it returns non-zero → the `&&` chain stops → `set -e` aborts — **after extraction already overwrote the live tree.** The error is about permissions and says nothing about the half-deployed site. This is the highest-value unverified check in the doc.
- **The archive is staged inside the public web root** (`/var/www/html/${PROJECT_NAME}.tar.gz`, `sync.sh:34`) and removed *only on success*. During every deploy — and permanently after a failed one — the complete source tree is downloadable at a predictable URL.
- **`ExecStart` hardcodes `/home/dadmin/.local/node-v22.22.0-linux-x64/bin/node`.** Production runs **22.22.0** from a hand-unpacked tarball; CI's `node-version: '22'` resolves **22.23.x**. Upgrading or moving that directory breaks the unit by path (`status=203/EXEC`, retried forever at 5 s). Note the skew has an edge: `jsdom@30`'s floor is `^22.22.2`, so production is *below* the version CI validates against — harmless (devDependency, quarantined test) but "green in CI" ≠ "runs on the relay host". **Not changed** — repointing the interpreter for the production relay is unverifiable without SSH.
- **`textures/` ships on every deploy.** Measured by reproducing `sync.sh`'s exact `tar` flags: **116,004,047 bytes compressed, 3,544 entries, of which only 171 are not textures.** No exclude, no content check.
- **`--exclude='dist'`** — the §1.4 landmine, noted and left for PR 10. Operational rule added to `DEPLOY.md`: **do not run `./sync.sh` between PR 7 and PR 10.**

**One code bug fixed: `sync.sh` did not exclude `.env`.** `.gitignore:2` lists it, so the project anticipates one existing locally, and `sync.sh`'s exclude list did not cover it — a local env file would have been tarred, extracted into a public web root, and `chmod 644`'d world-readable. No `.env` exists in the repo today, which is the only reason this was never a live leak; that also makes the fix provably non-regressive. One line, plus a comment naming the two `DEPLOY.md` sections. **Everything else was left alone on purpose:** PR 10 owns `sync.sh` and "must land with PR 9, not after", and every remaining defect is structural (release directories, deletion semantics, the build step, the staging path) — fixing them *is* the rewrite.

**Nothing was weakened.** No test touched, no assertion relaxed, no `QUARANTINE.md` change — still 4 files against the cap of 5, all owned by PR 26. `npm test` 50/50 + 4 quarantined, `check-globals` 0 duplicates / 65 files / 368 symbols, both exit 0 at this commit.

**Accept criterion, honestly: deploy ✅, rollback ❌ — and documentation cannot close it.**

> *"a fresh implementer can deploy and roll back from the doc alone"*

Deploying is fully documented, including the relay restart `sync.sh` omits. **Rolling back is not, because there is nothing to roll back to.** `tar xzf` extracts over the live tree; no backup is taken, no previous copy is kept, there are no versioned release directories, no symlink to flip, and the uploaded archive — the one artifact that could serve as a record — is deleted immediately after extraction. Once a deploy lands, the previous server state has ceased to exist.

`DEPLOY.md` §6.2 documents the best procedure that actually exists — re-deploy a known-good tag from a separate `git worktree`, with `npm test` / `check-globals` as the pre-flight gate — and states plainly that it is roll-*forward*-to-old-code with three gaps: deletions do not un-happen (§4.6), permissions and the relay's `node_modules` are not restored, and **it requires the known-good ref to be reachable**. Writing anything stronger would mean inventing machinery no line of this repo implements, which a fresh implementer would discover mid-incident. Two things close the gap, neither a documentation task:

- **Push `pre-refactor-baseline`** — still an open PR 1 criterion, and `git ls-remote --tags origin` confirms it is local-only. §6.2 has no target without it. This is now a *second*, independent reason to push it: not just a Phase 0 rollback point, but the only usable deploy-rollback target.
- **PR 10 must add a real rollback path** — versioned release directories plus an atomic symlink swap, or at minimum retaining the previous tree — in the same rewrite it already owns, and update `DEPLOY.md` §6 when it does.

**Not verified, and this is the doc's main weakness: `./sync.sh` was not run.** It needs SSH to `dadmin@10.0.30.160` with `~/.ssh/id_ed25519`, which this environment does not have. Everything about repo *contents* was verified by reading the cited file, and the payload measurement, the absence of `systemctl`, the absence of server-side filesystem writes, and the 5 s flush-timer wiring were verified by execution. Everything about the *remote host* is inference, marked `[UNVERIFIED]` inline and collected in `DEPLOY.md` §9 with the exact command that would confirm each — nine of them. Also unverified: **the save/load checklist was written from the code paths, not from a play session**, including its prediction that steps 8–9 fail on H-1. The doc says so and asks the first person to run it to correct the file.

**What serves `/var/www/html` is UNVERIFIED, not guessed.** Every `nginx` reference in the repo (`js/main.js:2112,2126`, `server/index.js:9`, `multiplayer.md:35,94,413`) describes nginx **only** as the TLS reverse proxy in front of the relay on 8765; `multiplayer.md:47` hedges the static server as `"(nginx / built-in)"`. There is no nginx config, no Apache config, and no static-server reference anywhere in the repo. Marked unverified with the command to settle it.

**One useful finding in the other direction: the relay is stateless and there is nothing on the server to back up.** `server/` performs no filesystem writes at all (verified across every `server/*.js`); sessions live in an in-memory `Map` and are disposed on shutdown. All player data is client-side. So a bad deploy can break the code that reads player data but cannot corrupt the data itself, and rebuilding the host from scratch loses nothing. That is what bounds the rollback gap above to *downtime* rather than *data loss* — worth stating, because it is the reason PR 6 can close with an unmet criterion rather than blocking Phase 1. The flip side: restarting the relay instantly destroys every in-flight multiplayer session.

**One unowned defect worth a decision (`DEPLOY.md` D-8):** `server/index.js:219-225` routes `uncaughtException` and `unhandledRejection` into the clean-shutdown path, which calls `process.exit(0)`. `Restart=on-failure` (`cuubz-relay.service:10`) does **not** restart on exit code 0 — so the relay stays down after an unhandled error, exactly the case the restart policy exists for. `Restart=always` or a non-zero exit code is the fix; both change production restart behavior, so neither belongs in a docs PR.

**New file:** `DEPLOY.md`. **Modified:** `sync.sh` (the `.env` exclude), `refactor.md` §1.4 / §1.5 / §4.1 (pointers to `DEPLOY.md`).

### PR 6b — Automate the save/load gate ✅ DONE
Not in the original plan. Added because PR 6 closed with `DEPLOY.md` §7 written but **never run**, and §9 said so: *"the save/load checklist was written from the code paths, not from a play session… The first person to run this checklist should confirm steps 8–9 fail as described and correct this document if they do not."* §7 is the parity baseline that Phase 1's "identical game, zero visual change" claim rests on, and a gate that depends on a human clicking around does not get run at every checkpoint.

- **Accept:** `DEPLOY.md` §7 runs as a script; H-1's prediction is either confirmed or the doc is corrected; nothing that cannot be driven is faked.
- **Rollback:** delete `test/e2e/` and the `test:e2e` script. Nothing else depends on it.

**Outcome (2026-07-29):** ✅ DONE. `npm run test:e2e` → **112 assertions, 0 failures, exit 0**, ~5 minutes. `npm test` (50/50 + 4 quarantined) and `check-globals` (0 duplicates / 65 files / 368 symbols) unchanged.

**The key design decision: build the harness around storage inspection, not input simulation.** That is what made this PR possible at all, and it follows from a hard limit worth stating precisely, because it is [§1.6](#16-renderloop-cannot-be-extracted-as-written) showing up somewhere new.

`page.evaluate` **can** reach all 368 top-level lexical symbols — `BLOCK_TYPES`, `ChunkManager`, `CHUNK_MAGIC`, `BLOCK_REGISTRY`, `PersistenceManager` — even though none of them are `window` properties. Same mechanism as [§2.4](#24-the-mechanism-is-implicit-globals-not-window) and PR 4 bug 1: a top-level `const` in a classic `<script>` is a global lexical binding. Verified live: `typeof BLOCK_TYPES === 'object'`, `BLOCK_REGISTRY.length === 193`. So every registry, constant and codec is directly testable from the browser.

It **cannot** reach live game state. Exactly four things are on `window` — `CuubzGame` / `CuubzBlockPalette` (`game.js:282-283`), `MobIntegration` (`mobIntegration.js:125`), `CuubzLogger` (`logger.js:39`) — and all four are **classes, not instances**. The running `renderer` / `chunkManager` / `player` / `inventory` are among §1.6's ~184 closure locals inside `startGame()`'s `setTimeout`. So the harness can click and type but cannot say "place block 2 at (14,68,-3)" or read the player's position. **This is not fought, it is designed around, and it unblocks at PR 12–13** — which is now a second, independent argument for Phase 2 existing: it is the PR that makes the save/load gate fully automatable.

The consequence is the interesting part. **DEPLOY.md steps 8–9 need no block placement.** The naive reading of §7 is "build a shape in world A, visit world B, look at spawn" — which needs pointer lock, mouse-look and inventory, i.e. everything out of reach. But H-1 is a *storage* bug, so it is provable purely from storage: world B generating chunk `"0,0"` overwrites world A's record at the same key, so read that record's own `worldName` field and watch it carry world B's id while world A's manifest still lists the key as generated. No pointer lock, no mouse simulation, no screenshot diffing. Same for the binary format — decode a stored `ArrayBuffer` and assert magic and version straight from the bytes.

**H-1 REPRODUCES. The prediction PR 6 asked to be confirmed is confirmed, and it is worse than described.** World A seed `424242` slot 0, world B seed `999111` slot 1:

| Observation | Result |
|---|---|
| Chunk `"0,0"`'s own `worldName` after visiting B | world **B**'s id — B's record replaced A's at the same key |
| Re-entering world A and reading `"0,0"` | **byte-for-byte identical to world B's chunk** (`e78141dbf2aa11bb` both sides) |
| World A's original spawn chunk (`b7ae538ee784e765`) | **gone from the store entirely — unrecoverable** |
| World A's manifest | still lists `"0,0"` as generated, so A loads the stale record rather than regenerating |
| World A's manifest checksum for `"0,0"` | `3799605976`, but the bytes stored there checksum to `1653333176` |
| World A chunks destroyed by **one** visit to world B | **1,073 of 1,184** — world-scoped keys would have left 2,393 records; the store holds 1,320 |

Two findings the original write-up did not have:

1. **The blast radius is the entire overlapping region, ~90% of the world, not just spawn.** "Play world A, then world B at spawn, and B's chunk overwrites A's" understates it — the two worlds *are* one world everywhere their pre-generated regions overlap, which at `regionRadius: 16` is nearly all of both.
2. **The corruption is already detectable with data the game stores today.** `manifest.generatedChunks[].checksum` is the chunk header's own FNV-1a, read straight out of the encoded buffer at offset 16 (`chunkmanager.js:649`), so a manifest-vs-record checksum mismatch identifies a contaminated chunk exactly. Nothing compares them on load. **That is a cheap partial mitigation for whoever owns H-1** — verify on load, regenerate on mismatch — degrading corruption into regeneration without touching the key format. The primary-key migration is still the real fix; this is the thing that could ship first.

**So H-1 needs its own migration PR, and it now has an evidence base for one.** → **That
PR is [PR 6c](#pr-6c--storage-integrity-h-1--d-15-in-one-migration--done), and it landed
the same day. H-1 and D-15 are both fixed.** The mitigation sketched above shipped as part
of it, in a modified form — see the deviation note there, because implementing it as
written would have destroyed player data.

**Four genuine bugs found. Three fixed, one left for its own PR.**

- **FIXED — `js/main.js:4865,4878` logged success milestones through `console.error`.** `=== AUTO-REJOIN COMPLETE ===` and `=== INIT COMPLETE ===`, so **every successful page load reported two console errors.** That pollutes error monitoring and made the harness's "zero console errors on a clean load" assertion impossible to write honestly. Now `console.info` — same visibility, correct severity, no behaviour change. **`js/util/logger.js` is correct and was left alone:** `CuubzLogger.log` is `console.log` gated on `DEBUG = false`, i.e. silent in production, which is exactly why someone reached for `console.error` to force visibility. The logger is not the bug; the severity was. With this fixed, "0 uncaught exceptions, 0 console errors, 0 missing assets on a clean load" is now literally true and asserted on every run.
- **FIXED — `DEPLOY.md` D-14: every "Exit to Menu" threw, leaving a blank page.** `js/main.js:4562` called `game.playerSync.reset()`. `PlayerSyncManager` has no `reset()` — that method belongs to `PingTracker` (`playerSync.js:103`; class boundaries at `:51`, `:125`, `:366`). `game.playerSync` is set whenever `sessionManager.client` exists, **which includes solo play** (`main.js:2612`), so this fired every time. The `TypeError` aborted `onExit` partway, skipping six cleanup steps (`playerListHUD.destroy`, `blockInteraction.dispose`, `firstPersonHand.dispose`, `droppedItems.clear`, `mobIntegration.destroy`, `_cleanupPauseMenu`) and — critically — `showScreen('mainMenu')` at `:4603`. Every screen stayed `hidden`: **a blank page, recoverable only by F5.** Almost certainly broken since `playerSync` was wired in, because nothing exercised the quit path. **Fixed by deleting the call**; `clearAll()` on the line above already disposes every remote-player mesh and clears the map (`playerSync.js:523-531`), so it was redundant as well as wrong. Fixed rather than merely flagged because it made **§7 step 7 unreachable** — one of the three steps the checklist says to stop the refactor over — and a gate that cannot run its own load-bearing step is not finished. Step 7 is now a real automated round trip, plus a guard that `onExit` returns to the menu, raises nothing, and leaves no in-game overlay visible.
- **FOUND, NOT FIXED — `DEPLOY.md` D-15: every saved chunk is exactly twice the size it needs to be.** `chunkBinaryCodec.js:63` sizes the buffer as `HEADER_SIZE + blockRuns.length * 4`, but `blockRuns` is a flat `Uint16Array` of `[id, count, id, count, …]`, so the run count is `blockRuns.length / 2` and the payload actually written is half the allocation. Measured on a real stored chunk: **24,156 bytes allocated, 12,088 used, 12,068 bytes of zeroes — 50.0% waste, ≈14 MB per world.** Not a corruption bug — `decode()` stops after `blockRunCount` runs and the checksum spans the whole data portion at both ends, so the padding is self-consistent, which is precisely why nobody noticed. It is pure waste: half the IndexedDB footprint and half the bytes written on every 5 s flush. Not fixed because shrinking the allocation changes the stored byte length and checksum of every future chunk, i.e. it is a `DEPLOY.md` §2.2 on-disk-format change and this PR is not allowed to touch `js/` beyond the log-severity fix. Backward compatible in principle (`decode` never consults buffer length), but it wants its own PR. **This bug is the direct payoff of asserting the header from real stored bytes rather than from the source constants** — a source-text test cannot see it.
- **FIXED — `DEPLOY.md` D-16: `#pause-pause-time` was inverted.** `index.html:477` was a checkbox labelled **"Pause Time of Day"**, `checked` by default, while `main.js:4693` sets `checked = !game.skybox.timePaused`. **So checked meant time was running:** ticking a box labelled "pause" un-paused it. Two possible fixes, and the choice is a product call rather than a refactor one, so it was escalated rather than picked: **relabel to "Day/Night Cycle"** (zero behaviour change — checked-by-default then correctly reads "cycle is on") or **invert the logic** (changes what the checked-by-default state *does*, i.e. every existing player's day/night cycle would start paused). **Relabelled**, on the decision. The harness now asserts the label, because a label that drifts back out of step with `main.js:4693` is exactly how this happened; asserting the actual `skybox.timePaused` value needs PR 12–13, since `game` is a closure local.

**Two defect-asserting blocks, and why that is a gate rather than an allowlist.** H-1 and D-15 are asserted *as defects* — the assertions pass because the bug is present, each headed `ASSERTING A KNOWN DEFECT` with the fix and the replacement assertion written next to it. This is not "allowlisting a bug to make a green run": a run goes red if a new failure appears **or** if a known failure stops reproducing, so fixing either turns the harness red on purpose and forces the assertion to be rewritten to what the fix makes true. The alternative — a harness that exits 1 from birth on pre-existing bugs — is the [§1.1](#11-there-is-no-green-baseline-the-suite-is-red-now) problem again, and PR 4 already paid to get out of it. **D-14 was a third such block and demonstrates the lifecycle**: it was asserted as a defect, then fixed in this same PR, and its block is now the real §7 step-7 round trip. Nothing was added to `QUARANTINE.md`; it still holds 4 files against its cap of 5, all owned by PR 26.

**Coverage: nine of fourteen steps automated, two explicitly not, and the harness says which on every run.** Steps 1, 2, 3, 5, 6, 7, 10, 11, 14 plus every `DEPLOY.md` §2 invariant. **Both load-bearing steps hold for terrain: chunk `"0,0"` is byte-for-byte identical with `savedAt` unchanged after a reload (step 6) *and* after a quit-to-menu with no reload (step 7)**, so the terrain was loaded from storage rather than regenerated. The two are not redundant — a reload throws the whole JS context away, so step 6 can pass while teardown leaks; step 7 keeps the context and exercises `onExit`, which is where D-14 lived. `#world-seed` (`index.html:154`) pins terrain, which is what makes a byte-equality assertion legitimate instead of a coin flip. The two remaining gaps are printed as `⚠️ UNVERIFIED` with what would close each, because a passing run must not imply more than it checked:

| Not verified | Why | What closes it |
|---|---|---|
| Step 4, and the placed-block half of steps 6/7 | pointer lock + mouse-look, and `blockInteraction` / `inventory` are §1.6 closure locals | **PR 12–13** |
| Steps 12–13 (multiplayer) | needs a relay, two contexts, **and** a guest placing a block | relay half works today; placement half waits for PR 12–13 |

Both gaps are the **same** blocker, which is the second independent argument for Phase 2: **PR 12–13 is what finishes this gate.**

**Toolchain, and why these choices.** `playwright-core`, **not** `playwright` — the latter's postinstall downloads ~300 MB of browsers; `playwright-core` is 14 MB and downloads nothing, driving the already-installed Edge (150.0.4078.105) via `chromium.launch({ channel: 'msedge' })`. **Headless WebGL works** with `['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']`: `glRenderer` reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`, THREE loads, and `THREE.REVISION === 134` is asserted — so [§1.2](#12-pin-three01340-do-not-run-npm-install-three)'s pin is now checked against what the browser really loads, which PR 8 must preserve. `test/e2e/staticServer.js` is a ~90-line dependency-free static server rather than a dev server, so the harness stays independent of the thing PR 7 changes: a gate that depends on what it validates is not a gate.

**Two engineering details that were failures first.**
- **`waitForQuiesce`.** `#hud` loses `.hidden` (`main.js:3901`) long before `checkRegion(0,0)` finishes pre-generating its 33×33 region, so a snapshot taken a fixed few seconds after the HUD appears catches a partly-generated world. Comparing two such snapshots produced a false *"33 chunks appeared after a reload"* failure with nothing to do with persistence. Polling the chunk count until three consecutive reads agree is what lets the round-trip assertions compare **exact** counts instead of being weakened to inequalities. Weakening the assertion would have hidden the real property.
- **Console-error accounting has exactly two exclusions, and the count is itself asserted.** `/favicon.ico` (Chromium requests it unprompted; the repo has none — `staticServer.js` already excludes it from `missing` for the same reason) and the relay WebSocket to `cuubz-relay.thehomelabguy.com:8765`, which cannot connect because the harness runs no relay — tolerated *only* outside the load and world-entry phases, which must be clean. Every suppressed message is printed. `assertEquals(NOISE_RULES.length, 2, …)` means a third exclusion cannot be added quietly.

**Not in `npm test`, not in CI, deliberately — and recorded PR 5's way.** `ubuntu-latest` has no Edge, and a real Chromium download plus SwiftShader rasterisation turns a 26 s job into minutes. Following PR 5's idiom for `npm run build` / `npm run lint`, it is a **comment in `ci.yml` naming the earliest sensible owner (PR 10, which already rewrites the deploy path and would want a post-deploy smoke check)** rather than a step that fails or one wrapped in `|| true`. It is also invisible to `npm test`: `test/run_tests.sh:46` globs `test/test_*.js` — flat, non-recursive — so nothing under `test/e2e/` is collected. That is a safety property this PR depends on; the workflow comment says so, and nothing in here is named `test/test_e2e*.js`.

**Screenshots are a self-comparison baseline, and nothing more.** Six PNGs to `test/e2e/artifacts/` (gitignored), including `05-world-alpha-contaminated.png` and `06-exit-to-menu-blank.png`. **SwiftShader does not render identically to a GPU**, so these are comparable only to another SwiftShader run on the same Chromium. That is still the right regression gate for PR 9's "zero visual change" claim; it is **not** evidence that the game looks correct on real hardware. Stated in the file so a future reader does not over-trust them.

**Portability preserved.** PR 5's audit asserts no `os.tmpdir` / `homedir` / `platform` in Node-executed code; `saveLoad.js` and `staticServer.js` use only `__dirname`-relative paths and keep that property intact. The harness itself asserts §7 step 14: `git status --porcelain` is byte-identical before and after the run.

**Nothing was weakened.** No test touched, no assertion relaxed, no `QUARANTINE.md` change — 4 files against the cap of 5, all owned by PR 26. CI green.

**New files:** `test/e2e/saveLoad.js`, `test/e2e/staticServer.js`. **Modified:** `package.json` + `package-lock.json` (`playwright-core` devDependency, `test:e2e` script), `.gitignore` (`test/e2e/artifacts/`), `.github/workflows/ci.yml` (comment only), `js/main.js` (two `console.error` → `console.info`; one deleted line for D-14), `index.html` (the D-16 relabel), `DEPLOY.md` §2.4 / §7 / §8 / §9, `refactor.md` (this section).

**Three things left open, all needing a decision rather than work:** **H-1** (the migration PR — now with an evidence base and a cheap partial mitigation), **D-15** (the 2× chunk allocation — a §2.2 format change, so its own PR), and the §7 items that wait on PR 12–13. **The first two were closed by [PR 6c](#pr-6c--storage-integrity-h-1--d-15-in-one-migration--done) in one migration**; the third still waits on Phase 2. The Phase 0 gate checkboxes are still untouched; "Manual save/load test passes" is now *substantially* true — nine of fourteen steps automated and green, two blocked on Phase 2, H-1 confirmed as a pre-existing failure — but it is a judgement call whether a gate with a known live data-corruption bug counts as passed, and that call is not this PR's to make.

### PR 6c — Storage integrity: H-1 + D-15 in one migration ✅ DONE
Not in the original plan. Added because PR 6b confirmed **H-1 by observation** — one visit
to a second world destroyed **1,073 of the first world's 1,184 saved chunks**, and
re-entering the first world served the second world's spawn chunk byte for byte. Phase 1
must not be built on a base that eats player data. **D-15 rides along because it touches
the same storage bytes**, and doing both in one migration means a player's data is
rewritten once rather than twice.

- **Accept:** the two-world test passes rather than asserting a defect; existing saved
  chunks are migrated, not orphaned; the migration is idempotent and safe on an
  already-migrated database; every known defect has an owner.
- **Rollback:** revert the commit. **Note the asymmetry:** a revert leaves already-migrated
  databases holding `worldName:cx,cz` keys that reverted code cannot read, so every world
  would appear empty and regenerate from its seed. Player *edits* would be lost even though
  terrain would not. That is an argument for getting this right rather than for not
  shipping it, but it is the reason the migration is idempotent and the reason
  `test/test_chunkStorage.js` exists.

**Outcome (2026-07-29):** ✅ DONE. `npm run test:e2e` → **137 assertions, 0 failures, exit
0** (112 at PR 6b; 25 added, and the H-1 and D-15 blocks rewritten from asserting the
defects to asserting the fixes). `npm test` → **51/51 passing, 4 quarantined, exit 0** (one
new file, 83 assertions). `check-globals` → 0 duplicates / 65 files / 368 symbols,
unchanged.

**H-1 IS FIXED, AND THE TWO-WORLD TEST IS NOW ITS REGRESSION TEST.** Same seeds as PR 6b —
world A `424242` slot 0, world B `999111` slot 1 — read from the same real browser:

| Observation | PR 6b (broken) | PR 6c (fixed) |
|---|---|---|
| World A's chunks after one full visit to world B | **1,073 of 1,184 destroyed** | **1,184 of 1,184 intact** |
| Records in the store with both worlds present | 1,320 — the *union of their coordinates* | **2,393 — the *sum*, 1,184 (A) + 1,209 (B)** |
| Chunk `"0,0"`'s `worldName` while playing world A | world **B**'s id | world **A**'s id |
| Re-entering world A and reading its spawn chunk | byte-identical to **world B's** chunk | byte-identical to **world A's own**, `savedAt` unchanged across three round trips and two worlds |
| World A's manifest checksum for `"0,0"` vs the bytes stored there | `3799605976` vs `1653333176` — divergent, unchecked | equal |
| Records anywhere in the store with an unscoped key | all of them | **0** |

**2,393 is the number PR 6b said world-scoped keys *would* have left, arrived at
independently a PR later.** The equality asserted is between the two worlds' own counts and
the store total, not against that literal — world B's exact count moves by a chunk or two
between runs depending on where its region pre-generation quiesces (1,209 here, 1,211 on
another run), and a hard-coded total would be a flaky assertion dressed up as a precise
one. Asserting *any* exact equality at all is only legitimate because of PR 6b's
`waitForQuiesce`; without it the counts have to be weakened to inequalities and the whole
property disappears.

**The design decision: two keys, not one.** The fix is not "world-scope the chunk key" —
that phrasing is what makes this look like a one-line change and it is the trap.
`ChunkManager.key(cx, cz)` has **17 call sites** and is the key of the in-memory
`memoryCache`, of `manifest.generatedChunks[].key`, and of the worker protocol. None of
those are world-scoped concepts, and changing it cascades into the manifest format, which
is itself a `DEPLOY.md` §2.1 invariant. So the **logical** key is untouched and a
**separate storage key** — `_storeKey(key)` → `` `${worldName}:${key}` `` — is applied at
exactly the **seven** sites that touch the `chunks` object store: three writes
(`saveChunk`, the `flushDirty` batch, the `beforeunload` flush), three reads (`loadChunk`,
`hasChunk`, `_batchLoadChunks`) and one delete (`deleteChunk`). That is the whole boundary,
and confining the change to it is what keeps the blast radius at seven lines instead of
seventeen call sites and a format change. The `manifests` store was already world-keyed
(`keyPath: 'worldName'`) and was left alone.

The separator is `:` — the separator `js/world/persistence.js` already uses for
`cuubz:worldSlot:0:conf`. A logical key contains only digits, `-` and `,`, so **the
presence of a `:` is an exact discriminator** between a migrated key and a pre-migration
one, whatever a world id turns out to contain. That is what makes the migration idempotent
rather than heuristic.

**The migration runs at `DB_VERSION = 2`, and the reason is H-2.** The obvious move —
bump the version and migrate in `onupgradeneeded` — is the one thing that must not happen
here: that handler enumerates every object store, `deleteObjectStore`s all of them and
recreates them empty (`chunkmanager.js:263-276`). Bumping the integer to fix players' keys
would destroy players' worlds on the way. So nothing about the schema changes, nothing
needs a version bump, and `_migrateToWorldScopedKeys` runs from `_openDB` instead —
which all seven boundary sites `await`, so **no read can observe a half-migrated store**.
That sequencing is the load-bearing property and it is asserted directly: the unit test
drives a real `_openDB` against a stub `indexedDB` and checks that the first read after
opening finds a pre-migration record.

**The migration needed no new data.** Every write site already set a `worldName` field on
the record (and there is a non-unique index on it that no read path has ever used), so
each row already knew which world it belonged to. Re-put under
`` `${record.worldName}:${record.chunkKey}` ``, delete the old row, batched 500 at a time
the way `flushDirty` batches and for the same reason. Payload bytes and `savedAt` are
carried across untouched — a migrated chunk must not look freshly written.

**What the migration cannot do, stated because the alternative is implying otherwise: it
cannot recover data H-1 already destroyed.** A contaminated record only remembers its
**last** writer, so it migrates into that world and the other world regenerates those
chunks from its seed. Terrain is deterministic, so the ground comes back identical; what is
gone is any player edit inside those chunks, and it was gone before the migration ran. A
record with **no** `worldName` cannot be attributed at all, and is left in place rather
than guessed at — guessing would put one world's terrain into another, which is precisely
the failure being fixed. It is counted and logged, and it is unreachable rather than
destroyed: no read path serves a bare key any more.

**D-15 shipped in the same migration, and the checksum is the reason it needed care.**
Both sites now read `blockRuns.length * 2` (`encode`'s `bufferSize` — the live bug — and
`estimateSize`, which had no callers outside the codec and over-reported 2×). The fix is
backward compatible because `decode()` never consults the buffer length; it stops after
`blockRunCount` runs, so an old padded chunk and a new tight one decode identically. **But
the checksum spans the whole data portion**, so a re-encoded chunk carries a *different*
checksum than its padded original — which is safe only because every write path records
the new checksum in the manifest in the same pass. That is now true; it was not (see D-19).
Both properties are asserted: the unit test reconstructs a byte-exact pre-6c padded buffer,
confirms its checksum differs, and confirms both buffers decode to identical blocks.

**Three defects found while doing it. All three fixed, all three logged.**

- **D-17 — `deleteChunk` issued two delete operations per call.** `store.delete(key)`
  called **twice**, as two separate `IDBRequest`s, purely so `onsuccess` and `onerror`
  could be attached separately. Idempotent, hence harmless, hence nobody noticed. One
  request, both handlers. Asserted by counting issued operations against the stub store,
  not by reading the diff.
- **D-18 — deleting a world left every one of its chunk records behind.** `js/main.js`
  deleted the manifest and stopped, under a comment reading *"chunks remain orphaned but
  harmless — they're keyed by chunk coordinates"*. `DEPLOY.md` §2.4 already called that
  premise out as H-1 itself: the records were not orphaned, they were **shared** with
  whatever world next generated the same coordinates. World-scoped keys are what make a
  world's chunks both identifiable and safe to remove, so deletion now removes them as a
  key range — the leak is only *fixable* because of this PR. This is the one change outside
  `chunkmanager.js` and `chunkBinaryCodec.js`, and the reason is that the comment is cited
  in `DEPLOY.md` as evidence and became false the moment the keys changed. Records already
  orphaned by a pre-6c deletion stay orphaned; they have no prefix to match.
- **D-19 — the `beforeunload` flush wrote chunks without updating the manifest.** So a
  chunk saved on tab close kept the checksum the manifest had recorded for its *previous*
  bytes. Nothing read those checksums, so nothing noticed — and it would have stayed
  invisible were it not for the load-time check below, which is the first reader. Both
  stores are now written in **one** transaction, from the in-memory manifest copy:
  `beforeunload` has no budget for an async read-modify-write, and two transactions could
  disagree. The three sites that record checksums (`addVerifiedChunk`, `flushDirty` phase 3
  and this one) now share `_mergeManifestEntries` so they cannot drift.

**A deviation on the load-time mitigation, and it is the most important judgement call in
this PR.** The plan (and `DEPLOY.md` §7.1's own suggestion, carried from PR 6b) was:
verify the manifest's recorded checksum against the stored record's offset-16 checksum on
load, and **on mismatch drop the manifest entry so the chunk regenerates**. Implemented
literally, that introduces a data-loss bug worse than the one it defends against. D-19 is
why: the `beforeunload` flush wrote chunk bytes without updating the manifest, so a
checksum mismatch is the *expected, benign* state for exactly the chunks a player edited
immediately before closing the tab. Regenerating on that signal would turn `DEPLOY.md`
§7's "a block that vanishes after an instant reload is not necessarily a regression" into
"is deterministically destroyed."

So it was split into the two checks the stored data actually supports:

1. **Ownership — regenerate.** A record whose `worldName` names a *different* world than
   the one loading it has to be foreign terrain, and serving it is the corruption itself.
   It is discarded and the chunk regenerates. This is free (the field is already in the
   record) and it is the **tripwire that would catch H-1 coming back** — which is what
   "defence in depth" has to mean, given that the keys are what actually fix it.
2. **Checksum — repair, do not regenerate.** A mismatch on intact, correctly-owned bytes
   means the *manifest* is out of date, not the chunk. `decode()` already verifies the
   bytes against the checksum they carry, so real corruption is caught there and always
   was. The manifest entry is rewritten to what is actually stored, and the chunk loads.

Reporting a fixed defect count would have been easy here; the honest version is that the
scope item was implemented in the form the data supports, and D-19 exists because
implementing it literally required finding out why it could not be.

**`BUGS.md` — the standing ledger, and the process it encodes.** Every known defect, its
severity, its **owner PR** and its status, in one table, under a rule that **no row may say
"Unowned"**. `DEPLOY.md` §8 is now a pointer to it, so there is one list rather than two.
The rule is not bookkeeping: §8 shipped with **six unowned rows**, one of which was H-1 —
live data corruption that sat documented and unowned through two PRs while the thing that
would fix it had no home. What the consolidation added:

| Was | Now |
|---|---|
| D-8, D-10, D-12 — "Unowned" | **PR 10**, which already owns `sync.sh` and the systemd unit |
| H-2, H-3 — "Unowned" | **PR 6d**, a new slot (below) |
| `SurvivalSystem` spawn `y=20` — loose in PR 4's prose, no ID | **D-21**, owner **PR 22** — the PR that wires death/respawn out of the render loop, i.e. where it stops being latent |
| Four relay tests on fixed ports — loose in PR 5's prose, no ID | **D-20**, owner **PR 31** |
| `on: push` double-running same-repo PR branches — loose in PR 5's prose | **D-22**, owner **PR 11**, the next PR to touch `ci.yml` |

It also records **which open decision blocks which row**, so a decision is neither made
twice nor lost, and it does *not* retroactively invent IDs for the thirteen bugs PR 3 and
PR 4 fixed before the scheme existed — those are pointed at, not renumbered.

**Tests — nothing weakened, and one existing assertion strengthened.**

- **New: `test/test_chunkStorage.js`, 83 assertions, in `npm test` and therefore in CI.**
  Covers the store-key helpers, all four single-record boundary sites (including that a
  second world neither sees nor overwrites the first's chunk (0,0)), `_batchLoadChunks`
  keying results by the *logical* key, `_mergeManifestEntries`, the migration on a fresh
  database, **twice more for idempotency** (asserting *zero* writes on the second pass, not
  merely a harmless outcome), a record with no `worldName`, a record with an empty one, a
  half-migrated database, an empty store, D-17 by operation count, and D-15's exact size
  plus the padded-buffer compatibility property.
  It uses a ~70-line hand-rolled IndexedDB stub rather than `fake-indexeddb`, which is not
  a dependency and belongs to PR 32 with the rest of the persistence suite. The stub models
  the one behaviour that matters: **a transaction does not complete until work queued from
  inside a request handler has also drained.** The migration issues its `put`/`delete` from
  inside a `get`'s `onsuccess`, so a stub that resolved synchronously would pass while the
  real thing failed.
- **Strengthened, not added: `test_chunkBinaryCodec.js` test 7.** It asserted
  `estimated < actual * 1.5`. **Both the bug and the fix satisfy that**, which is exactly
  why a unit test sat next to D-15 for the life of the codec without seeing it. It is now
  an equality, plus `length === 20 + runCount * 4` read from the chunk's own header.
- **The two defect-asserting blocks in `test/e2e/saveLoad.js` are inverted, and none
  remain.** PR 6b shipped three (D-14, D-15, H-1) on the rule that a run goes red if a new
  failure appears **or** if a known failure stops reproducing. D-14 completed that
  lifecycle inside PR 6b; D-15 and H-1 complete it here. Steps 8–9 no longer describe the
  bug — they assert that world A's bytes survive world B, that the store holds the sum, and
  that re-entering A serves A's own terrain.
- **The migration is asserted in the browser too, not only against the stub.** The harness
  writes a record the pre-6c way — bare primary key, `worldName` beside it — then loads the
  game and checks the record was re-keyed under its own `worldName`, the bare row is gone,
  and the payload is byte-identical with `savedAt` preserved. That is the one property the
  suite cannot reach by playing forward, because every record the harness writes is already
  world-scoped.
- **`QUARANTINE.md` untouched** — 4 files against the cap of 5, all owned by PR 26.
  `test:e2e` is still not in CI and still a comment naming PR 10, per PR 5's idiom.
  Nothing in `test/e2e/` is named `test/test_e2e*.js`, so `run_tests.sh:46`'s flat glob
  still cannot see it.

One incidental harness fix: it now clears `test/e2e/artifacts/*.png` before a run. PR 6c
renamed `05-world-alpha-contaminated.png` to `05-world-alpha-intact.png`, which would
otherwise have left seven files against the six the run asserts — and a screenshot from a
run of *different code* is worse than no screenshot in a baseline whose only value is
self-comparison.

**New files:** `BUGS.md`, `test/test_chunkStorage.js`. **Modified:** `js/chunkmanager.js`
(the seven boundary sites, `_storeKey` + the two static key helpers, the migration,
`_mergeManifestEntries`, the load-time integrity check, D-17, D-19),
`js/world/chunkBinaryCodec.js` (D-15, both sites), `js/main.js` (D-18 — stated reason
above), `test/e2e/saveLoad.js`, `test/test_chunkBinaryCodec.js`, `DEPLOY.md` §2.1 / §2.2 /
§2.4 / §7 / §7.1 / §8 / §9, `refactor.md` (this section and the PR 6d slot).

**Left open, and each now with an owner:** **H-2** and **H-3** → PR 6d (below). The
`DEPLOY.md` §7 items that wait on PR 12–13 are unchanged. The Phase 0 gate checkboxes are
still untouched — six of the seven are substantively true, and *"Manual save/load test
passes"* is now stronger than it was (eleven of fourteen steps automated and green, the
known data-corruption bug fixed rather than merely documented), but ticking it is still the
owner's call and not this PR's.

### PR 6d — Rewrite `onupgradeneeded` so a schema change *can* migrate (H-2, H-3) ✅ DONE
**Not needed by PR 6c, which deliberately migrated around it, and that is the point: the
next person who needs a genuine schema change has nowhere to go.**

`onupgradeneeded` (`js/chunkmanager.js:263-276`) enumerates every existing object store,
`deleteObjectStore`s all of them, and recreates them empty. The comment says it "handles
schema changes cleanly". It destroys every saved world on every player's device, with no
migration and no warning. **Bumping `DB_VERSION` is a one-character change with total
player data loss as its effect** — which is why PR 6c ran its migration at version 2 from
`_openDB` instead, and why `DEPLOY.md` §2.1 carries a ⛔ warning rather than a note.

- **Scope:** rewrite the handler to migrate `oldVersion → newVersion` step by step, creating
  stores only when absent and never deleting one that holds data. **H-3** rides along:
  `js/main.js:545` opens the database with no version argument, which on a device where it
  does not yet exist creates `cuubz-worlds` at version 1 with no object stores and throws
  the following `db.transaction([...])` into a silent `catch {}`. It self-heals through this
  same handler, so the two want one PR.
- **Accept:** `DB_VERSION` can be incremented with a pre-existing v2 database present and
  every chunk and manifest survives, asserted against a seeded database rather than
  reasoned about. `DEPLOY.md` §2.1's ⛔ warning is replaced by the procedure.
- **This gates PR 23.** `refactor.md` §9 PR 23 splits `chunkmanager.js` and is already
  flagged as the highest data-loss risk in the plan, with "test with a **pre-existing** v2
  database" as an explicit requirement. PR 23 should not be the PR that discovers this.
- **Open decision 6.**

**Outcome (2026-07-29):** ✅ DONE. `npm run test:e2e` → **149 assertions, 0 failures, exit
0** (137 at PR 6c; 12 added). `npm test` → **51/51 passing, 4 quarantined, exit 0**
(`test/test_chunkStorage.js` 83 → **129 assertions**, seven new sections).
`check-globals` → 0 duplicates / 65 files / 368 symbols, unchanged: everything new is a
static on `ChunkManager` or a property assigned to it, so nothing enters the global scope.

**`DB_VERSION` WAS INCREMENTED OVER A POPULATED VERSION-2 DATABASE, IN A REAL BROWSER, AND
EVERY RECORD SURVIVED.** That is the accept criterion and it is the only part of this PR
that could not be established by reading the code:

| Observation | Pre-6d handler | PR 6d ladder |
|---|---|---|
| Chunk records after a 2 → 3 increment (3 seeded, two worlds) | **0** — every store deleted and recreated empty | **3**, equal field for field: same primary keys, `worldName`s, byte lengths, offset-16 checksums and `savedAt` |
| Manifest records, checksums included | **0** | **1**, `generatedChunks` unchanged |
| Object stores after the increment | `chunks`, `manifests` — *recreated*, which is why this was invisible | `chunks`, `manifests`, **plus** the store the new step asked for |
| `deleteObjectStore` calls anywhere in an upgrade | one per existing store | **0**, asserted by operation count |
| Bumping `DB_VERSION` without writing the step | silently "upgrades" to a schema that was never applied | **throws**, aborting the versionchange transaction; the database keeps its old version and all of its data |

**The design is a ladder, and the two rules are the whole of it.** `SCHEMA_STEPS[v]`
brings a database from `v-1` to `v`; an upgrade runs every step in
`(oldVersion, newVersion]` in ascending order. (1) **Steps create, never delete** —
`_ensureStore` / `_ensureIndex` are create-if-absent, so re-running a step over a database
that already has the store is a no-op instead of a data loss. (2) **An unregistered
version throws** — the failure mode of forgetting the step is a loud one at development
time, not a database that claims v3 while holding a v2 schema. The second rule is the
non-obvious half: the tempting default is to treat a missing step as "nothing to do", and
that is exactly how a schema and a version number drift apart permanently.

**The judgement call: ship the mechanism, do not exercise it on players.** `DB_VERSION`
stays at 2. Shipping a ladder and moving every player's database through it are separate
risks, and there is no schema change that needs making — so the increment is proved
against a **seeded probe database** rather than performed on real ones. The probe is a
separate database name (`cuubz-h2-upgrade-probe`, deleted before and after), because
`cuubz-worlds` is what the other ~140 assertions in the harness depend on and driving an
upgrade over it would bet all of them on the thing under test. The ladder receives the
database, not the name, so nothing about the proof is weakened; the run then asserts
`cuubz-worlds` is still at version 2 with its record count unchanged. Recorded as
**decision 6** in `BUGS.md` so PR 23 does not re-open it.

**H-3 was fixed by deleting the second opener, not by patching it.** `js/main.js:545`
called `indexedDB.open('cuubz-worlds')` with no version, which on a device where the
database did not exist created it at version 1 with no object stores and threw the next
line's `db.transaction([...])` into a silent `catch {}`. The obvious fix is to add the
version argument. The better one is that **a caller which does not name the version should
not be possible**: `ChunkManager.openDatabase()` is now the only opener in the codebase, it
always names `DB_VERSION`, it carries the ladder, and it returns a fresh un-memoized
connection the caller owns and closes (`_openDB` is the instance-level memoizing wrapper
around it). H-3 was a *second source of truth about the schema*; one opener is what
removes the category.

**The repair pass is the part that would have been easy to leave out.** Every upgrade ends
with an unconditional `_ensureBaseSchema`, which looks redundant next to steps 1 and 2 that
already call it. It is not: an H-3 database created by an older build arrives as a 1 → 2
upgrade whose *database already claims version 1* — so step 1 never runs, and without the
repair pass the stores would never be created. The old handler healed that case by
accident, as a side effect of deleting everything. The ladder heals it on purpose, and
`test/test_chunkStorage.js` §20 asserts it from that exact starting state (version 1, zero
stores) rather than trusting the accident to survive the rewrite.

**One defect found, logged, and mitigated: D-23 — the cache-bust strings were never
bumped.** `index.html` carries a hand-maintained `?v=` string on each of its 65
`<script src>` tags. **28 of those files changed during Phase 0 — PR 2, 3, 4, 6b and 6c —
and not one string was bumped.** A deploy of Phase 0 would therefore have served returning
players their *cached* pre-Phase-0 JavaScript: no global-collision fixes, no D-14 quit-path
fix, and a `js/chunkmanager.js` with no H-1 migration in it. The H-1 fix would have reached
new players and missed the ones who already had corrupted worlds.

All 28 are bumped to `?v=20260729-1` in this PR, mechanically (every file differing from
the PR 1 baseline `27959d3`), so a deploy from this branch is correct today. The *class* of
bug is owned by **PR 7**: Vite emits content-hashed asset filenames and the convention
stops existing. Until then, bumping the string is a manual step in any PR that edits a
`js/` file, and it is written into `DEPLOY.md` §2.1's schema-change procedure as step 4.
The severity is **medium** rather than high only because the cache headers of whatever
serves `/var/www/html` are themselves unverified (`DEPLOY.md` §3.1) — with plain ETag
revalidation a changed file is refetched regardless of the query string.

**Tests — 46 new assertions in CI, 11 in the browser, nothing weakened.**

- **`test/test_chunkStorage.js` §§16–22, 83 → 129 assertions.** A fresh 0 → 2 upgrade;
  **§17, the accept criterion** — a seeded v2 database with three real encoded chunks and a
  real manifest taken to version 3 through the shipped handler, asserting record survival,
  buffer *object identity* (the upgrade moved nothing and re-encoded nothing), and that the
  records are still readable through `hasChunk` / `loadChunk` rather than merely present;
  `_ensureStore` / `_ensureIndex` never clobbering, including recreating an index that went
  missing and skipping an index on an absent store; the unregistered-version throw
  asserting that it fires **before** any schema operation; **§20**, the H-3 starting state;
  and **§22**, a guard on future edits that runs every registered step against an
  already-current database and fails if it issues any schema operation at all.
- **"Deleted nothing" is asserted by counting schema operations, not by inspecting the
  result.** A handler that deletes a store and recreates it leaves exactly the same store
  names behind. That is precisely how H-2 stayed invisible for the life of this file, and a
  test that looked at the end state would have reproduced the blindness.
- **The stub grew a schema surface.** `onupgradeneeded` hands over a synchronous `db` plus
  the versionchange transaction — a completely different API from the async request objects
  the PR 6c stub models — so `createFakeDB` now also exposes `objectStoreNames`,
  `createObjectStore`, `deleteObjectStore`, an index registry, and an operation log, while
  holding real records in the same maps the request API reads. That overlap is what makes
  "the upgrade did not touch the data" assertable at all.
- **The browser block is deliberately not a `DEPLOY.md` §7 step.** §7 never asked for this
  because it was forbidden. It is headed as PR 6d's own block and printed as such.
- **The probe chunks carry different blocks, and that is load-bearing.** The first version
  of this block seeded three *empty* chunks, and an empty chunk RLE-encodes to the same 28
  bytes whatever its coordinates are — so all three shared one checksum and "the checksums
  match after the upgrade" would have been satisfied by any three records at all. They now
  hold 1×1, 5×5 and 11×11 slabs of stone, giving three distinct lengths (32 / 64 / 112) and
  three distinct checksums, and the run asserts that distinctness *before* comparing. An
  assertion that passes for the wrong reason is worse than one that is absent, because it
  is counted.
- **`QUARANTINE.md` untouched** — 4 files against the cap of 5, all owned by PR 26.
  `test:e2e` is still not in CI and still a comment naming PR 10. Nothing in `test/e2e/` is
  named `test/test_e2e*.js`.

**Modified:** `js/chunkmanager.js` (the ladder, `_ensureStore`, `_ensureIndex`,
`_ensureBaseSchema`, `_applySchemaUpgrade`, `openDatabase`, `SCHEMA_STEPS`, and `_openDB`
reduced to memoization plus the H-1 data migration), `js/main.js` (H-3), `index.html`
(D-23, 28 cache-bust strings), `test/test_chunkStorage.js`, `test/e2e/saveLoad.js`,
`BUGS.md`, `DEPLOY.md` (§2.1's ⛔ → the procedure, §2.4, §7, §9, the header),
`refactor.md` (this section and the Phase 0 gate).

**Phase 0 is complete.** The gate below is ticked with the evidence for each box.

### Phase 0 gate — do not proceed until all are true

Ticked by PR 6d. Every box was verified by running the command named beside it at
`refactor/phase-0`, not by reading the plan.

- [x] `git status` clean; `pre-refactor-baseline` tag pushed —
      `git ls-remote --tags origin` now returns it. It is the only usable deploy-rollback
      target (`DEPLOY.md` §6.2) and an open PR 1 acceptance criterion.
- [x] All source files `require` without throwing — PR 2; held by `npm test` at every
      commit since.
- [x] `check-globals.js` reports 0 duplicates — 65 script-tagged files, 368 top-level
      symbols, exit 0. In CI on every push.
- [x] `npm test` exits 0 — 51/51 passing, 4 quarantined against a cap of 5, every one
      owned by PR 26 in `QUARANTINE.md`. In CI on every push.
- [x] CI runs on push — `.github/workflows/ci.yml`, green with 0 annotations. `test:e2e`
      is deliberately excluded (no Edge on `ubuntu-latest`) and says so in a comment
      naming PR 10.
- [x] Deployment plan + data invariants written down — `DEPLOY.md`, with `BUGS.md` as the
      single defect ledger. §9 marks explicitly which claims are unverified and names the
      command that would verify each.
- [x] Manual save/load test passes — **with the footnote below. Read it before relying on
      this box.**

> **Footnote on the save/load box.** `npm run test:e2e` runs **eleven of the fourteen**
> `DEPLOY.md` §7 steps in a real browser: 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 14, plus every
> §2 storage invariant, plus PR 6d's `DB_VERSION` increment. 149 assertions, 0 failures.
>
> **Three are not automated and this box does not claim them:**
> - **Step 4** — placing and breaking blocks. Needs pointer lock and mouse-look, and
>   `blockInteraction` / `inventory` / `chunkManager` are closure locals inside
>   `startGame()`'s `setTimeout` (§1.6). **Waits on PR 12–13.**
> - **Steps 12–13** — multiplayer host/guest persistence. Same pointer-lock wall, plus a
>   running relay. **Waits on PR 12–13.**
> - Consequently the placed-block and inventory halves of steps 6 and 7 are unverified;
>   what is verified there is that **terrain** is byte-identical across a reload and
>   across a quit-to-menu, with `savedAt` unchanged.
>
> The harness prints all three as `⚠️ UNVERIFIED` on every run with what would close each,
> so a green run cannot be mistaken for a complete one. **The first thing PR 12–13 should
> do after hoisting the locals is close them** — at that point it is a few lines in
> `saveLoad.js`, and it is the last of §7 that a human has to run by hand.
>
> Ticking this box was **decision 2**, made on the record because the alternative — leaving
> it unticked forever because three steps need a subsystem two phases away — is how a gate
> stops being a gate.

---

## 6. Phase 1 — Vite + ES Modules (PR 7–11)

> **Deliverable:** identical game, ES modules, working build **and working deploy**. Zero visual change.

### PR 7 — Vite skeleton, no source changes ✅ DONE
```bash
npm i -D vite
```
```js
// vite.config.js
import { defineConfig } from 'vite';
export default defineConfig({
  root: '.',
  publicDir: false,          // textures/ served from root; see §1.8 — do NOT copy 118 MB
  build: { outDir: 'dist', target: 'es2020' },
  server: { port: 3000 },
});
```
Add `dev` / `build` / `preview` scripts. **Do not touch `js/` yet.** Confirm `npm run dev` serves the existing script-tag site unchanged.
- **Accept:** `npm run dev` → game plays identically. `npm run build` succeeds.

**Outcome (2026-07-29):** ✅ DONE. `vite@^8.1.5` as a devDependency; `vite.config.js`;
`dev` / `build` / `preview` / `test:e2e:vite` scripts; a `build` step in CI. **Not one
byte of `js/` or `index.html` changed.**

| Gate | Result |
|---|---|
| `npm run test:e2e` (staticServer — the parity baseline) | **150 assertions, 0 failures, exit 0** |
| `npm run test:e2e:vite` (**`npm run dev`**) | **150 assertions, 0 failures, exit 0 — identical** |
| `npm test` | 51/51 + 4 quarantined, exit 0 |
| `node scripts/check-globals.js` | 0 duplicates / 65 files / 368 symbols |
| `npm run build` | exit 0 (see D-24) |

**"Serves the existing site unchanged" is checked, not asserted.** `--server=vite` runs
the *whole* save/load harness against the dev server instead of `staticServer.js`, so the
claim being made is not "the menu rendered" but "every storage invariant, both chunk key
formats, the chunk binary header, `THREE.REVISION === 134`, both terrain round trips, the
two-world H-1 regression test, the H-1 migration, PR 6d's `DB_VERSION` increment and the
clean-load error budget all hold, identically, on both hosts". Cost: one ~110-line file
and about six more minutes per phase gate.

`staticServer.js` stays the default and stays the baseline. PR 6b wrote in its header that
it exists so the harness does not depend on the dev server PR 7 introduces, "because a
harness that depends on the thing it is validating is not a gate" — that sentence was
written for this PR and it still holds.

**One trap, found the hard way, and now impossible.** A dev server left running from an
earlier attempt answered on the same port while the new `vite` failed to bind, so a probe
run tested **stale code and passed**. `viteServer.js` therefore uses a fixed port with
`--strictPort` and turns "vite exited before reporting a URL" into a rejection with vite's
own output attached. An ephemeral port would have hidden the problem instead of solving
it: the failure mode is not "the port was busy", it is "something else answered".

**The `missing` assertion had to be re-implemented, not skipped.** `staticServer` counts
its own 404s and the harness asserts zero. A child-process dev server cannot do that, and
leaving `server.missing` as an empty array would have turned a real assertion vacuously
true in one mode — weakening an assertion to make a run pass. The Vite host collects the
same signal from Playwright's `response` event instead.

**`publicDir: false`, and it is not a detail.** Vite's default is to copy the public
directory into `dist/` on every build. `textures/` is 118 MB across 3,370 files at the repo
root (§1.8), so pointing `publicDir` at it would duplicate 118 MB per build, and moving the
tree into `public/` would duplicate it in git as well. With `publicDir: false` the dev
server still serves `textures/` — it is inside the project root, and `textureAtlas.js`
fetches it relatively. **PR 9** owns making those relative fetches survive a base-URL
change; **PR 10** owns how textures reach a deploy host.

**D-24 — `npm run build` succeeds and produces a `dist/` that cannot run.** Vite does not
bundle a classic `<script src>`: it emits one *"can't be bundled without `type="module"`"*
warning per tag — 65 of them — and copies neither the scripts nor the textures. So
`dist/index.html` (28 kB) plus one bundled CSS asset is the entire output, carrying 65
references to files that are not there. **This is the expected state at this point in the
plan, not a regression:** PR 9 is what makes those files modules, which is what makes them
bundleable. It is logged with an owner anyway, because "the build succeeds" and "the build
output works" are different claims and only the first one is true today. `sync.sh` excludes
`dist/` (**D-4**), so nothing can deploy it by accident; the residual risk is a human
copying the directory by hand, which is why `DEPLOY.md` §4.3 now says so explicitly.

**The `build` step went into CI in this commit**, which is what PR 5's comment block in
`ci.yml` promised: *"PR 7 and PR 11 each add their step in the same commit that adds the
script."* Today it only proves `vite build` does not crash. It becomes a real gate during
PR 9, when every converted file is something the build can fail on — which is the point of
having it before PR 9 rather than after.

**Not done here, deliberately:** `vite` is not version-pinned (`^8.1.5`). §1.2's pin is
about `three`, where a minor bump changes every colour in the game; a build tool that
produces no deployed artifact yet does not need the same treatment, and pinning it would
just be a lockfile with extra steps.

**New files:** `vite.config.js`, `test/e2e/viteServer.js`. **Modified:** `package.json`
(four scripts + the devDependency), `package-lock.json`, `test/e2e/saveLoad.js` (the
`--server=` switch and the browser-side `missing` collector), `.github/workflows/ci.yml`
(the `build` step, plus three comments that had gone stale), `BUGS.md` (D-24, and D-22's
note, which claimed PR 11 would be the next PR to touch `ci.yml`), `refactor.md` (this
section).

### PR 8 — Pin Three.js at r134 ✅ DONE
```bash
npm i three@0.134.0 --save-exact
```
Keep `js/three.min.js` on disk until PR 9 flips imports. See [§1.2](#12-pin-three01340-do-not-run-npm-install-three).
- **Accept:** `package.json` shows `"three": "0.134.0"` (exact, no `^`).

**Outcome (2026-07-29):** ✅ DONE. `"three": "0.134.0"` in `dependencies`, exact, and
`node_modules/three/package.json` reports `0.134.0`. **Nothing imports it yet and nothing
was removed** — `js/three.min.js` is still on disk and still what `index.html` loads. PR 9
flips the imports; this PR only makes the package available and the pin enforceable.

**The pin is now a CI gate rather than a paragraph — `test/test_threePin.js`, 8
assertions.** §1.2 explains at length why r134 is load-bearing (843 hand-written shader
lines, seven `ShaderMaterial`s, six with `fog: true`, and zero occurrences of
`outputEncoding` / `sRGBEncoding` / `outputColorSpace` / `physicallyCorrectLights` /
`useLegacyLights` anywhere in `js/`, so a modern Three changes every colour in the game).
Nothing enforced it. `npm i three` — the exact command §1.2 forbids — would have
installed r18x and left the repo looking fine until PR 9 switched the imports over.

**It checks four things, and the fourth is the reason it exists.** The declared range is
exactly `0.134.0` with no range operator; the *installed* package matches; the vendored
`js/three.min.js` is r134; and **the two copies agree**. The dangerous state is not "the
pin moved" — it is the npm package and the vendored bundle disagreeing, because PR 9's
switchover would then change renderer behaviour silently while both version strings looked
correct in isolation. That is the failure §1.2 describes, and it is invisible to any check
that looks at one copy at a time.

The bundle's revision is read in two steps — find `.REVISION=<ident>`, then find that
identifier's string literal — rather than by grepping for `"134"`, which would also match
a shader define or a magic number, and which would silently start matching nothing after a
rebuild with a different minifier.

**Not run: `npm run test:e2e`.** It cannot observe this PR. The harness asserts
`THREE.REVISION === 134` from the running browser, and the browser loads
`js/three.min.js` via a `<script>` tag that this PR did not touch; an npm package nothing
imports cannot change what the page executes. Six minutes for a guaranteed-identical
result is not diligence, it is theatre. It runs at the Phase 1 gate, where PR 9 will have
made it meaningful.

**New files:** `test/test_threePin.js`. **Modified:** `package.json`, `package-lock.json`,
`refactor.md` (this section).

### PR 9 — Convert `js/` → `src/` ES modules (mechanical, in dependency order) ✅ DONE
For each file, in `index.html` script order (leaves first):
1. `git mv` to its [§4.1](#41-target-directory-structure) destination.
2. Add `export` to each externally-used symbol; add `import` for each consumed one.
3. Delete `window.X = X` (all 4) and the `typeof module !== 'undefined'` CommonJS shims (62) — tests will import ESM after PR 31; until then keep the shim **only** where a currently-passing test needs it, and list those files.
4. Delete the 29 genuine `typeof X !== 'undefined'` guards as their imports become explicit.

**Workers — must be in this PR** ([§1.3](#13-web-workers-are-fetchblob-and-will-break-under-vite)):
```js
// replace fetch + Blob + new Worker(blobURL)
const worker = new Worker(new URL('./meshWorker.js', import.meta.url), { type: 'module' });
```
- Decide and record: does `workerGeneration.js` keep its dual-mode `globalScope` IIFE and main-thread inline fallback, or is the fallback deleted? Do not leave it ambiguous.
- Fix `textureAtlas.js` relative fetches ([§1.8](#18-textures-118-mb-3370-files-already-in-git)).
- `host.js` must now **import** `MESSAGE_TYPES` (it never defined it — [§3.5](#35-protocol-duplication--v1-was-half-wrong)).
- `index.html`: 64 script tags → one `<script type="module" src="/src/index.js">`.

- **Accept:** `npm test` still exits 0. Game plays identically: solo, host, join, creative, pause, settings. **Worlds created before this PR still load** (manual save/load test). Chunk generation and meshing both still run in workers (check DevTools → Sources → Threads).
- **Rollback:** this is the biggest PR in the plan. If it must be split, split by directory (`util/` → `world/` → `renderer/` → `systems/` → `multiplayer/` → `ui/` → `main.js` last) with a working game after each.

**Outcome (2026-07-30):** ✅ DONE, in one commit. 66 files moved out of `js/` into `src/`,
`js/three.min.js` deleted, `js/` gone. `index.html` went from 65 classic `<script src>`
tags plus the vendored Three bundle to **one** `<script type="module" src="/src/index.js">`.
368 top-level symbols became explicit exports and 62 CommonJS shims and all four
`window.X =` assignments were removed.

| Gate | Before (PR 8) | After (PR 9) |
|---|---|---|
| `npm test` | 52/52 + 4 quarantined, exit 0 | **52/52 + 4 quarantined, exit 0** |
| `node scripts/check-globals.js` | 0 duplicates / 65 files / 368 symbols | **69 modules / 1 module entry / 0 classic tags / 69 reachable, exit 0** (repointed — see below) |
| `npm run build` | exit 0, `dist/` did not run | **exit 0, and `dist/` runs** — 1.7 MB bundle + CSS + both workers as hashed assets |
| `npm run test:e2e` | 150 / 0 (served the working tree) | **152 / 0 (serves `dist/`)** |
| `npm run test:e2e:vite` | 150 / 0 | **152 / 0 — identical** |
| `QUARANTINE.md` | 4 files | 4 files |

**The two e2e hosts still agree, which is the whole point.** They agree on a *different*
pair than before: "built bundle" vs "dev server" instead of "raw source" vs "dev server",
because a raw static server can no longer serve this tree at all (see "staticServer" below).
That is a stronger pair, not a weaker one.

**Why the count moved 150 → 152.** One assertion was **removed**: `window.__THREE_LOAD_FAILED
is not set`. It read a flag set by an `onerror` attribute on the `js/three.min.js` script
tag, and both the tag and the file are gone — leaving it in place would have asserted that
a flag nobody can set was not set, which is the definition of a vacuous gate. Three were
**added**, and each is a real claim PR 9 made checkable for the first time:

- `window.__cuubz exists` — strictly stronger than the flag it replaces. `src/testBridge.js`
  is the first module the bundle evaluates, so the object cannot be there unless the whole
  graph parsed, resolved `three` and ran. The old flag only proved one `<script>` fetched.
- `Both worker pools initialised` — see "the workers" below. This is the assertion that
  stops a green run from being a lie.
- `navigator.hardwareConcurrency is readable` — the pools size themselves off it.

---

#### The e2e harness would have died here, and that is what §4.1 of `PR8_HANDOFF.md` was about

`test/e2e/saveLoad.js` reads roughly a third of its assertions out of the page by naming
**top-level lexical bindings** — `ChunkManager`, `CHUNK_MAGIC`, `BLOCK_REGISTRY`,
`PersistenceManager` and a dozen more. That works only because a top-level `const` in a
classic `<script>` is a global lexical binding ([§2.4](#24-the-mechanism-is-implicit-globals-not-window)).
In an ES module the identical `const` is module-scoped and unreachable from
`page.evaluate`, so every `DEPLOY.md` §2 storage invariant, the chunk-header decode, the
H-1 two-world regression test, the H-1 migration and PR 6d's `DB_VERSION` increment would
have stopped being runnable at exactly the PR whose entire claim is "identical game".

**Ruling (owner, BUGS.md decision 7): a test-only bridge.** `src/testBridge.js` imports the
symbols the harness needs and assigns them to **one** namespace object, `window.__cuubz`,
and is the first thing `src/index.js` imports. The harness destructures from it. The two
alternatives were rejected for stated reasons: dynamic `import()` inside `page.evaluate`
only resolves against the dev server, which would make the harness vite-only and contradict
[PR 7's ruling](#pr-7--vite-skeleton-no-source-changes--done) that a harness may not depend
on the thing it validates; and rewriting the assertions to hard-code the constants turns
checks that exist to catch a constant *changing* into tautologies.

It is a production file that exists for tests and that is a real cost. It is paid down in
Phase 2: **PR 12 puts a real `Game` on `window`, and this collapses into it.** The file's
header says so and §7 PR 12 carries the removal.

#### `check-globals.js` was repointed, not retired and not left vacuous

The gate parsed the `<script src>` list out of `index.html` and failed on duplicate
column-0 declarations across those 65 files. After this PR it would have scanned one file,
found zero symbols and exited 0 having checked nothing — a green gate that checks nothing
reads as coverage, which is worse than no gate. But retiring it belongs to PR 11, in the
same commit that turns on `no-undef` (the strictly stronger replacement), and deleting it
here would leave the intervening commits unguarded.

**Ruling (BUGS.md decision 11):** same job, asked of the structure that now exists. It
checks that `index.html` loads exactly one `<script type="module">` and **zero** classic
`<script src>` tags (a classic tag is the fastest way to undo this PR, and it would do so
silently); that nothing in `src/` assigns to `window.*` except the allowlisted
`src/testBridge.js`; that no `module.exports` / `typeof module` / `require(` survives in
`src/`; and that **every** module is reachable by import from `src/index.js`. That last one
is what found D-25. `test_globalCollisions.js` was updated in the same commit and asserts
the new output. **PR 11 deletes the script, its CI step and that assertion together.**

#### The workers: both pools still spawn, and there is now an assertion that says so

[§1.3](#13-web-workers-are-fetchblob-and-will-break-under-vite) is the section this PR
could most easily have broken quietly.

**`workerGeneration.js` keeps its triple contract, deliberately** — this is the explicit
statement §1.3 demands. It is still a self-contained IIFE taking `globalScope`; it is still
fetched and wrapped in a Blob for the worker; and it is still evaluated on the main thread
(now as a side-effect import from `src/index.js` rather than a `<script>` tag at
`index.html:523`) so that `window._voxelgenGenerateChunk` exists as the inline fallback.
**The fallback stays** (owner, BUGS.md decision 9): losing it means a browser that fails to
spawn a worker gets no terrain at all, and this PR is meant to be mechanical. The file's
body was moved byte-for-byte — it declares nothing at column 0, so it needed no exports and
got none.

**Neither worker became an ES module** (BUGS.md decision 14). §6 above suggests
`new Worker(new URL(…), { type: 'module' })`; `meshWorker.js` has no imports and gains
nothing from being a module, and `workerGeneration.js` *cannot* be one while decision 9
holds. What changed is only the paths, which were hard-coded `js/…` strings that Vite could
not see:

```js
import meshWorkerUrl       from '../renderer/meshWorker.js?url';
import workerGenerationUrl from './workerGeneration.js?url';
```

`?url` makes both build-time asset references: resolved in dev, emitted as content-hashed
standalone assets on build (`dist/assets/meshWorker-*.js`, `dist/assets/workerGeneration-*.js`).
The `fetch` + Blob construction and its `try`/`catch` are untouched.

**And that `catch` is why there is a new assertion.** Both pools fall back to main-thread
generation and only `console.warn` on failure — so a broken worker URL produces a game that
still generates terrain, still passes every storage assertion in the harness, and is
silently single-threaded. The accept criterion for this PR was *"check DevTools → Sources →
Threads"*, which is not a gate. `saveLoad.js` now collects
`[ChunkManager] … worker pool init failed` and asserts it never fires, on both hosts.

#### `npm test` could not have survived step 3 as written, and this is what replaced it

Step 3 above says to keep the `typeof module !== 'undefined'` shim "only where a currently-
passing test needs it". **That is not possible.** Once a file contains `import` or `export`,
`require()` refuses to compile it — `SyntaxError: Cannot use import statement outside a
module` — before any shim inside it can run. 35 test files require 30-odd source files;
without something, this PR takes `npm test` from 52/52 to about 17/52.

**Ruling (BUGS.md decision 12): a `require` hook.** `test/helpers/esmRequire.js` compiles
`src/**` as CommonJS on the fly, installed by `test/run_tests.sh` through `node -r`. The
alternatives were larger than the conversion itself: `"type": "module"` at the repo root
converts `server/`, all 56 test files and both `scripts/` as collateral; rewriting 35 test
files onto `await import()` means making every one of them async, which is PR 31/32's job
done properly and once. The hook's header carries the full reasoning, including why a regex
transform is defensible here and not in `scripts/generate-manifest.js` (§1.9): it only ever
sees the uniform syntax this PR's codemod generates, and anything outside that shape is a
hard error naming the file and line, not a silent miss. **All 62 shims are gone.** PR 31
deletes the hook — logged as **D-28**.

#### `staticServer.js` serves `dist/` now, and that closes D-24

A raw static server cannot serve this tree any more: `index.html` loads one ES module whose
graph contains bare specifiers (`import * as THREE from 'three'`), which nothing but a
bundler or an import map can resolve. **Ruling (BUGS.md decision 13):** the baseline host
serves the **built** output, with a fallback to the repo root for `textures/` (because
`publicDir` is deliberately `false` — [§1.8](#18-textures-118-mb-3370-files-already-in-git)
— so `dist/` has no textures). `npm run test:e2e` runs `npm run build` first.

That is a better baseline than the one it replaces. **D-24 is closed by measurement**: "the
build exits 0" and "the build output runs" used to be different claims with only the first
one checked, and the second is now a 152-assertion gate against the exact artifact PR 10
deploys. The texture half of D-24 was never PR 9's and stays with PR 10 — the fallback here
mirrors the topology that PR has to build on the host (bundle per release, textures once).

#### Three real bugs, found because the module graph is the first thing that could see them

- **D-26 — `SurvivalSystem` ↔ `DamageSystem` was a fatal import cycle.** `survival.js`
  declared `DAMAGE_SOURCES` and called `calculateFallDamage`; `damageSystem.js` read
  `DAMAGE_SOURCES` as a computed key **at module top level**. As classic scripts that worked
  because `index.html` loaded survival first into one shared scope; under `require()` it
  worked because damageSystem carried a shim that pulled the table off `require('./survival')`
  first. Real ES modules have neither crutch: whichever side evaluates first pulls in the
  other, which reads a `const` in its temporal dead zone —
  `ReferenceError: Cannot access 'DAMAGE_SOURCES' before initialization`, at load, in the
  browser, on the first page view (`mobIntegration.js` imports from the survival side).
  **Fixed here** by extracting the table to `src/game/data/DamageSources.js`, a leaf module
  both import; reordering was not an option because import order is not something a module
  graph lets you control. Both files re-export it, so no call site or test changed. §4.1
  already puts data tables under `src/game/data/`.
- **D-25 — twelve of the 65 files are referenced by nothing.** Computing reachability from
  `src/index.js` is what surfaced it: `main.js` never names `AmbientManager`, `SoundManager`,
  `SurvivalSystem`, `DamageSystem`, `QuestSystem`, `SpawnManager`, `Crosshair`, `Boss`,
  `QuestMarker`, `PerformanceOptimizer`, `pathfinding` or the main-thread `Noise`. **The
  entire audio subsystem is 1,791 lines that are never instantiated** — the game is silent
  by construction — and survival meters, environmental damage, quests and boss fights are in
  the same state. As classic scripts nothing distinguished them from live code. They are kept
  in the graph with explicit side-effect imports in `src/index.js`, with the reasoning in a
  comment, because deleting 6,000 lines is not a mechanical conversion and because dropping
  them silently would be a behaviour change smuggled into this PR. **PR 20** owns wiring or
  deleting each one; the list is in §9 PR 20.
- **D-27 — the 29 `typeof X !== 'undefined'` guards are constant-`true` now**, and one was
  hiding a null dereference: `Skybox.init()` short-circuited on `typeof THREE === 'undefined'`
  in Node and so never evaluated `!this.renderer.scene`. In the browser nothing changes —
  THREE was always defined there, so the second half already ran — but the null check was
  always missing. Guard added here; `test_skybox.js` found it within a minute of the tests
  going green. Removing the other 28 is PR 11's, and note that `no-undef` will *not* flag
  them: they are syntactically fine, so it is a grep-and-delete pass.

#### The rest of the checklist

- **`host.js` imports `MESSAGE_TYPES`** ([§3.5](#35-protocol-duplication--v1-was-half-wrong)) —
  `import { MESSAGE_TYPES } from './Client.js'`. It never declared it. `shared/protocol.js`
  is still PR 30's.
- **`textureAtlas.js`'s relative fetches** ([§1.8](#18-textures-118-mb-3370-files-already-in-git))
  are absolute: `/textures/blocks/…`. `ItemTextureAtlas.js` had the same bug and got the same
  fix. A leading `/` rather than `import.meta.env.BASE_URL` (BUGS.md decision 15) — the deploy
  target serves from the web root and `base` is `/`, while `import.meta.env` is a Vite-only
  global that would break the moment a Node test imports one of these files.
- **`THREE` comes from the pinned package.** Every renderer file does
  `import * as THREE from 'three'`; `js/three.min.js` is deleted. `test/test_threePin.js` was
  repointed in the same commit rather than deleted — it now reads the revision out of
  `node_modules/three`'s declared `module` entry, which is the copy the browser actually
  executes, and asserts the vendored bundle is *gone*. Same claim, aimed at the file it is now
  true of. It also learned to read the unminified `const REVISION = '134'` form.
- **`main.js` → `src/main.js`, not `src/index.js`.** §13 empties `main.js` into `src/ui/`,
  `src/core/Game.js` and the systems across Phase 3; `src/index.js` is the <50-line bootstrap
  §4.1 describes, and today it is the bridge, the twelve orphans and `import './main.js'`.
  `new CuubzGame()` in `main.js` is now `import { Game as CuubzGame } from './core/Game.js'` —
  the alias keeps the call site byte-identical while the binding becomes an ordinary import.
- **`scripts/generate-manifest.js`** points at `src/engine/world/BlockRegistry.js`. Its regex
  (§1.9) still matches `export const BLOCK_REGISTRY = [`, and `test_manifestGenerator.js`
  proves it.
- **`DEPLOY.md` and `README.md` were path-swept** in this commit because they describe the
  live system; the §2 invariant *values* are unchanged and the §2.1 line numbers were re-read
  after the move. Five feature-planning docs still cite `js/…` — **D-29**, PR 11.

**Not done here, deliberately:** `minify` stays `false` (an unminified bundle keeps a stack
trace legible while "identical game" is being checked; PR 10 owns the call now that `dist/`
is what ships); the 28 remaining vacuous `typeof` guards (D-27, PR 11); the twelve unwired
subsystems (D-25, PR 20); `shared/protocol.js` (PR 30); splitting `ChunkManager.js` (PR 23),
`InventorySystem.js` (PR 24) and `SkyRenderer.js` (PR 25) — each moved whole to its §4.1
destination.

**⚠️ PR 10 has NOT landed with this commit.** `sync.sh` still carries `--exclude='dist'`, so
the next `./sync.sh` uploads everything except the only directory that now contains the
application and serves a black page. **Do not deploy.** That is **D-4** and `DEPLOY.md` §4.3
now says so in the imperative rather than the conditional.

**New files:** `src/index.js`, `src/testBridge.js`, `src/game/data/DamageSources.js`,
`test/helpers/esmRequire.js`. **Deleted:** `js/three.min.js`, and `js/` with it.
**Moved:** 66 files (see [§4.1](#41-target-directory-structure)). **Modified:** `index.html`,
`vite.config.js`, `package.json` (`test:e2e` builds first), `scripts/check-globals.js`
(rewritten), `scripts/generate-manifest.js`, `test/run_tests.sh`, `test/e2e/staticServer.js`,
`test/e2e/saveLoad.js`, 37 test files (require paths, plus the five noted above),
`.github/workflows/ci.yml`, `BUGS.md`, `DEPLOY.md`, `README.md`, `refactor.md` (this section).


### PR 10 — Fix deployment (**must land with PR 9, not after**)

> **⛔ PR 9 HAS LANDED AND THIS HAS NOT. THE REPO CANNOT BE DEPLOYED RIGHT NOW.**
> `index.html` loads one module out of a bundle that only exists in `dist/`, and
> `sync.sh:30` still says `--exclude='dist'`. The next `./sync.sh` uploads everything
> except the application and serves a black page. That is **D-4**, now live rather than
> predicted. `DEPLOY.md` §4.3 carries the operational rule.

- Rewrite `sync.sh`: run `npm run build`, then ship `dist/` + `server/` + `textures/` (**stop excluding `dist/`**).
- Decide whether `textures/` ships separately (118 MB per deploy is slow — consider rsync or a one-time upload).
  **PR 9 made this concrete rather than theoretical:** `publicDir` is `false`, so `dist/`
  contains no textures at all and something has to put them on the host. `test/e2e/staticServer.js`
  models the intended answer — serve `dist/` and fall back to a separately-uploaded
  `textures/` — and is a working reference for the topology.
- Verify `cuubz-relay.service`'s `WorkingDirectory=/var/www/html/server` still resolves; update the unit if the layout moved.
- Document the restart + rollback procedure.
- **`tar xzf` never deletes (D-5) is now realised, not latent.** PR 9 removed all 66 files
  under `js/` plus `js/three.min.js`; none of them will leave the host on their own, and the
  host will serve a complete dead copy of the pre-PR-9 codebase alongside the live one.
  Whatever replaces `tar xzf` has to delete.
- **Decide `minify`.** `vite.config.js` keeps `minify: false` (1.7 MB raw / 353 kB gzipped)
  because an unminified bundle keeps a stack trace legible while PR 9's "identical game"
  claim is being checked. PR 10 is the PR that starts shipping the artifact, so it owns the
  call. Whichever way it goes, both e2e hosts run against the real output, so it is
  verifiable rather than assumed.
- **Accept:** deploy to `10.0.30.160`, load the site in a browser, **JS actually loads**, multiplayer relay connects.
- **Rollback:** keep the old `sync.sh` as `sync-legacy.sh` for one release cycle.

### PR 11 — Lint + format
```bash
npm i -D eslint prettier
```
- **`eslint.config.js` (flat config)** — ESLint 9+ ignores `.eslintrc.cjs`. v1 got this wrong.
```js
export default [
  { files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-unused-vars': 'warn', 'no-undef': 'error' } },
];
```
- `.prettierrc`: `{ "semi": true, "singleQuote": true, "trailingComma": "es5", "printWidth": 120 }`
- Add `lint` / `format` scripts; wire `lint` into CI.
- **`no-undef` is the payoff:** with modules, every leftover implicit global becomes a lint error. Fix them; do not disable the rule.
- **Delete `scripts/check-globals.js` and its CI step in the same commit that turns
  `no-undef` on.** PR 9 repointed the script at the module boundary rather than let it go
  vacuous (owner ruling, `BUGS.md` decision 8 / 11) — it now checks that `index.html` has one
  module entry and zero classic script tags, that nothing in `src/` assigns to `window.*`
  outside `src/testBridge.js`, that no CommonJS survives, and that every module is reachable
  from `src/index.js`. `no-undef` subsumes the parts that matter. Remove the script, the CI
  step, and the block in `test/test_globalCollisions.js` that asserts its output, together.
  Do not leave it standing as a step that checks less than the linter does.
- **D-27 — remove the 28 remaining `typeof X !== 'undefined'` cross-module guards.** With the
  symbols imported these are constant-`true` and read as protection they do not provide; §14
  names the pattern as an anti-pattern. **`no-undef` will not flag them** — they are
  syntactically valid — so this is a deliberate grep-and-delete pass, not a free side effect
  of turning the linter on. Watch for the shape PR 9 hit in `Skybox.init()`, where the guard
  was short-circuiting a null dereference that nothing else checked.
- **D-29 — path-sweep the five planning docs** that still cite `js/…`: `IMPLEMENTATION_PLAN.md`,
  `multiplayer.md`, `MOB_PLAN.md`, `performance.md`, `CRAFTING_PLAN.md`. `DEPLOY.md` and
  `README.md` were done in PR 9; the `PR*_HANDOFF.md` files are dated records and stay as they
  are.
- **D-22 — narrow `on: push` to `branches: [main]`** now that `main` is moving again. PR 7 and
  PR 9 both left it alone deliberately; this is the PR that gets to make the call.
- **Accept:** `npm run lint` exits 0. CI runs test + lint + build.

### Phase 1 gate

Tick a box only if you ran the thing — the rule PR 6d established for the Phase 0 gate
(`BUGS.md` decision 2). Four are closed by PR 9.

- [ ] `npm run dev`, `npm run build`, `npm test`, `npm run lint` all pass
      — three of the four are green at PR 9 (`npm test` 52/52 + 4 quarantined,
      `npm run build` exit 0, `npm run dev` serves 152/152 via `test:e2e:vite`).
      `npm run lint` does not exist until PR 11.
- [x] `three` pinned to exactly `0.134.0`; no visual change (compare screenshots against the tag)
      — pin enforced by `test/test_threePin.js` (10 assertions, in CI), which since PR 9
      reads the revision out of the package's declared `module` entry, the copy the browser
      now executes. `THREE.REVISION === '134'` asserted from the running browser on both e2e
      hosts. **Screenshots are self-comparison only** — SwiftShader is not a GPU, so six
      artifacts under `test/e2e/artifacts/` establish "this run looks like the last run",
      not "the game looks right on real hardware".
- [x] Both worker pools still run off-main-thread
      — `npm run test:e2e` and `npm run test:e2e:vite` both assert that
      `[ChunkManager] … worker pool init failed` never appears. Added in PR 9 because the
      fallback is silent: a broken worker URL gives you a working, single-threaded game that
      passes every other assertion.
- [ ] Deploy works end to end and serves real JS
      — **blocked on PR 10, and currently FALSE** (D-4). Needs SSH to `10.0.30.160`.
- [x] Pre-refactor worlds load; blocks persist across reload
      — the terrain round trip, the two-world H-1 regression test and the H-1 migration all
      pass byte-for-byte on both hosts after the conversion; `DB_NAME`, `DB_VERSION`, both
      store key formats and the chunk binary header are unchanged and asserted from the page.
      **Caveat, same as Phase 0's:** the harness never places or breaks a block (pointer lock
      — PR 12–13), so "blocks persist" is proved for *generated* terrain, not for player edits.
- [ ] Multiplayer host + join + block sync verified with two browsers
      — still manual, still unautomated. `DEPLOY.md` §7 steps 12–13.

---

## 7. Phase 2 — Hoist Closure State onto `Game` (PR 12–13)

> **Deliverable:** `renderLoop` reads state from an object, not from ~184 closure locals. **No files split yet.**
>
> This phase does not exist in v1. Without it, Phase 3 is impossible ([§1.6](#16-renderloop-cannot-be-extracted-as-written)).

### PR 12 — Introduce `GameState` and migrate the render-loop locals
- Create `src/core/GameState.js` (shape in [§4.2](#42-key-patterns)).
- Inside `startGame()`, create one `state` object and reassign the locals that `renderLoop` closes over onto it: `renderer, chunkManager, player, inventory, skybox, biomeEffects, blockInteraction, chunkStreamer, playerSync, droppedItems, firstPersonHand, itemAtlas`, + the rest.
- Rewrite `renderLoop` to read `state.x` everywhere. Keep it in the same file at this point.
- Fold the ad-hoc props in: `game.frameCount`, `game.attackCooldown`, `game._shadowMissingCount`, `game._noPbrCount`.
- **Accept:** `renderLoop`'s body references **no** function-scoped locals from `startGame` — verifiable by moving `renderLoop` to module top-level in the same file with only `state` passed in. Gameplay identical.

### PR 13 — Un-nest `startGame`
- Remove the `setTimeout(async () => { try { ... } })` wrapper; convert to a plain `async function` with real `await` and a top-level error handler.
- Dedent — ~1,845 lines currently sit at ≥10 spaces.
- Split the body into numbered private steps (still in `main.js`) matching the `Game.init()` order in [§8.4](#84-pr-17--startgame--srccoregamejs).
- **Accept:** max indentation in `main.js` under 8 spaces. Load-order-sensitive init still works (texture atlas before mesh build, chunk manager before player spawn).

---

## 8. Phase 3 — Decompose main.js (PR 14–19)

> **Deliverable:** `main.js` deleted, contents distributed. Feature parity.

### 8.1 PR 14 — Reconcile the duplicate managers (do this first)
Decide, per [§3.4](#34-duplicate-managers--decide-before-touching-them):
- **Option A (preferred):** make `main.js` use the tested `js/entities/characterManager.js` / `worldManager.js`, delete `BrowserCharacterManager` / `BrowserWorldManager`, port any browser-only behavior across.
- **Option B:** delete the untested standalone files **and their tests**, promote the `Browser*` classes.

Record the choice and the reason. Do not merge both silently.
- **Accept:** exactly one `CharacterManager` and one `WorldManager` in the tree, both covered by tests, character and world CRUD verified in the browser.

### 8.2 PR 15 — Extract the UI layer

| From `main.js` (grep the symbol) | Target |
|---|---|
| `screens` / `modals` / `sessionUI` objects, `showScreen()` | `src/ui/UIManager.js` |
| `renderCharacterSlots`, `createCharacterSlotElement`, `openCreateModal`, `openEditModal`, `closeCharModal` | `src/ui/screens/CharacterScreen.js` |
| `renderWorldSlots` (L606), `createWorldSlotElement`, `openCreateWorldModal`, `closeCreateWorldModal`, `openDeleteModal` | `src/ui/screens/WorldScreen.js` |
| Host lobby tabs, browse panel | `src/ui/screens/LobbyScreen.js` |
| Settings wiring | `src/ui/screens/SettingsScreen.js` |
| `initMenuNavigation` (L804) | `src/ui/UIManager.js` + per-screen handlers |
| `escapeHtml` | `src/util/HTMLUtils.js` |

Screen pattern:
```js
export class CharacterScreen {
  constructor(uiManager) {
    this.uiManager = uiManager;
    this.element = document.getElementById('character-screen'); // existing HTML for now
  }
  show() { this.element.classList.remove('hidden'); this.render(); }
  hide() { this.element.classList.add('hidden'); }
  render() { /* populate slots */ }
}
```
- **Accept:** menu → character → world → mode → game navigates correctly; all modals open/close; no screen file over 400 lines.

### 8.3 PR 16 — Extract `SessionManager`
`class SessionManager` (L1723), `REJOIN_STORAGE_KEY` (L1593), the rejoin panel, `updateConnectionStatus`, and the 5 `cuubz_last_session` write sites → `src/multiplayer/SessionManager.js`. Route localStorage through `src/util/StorageHelper.js`; **the key string does not change** ([§1.5](#15-player-data-must-survive-byte-for-byte)).
- **Accept:** host a session, close the tab, reopen → rejoin prompt appears and works.

### 8.4 PR 17 — `startGame()` → `src/core/Game.js`
`core/Game.js` is a **rewrite**; `js/game.js` (280 lines, stub) is absorbed or deleted, along with its `new CuubzGame()` call site (`main.js:2569`).

```js
class Game {
  async init(config) {
    // 1 hide screens / show loading      9 multiplayer (host or client)
    // 2 renderer                        10 first-person hand
    // 3 input                            11 mob system
    // 4 texture atlas                    12 inventory + systems
    // 5 PBR + shadows                    13 block interaction
    // 6 skybox                           14 HUD
    // 7 chunk manager                    15 start render loop
    // 8 player at spawn
  }
}
```
Each step is one private method or a system's `init()`. Preserve the existing ordering exactly — it is load-order sensitive.
- **Accept:** solo and multiplayer both start; saved spawn restore works; loading screen sequence unchanged.

### 8.5 PR 18 — `RenderLoop` + `SystemRunner`
```js
export class RenderLoop {
  constructor(game) { this.game = game; this.rafId = null; }
  start() {
    const loop = (t) => {
      this.rafId = requestAnimationFrame(loop);
      if (!this.game.state.isRunning) return;
      if (this.game.state.isPaused) { this.game.renderer.render(); return; }
      this.game.tick(t);
    };
    this.rafId = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.rafId); }
}
```
```js
const SYSTEM_ORDER = ['inputManager','blockInteraction','player','mobSystem','droppedItems',
  'playerSync','chunkStreamer','skybox','biomeEffects','survivalSystem','questSystem','hud'];
```
> **Ordering is behavior.** Derive `SYSTEM_ORDER` from the actual call order in the current `renderLoop` body, not from this list. Verify against the pre-refactor code.
- **Accept:** the loop function is under 30 lines. Frame-rate and gameplay feel unchanged; check `updateDebugStats` FPS against the tag.

### 8.6 PR 19 — Pause menu, debug stats, bootstrap; delete `main.js`
- `setupPauseMenu` (L4428) → `src/ui/overlays/PauseMenu.js` (owns its own listener setup/teardown).
- `updateDebugStats` (L4394) → `src/ui/hud/DebugStats.js`.
- Mobile detection, auto-rejoin, `beforeunload`, init trigger → `src/index.js` + `SessionManager`.
- Delete `js/main.js`.
- **Accept:** `js/main.js` gone. `src/index.js` under 50 lines. Every extracted file under 400 lines. Escape → pause → resume/exit/settings all work.

### Phase 3 gate
- [ ] `main.js` deleted
- [ ] `src/index.js` < 50 lines; no extracted file > 400 lines
- [ ] Zero `typeof X !== 'undefined'` in `src/` (`no-undef` clean)
- [ ] Solo, host, join, creative, pause, settings, save/load all verified manually
- [ ] `npm test && npm run lint && npm run build` green; deploy verified

---

## 9. Phase 4 — Systems, EventBus, Split Monoliths (PR 20–25)

### PR 20 — `System` base class
`src/game/systems/System.js` per [§4.2](#42-key-patterns). Convert systems one at a time; `SystemRunner` drops its special cases.

**PR 20 also owns D-25 — the twelve modules nothing references.** PR 9 computed the import
graph for the first time and found that twelve of the 65 former `<script>` files are not
reached from `main.js` at all. They were fetched, parsed and evaluated on every page load
and then did nothing. `src/index.js` keeps them in the graph with explicit side-effect
imports so PR 9 stayed mechanical; **this is the PR where each one is either wired to a
real `System` or deleted, and its line in `src/index.js` goes with it.**

| Module | Lines | State |
|---|---|---|
| `src/engine/audio/AmbientAudio.js` | 1,170 | `AmbientManager` never instantiated — **the game has no ambient audio** |
| `src/engine/audio/SFX.js` | 621 | `SoundManager` never instantiated — **no sound effects either** |
| `src/game/systems/SurvivalSystem.js` | 1,160 | Reachable only via `mobIntegration`'s use of `DAMAGE_SOURCES`; the meters, hunger, thirst and death handling are unwired. **D-21 lives here** and stays owned by PR 22 |
| `src/game/systems/DamageSystem.js` | — | Environmental/fall/boss damage, unwired |
| `src/game/systems/QuestSystem.js` | — | Unwired; `QuestMarker.js` is unwired with it |
| `src/game/entities/Boss.js` | 1,152 | Unwired. PR 3 fixed `getBossDefinition` colliding with `damageSystem.js`'s — a live bug in code nothing calls |
| `src/game/entities/QuestMarker.js` | — | Unwired |
| `src/engine/world/SpawnManager.js` | — | Unwired; `main.js` computes spawn itself |
| `src/engine/renderer/PerformanceOptimizer.js` | — | Unwired. PR 3's `isMobileViewport` collision was here too |
| `src/ui/hud/Crosshair.js` | — | Unwired; the crosshair is a DOM overlay in `index.html` |
| `src/game/mobs/ai/pathfinding.js` | — | Unwired even from `mobAI.js` |
| `src/engine/world/Noise.js` | — | The main-thread copy. `workerGeneration.js` carries its own; nothing on the main thread calls this one |

Deciding *wire vs delete* per module is this PR's job and each choice needs a line in the
outcome. "Wire it up" is not automatically right — an unwired subsystem that has never run
in production is untested by definition, and turning six of them on at once is not a
mechanical change either.

### PR 21 — `EventBus`
```js
class EventBus {
  constructor() { this._listeners = new Map(); }
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(cb);
    return () => this.off(event, cb);
  }
  off(event, cb) { /* ... */ }
  emit(event, data) { (this._listeners.get(event) || []).forEach(cb => cb(data)); }
}
export const eventBus = new EventBus();
```

| Event | Emitter | Consumers |
|---|---|---|
| `block:broken` | BlockInteraction | ChunkManager, Client, DroppedItems |
| `block:placed` | BlockInteraction | ChunkManager, Client |
| `player:moved` | Player | Client, PlayerSync, ChunkStreamer, HUD |
| `player:damaged` | SurvivalSystem | HUD (flash), Client |
| `mob:died` | MobManager | DroppedItems, QuestSystem, HUD |
| `inventory:changed` | InventorySystem | Hotbar, InventorySync |
| `gamemode:changed` | Game | Player, HUD, BlockInteraction |
| `daynight:changed` | TimeOfDaySystem | Renderer (fog), HUD, Client |

- **Beware ordering:** `forEach` is synchronous and registration-ordered. Anywhere the old inline code depended on "chunk update happens before network send", assert it in a test.
- **Accept:** each migrated path has a unit test; no `if (sessionManager && ...)` chains left in gameplay code.

### PR 22 — Move cross-cutting logic out of the loop
These currently run inline in `renderLoop`; each moves into its own system's `update(dt)` with its own frame counter:
multiplayer movement sync (`frameCount % 3`) · touch look delta · fly-mode indicator · HUD armor (`% 10`) · debug stats · day/night + PBR update · biome effects · mob attack via mouse · multiplayer time sync (`% 30`) · block-change network send · hotbar UI (`% 5`) · the periodic-save `setInterval`.
- **Accept:** `renderLoop` calls only `SystemRunner.update(dt)` and `renderer.render()`.

### PR 23 — Split `chunkmanager.js` (1,664 → 5 files)

| Responsibility | File | ~Lines |
|---|---|---|
| Worker pool | `src/engine/world/WorkerPool.js` | 80 |
| Memory cache | `src/engine/world/ChunkCache.js` | 100 |
| IndexedDB + `flushDirtyChunks` + `startFlushTimer` | `src/engine/world/ChunkStorage.js` | 200 |
| `checkRegion` / `startRegionCheck` | `src/engine/world/RegionTracker.js` | 150 |
| `renderChunks`, `loadedMeshes`, `updateRenderChunks`, public API (`getVoxel`, `applyBlockChange`) | `src/engine/world/ChunkManager.js` | 300 |

- **Highest data-loss risk in the plan.** `DB_NAME`/`DB_VERSION` must not change; the `onupgradeneeded` path must behave identically. Run the save/load test before and after, and test with a **pre-existing** v2 database.

### PR 24 — Split `inventory.js` (1,048) + dedupe the face table

| From | To |
|---|---|
| `ITEM_CATEGORIES`, `MAX_STACKS`, `NAMED_ITEMS` | `src/game/data/ItemDefinitions.js` |
| `Inventory` (slots, add, remove, stack, serialize), `getAttackDamage()` | `src/game/systems/InventorySystem.js` |
| `EQUIPMENT_SLOTS`, `getEquipmentSlotForItem`, `equipItem`, `unequipItem`, `getEquipmentStats`, `getArmorValue`, `getArmorToughness` | `src/game/systems/EquipmentSystem.js` |
| `hotbarSlotIndex`, `selectByNumber`, `cycleSelection` | `src/ui/hud/Hotbar.js` |

Also: unify `FACES` (`meshWorker.js:36`) with the `sides` table (`chunkMeshBuilder.js:371`) into `src/game/data/FaceTable.js` ([§3.5](#35-protocol-duplication--v1-was-half-wrong)). Worker imports must stay worker-safe (no THREE, no DOM).
- **Accept:** inventory serialization round-trips existing saves; meshes render identically (screenshot diff).

### PR 25 — Split `skybox.js` (1,031) and finish mobs
- Extract the day/night cycle → `src/game/systems/TimeOfDaySystem.js`; keep rendering in `SkyRenderer.js`.
- Resolve the `test_skybox` fog-density discrepancy from PR 4 if still open.
- Unpark `js/mobs/` if it was parked in PR 1: move to `src/game/mobs/`, wrap in `MobSystem`, and either work through `MOB_PLAN.md` or freeze it with the remaining 253 items documented as out of scope.

---

## 10. Phase 5 — UI / HTML / CSS (PR 26–29)

### PR 26 — Slim `index.html` **and** fix the source-text tests in the same PR
Target:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Cuubz — Voxel Survival</title>
  <link rel="stylesheet" href="/src/ui/css/index.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/index.js"></script>
</body>
</html>
```
Phased approach: keep the DOM structure but move each screen's markup into a template imported by its screen module, so CSS selectors keep matching. Also remove the **24 inline `style="` attributes** — v1's "no inline styles" goal never accounted for them.

**In this same PR**, rewrite or delete `test_responsiveHUD`, `test_mobileViewports`, `test_pageLoad`, `test_textureAssets`, `test_textureGenerator`, `test_chunkBinaryCodec` — they `readFileSync` the HTML/CSS and will break ([§3.6](#36-source-text-tests-conflict-with-phase-5)). Prefer real jsdom DOM assertions; delete anything that only asserts a CSS string exists.
- **Accept:** `index.html` under 80 lines; `npm test` green; all screens render; mobile touch controls work.

### PR 27 — Reorganize CSS
Split `css/style.css` (~2,100 lines) into `src/ui/css/`:
```
reset.css  variables.css  layout.css
components/{buttons,modals,meters,hotbar,inventory,crafting,settings,lobby,slots,touch-controls}.css
hud/{meters,crosshair,debug-stats,quest-tracker}.css
screen/{main-menu,character,world,loading}.css
```
Add design tokens:
```css
:root {
  --color-bg:#1a1a2e; --color-text:#e0e0e0; --color-primary:#4CAF50;
  --color-danger:#e74c3c; --color-muted:#555;
  --spacing-xs:4px; --spacing-sm:8px; --spacing-md:16px; --spacing-lg:24px;
  --radius-sm:4px; --radius-md:8px; --font-mono:'Courier New', monospace;
}
```
Import CSS from the module that uses it (`import '../css/components/buttons.css'`).
- **Accept:** visual diff against the Phase 0 tag on desktop **and** mobile viewport. Extract token values from the existing CSS; don't invent colors.

### PR 28 — HUD components
`src/ui/hud/*` — each element owns its DOM and subscribes to EventBus instead of being poked from the loop.

### PR 29 — Overlay components
`InventoryScreen`, `CraftingScreen`, `PauseMenu`, `EquipmentPanel` — each owns show/hide and listener lifecycle.

---

## 11. Phase 6 — Shared Protocol & Test Migration (PR 30–33)

### PR 30 — `shared/protocol.js`
`MESSAGE_TYPES` currently lives in `js/multiplayer/client.js:40` and `server/session.js:30`, and is *used* undefined in `host.js`. One source of truth:
```js
// vite.config.js
resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } }
```
`server/` is CommonJS — either publish `shared/protocol.js` as dual CJS/ESM, or keep it CJS and let Vite consume it. **Pick one and write it down.**
- **Accept:** a test asserts client and server `MESSAGE_TYPES` are deep-equal. Two-browser multiplayer session still works.

### PR 31 — Vitest
```bash
npm i -D vitest
```
```js
// vitest.config.js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['test/**/*.test.js'] } });
```
Migrate incrementally: run the legacy `bash test/run_tests.sh` **and** `vitest` side by side in CI until the last file is converted. Do not big-bang this.
- **Accept:** both runners green; `npm test` runs Vitest; `test/QUARANTINE.md` is empty or has a documented owner per entry.

### PR 32 — Restructure tests + automate the data test
```
test/
├── helpers/setup.js
├── unit/{core,engine,game,ui}/
├── integration/{gameLoop,multiplayerSync,worldPersistence}.test.js
└── e2e/                     # future: Playwright
```
Automate the [§1.5](#15-player-data-must-survive-byte-for-byte) save/load check as `integration/worldPersistence.test.js` using `fake-indexeddb`, seeded with a **pre-refactor v2** database dump.

### PR 33 — Remove CommonJS shims and final cleanup
Delete the remaining `typeof module !== 'undefined'` blocks (62 at the start) now that tests import ESM. Final gate: `npm run dev`, `npm run build`, `npm test`, `npm run lint`, `./sync.sh` all pass.

---

## 12. Deferred: Three.js Upgrade (separate project)

Do not attempt during this refactor. When it happens:
1. Establish screenshot baselines first — day, night, underwater, cave, each biome, shadows on/off, mobile.
2. Read the r134 → target migration guides in sequence; the color-management break (r152) is the big one.
3. Set `outputColorSpace` / `useLegacyLights` explicitly to reproduce r134 behavior, then migrate deliberately.
4. Rewrite `pbrShader.js`'s 7 `ShaderMaterial` variants against the new fog and shadow uniform includes.
5. Diff every screenshot. Any pixel change must be explained, not accepted.

Confirmed non-blockers: workers use no THREE; no removed APIs are referenced.

---

## 13. File Migration Map

`main.js` → targets, **by symbol** (line numbers drift; see [§3.3](#33-real-symbol-landmarks-in-mainjs) for current values):

| Symbol / region | Target |
|---|---|
| IIFE open, logger init | `src/index.js` |
| `screens`, `modals`, `sessionUI`, `showScreen` | `src/ui/UIManager.js` |
| `BrowserCharacterManager` | **RECONCILE** → `src/game/entities/CharacterManager.js` (PR 14) |
| `BrowserWorldManager` | **RECONCILE** → `src/game/entities/WorldManager.js` (PR 14) |
| Top-level `let` declarations | Eliminated → `GameState` |
| `renderCharacterSlots`, `createCharacterSlotElement`, char modals | `src/ui/screens/CharacterScreen.js` |
| `escapeHtml` | `src/util/HTMLUtils.js` |
| `renderWorldSlots`, `createWorldSlotElement`, world modals | `src/ui/screens/WorldScreen.js` |
| `initMenuNavigation` | `src/ui/UIManager.js` + per-screen |
| `REJOIN_STORAGE_KEY`, `SessionManager`, rejoin panel, `updateConnectionStatus` | `src/multiplayer/SessionManager.js` |
| `init()` DOM/event/settings wiring | `src/index.js` + `src/ui/screens/*` |
| `startGame()` steps 1–15 | `src/core/Game.js` |
| `new CuubzGame()` + `js/game.js` | Absorbed; `core/Game.js` is a **rewrite** |
| Hotbar update, inventory toggle, crafting screen | `src/ui/hud/Hotbar.js`, `src/ui/overlays/*` |
| Damage/quest/creative/sound wiring | respective system files |
| Keyboard shortcuts, mouse wheel | `src/engine/input/InputManager.js` |
| Periodic save `setInterval` | `src/engine/world/ChunkStorage.js` |
| `renderLoop` | `src/engine/loop/RenderLoop.js` + `SystemRunner.js` |
| `updateDebugStats` | `src/ui/hud/DebugStats.js` |
| `setupPauseMenu`, `onExit` | `src/ui/overlays/PauseMenu.js` |
| Mobile detection, auto-rejoin, `beforeunload` | `src/index.js` + `SessionManager.js` |

`chunkmanager.js` → [PR 23](#pr-23--split-chunkmanagerjs-1664--5-files). `inventory.js` → [PR 24](#pr-24--split-inventoryjs-1048--dedupe-the-face-table). Everything else → [§4.1](#41-target-directory-structure).

---

## 14. Anti-Patterns

- ❌ **Don't skip Phase 0.** A red suite means you cannot prove parity. This is the whole reason v1 was rejected.
- ❌ **Don't run bare `npm install three`.** Pin `0.134.0`. See [§1.2](#12-pin-three01340-do-not-run-npm-install-three).
- ❌ **Don't change `DB_NAME`, `DB_VERSION`, `'cuubz:settings'`, or `'cuubz_last_session'`.** Players lose worlds.
- ❌ **Don't merge the module switch without the deploy fix.** `sync.sh` excludes `dist/`; you'd ship a site with no JS.
- ❌ **Don't extract `renderLoop` before hoisting its 184 closure locals.**
- ❌ **Don't `cp -r textures/`.** 118 MB, already in git. `git mv` or leave it.
- ❌ **Don't use `.eslintrc.cjs`.** ESLint 9+ needs flat `eslint.config.js`.
- ❌ **Don't let module conversion silently fix the 8 collisions.** Fix them in PR 3, with tests.
- ❌ **Don't change HTML/CSS while source-text tests still read them.** Same PR, or delete them first.
- ❌ **Don't put game logic in UI components.** Screens manage DOM, emit events, delegate.
- ❌ **Don't reach into another module's internals.** EventBus for cross-cutting concerns.
- ❌ **Don't use `typeof X !== 'undefined'`.** If it isn't imported, it's a bug. Keep `no-undef` on.
- ❌ **Don't assign to `window.*`.** ES exports only.
- ❌ **Don't inline large data objects in logic files.** `src/game/data/`.
- ❌ **Don't batch PRs.** Each one must be independently verifiable and revertible.

---

## Appendix A — Full File Inventory

64 files, 33,912 lines (excludes `js/three.min.js`). Every one has a destination in [§4.1](#41-target-directory-structure).

```
4919  main.js                    613  entities/questMarker.js
1664  chunkmanager.js            589  input/interaction.js
1175  multiplayer/host.js        549  renderer/textureAtlas.js
1170  audio/ambient.js           541  renderer/performanceOptimizer.js
1160  systems/survival.js        527  systems/crafting.js
1152  entities/boss.js           486  mobs/mobDefinitions.js
1064  world/workerGeneration.js  463  entities/worldManager.js        ← dup of main.js:428
1048  systems/inventory.js       392  entities/characterManager.js    ← dup of main.js:69
1048  multiplayer/client.js      280  game.js                         ← stub, absorbed
1031  renderer/skybox.js         + 36 more files under 500 lines
 846  multiplayer/playerSync.js    (world/, renderer/, systems/, input/, util/, mobs/*)
 843  renderer/pbrShader.js
 813  multiplayer/inventorySync.js   Untracked: js/mobs/ — 18 files, 3,516 lines
 788  renderer/chunkMeshBuilder.js   Not script-tagged: js/renderer/meshWorker.js
 769  multiplayer/chunkStreamer.js
 667  renderer/voxelRenderer.js      server/: index.js, session.js, matchmaking.js (~1,110)
 634  systems/damageSystem.js
 621  audio/sfx.js
```

Regenerate with:
```bash
find js -name '*.js' -not -name 'three.min.js' | xargs wc -l | sort -rn
```

## Appendix B — What Changed From v1

| v1 claim | Reality |
|---|---|
| "All 55 existing tests pass" (Phase 1 gate) | 53 files; **21 pass, 32 fail** before any change. 3 source files crash on `require`. |
| `npm install three` | Bundled Three is **r134 (2021)**; 843-line custom PBR shader with 7 `ShaderMaterial`s and no color-management config. Blind upgrade changes every color. **Pin 0.134.0.** |
| Web Workers | Never mentioned. Both pools use `fetch` + `Blob` with hardcoded `js/` paths; `meshWorker.js` isn't script-tagged; `workerGeneration.js` is triple-contract dual-mode. |
| Deployment | Never mentioned. `sync.sh` **and** `.gitignore` exclude `dist/` → first sync ships zero JS. |
| "Root cause: `window.GlobalName` exports" | Only **4** `window.*` assignments. Real cause: implicit top-level globals in classic scripts. |
| "`typeof X !== 'undefined'` littered everywhere" | 126 total, but **62 are `typeof module`**; only **29** are genuine cross-module guards. |
| §8.1 line-number table | **Every entry wrong.** `startGame` is 2156 (not 1850), `renderLoop` 3908 (not 3950), `BrowserWorldManager` 428, `renderWorldSlots` 606. Replaced with symbol names. |
| "`renderLoop()` is 200+ lines → extract it" | It's a closure over **~184 locals** inside a `setTimeout(async…)`. Not extractable without a new hoisting phase. |
| `MESSAGE_TYPES` duplicated in 4 files | Defined in **2**; `matchmaking.js` and `server/index.js` have zero refs; `host.js` uses it **undefined**. |
| ~50 script tags | **64**. Plus 24 inline `style=` attributes the "no inline styles" goal ignored. |
| `.eslintrc.cjs` | ESLint 9+ needs flat `eslint.config.js`. |
| `"test": "node test/run_tests.sh"` | It's a bash script — `node` can't run it. |
| `cp -r textures/* public/textures/` | Duplicates **118 MB / 3,370 files**, already tracked in git. |
| Target tree | Omitted **52 of 64 files**, including 11 of the 15 largest. No `src/audio/` at all. |
| `BrowserCharacterManager` → `CharacterManager.js` | **Collides** with the existing tested `js/entities/characterManager.js`. Needs an explicit reconcile decision. |
| Global collisions | Not mentioned. **8 exist, 3 are live production bugs** (boss spawning throws, host inventory sync always rejects, mobile breakpoint is 600 not 768). |
| Data compatibility | Not mentioned. IndexedDB `cuubz-worlds` v2 + 2 localStorage keys must survive byte-for-byte. |
| `js/mobs/` | Not mentioned. **Entirely untracked** — 18 files, 3,516 lines; `MOB_PLAN.md` 56/309 done. |
| Phase 4 before Phase 5 | Phase 4 invalidated 6 source-text tests that Phase 5 was supposed to migrate. Merged into one PR here. |
| CI | Not mentioned. Now PR 5, before anything else. |
| "~6 weeks, Week 1…Week 5" | Not credible for 34k lines with a red suite, and useless for handoff. Replaced with 33 numbered PRs, each with acceptance criteria. |

---

*v2 written 2026-07-29 against the working tree (16 modified tracked files, `js/mobs/` untracked). All figures measured, not estimated. Regenerate them before starting if the tree has moved.*
