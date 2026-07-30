# PR 15 Handoff — PR 14 and PR 15 are landed. PR 16 is next, and §4 is its inventory.

**Read this first:** the owner ruled on 2026-07-30 (`BUGS.md` **decision 20**) that
**nothing deploys to `10.0.30.160` until the entire rewrite is finished** — not at any
phase gate. **PR 10's `sync.sh` stays unverified on purpose.** Do not run it. The unticked
deploy box in the Phase 1 gate is **deliberately deferred, not blocked work**. The accepted
cost is written down in three places and is not an oversight: **the delta between this
branch and anything that has ever run on the host grows with every PR.**

**Status:** PR 14 and PR 15 are **landed and pushed**. `refactor/phase-0` is at `046ba0f`,
CI green with **zero annotations**. Tree clean. Nothing in progress. Phase 3 is **two of
six PRs done**.
**Parent doc:** `refactor.md` §8.1 (PR 14) and §8.2 (PR 15) — the full outcome write-ups
live there, not here. `PR13_HANDOFF.md` is superseded except for its §5.
**This is a starting point, not a record.** The record is `refactor.md`, `DEPLOY.md` and
`BUGS.md`.

---

## 0. Where things stand in one screen

```bash
git log --oneline -4
#   046ba0f feat(PR15): extract the UI layer — UIManager + 5 screens; D-41, D-42; e2e 183 -> 183
#   7e62e78 feat(PR14): reconcile the duplicate managers — Option A; D-37..D-40; e2e 166 -> 183
#   981b343 docs: PR13_HANDOFF.md — Phase 2 closed, no deploy until the rewrite is done
#   9592556 feat(PR13): un-nest startGame — both setTimeout wrappers gone, 15 numbered steps

npm test                  # 52/52 passing, 4 quarantined, exit 0            (CI)
npm run lint              # 0 errors, 176 warnings, exit 0                  (CI runs lint:ci)
npm run build             # exit 0
npm run test:e2e          # 183 assertions, 0 failures  (~7 min, builds first, serves dist/)
npm run test:e2e:vite     # 183 assertions, 0 failures  (~6 min, npm run dev)
git status                # clean
```

**166 → 183 in PR 14, and 183 → 183 in PR 15.** Both numbers matter. PR 14's rise is the
delete path getting coverage for the first time; PR 15 moved ~950 lines and added none, so
an unchanged count on both hosts is its parity evidence. **The two hosts must stay equal** —
that equality is the proof that the built bundle and the dev server are the same game.

**Branch state:** `refactor/phase-0` at `046ba0f`, pushed. **`origin/main` is still at the
PR 1 baseline `27959d3`** — deliberately; the owner merges. **PR #1 is open** and is to be
left open. `pre-refactor-baseline` is pushed (`27959d3`).

`src/main.js`: **5,155 → 3,892 lines** across the two PRs.

---

## 1. What these two PRs did

| PR | Result |
|---|---|
| **14** | **The reconcile, ruled Option A.** `main.js` uses the tested `CharacterManager` / `WorldManager`; both `Browser*` classes deleted (~320 lines). The D-18/H-3 chunk cleanup moved to `PersistenceManager.deleteWorld()`. **D-37, D-38 closed; D-39, D-40 found and fixed.** e2e 166 → 183 |
| **15** | **The UI layer.** Seven new files under `src/ui/` and `src/util/`, ~950 lines out of `main.js`, no file over 400. Screens read `main.js` state through an object of **live getters**. **D-41, D-42 logged with owners.** e2e 183 → 183 |

**The most useful thing PR 14 bought** is not the deletion. It is that the delete path is
measured now. `updateCharacter`, `deleteCharacter` and `deleteWorld` had **zero**
assertions before it; the harness now deletes world B through the real modal and proves
world A's chunk `"0,0"` is byte-identical across it. That assertion was **proved
non-vacuous**: with the cleanup disabled the run reports *expected 0, got 1209*.

**The most useful thing PR 15 bought** is that the six delegates it could have left behind
were checked against `grep` and deleted instead. Warning count: 176 before, 176 after.

---

## 2. Rulings already made — do not re-litigate

`BUGS.md` has all **twenty-seven** in its decision table. **20 is the owner's and overrides
three documents.** 24–26 were made inside PR 14, 27 inside PR 15. The ones that will bite:

1. **Decision 20 — no deploy until the whole rewrite is done.** See the top of this file.
2. **Decision 26 — Option A.** One `CharacterManager`, one `WorldManager`, both tested.
   Six divergences are recorded in §8.1's outcome, not merged silently.
3. **Decision 25 — the chunk cleanup lives in `PersistenceManager.deleteWorld()`**, not
   `WorldManager.js`, because Node tests import that file and it stays environment-free.
   `WorldManager.deleteWorld` is unchanged — it already called `this.storage.deleteWorld()`.
4. **Decision 24 — world names are 32 characters**, and `WorldManager` owns
   `MAX_WORLD_NAME_LENGTH`. It no longer imports a *character* limit. Four test assertions
   moved. `selectCharacter` is `async` and persists `lastPlayed`; that is intended.
5. **Decision 27 — the extracted UI reads `main.js` state through live getters** (`uiDeps`),
   because all five bindings are `null` when the UI is constructed. **PR 17 and PR 19 delete
   this bridge** when those `let`s become fields on `Game` and `GameState`. Do not
   "clean it up" early — the alternative is rewriting ~110 references.
6. **Decision 23 — PR 13's fifteen steps are banner comments, not functions.** They share
   ~160 init-only locals. **PR 17 extracts them properly**, by moving each onto `GameState`
   as it lifts the step. Do not half-do it earlier.
7. **Decision 21 — `src/testBridge.js` was NOT deleted; its removal is PR 33's.**
   `window.__cuubz` is still the **only** sanctioned `window` assignment in `src/`, and
   `test_globalCollisions.js` fails if a second appears (D-35). `ALLOWED_WINDOW_WRITERS` is
   a named constant so widening it is a deliberate edit.
8. **Neither Web Worker is an ES module** and `workerGeneration.js` keeps its triple
   contract. Losing the main-thread fallback means a browser that cannot spawn a worker
   gets no terrain at all.
9. **`test/helpers/esmRequire.js` is how CommonJS tests require ES modules.** PR 31 deletes
   the hook. `refactor.md` §6 PR 9 step 3 is impossible as written.
10. **`minify` stays `false`, and the `typeof X !== 'undefined'` guards stay** — both PR 33's.
11. **Prettier reformats nothing. CI lints with `--quiet`.**

Still true: **never renumber `BLOCK_REGISTRY`**; **`DB_VERSION` stays at 2**; **do not
`npm install three`**; **`DEPLOY.md` §2 is authoritative for storage**.

---

## 3. `BUGS.md` — ten open rows, all owned

| Owner | Rows |
|---|---|
| **PR 16** | **D-43** — two `beforeunload` handlers write the rejoin record and disagree about `mode`; the one that hard-codes `'survival'` wins |
| **PR 19** | **D-42** — `applyPerfSettings()` is defined and never called |
| PR 20 | D-25 — twelve modules referenced by nothing, incl. 1,791 lines of never-instantiated audio |
| PR 22 | D-21 — `SurvivalSystem` spawn `y=20` |
| **PR 29** | **D-41** — three character-creation paths that disagree on the slot limit |
| PR 10 | D-12 — `StrictHostKeyChecking=accept-new`; improved, not closed |
| PR 31 | D-20 (relay tests on fixed ports), D-28 (`esmRequire` vs ESM on cycles) |
| PR 32 | D-33 — 176 `no-unused-vars` warnings |
| PR 33 | D-27 (vacuous `typeof` guards), D-30 (`minify: false`) |

Closed this session: **D-37, D-38, D-39, D-40** (all PR 14).

**Four of the six rows touched this session could not have been seen before the structural
change that found them** — which remains the pattern:

- **D-39** — every world preview the browser has ever drawn came from an eight-name biome
  list `BrowserWorldManager` invented, two of whose entries (`Lava`, `Corrupt`) **are not
  biomes this game has**. Found by repointing one call site at the tested class.
- **D-40** — the D-18 chunk cleanup's `catch` was empty, so a failure reported success and
  re-opened the leak with no trace, and it ran *after* the localStorage config was deleted.
  It had been read past in PR 6c, PR 6d and PR 13's comparison as a landmark. **Lifting it
  out of `main.js` is what forced someone to read it as code.**
- **D-42** — a 14-line "apply performance settings to the live engine" function with no
  caller. `no-unused-vars` had always flagged it; it was one of 178 until PR 15 cleared the
  rest of the section and left it standing alone.
- **D-43** — see §4.4. Found by *counting* the write sites §8.3 says to consolidate.

**The standing process rule applies to every PR:** every bug found gets a row with a
severity and an owner, and either a fix in the current PR or an explicit slot in
`refactor.md`. "Documented and unowned" is not an end state.

---

## 4. PR 16 is next, and the inventory is already done

`refactor.md` §8.3 — *extract `SessionManager`.* Target: `src/multiplayer/SessionManager.js`,
with localStorage routed through `src/util/StorageHelper.js` and **the key string
unchanged** (§1.5). Accept: *host a session, close the tab, reopen → rejoin prompt appears
and works.*

**PR 15 did the inventory rather than leaving it for you.** Line numbers are from `046ba0f`.

### 4.1 Every symbol, where it is, and where it goes

| Symbol | `src/main.js` | Lines | Destination |
|---|---|---|---|
| `let sessionManager` | 278 | 1 | **Stays** as a `main.js` binding — `uiDeps` and ~45 sites in `startGame` read it. PR 17 moves it onto `Game` |
| `updateConnectionStatus(status)` | 290 | 22 | `SessionManager` method. Writes `sessionUI.connectionStatus` **and** `sessionUI.connectionHud` |
| `renderSessionList` (delegate) | 319 | 1 | Delete — call `ui.lobby.renderSessionList` from the class |
| `renderPlayerList(players)` | 325 | 47 | **See §4.2 — it needs a home decision** |
| `hidePlayerList()` | 376 | 8 | Same |
| `REJOIN_STORAGE_KEY`, `REJOIN_MAX_AGE` | 389–390 | 2 | `src/util/StorageHelper.js` |
| `getLastSession()` | 396 | 16 | `StorageHelper.readLastSession()` — owns the 24 h expiry and the corrupt-JSON `catch` |
| `clearLastSession()` | 416 | 3 | `StorageHelper.clearLastSession()` |
| `updateRejoinPanel()` | 423 | 15 | `SessionManager` method. **`uiDeps.updateRejoinPanel` calls it** — keep that field working |
| `rejoinSession()` | 442 | 72 | `SessionManager.rejoin()` |
| `class SessionManager` | 519 | 369 | The file. Ten methods; `_wireClientEvents` is the half that touches the UI |
| `showHostError` / `hideHostError` (delegates) | 890–891 | 2 | Delete — call `ui.lobby.*` from the class |
| `getRelayUrl(pageOrigin)` | 903 | 14 | Export from `SessionManager.js`. **Note the unused `pageOrigin` parameter** — it is documented as a test override and never read |
| `initSessionUI()` | 918 | 20 | A `createSessionManager(deps)` factory, or the constructor |
| `beforeunload` (in `initMenuNavigation`) | 240 | 32 | **D-43** — one of the two |
| `beforeunload` (IIFE top level) | 3859 | 28 | **D-43** — the other |

**Roughly 480 lines move. ~45 `sessionManager.*` references inside `startGame` do not** —
they are PR 17's, and they keep working because `let sessionManager` stays where it is.

### 4.2 The four things that will bite

**1. `renderPlayerList` / `hidePlayerList` have no assigned home and the obvious one is
taken.** §8.3 does not mention them; §4.1 sends "player list" to
`src/multiplayer/PlayerListHUD.js` — **which already exists, is imported by `main.js` at
line 18, and is a different thing** (it is instantiated inside `startGame` and driven from
the render loop). These two functions are the `#player-list-overlay` DOM, driven by
`SessionManager`'s `PLAYER_JOINED` / `PLAYER_LEFT` events. **Decide and record it**;
`src/ui/hud/PlayerListOverlay.js` is the suggestion — §4.1 already has a `src/ui/hud/`
directory, and the name matches the element id rather than colliding with a live class.
Do **not** merge them into `PlayerListHUD.js` without reading both.

**2. D-43 — there are six `cuubz_last_session` write sites, not five, and two are
`beforeunload` handlers on the same key.** The top-level one is registered when the module
evaluates; the `initMenuNavigation` one when `init()` runs. **Both fire. The second one
registered runs second and its `setItem` wins.** They disagree: the top-level handler takes
`mode` from `sessionManager._gameMode` — what the session is actually running — while the
winner reads `#host-mode-select` for a host and **hard-codes `'survival'` for a joiner.**
So refreshing while joined to a creative session rejoins into survival. The fix is not to
delete one handler; it is that `SessionManager` owns the record and there is **one writer
with one shape**, which is what §8.3's `StorageHelper` requirement is for.

**3. `rejoinSession()` constructs a second `SessionManager` if none exists** (line 478),
duplicating three lines of `initSessionUI`. Whatever shape the extraction takes has to keep
that path — the auto-rejoin at the end of `init()` can reach it before `initSessionUI` has
run. It is the same lazy-init in two places; collapsing it into the factory is the natural
move, but check the ordering in `init()` before assuming it is safe.

**4. `startHosting()` wires block-validation callbacks twice.** Lines 751–775 wire
`BLOCK_BREAK` / `BLOCK_PLACE` from an `options` argument, and `registerHostCallbacks()`
(line 821) wires the *same two events* again from `startGame`. `startHosting` is called
from exactly one place — `LobbyScreen`'s start-hosting button — **with no arguments**, so
the `options` half is dead today. Do not delete it silently: log it and let PR 16 or PR 30
own it. It is one `client.onGame` registration away from being a double-handler bug.

### 4.3 What the harness will and will not tell you

`npm run test:e2e` **never enters a multiplayer path.** `saveLoad.js` is single-context, it
never clicks `#btn-host` or `#btn-join`, and the two `note()` calls at the end say so. So
of the ~480 lines PR 16 moves, the harness covers:

- **nothing in `SessionManager` itself**;
- `updateRejoinPanel()` **only** as far as `uiDeps.updateRejoinPanel` being callable —
  and it is not called on any path the harness takes;
- `getLastSession()` indirectly, through the auto-rejoin block at the end of `init()`,
  which runs on **every** page load the harness does (five of them) and must keep returning
  `null` without throwing. **That is the one real guard you have**, and it is why a PR 16
  that breaks `StorageHelper` will go red rather than silent.

The honest options are the same two PR 14 faced: **(a)** stand the relay up in the harness —
`server/index.js` on 8765 as a child process, two browser contexts, and point the relay URL
at localhost via the `?relayUrl=` query parameter `getRelayUrl` already supports (that
override exists and is the cheapest way in); or **(b)** say plainly in the outcome that the
session layer is unverified. §7 steps 12–13 have been `⚠️ UNVERIFIED` since PR 6b for
exactly this reason, and the `note()` already states that what is missing is *harness*
orchestration, not source access — PR 12 removed the source blocker.

**D-43 is a good argument for (a).** It is a live, player-visible defect in the rejoin path
that five e2e runs and four PRs walked straight past.

### 4.4 What PR 17 needs from PR 16 and should not have to redo

PR 17 lifts `startGame` onto `src/core/Game.js`, and it inherits **~45 `sessionManager.*`
reads inside that function**. They fall into three groups, and knowing which is which is
most of the work:

- **guards** — `sessionManager && sessionManager.client`, `&& sessionManager.hostingSessionId`,
  `&& sessionManager.currentSessionId`. These become `this.session?.…` and are mechanical;
- **event registrations** — `sessionManager.client.onGame('WELCOME' | 'PLAYER_JOINED' |
  'PLAYER_MOVE' | 'PLAYER_LEFT' | 'CHUNK_DATA' | 'TIME_SYNC' | 'INVENTORY_SYNC', …)`, about
  a dozen, all inside `startGame` steps 11–13. **These are the ones that are load-order
  sensitive** — several are registered *after* `joinGame` is called (line 1401), which is a
  race the current code gets away with because the socket has not delivered yet;
- **the `isJoiningClient` flag** (line 1193), computed once from
  `currentSessionId && !hostingSessionId` and read throughout the rest of init. It is one of
  the ~160 init-only locals decision 23 is about, and PR 17 puts it on `GameState`.

If PR 16 can leave those forty-five reads syntactically untouched, PR 17 is a cut rather
than a rewrite. **That is the reason `let sessionManager` stays in `main.js`.**

---

## 5. Things that are true and easy to break by accident

- **When editing `main.js` mechanically, parse it with `acorn` afterwards.** `node --check`
  reported a brace-imbalanced version of the file as valid during PR 13 (it re-parses as
  ESM on failure); `acorn.parse(src, {ecmaVersion:'latest', sourceType:'module'})` catches
  it in one line. `acorn` is in `node_modules` but **not resolvable from a script outside
  the repo** — require it as `require(process.cwd()+'/node_modules/acorn')` or run from the
  repo root. ESLint catches it too. Do not trust `node --check` on this file.
- **`page.waitForSelector('#some-modal.hidden')` waits for the element to become
  *visible*** — and a `.hidden` modal never does, so it burns the full 30 s timeout and
  fails. Wait for a *closing* modal with `waitForFunction` and `classList.contains`. PR 14
  lost a seven-minute run to this.
- **A stale `vite` on port 3100 makes a green run a lie**, and `--strictPort` is what turns
  that into a loud failure instead. It happened **twice more** in this session, both times
  after a run was interrupted. Kill it —
  `Get-NetTCPConnection -LocalPort 3100 -State Listen` → `Stop-Process -Force`. Do not
  switch to an ephemeral port.
- **Do not edit a tracked file while an e2e run is in progress.** The vite host serves the
  working tree, so HMR reloads the page mid-run and the context is destroyed; and the run
  asserts `git status --porcelain` is byte-identical before and after. Both happened in this
  session. Draft in the scratchpad and apply afterwards.
- **`test/run_tests.sh` globs `test/test_*.js` — flat, non-recursive.** That is the only
  reason `test/e2e/` is invisible to `npm test`. Never name anything in `test/e2e/`
  `test/test_e2e*.js`, and never make that glob recursive.
- **`test/run_tests.sh` runs `node -r ./test/helpers/esmRequire.js`.** Without it every
  test that requires a source file dies on *"Cannot use import statement outside a module"*.
- **The two worker files must stay classic scripts.** `eslint.config.mjs` lints them with
  `sourceType: 'script'` so an accidental `import` is a parse error at lint time rather
  than a silent Blob-worker failure. `saveLoad.js` asserts the fallback warning never fires.
- **`publicDir` is `false` and must stay that way.** `textures/` is 118 MB across 3,370
  files; Vite copies `publicDir` into `dist/` on **every** build.
- **`QUARANTINE.md` holds 4 files against a cap of 5, all owned by PR 26.** Do not grow it.
- **`waitForQuiesce` exists for a reason.** `#hud` loses `.hidden` long before
  `checkRegion(0,0)` finishes its 33×33 pre-generation. Polling until three consecutive
  chunk counts agree is what lets the round-trip assertions compare **exact** counts. Do
  not replace it with a sleep, do not weaken counts to inequalities.
- **Chunks flush on a 5 s dirty timer**; player state saves every 30 s, on Escape, and on
  `game.stop()`. `DEPLOY.md` §7 has the timing table. The block-edit assertions call
  `chunkManager.flushDirty()` directly because the game is paused there and `resumeGame()`
  is what restarts the interval.
- **Never weaken an assertion to make a run pass.** If a defect-asserting block goes red
  because you fixed the defect, rewrite it into the assertion the fix makes true, in the
  same PR. **New assertions must be proved non-vacuous by breaking the thing they check** —
  PR 12 did it for D-35, PR 14 did it for D-18 by disabling the cleanup and confirming
  *expected 0, got 1209*.
- **Screenshots are a self-comparison baseline only.** SwiftShader is not a GPU. The count
  assertion expects exactly **six** `.png` files — adding a `shot()` call breaks it.
- **A green harness proves less than it looks like.** D-32, D-34 and now **D-43** all sat
  under a fully green run.

---

## 6. Acceptance criteria for whatever comes next

- `npm test` stays at 52/52 + 4 quarantined, exit 0.
- `npm run lint` stays at **0 errors**. Warnings may not grow without a `BUGS.md` note.
  Do not disable `no-undef`.
- `npm run build` stays at exit 0.
- `npm run test:e2e` and `npm run test:e2e:vite` stay at 0 failures and stay **equal to
  each other**. If the count changes, say by how much and why, in the same PR.
- `QUARANTINE.md` stays at 4 files.
- `git status` clean after every gate run.
- CI green on push, **zero annotations**.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.
- **No extracted file over 400 lines** (§8.6's gate, and §8.2's accept criterion).

---

## 7. The Phase 3 gate — where it stands after two of six PRs

| Box | State |
|---|---|
| `main.js` deleted | **No** — 3,892 lines. PR 17 takes `startGame`, PR 18 the render loop, PR 19 the rest |
| `src/index.js` < 50 lines; no extracted file > 400 | `index.js` is **56 lines**, of which ~38 are the comment block explaining the twelve D-25 side-effect imports. **No extracted file exceeds 400** — the largest is `LobbyForms.js` at 218 |
| Zero `typeof X !== 'undefined'` in `src/` | **No** — `grep -rn "typeof [A-Za-z_$][A-Za-z0-9_$]* !== 'undefined'" src/ --include=*.js` counts **61** across 20 files, 16 of them in `main.js`. D-27's "29 genuine cross-module guards" is the subset where `X` is an imported binding; the rest are ordinary feature detection (`typeof window`, `typeof document`) and are fine. **They are PR 33's, by decision 16** — so this box will not close in Phase 3 as written. That is a known conflict between the gate and the decision, and whoever runs the gate should say so rather than tick it |
| Solo, host, join, creative, pause, settings, save/load verified | Solo + save/load are automated (183 assertions). **Host and join are not, and D-43 is what that costs** |
| `npm test && npm run lint && npm run build` green; deploy verified | First three green. **Deploy is decision 20 — deliberately deferred. Do not tick it.** |
