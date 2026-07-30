# PR 17 Handoff — PR 17 is landed. PR 18 is next, and §4 is its inventory.

**Read this first:** the owner ruled on 2026-07-30 (`BUGS.md` **decision 20**) that
**nothing deploys to `10.0.30.160` until the entire rewrite is finished** — not at any
phase gate. **PR 10's `sync.sh` stays unverified on purpose.** Do not run it. The accepted
cost is written down in three places and is not an oversight: **the delta between this
branch and anything that has ever run on the host grows with every PR.**

**Read second:** `refactor.md` **§8.7** — the plan was collapsed from 17 remaining PRs to
7 (`BUGS.md` **decision 32**). **The `EventBus` (PR 21) and PR 28/29's component framework
are dropped.** Do not build them. Absorbed PRs keep their headings, marked **ABSORBED**;
**nothing is renumbered.**

**Status:** PR 17 is **landed and pushed** — `refactor/phase-0` at `1d1d517`. CI green with
**zero annotations**. Tree clean. Nothing in progress.
Phase 3 is **four of five PRs done** (14, 15, 16, 17). The phase is 14–18.
**Parent doc:** `refactor.md` §8.4 — the outcome write-up lives there, not here.
`PR16_HANDOFF.md` is superseded.

---

## 0. Where things stand in one screen

```bash
git log --oneline -2
#   1d1d517  feat(PR17): startGame() -> src/core/Game.js — D-49 fixed; e2e 183 -> 189
#   4dad10a  docs: collapse the remaining plan — 17 PRs to 7; EventBus dropped; decision 32

npm test                  # 53/53 passing, 4 quarantined, exit 0            (CI)
npm run lint              # 0 errors, 171 warnings, exit 0                  (CI runs lint:ci)
npm run build             # exit 0
npm run test:e2e          # 189 assertions, 0 failures  (~7 min, builds first, serves dist/)
npm run test:e2e:vite     # 189 assertions, 0 failures  (~6 min, npm run dev)
git status                # clean
```

**183 → 189 on both hosts.** The six are D-49, and **they were proved non-vacuous by
reintroducing the defect** — `.hidden` stays `true`, the grid renders 0 slots instead of
36, the recipe list stays empty. **The two hosts must stay equal to each other**; that
equality is the proof that the built bundle and the dev server are the same game.

**Branch state:** `refactor/phase-0`, pushed. **`origin/main` is still at the PR 1 baseline
`27959d3`** — deliberately; the owner merges. **PR #1 is open** and is to be left open.
`pre-refactor-baseline` is pushed (`27959d3`).

`src/main.js`: **5,155 → 1,401 lines** across PR 14, 15, 16 and 17.

---

## 1. What PR 17 did

`startGame()` was `src/main.js:321–2190` — **1,894 lines, 58% of the file.** It is
`src/core/Game.js` plus ten new files.

| File | Lines | What |
|---|---|---|
| `src/core/Game.js` | 399 | the class; `init(mode)`; `savePlayerState()`; `stop()` |
| `src/core/BlockPalette.js` | 116 | split out for the ceiling; **re-exported from `Game.js`** |
| `src/core/init/initScene.js` | 99 | steps 1–5 |
| `src/core/init/initSkybox.js` | 101 | step 6 |
| `src/core/init/initWorld.js` | 120 | step 7 |
| `src/core/init/initPlayer.js` | 208 | step 8 |
| `src/core/init/initMobs.js` | 59 | steps 9–10 |
| `src/core/init/initPlayerSync.js` | 159 | step 11a |
| `src/core/init/initChunkStreaming.js` | 232 | step 11b |
| `src/core/init/initInventory.js` | 192 | steps 12–13 (the systems half) |
| `src/core/init/initHud.js` | 65 | step 14 |
| `src/ui/hud/Hotbar.js` | 112 | `renderItemIcon`, `updateHotbarUI` |
| `src/ui/overlays/InventoryScreen.js` | 327 | grid, equipment, recipes, toggle |
| `src/ui/overlays/InventoryDrag.js` | 272 | the three `document` drag listeners |
| `src/game/systems/DroppedItemsSystem.js` | 116 | was an object literal inside step 13 |
| `src/game/data/BlockColors.js` | 41 | the drop-colour table (**D-51**) |

**Ordering is preserved exactly.** `joinGame()` is still called in step 8 with four of its
handlers registered in step 11 — the race `PR16_HANDOFF.md` §4.2 said to keep. The four
duplicate `onGame` registrations are still duplicated: two live consumers, not D-44.

**D-49 is the finding, and it is the biggest one this refactor has produced.**
`renderInventoryCraftingUI()` read `game.chunkManager`, which **PR 12 emptied** when it
folded the ad-hoc `game.*` props onto `GameState`. The crafting-table proximity scan threw
`TypeError` on its first statement, *before* `classList.remove('hidden')` — so **pressing
`E` has not opened the inventory since PR 12.** Four PRs, five fully green `test:e2e` runs,
and a `no-unused-vars`-clean lint, because no assertion had ever pressed `E`. Found by
moving the code, like D-32, D-34, D-43 and D-45 before it.

---

## 2. Rulings already made — do not re-litigate

`BUGS.md` has all **thirty-four** in its decision table. 20 and 32 are the owner's.
**33–34 were made inside PR 17.** The ones that will bite:

1. **Decision 20 — no deploy until the whole rewrite is done.** See the top of this file.
2. **Decision 32 — the plan is seven PRs.** No `EventBus`, no component framework.
3. **Decision 33 — `startGame` became eleven files, not one**, because §8.2's 400-line
   ceiling binds. Same call as decision 30 for the session layer. **Every new file is
   under 400; `Game.js` is 399 and has no headroom** — the next thing added to it forces
   another split, and that is fine.
4. **Decision 34 — `Game` absorbed the Phase-0 `CuubzGame`.** One class. `state.game ===
   game` and `game.state === state`; `GameState`'s four read-through getters are
   unchanged. `Game.update()` was deleted (**D-53**); `BlockPalette` moved and is
   re-exported so `require('../src/core/Game.js').BlockPalette` still resolves.
5. **Decision 27 — the UI reads through live getters** (`uiDeps`). PR 17 **did not** delete
   it: `Game` reads its managers through the same object (`gameDeps` extends it with
   `Object.create`), because `characterManager` / `worldManager` / `perfSettings` /
   `sessionManager` are still `main.js` `let`s. **PR 18 is what deletes it**, when those
   four move into the bootstrap.
6. **Decision 23 — the init-only locals moved onto `GameState`/`Game` as each step
   lifted.** The rule PR 17 used: `GameState` for anything that outlives init or that the
   render loop reads; a **declared** `Game` field for init-only ones (`container`,
   `loadingStatus`, `loadingProgress`, `requestedMode`, `isJoiningClient`); a plain local
   otherwise. **Do not add a `GameState` property by assigning to it** — declare it in the
   constructor, or the render loop's dependencies stop being countable.
7. **Decision 31 — the session layer's *logic* is covered in `npm test`; its *browser
   wiring* is D-48, owned by PR 31.** Do not add a browser multiplayer harness before then.
8. **Decision 21 — `src/testBridge.js` is not deleted until PR 33.** `window.__cuubz` is
   still the only sanctioned `window` assignment in `src/` and `test_globalCollisions.js`
   fails if a second appears. **`Game.js` does not import it** — `publishGameState` arrives
   through `deps`, because `testBridge.js` assigns `window.__cuubz` at module top level and
   `test_creativeMode.js` / `test_crafting.js` `require` `Game.js` in **Node**. Keep it
   that way.
9. **Decision 29 — a mechanical extraction does not recreate provably-dead `typeof`
   guards.** PR 17 carried across the `typeof Skybox`/`FirstPersonHand`/`PlayerListHUD`/
   `PlayerSyncManager`/`ChunkStreamer`/`InventorySync`/`EQUIPMENT_SLOT_ORDER`/
   `computeHumidityMap` guards **unchanged**, because they were being moved rather than
   rewritten and PR 33 owns the sweep. The count is unchanged.
10. **`test/helpers/esmRequire.js` learned one thing in PR 17**: an `import` line may end in
    a `//` comment. Its own header says *"teach it the new shape rather than working around
    it"*, so the five anchors were widened rather than the comments removed. PR 31 deletes
    the hook.

Still true: **never renumber `BLOCK_REGISTRY`**; **`DB_VERSION` stays at 2**; **do not
`npm install three`**; **`DEPLOY.md` §2 is authoritative for storage**; **never change
`'cuubz_last_session'`**; **Prettier reformats nothing**; **CI lints with `--quiet`**.

---

## 3. `BUGS.md` — sixteen open rows, all owned

| Owner | Rows |
|---|---|
| **PR 18** | **D-42** (`applyPerfSettings()` never called — *and its third parameter is never read*), **D-50** (eight `document` listeners per `startGame()`, never removed), **D-54** (`game.stop()` has no call site) |
| PR 20 | D-25 (twelve unreferenced modules), D-21 (`SurvivalSystem` spawn `y=20`) |
| PR 23 | **D-51** — the dropped-item colour table predates the block renumbering |
| PR 26 | D-41 (three character-creation paths), **D-52** (equipment-slot click branch unreachable) |
| PR 10 | D-12 (`StrictHostKeyChecking`; improved, not closed) |
| PR 31 | D-20, D-28, D-33, D-47, **D-48** (no multiplayer path driven in a browser) |
| PR 33 | D-27, D-30 |

Closed this session: **D-49** (fixed), **D-53** (deleted).

**Four of the five rows opened this session could not have been seen before the structural
change that found them** — the pattern has now held for four consecutive PRs:

- **D-49** — `game.chunkManager` was 160 lines from the `new CuubzGame()` that stopped
  supplying it. Visible once the reader and the writer sat in different files.
- **D-50** — eight `document` listeners spread over 1,300 lines of one function. Visible
  once they sat in three files that are *about* input.
- **D-51** — 20 lines of hex in the middle of a 1,894-line function. Visible once it was a
  data file, at which point checking it against `BLOCK_REGISTRY` was one command.
- **D-52** — `_invClickStart = null` and `if (_invClickStart && …)` are 100 lines apart in
  the new file too, but the new file is *about* the drag lifecycle.
- **D-54** — the monkey-patch and the `onExit` that bypasses it were 2,700 lines apart.

**The standing process rule applies to every PR:** every bug found gets a row with a
severity and an owner, and either a fix in the current PR or an explicit slot in
`refactor.md`. "Documented and unowned" is not an end state.

---

## 4. PR 18 is next, and here is its inventory

`refactor.md` §8.5 — *`RenderLoop` + `SystemRunner`, **then** pause menu, debug stats,
bootstrap, **delete `src/main.js`***. It **absorbs PR 19** (§8.7) and owns **D-42**,
**D-50** and **D-54**.
Accept: the loop function is under 30 lines; `src/index.js` under 50 lines; no extracted
file over 400; Escape → pause → resume/exit/settings all work.

### 4.1 What is left in `main.js`, measured

`wc -l src/main.js` → **1,401**.

| Region | Lines | Size | Destination |
|---|---|---|---|
| imports | 1–45 | 45 | split across the new files |
| IIFE open, the six `let`s, `uiDeps`, `gameDeps` | 47–150 | 104 | the bootstrap (§4.4) |
| `syncPerfSettingsUI`, `applyPerfSettings`, `rebuildAtlasAndMaterials` | 152–224 | 73 | bootstrap; **`applyPerfSettings` is D-42** |
| `initMenuNavigation`, `let sessionManager` | 226–300 | 75 | bootstrap |
| `startGame` wrapper | 302–361 | 60 | bootstrap (3 real lines) |
| FPS `let`s + **`renderLoop`** | 363–846 | **484** | `src/engine/loop/*` |
| `updateDebugStats` | 848–891 | 44 | `src/ui/hud/DebugStats.js` |
| **`setupPauseMenu`** | 893–1199 | **307** | `src/ui/overlays/PauseMenu.js` |
| `detectMobile` | 1201–1213 | 13 | `src/index.js` |
| `init()` | 1215–1388 | 174 | bootstrap + `src/multiplayer/AutoRejoin.js` |
| `beforeunload`, `DOMContentLoaded`, IIFE close | 1390–1401 | 12 | `src/index.js` |

### 4.2 The three things that will bite

**1. The render loop is NOT five contiguous blocks. The multiplayer calls are interleaved
at five separate points, and the order is behaviour.** `sendMove` sits at **442–448**,
*between* `player.update()` (440) and the touch-look application (451). `playerSync.update`
is at 578, the player-list HUD at 583, the chunk streamer at 601, `TIME_SYNC` at 625 and the
block-change send at 639. **A `SystemRunner` that groups by subject reorders the frame.**
§8.5 says it in as many words: *"Derive `SYSTEM_ORDER` from the actual call order in the
current `renderLoop` body, not from this list."* Either keep `sendMove` where it is inside
whatever owns the player step, or have the runner call the network step twice at the two
points it already runs. **Say which, in the outcome.**

**2. `camPos` crosses the split.** It is computed at **494** (`new THREE.Vector3(x, y+1.6,
z)`), used at 495 and 498 — and read again at **717** by
`biomeEffects.setCameraPosition(camPos)`, two hundred lines later. It is the only
frame-local that crosses a natural module boundary. Put it on `GameState` as a declared
field (`state.camPos`, reused per frame rather than reallocated) or thread a per-frame
context; **do not recompute it**, because a second `new THREE.Vector3` per frame is a
change to allocation behaviour in the hottest function in the program.

**3. `renderLoop` reads exactly three `main.js`-level names and one of them is the
problem.** `_renderRafId` (line 388 — becomes `RenderLoop`'s own field),
`updateDebugStats` (836 — becomes an import), and **`sessionManager`, at lines 443, 444,
603, 625, 626, 627, 639, 642 and 647.** `sessionManager` is a `let` assigned by
`initMenuNavigation`, by `rejoinSession` and by the auto-rejoin path, all of which run
*before* any `GameState` exists. **The clean move is `state.session`, set once at the top
of `Game.init()`** (`state.session = deps.sessionManager`) — add it as a declared
`GameState` field. It is never reassigned during a session. `setupPauseMenu` reads it too
(lines 1023 and 1181).

### 4.3 The 400-line arithmetic

`renderLoop` is 461 lines of body. **It cannot be one file** and §8.5's accept criterion
says the loop function itself is under 30 lines, so the shell and the body are two things
already. A split that follows the section comments and **preserves order**:

| Module | From `main.js` | ~lines |
|---|---|---|
| `src/engine/loop/RenderLoop.js` | 386–405 + 845 (rAF, early-outs, delta, `frameCount++`) | 45 |
| `src/engine/loop/SystemRunner.js` | the spine — calls the steps in the order below | 90 |
| `.../steps/InputStep.js` | 407–437 (keyboard, touch, pointer lock, merged input) | 35 |
| `.../steps/PlayerStep.js` | 439–485 (`player.update`, **sendMove**, touch look, mobile inventory, fly indicator, armour HUD) | 55 |
| `.../steps/ViewStep.js` | 489–519 (camera, sky, shadow camera, skybox, block interaction, hand) | 35 |
| `.../steps/CombatStep.js` | 521–575 (mob attack, then `mouse.update()`) | 60 |
| `.../steps/NetworkStep.js` | 577–650 (player sync, list HUD, chunk streamer, `TIME_SYNC`, block sends) | 100 |
| `.../steps/WorldStep.js` | 652–833 (drops, hotbar, rescue, PBR/shadow, biome effects, **render**, tooltip, chunk update, mobs) | 190 |

`WorldStep` at ~190 is the one to watch — the hover-tooltip raycast (756–810) is 55 lines of
debug UI inside it and is a candidate for `src/ui/hud/BlockTooltip.js` if it grows.
**`state.renderer.render()` is at 754, inside that block** — the frame is drawn in the
middle of `WorldStep`, not at the end of the loop. Do not "tidy" it to the end; the tooltip
raycast and `chunkManager.updateRenderChunks` deliberately run after the draw.

`setupPauseMenu` at 307 fits one file. `updateDebugStats` at 44 plus the three FPS `let`s
fits one. **The bootstrap is the awkward one** — see below.

### 4.4 `src/index.js` under 50 lines: read this before planning it

`src/index.js` is **56 lines today**, of which **12 are the D-25 side-effect imports** kept
in the graph deliberately (owner **PR 20**) and ~38 are the comment block explaining them.
The bootstrap material coming out of `main.js` is ~310 lines (`uiDeps`/`gameDeps`, the six
`let`s, `initMenuNavigation`, `syncPerfSettingsUI`, `rebuildAtlasAndMaterials`, `init()`,
`detectMobile`, `beforeunload`). **That does not fit in a 50-line `index.js`**, so PR 18
needs a real module — `src/core/Bootstrap.js` or `src/app/App.js` — that owns the managers
and exposes `start()`, with `index.js` reduced to the twelve D-25 imports, one
`import { start }`, and the `DOMContentLoaded` branch.

The ~110-line auto-rejoin block inside `init()` (lines 1279–1370) is its own subject and
§13 already sends it to *"`src/index.js` + `SessionManager.js`"*; `src/multiplayer/
AutoRejoin.js` is the honest destination and keeps the bootstrap readable.

**State plainly at the gate whether the `< 50 lines` box closes**, and if the twelve D-25
imports are what keeps it open, say so — that is PR 20's, not PR 18's.

### 4.5 D-42, D-50 and D-54 are PR 18's and none of them is optional

- **D-42** — `applyPerfSettings()` is defined and never called. **Its third parameter,
  `textureAtlas`, is never read either** (D-46's shape). The two live inline sites are
  `src/core/init/initScene.js` step 5 (`renderer.setShadowQuality`) and
  `src/core/init/initWorld.js` step 7 (`renderDistance: renderDist`). Either those call it
  or it goes. **Nothing may still be dead when `main.js` is deleted.**
- **D-50** — eight `document` listeners added per `startGame()`, never removed. They are
  in `initPlayer.js` (1), `InventoryDrag.js` (3), `initHud.js` (2), `initScene.js` (1
  canvas `click`) and the pause menu's own `keydown`. A session teardown is the fix and PR
  18 is where session lifetime gets an owner.
- **D-54** — `game.stop()` has **no call site**; `onExit` sets `state.game.running = false`
  directly. `Game.stop()` exists and does the right thing (save, clear drops, clear the
  30 s interval). Making `onExit` call it is one line **and it is a behaviour change** —
  exiting to the menu would start saving player position. `DEPLOY.md` §7 already claims it
  does. Decide, and say so.

### 4.6 What PR 18 must not break

- **`publishGameState(state)` at the end of `Game._startRenderLoop()`** — the e2e harness's
  only handle on live state. Every block-edit assertion goes through it.
- **The two awaited sleeps** (200 ms before step 1, 500 ms before `game.start`). PR 13
  established both are behaviour.
- **`_cleanupPauseMenu` calls itself** — `onExit` (line ~1078) invokes it from inside the
  cleanup it is part of. Check that survives the move to a class.
- **The `try/catch` around `Game.init()`'s body** — nothing awaits `startGame()`, so without
  it a throw is an unhandled rejection instead of the loading-screen error message.
- **Frame-rate.** §8.5's accept says check `updateDebugStats` FPS against the tag. The
  render loop is the hottest code in the program and PR 18 is adding six function calls per
  frame to it; that is fine, allocating six objects per frame is not.

---

## 5. Things that are true and easy to break by accident

- **When editing `main.js` mechanically, parse it with `acorn` afterwards.** `node --check`
  reported a brace-imbalanced version as valid during PR 13 (it re-parses as ESM on
  failure). `require(process.cwd()+'/node_modules/acorn')` and
  `acorn.parse(src, {ecmaVersion:'latest', sourceType:'module'})` catches it in one line.
  PR 17 cut 1,894 lines out of the file with a script and this is what proved the cut.
- **`no-undef` is the other half of that gate.** PR 17 moved ~160 locals into eleven files
  and `npm run lint` named every one it missed. Run it after every file you create, not at
  the end.
- **Do not edit a tracked file while an e2e run is in progress.** The vite host serves the
  working tree, so HMR reloads the page mid-run; and the run asserts `git status
  --porcelain` is byte-identical before and after. Draft in a scratchpad, apply afterwards.
- **A stale `vite` on port 3100 makes a green run a lie.** It happened again in PR 17 —
  `vite exited with code 1 before reporting a URL`, six assertions in. Kill it:
  `Get-NetTCPConnection -LocalPort 3100 -State Listen` → `Stop-Process -Force`.
  `--strictPort` is what turns it into a loud failure; do not switch to an ephemeral port.
- **`page.waitForSelector('#x.hidden')` waits for the element to become *visible*** — a
  `.hidden` element never does, so it burns the full 30 s timeout. Wait with
  `waitForFunction` + `classList.contains`. The D-49 assertions do it that way.
- **`test/run_tests.sh` globs `test/test_*.js` — flat, non-recursive**, which is the only
  reason `test/e2e/` is invisible to `npm test`. Never name anything `test/test_e2e*.js`.
- **`test/run_tests.sh` runs `node -r ./test/helpers/esmRequire.js`.** Without it every test
  that requires a source file dies on *"Cannot use import statement outside a module"*.
- **The two worker files must stay classic scripts.** `eslint.config.mjs` lints them with
  `sourceType: 'script'` so an accidental `import` is a parse error at lint time.
- **`publicDir` is `false` and stays that way.** `textures/` is 118 MB across 3,370 files.
- **`QUARANTINE.md` holds 4 files against a cap of 5, all owned by PR 26.** Do not grow it.
- **`waitForQuiesce` exists for a reason.** Do not replace it with a sleep, do not weaken
  exact counts to inequalities.
- **The screenshot assertion expects exactly six `.png` files.** Adding a `shot()` call
  breaks it. SwiftShader is not a GPU; they are a self-comparison baseline only.
- **Never weaken an assertion to make a run pass.** If a defect-asserting block goes red
  because you fixed the defect, rewrite it into the assertion the fix makes true, in the
  same PR. **New assertions must be proved non-vacuous by breaking the thing they check** —
  PR 12 for D-35, PR 14 for D-18, PR 16 three ways for D-43, **PR 17 three ways for D-49**.
- **A green harness proves less than it looks like.** D-32, D-34, D-43, D-45 and now
  **D-49 — a player-visible feature that had been dead for four PRs** — all sat under fully
  green runs. Structural change has found every real bug in this refactor.

---

## 6. Acceptance criteria for whatever comes next

- `npm test` stays at 53/53 + 4 quarantined, exit 0.
- `npm run lint` stays at **0 errors**. Warnings may not grow without a `BUGS.md` note.
  Do not disable `no-undef`. Do not undo `lint:ci`'s `--quiet`.
- `npm run build` stays at exit 0 — **and `dist/` must actually run**, which is what
  `npm run test:e2e` proves.
- `npm run test:e2e` and `npm run test:e2e:vite` stay at 0 failures and stay **equal to
  each other**. If the count changes, say by how much and why, in the same PR.
- `QUARANTINE.md` stays at 4 files. `git status` clean after every gate run.
- CI green on push, **zero annotations**.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.
- **No extracted file over 400 lines.**
- **Outcome sections are a paragraph and a gate table, not an essay** (decision 32).
  Handoffs are written when a session ends, not per PR.

---

## 7. The Phase 3 gate — where it stands after four of five PRs

| Box | State |
|---|---|
| `main.js` deleted | **No — 1,401 lines**, and PR 18 is the PR that deletes it. 5,155 → 1,401 across PR 14–17 |
| `src/index.js` < 50 lines; no extracted file > 400 | `index.js` is **56 lines**, 12 of them D-25's side-effect imports (PR 20's). **No file exceeds 400** — the largest is `Game.js` at **399**, and decision 33 is how it got there. §4.4 explains why the `index.js` half may not close in PR 18 |
| Zero `typeof X !== 'undefined'` in `src/` | **No — and this box cannot close in Phase 3.** Decision 16 moved the sweep to **PR 33**; that is a ruling, not a slip. PR 17 carried its guards across unchanged (decision 29 applies to *recreating* one, not to moving one). Report the count at the gate; do not tick it, and do not do PR 33's work early |
| Solo, creative, pause, settings, save/load verified | **Automated — 189 assertions on both hosts.** PR 17 added the inventory to that list, which is what D-49 cost |
| host, join verified | **Not automated and not going to be in Phase 3.** **D-48**, owner PR 31. The session layer's *logic* is covered by `test_sessionRecord.js` in `npm test` (decision 31) |
| `npm test && npm run lint && npm run build` green | **Green.** |
| deploy verified | **Decision 20 — deliberately deferred, not blocked. Do not tick it and do not run `./sync.sh`.** |
