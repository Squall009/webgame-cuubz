# PR 16 Handoff — PR 16 is landed. PR 17 is next, and §4 is its inventory.

**Read this first:** the owner ruled on 2026-07-30 (`BUGS.md` **decision 20**) that
**nothing deploys to `10.0.30.160` until the entire rewrite is finished** — not at any
phase gate. **PR 10's `sync.sh` stays unverified on purpose.** Do not run it. The unticked
deploy box in the Phase 1 gate is **deliberately deferred, not blocked work**. The accepted
cost is written down in three places and is not an oversight: **the delta between this
branch and anything that has ever run on the host grows with every PR.**

**Status:** PR 16 is **landed and pushed** — `refactor/phase-0` at `efdd56b`. CI green with **zero annotations**. Tree clean.
Nothing in progress. Phase 3 is **three of six PRs done** (14, 15, 16).
**Parent doc:** `refactor.md` §8.3 — the full outcome write-up lives there, not here.
`PR15_HANDOFF.md` is superseded except for its §4.4, which PR 17 still needs and which §4
below extends.
**This is a starting point, not a record.** The record is `refactor.md`, `DEPLOY.md` and
`BUGS.md`.

---

## 0. Where things stand in one screen

```bash
git log --oneline -3
#   efdd56b  feat(PR16): extract the session layer — D-43 fixed; D-44/D-45/D-46; e2e 183 -> 183
#   11966eb  docs: PR15_HANDOFF.md §3 said ten open rows; BUGS.md has eleven
#   046ba0f  feat(PR15): extract the UI layer — UIManager + 5 screens

npm test                  # 53/53 passing, 4 quarantined, exit 0            (CI)
npm run lint              # 0 errors, 172 warnings, exit 0                  (CI runs lint:ci)
npm run build             # exit 0
npm run test:e2e          # 183 assertions, 0 failures  (~7 min, builds first, serves dist/)
npm run test:e2e:vite     # 183 assertions, 0 failures  (~6 min, npm run dev)
git status                # clean
```

**183 → 183 on both hosts, and 52 → 53 test files.** That split is the shape of the PR:
the browser harness proves it was an extraction (nothing it can see changed), and the
new unit file is where the D-43 fix actually got measured. **The two e2e hosts must stay
equal to each other** — that equality is the proof that the built bundle and the dev
server are the same game.

**Branch state:** `refactor/phase-0`, pushed. **`origin/main` is still at the PR 1 baseline
`27959d3`** — deliberately; the owner merges. **PR #1 is open** and is to be left open.
`pre-refactor-baseline` is pushed (`27959d3`).

`src/main.js`: **5,155 → 3,230 lines** across PR 14, 15 and 16.

---

## 1. What PR 16 did

Six new files, ~660 lines out of `main.js`, **D-43 fixed**, and four more defects found —
three fixed here, two logged with owners.

| File | Lines | What |
|---|---|---|
| `src/multiplayer/SessionManager.js` | 374 | the class, and `getSessionRecord()` |
| `src/multiplayer/SessionHosting.js` | 119 | `startHosting()` — the only DOM-reading half |
| `src/multiplayer/SessionRejoin.js` | 135 | rejoin panel + manual rejoin |
| `src/multiplayer/RelayUrl.js` | 38 | `getRelayUrl()` |
| `src/util/StorageHelper.js` | 125 | **the one writer** of `cuubz_last_session` |
| `src/ui/hud/PlayerListOverlay.js` | 93 | `renderPlayerList` / `hidePlayerList` |
| `src/ui/hud/ConnectionHUD.js` | 54 | `updateConnectionStatus` |

**The most useful thing PR 16 bought is not the deletion.** It is that the session layer
has coverage for the first time — `test/test_sessionRecord.js`, 51 assertions inside
`npm test`, against the **real** `SessionManager` and `StorageHelper`, proved non-vacuous
by breaking each thing it checks. Three of those assertions are *structural*, in the idiom
`test_globalCollisions.js` uses for the `window` allowlist, because **no lint rule can see
a stray `localStorage.setItem`**: one file spells the key, one file writes it, two files
register `beforeunload`.

**D-45 is the finding worth remembering.** `test/test_relayUrl.js` had 24 green assertions
against a *copy* of `getRelayUrl` defined inside the test file, and the copy asserted a
per-game relay subdomain the shipped function does not implement. That is the **third**
vacuous test this refactor has found, and the first found by *looking for existing
coverage* rather than by breaking something. `test_sessionUI.js` is 730 more lines of the
same shape and is **D-47**, owned by PR 32.

---

## 2. Rulings already made — do not re-litigate

`BUGS.md` has all **thirty-one** in its decision table. **20 is the owner's and overrides
three documents.** 24–26 were made inside PR 14, 27 inside PR 15, **28–31 inside PR 16**.
The ones that will bite:

1. **Decision 20 — no deploy until the whole rewrite is done.** See the top of this file.
2. **Decision 27 — the extracted UI reads `main.js` state through live getters** (`uiDeps`),
   because all five bindings are `null` when the UI is constructed. **PR 17 and PR 19 delete
   this bridge** when those `let`s become fields on `Game` and `GameState`. PR 16 added one
   getter (`ui`) and removed none. Do not "clean it up" early.
3. **Decision 23 — PR 13's fifteen steps are banner comments, not functions**, because they
   share init-only locals PR 12 did not hoist. **PR 17 is what extracts them**, by moving
   each onto `GameState` as it lifts the step. §4 below counts them for you.
4. **Decision 30 — the session layer is four files, not one**, because §8.2's 400-line
   ceiling binds and `SessionManager.js` alone would have been ~660. The seams are real:
   `SessionHosting` is the only part that reads form controls, `SessionRejoin` the only
   part that runs before there is a session, `RelayUrl` has no DOM and no imports.
   **Dependencies run one way** and the obvious `SessionManager ↔ SessionRejoin` cycle was
   avoided deliberately — D-26 is what a cycle costs under real ES modules.
5. **Decision 31 — the session layer's *logic* is covered in `npm test`; its *browser
   wiring* is D-48, owned by PR 31.** `PR15_HANDOFF.md` §4.3 offered "stand the relay up"
   or "say it is unverified"; neither was taken as written, and the reasoning is in the
   decision table. Do not re-open it by adding a half-relay to `saveLoad.js`.
6. **Decision 28 — `renderPlayerList` / `hidePlayerList` are `src/ui/hud/PlayerListOverlay.js`
   and are NOT `src/multiplayer/PlayerListHUD.js`**, which already exists, is imported by
   `main.js`, and is a different thing (render-loop driven, owns `#player-list`).
7. **Decision 29 — a mechanical extraction does not recreate provably-dead branches.** The
   two `typeof MultiplayerClient/HostManager !== 'undefined'` guards were dropped rather
   than copied into new files. **This is not PR 33's sweep done early** — the other 59 stay
   and the Phase 3 gate box still cannot close.
8. **Decision 21 — `src/testBridge.js` was NOT deleted; its removal is PR 33's.**
   `window.__cuubz` is still the **only** sanctioned `window` assignment in `src/`, and
   `test_globalCollisions.js` fails if a second appears (D-35).
9. **Neither Web Worker is an ES module** and `workerGeneration.js` keeps its triple
   contract. Losing the main-thread fallback means a browser that cannot spawn a worker
   gets no terrain at all.
10. **`test/helpers/esmRequire.js` is how CommonJS tests require ES modules.** PR 31 deletes
    the hook. `refactor.md` §6 PR 9 step 3 is impossible as written.
11. **`minify` stays `false`; the `typeof X !== 'undefined'` guards stay** — both PR 33's.
12. **Prettier reformats nothing. CI lints with `--quiet`.**

Still true: **never renumber `BLOCK_REGISTRY`**; **`DB_VERSION` stays at 2**; **do not
`npm install three`**; **`DEPLOY.md` §2 is authoritative for storage**; **never change
`'cuubz_last_session'`** — and there is now a test that fails if a second file spells it.

---

## 3. `BUGS.md` — twelve open rows, all owned

| Owner | Rows |
|---|---|
| **PR 19** | **D-42** — `applyPerfSettings()` is defined and never called |
| PR 20 | D-25 — twelve modules referenced by nothing, incl. 1,791 lines of never-instantiated audio |
| PR 22 | D-21 — `SurvivalSystem` spawn `y=20` |
| PR 29 | D-41 — three character-creation paths that disagree on the slot limit |
| PR 10 | D-12 — `StrictHostKeyChecking=accept-new`; improved, not closed |
| **PR 31** | D-20 (relay tests on fixed ports), D-28 (`esmRequire` vs ESM on cycles), **D-48 (no multiplayer path has ever been driven in a browser)** |
| **PR 32** | D-33 — 172 `no-unused-vars` warnings; **D-47 — `test_sessionUI.js` is 730 lines testing a copy of the code** |
| PR 33 | D-27 (vacuous `typeof` guards), D-30 (`minify: false`) |

Closed this session: **D-43** (the PR's own row), **D-44**, **D-45**, **D-46**.

**Three of the four rows opened this session could not have been seen before the structural
change that found them** — which remains the pattern:

- **D-44** — `startHosting()` wired `BLOCK_BREAK` / `BLOCK_PLACE` from an `options` argument
  that its single caller never passes, duplicating `registerHostCallbacks()`. Visible only
  once the two registrars sat in the same file.
- **D-45** — 24 assertions against a private copy of `getRelayUrl` that had drifted into
  asserting a relay scheme the game does not implement. Found by *looking for existing
  coverage* before writing new coverage, which is worth doing every time.
- **D-46** — `getRelayUrl`'s `pageOrigin` parameter, documented as a test override and read
  by no line of the function. It is *why* D-45's copy asserted what it did.
- **D-48** — not new, but newly a row with an owner instead of a `note()` nobody owned.

**The standing process rule applies to every PR:** every bug found gets a row with a
severity and an owner, and either a fix in the current PR or an explicit slot in
`refactor.md`. "Documented and unowned" is not an end state.

---

## 4. PR 17 is next, and here is its inventory

`refactor.md` §8.4 — *`startGame()` → `src/core/Game.js`*. Accept: *solo and multiplayer
both start; saved spawn restore works; loading screen sequence unchanged.*

`startGame` is `src/main.js:321–2214` — **1,894 lines, 58% of the file.** This is the
largest single move left in the plan and it is bigger than PR 14 and PR 15 combined.

### 4.1 The fifteen steps, from the banners, with their real sizes

`grep -n '══ Step' src/main.js` prints these. **The banners are the authority** — §8.4's
list was wrong until PR 13 corrected it from the code (D-36).

| Step | Line | Lines | What |
|---|---|---|---|
| 1 | 378 | 9 | hide screens / show loading |
| 2 | 387 | 9 | renderer |
| 3 | 396 | 24 | input |
| 4 | 420 | 18 | texture atlas |
| 5 | 438 | 11 | PBR + shadows |
| 6 | 449 | 81 | skybox |
| 7 | 530 | 97 | chunk manager |
| 8 | 627 | **175** | player at spawn |
| 9 | 802 | 28 | mob system |
| 10 | 830 | 9 | first-person hand |
| 11 | 839 | **338** | multiplayer (host or client) |
| 12 | 1177 | 11 | block interaction |
| 13 | 1188 | **874** | inventory + systems |
| 14 | 2062 | 81 | HUD, input shortcuts, periodic save |
| 15 | 2143 | 71 | start the render loop |

**Steps 8, 11 and 13 are 73% of the function.** Ten of the fifteen are under 30 lines and
lift cleanly. Plan the PR around the three, not around the fifteen.

### 4.2 What has to move with them

- **238 `const`/`let` declarations inside the function**, 42 of them at its top level
  (`container renderer touch canvas mouse sensitivity perfTexRes tileSize textureAtlas
  itemAtlas advancedShading skybox atlasOverlay atlasCanvasEl isJoiningClient worldName
  renderDist chunkManager bestSpawnX spawnHeight player savedSpawn biomeEffects initCamPos
  firstPersonHand playerSync playerListHUD chunkStreamer blockInteraction inventory crafting
  inventorySync selectedChar droppedItems craftingScreen btnCloseCrafting _invDrag
  _invClickStart mobileCraftBtn saveIntervalId origStop hud`). **Decision 23 is about these.**
- **31 fields already assigned onto `gameState`** — every one of them is a `const` local
  that is never reassigned, so the local and `gameState.x` can never disagree. That is the
  invariant PR 12 established and it is what makes step-by-step lifting safe: **move a
  local onto `GameState` and delete the local, one step at a time, and the file stays
  runnable between every commit.**
- **25 `getElementById` and 12 `addEventListener` calls** inside the function. Several of
  the listeners are added on every `startGame()` — a re-entry (exit to menu, start again)
  re-adds them. Check that before assuming a teardown exists; `_cleanupPauseMenu` is the
  only teardown in the file.

### 4.3 The five things that will bite

**1. Step 13 is 874 lines and is not a "step".** It is the inventory / crafting / hotbar
DOM knot — `updateHotbarUI`, `toggleInventoryScreen`, the drag handlers, the crafting
screen, the mobile craft button — and it is the ~700-line block decision 23 names as the
reason the steps are banners. **Decide before starting whether PR 17 lifts it or defers
it.** `refactor.md` §13 already sends this material to `src/ui/hud/Hotbar.js` and
`src/ui/overlays/*`, which are **PR 28/PR 29's** files, and PR 24 splits `inventory.js`.
A defensible PR 17 lifts steps 1–12 and 14–15 onto `Game` and leaves step 13 as a single
`this._initInventory()` call whose body is still a method on `Game` — under 400 lines only
if the DOM half goes to PR 28/29 in the same breath. **Record the call either way.**

**2. Step 11's event registrations are load-order sensitive and one of them is a race.**
`sessionManager.client.joinGame(...)` is called at **line 743 — inside step 8** — and the
`WELCOME` / `PLAYER_JOINED` / `PLAYER_MOVE` / `PLAYER_LEFT` handlers are registered at
**852+, inside step 11.** The current code gets away with it because the socket has not
delivered by then. Do not "fix" the ordering as part of the move; if you move `joinGame`
below the registrations you have changed behaviour in the one path that has **no automated
coverage at all** (D-48). **Preserve the order exactly and note it.**

**3. Four of those events are registered twice, deliberately.** `WELCOME`,
`PLAYER_JOINED`, `PLAYER_MOVE` and `PLAYER_LEFT` each get two `onGame` registrations in
step 11 — one for `PlayerSyncManager`, one for `PlayerListHUD` — each parsing the same
payload separately. That is not D-44 (which was a genuinely dead duplicate); these are two
live consumers. **Do not collapse them in PR 17.** If they should share a parse, that is
PR 21's `EventBus`.

**4. `sessionManager` appears 56 times on 39 lines inside `startGame`, and PR 16 left every
one syntactically untouched.** That was the point of keeping `let sessionManager` in
`main.js`. They fall into three groups (`PR15_HANDOFF.md` §4.4 has the original breakdown):
guards (`sessionManager && sessionManager.client`, `&& hostingSessionId`,
`&& currentSessionId`) which become `this.session?.…` mechanically; the dozen `onGame`
registrations above; and `isJoiningClient` (line 535), computed once and read at 552, 557
and 639 — it is an init-only local that belongs on `GameState`.

**5. `renderLoop(state)` reads four `main.js`-level names** — `sessionManager`,
`mobIntegration`, `_renderRafId` and `updateDebugStats`. It is **PR 18's**, not PR 17's,
but PR 17 turns three of those four into `Game` fields. Either leave the `let`s in place
until PR 18 (safe, and what PR 16 did for `sessionManager`) or move `renderLoop` in the
same PR (not what §8.5 says). **The first is the smaller diff and it is the precedent.**

### 4.4 `src/core/Game.js` already exists and is 281 lines

It is **not** a stub in the sense §8.4 implies. It is the former `js/game.js`: `MODES`, a
`BlockPalette` class (creative-mode block cycling), and a `Game` class with
`start/stop/setMode/isCreative/isSurvival/canPlaceBlock/update`. `main.js` imports it as
`CuubzGame` (line 42) and constructs it at **line 784, inside step 9**, then assigns
`gameState.game`. Its `update()` even calls `requestAnimationFrame` — a **second** loop
that nothing starts today.

So §8.4's "core/Game.js is a **rewrite**" is accurate but the file is not empty, and the
`Game` PR 17 builds has to absorb or displace the `Game` that is already there. **Decide
which**: `BlockPalette` is used (creative block cycling) and `setMode` is called from the
pause menu, so neither can simply be deleted. `Game.update()`'s stray `requestAnimationFrame`
should be checked against `renderLoop` before anything is merged — **if PR 17 ever calls
`Game.update()`, there are two rAF loops.** That is a bug waiting to be created; log it if
you find it live.

### 4.5 What PR 17 must not break

- `publishGameState(gameState)` at the end of step 15 — the e2e harness's only handle on
  live state. Every block-edit assertion goes through it.
- The two awaited sleeps (200 ms before step 1's work, 500 ms before `game.start`). PR 13
  established both are **behaviour**, not accident.
- `game.stop()` is what flushes player state (`DEPLOY.md` §7). `origStop` at step 14 wraps
  it — check that wrapper survives the move.
- The `try/catch` around the whole body: **nothing awaits `startGame()`**, so without it a
  throw is an unhandled rejection instead of the loading-screen error message.

---

## 5. Things that are true and easy to break by accident

- **When editing `main.js` mechanically, parse it with `acorn` afterwards.** `node --check`
  reported a brace-imbalanced version as valid during PR 13 (it re-parses as ESM on
  failure); `acorn.parse(src, {ecmaVersion:'latest', sourceType:'module'})` catches it in
  one line. Require it as `require(process.cwd()+'/node_modules/acorn')`. ESLint catches it
  too. Do not trust `node --check` on this file.
- **`src/` is CRLF and there is no `.gitattributes`.** A script that rewrites the file with
  `\n` produces a mixed-ending diff that touches every line. Normalise after any
  programmatic edit.
- **`page.waitForSelector('#some-modal.hidden')` waits for the element to become *visible***
  — a `.hidden` modal never does, so it burns the full 30 s timeout and fails. Wait for a
  *closing* modal with `waitForFunction` and `classList.contains`.
- **A stale `vite` on port 3100 makes a green run a lie.** `--strictPort` turns that into a
  loud failure. Kill it — `Get-NetTCPConnection -LocalPort 3100 -State Listen` →
  `Stop-Process -Force`. Do not switch to an ephemeral port.
- **Do not edit a tracked file while an e2e run is in progress.** The vite host serves the
  working tree, so HMR reloads the page mid-run; and the run asserts `git status
  --porcelain` is byte-identical before and after. Draft in a scratchpad, apply afterwards.
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
- **Never weaken an assertion to make a run pass.** If a defect-asserting block goes red
  because you fixed the defect, rewrite it into the assertion the fix makes true, in the
  same PR. **New assertions must be proved non-vacuous by breaking the thing they check** —
  PR 12 did it for D-35, PR 14 for D-18, **PR 16 did it three ways for D-43 and twice for
  D-45**.
- **Screenshots are a self-comparison baseline only.** The count assertion expects exactly
  **six** `.png` files — adding a `shot()` call breaks it.
- **A green harness proves less than it looks like.** D-32, D-34, D-43 and **D-45** all sat
  under fully green runs. D-45 sat under 24 green assertions *of its own*.

---

## 6. Acceptance criteria for whatever comes next

- `npm test` stays at 53/53 + 4 quarantined, exit 0.
- `npm run lint` stays at **0 errors**. Warnings may not grow without a `BUGS.md` note.
  Do not disable `no-undef`.
- `npm run build` stays at exit 0.
- `npm run test:e2e` and `npm run test:e2e:vite` stay at 0 failures and stay **equal to each
  other**. If the count changes, say by how much and why, in the same PR.
- `QUARANTINE.md` stays at 4 files.
- `git status` clean after every gate run.
- CI green on push, **zero annotations**.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.
- **No extracted file over 400 lines** (§8.2's accept criterion and §8.6's gate).

---

## 7. The Phase 3 gate — where it stands after three of six PRs

| Box | State |
|---|---|
| `main.js` deleted | **No** — 3,230 lines. PR 17 takes `startGame` (1,894 of them), PR 18 the render loop, PR 19 the rest |
| `src/index.js` < 50 lines; no extracted file > 400 | `index.js` is **56 lines**, of which ~38 are the comment block explaining the twelve D-25 side-effect imports. **No extracted file exceeds 400** — the largest is `SessionManager.js` at 374, and decision 30 is how it got there |
| Zero `typeof X !== 'undefined'` in `src/` | **No** — and **this box cannot close in Phase 3 as written.** They are PR 33's by **decision 16**, which is a deliberate ruling, not a slip. PR 16 removed four of them incidentally (decision 29 — a moved guard on an imported binding is provably dead, and recreating it in a new file means authoring dead code); the rest stay. **Say so at the gate; do not tick it, and do not do PR 33's work early to make it tickable** |
| Solo, host, join, creative, pause, settings, save/load verified | Solo + save/load are automated (183 assertions). **Host and join are still not driven in a browser** — that is **D-48**, owned by PR 31, and it is what D-43 cost. PR 16 covered the session layer's logic in `npm test` instead (decision 31) |
| `npm test && npm run lint && npm run build` green; deploy verified | First three green. **Deploy is decision 20 — deliberately deferred. Do not tick it.** |
