# PR 26 Handoff — PR 23 and PR 26 are landed. PR 31 is next, and §4 is its inventory.

**Read this first:** the owner ruled on 2026-07-30 (`BUGS.md` **decision 20**) that **nothing
deploys to `10.0.30.160` until the entire rewrite is finished**. **PR 10's `sync.sh` stays
unverified on purpose.** Do not run it. The accepted cost is written down: the delta between
this branch and anything that has ever run on the host grows with every PR.

**Read second:** `refactor.md` **§8.7** — the plan was collapsed from 17 remaining PRs to 7
(`BUGS.md` **decision 32**). The `EventBus` (PR 21) and PR 28/29's component framework are
**dropped**. Absorbed PRs keep their headings marked **ABSORBED**; **nothing is renumbered.**

**Status:** `refactor/phase-0` at `bc59834`, pushed, CI green with **zero annotations**.
Tree clean. Nothing in progress. **Phases 0/1/2/3 CLOSED. Phase 4 CLOSED** (PR 20, PR 23).
**Phase 5 CLOSED** (PR 26). **Phase 6 is 0 of 2** — PR 31 and PR 33 remain, then PR 34.
`PR20_HANDOFF.md` is superseded except for its §5, which is still PR 34's decision material.

---

## 0. Where things stand in one screen

```bash
git log --oneline -3
#   bc59834  feat(PR26): index.html 525 -> 28 lines, CSS into 31 files, QUARANTINE.md emptied
#   25151b7  feat(PR23): split the three monoliths; BLOCK_REGISTRY and BiomeSystem become the source of truth
#   2f63a80  docs: two CI landmines found the hard way in this session

npm test                  # 59 files, 0 failed, 0 quarantined, exit 0          (CI)
                          # 6,532 assertions   (5,699 at PR 20)
npm run lint              # 0 errors, 151 warnings, exit 0   (CI runs lint:ci = --quiet)
npm run build             # exit 0
npm run test:e2e          # 189 assertions, 0 failures  (~7 min, builds first, serves dist/)
npm run test:e2e:vite     # 189 assertions, 0 failures  (~6 min, npm run dev, Edge)
git status                # clean
```

**189 on both hosts, unchanged across every PR since PR 17.** That equality is the proof that
the built bundle and the dev server are the same game. **`npm test` only runs from Git Bash** —
`package.json` calls `bash test/run_tests.sh`. **PR 31 removes that constraint; say so when it does.**

**Branch state:** `refactor/phase-0`, pushed. **`origin/main` is still at the PR 1 baseline
`27959d3`** — deliberately; the owner merges. **PR #1 is open and stays open.**

**No "before" e2e run is needed for the next PR** — PR 26's "after" pair is its "before",
because the only commits between will be documentation. Say so in the outcome.

---

## 1. What PR 23 and PR 26 did

**PR 23 — the three monoliths are gone, and the id tables have one source of truth.**
`ChunkManager.js` **2,057 → 400** (12 files), `InventorySystem.js` **981 → 380** (7),
`SkyRenderer.js` **1,007 → 353** (4), by **prototype mixin** (decision 44) — an AST differ
proved 53/53 of ChunkManager's method bodies byte-identical against HEAD. `meshWorker.js` now
holds **zero block-id literals**; `InventorySync`'s placement allowlist went **27 → 193** ids
after rejecting 166 real blocks. D-60's Perlin collapse was proved bit-exact over **202,163**
comparisons *before* a line was deleted. Ten rows closed or half-closed.

**PR 26 — `index.html` is 28 lines and `QUARANTINE.md` is empty.** `css/style.css` (2,107) →
31 files, proved equivalent across 1,189 CSS tuples; markup → 16 template modules, proved
equivalent across 968 DOM nodes; the four quarantined tests rewritten or deleted; D-41, D-52,
D-58, D-61 closed. **The largest file in `src/` is now `SurvivalSystem.js` at 1,159 — PR 34's.**

**The adversarial pass found real defects in both PRs, under five green gates each. That is
now five consecutive PRs.** In PR 26 it caught a regression the PR itself had introduced.

---

## 2. `BUGS.md` — twenty-seven open rows, all owned

| Owner | Rows |
|---|---|
| **PR 31** | **D-20**, **D-28**, **D-33**, **D-47**, **D-48**, **D-62**, **D-73**, **D-79**, **D-80**, **D-83** |
| PR 33 | D-27, D-30, D-71, D-72, D-74, D-75, **D-76**, **D-77**, **D-78**, **D-81**, **D-82** |
| PR 34 | D-25 (the five deferred), D-68 (content half), D-69, D-70 |
| PR 10 | D-12 (post-deploy) |

`D-53` sits in the Open table with a Fixed status; it was closed in PR 17. Pre-existing.

**Closed this session:** D-51, D-56, D-57, D-60, D-63, D-64, D-65, D-66, D-67 and half of
D-68 (PR 23); D-41, D-52, D-58, D-61 (PR 26); D-25's `Noise.js` third.

**D-76 was reassigned PR 26 → PR 33 when PR 26 landed without reaching it.** It was logged
during PR 23 and given to PR 26 before PR 26's scope was known. A row pointing at a closed PR
is the "documented and unowned" state the process rule forbids, so it moved to the sweep-up PR,
which already owns **D-72**, the other `ItemDefinitions.js` row.

### The three that will bite

**D-77 (medium) — no mob has been rendered since PR 9.** `mobIntegration.js:72` guards
`MobRenderer`'s construction on `typeof THREE !== 'undefined'` and **THREE is not imported in
that file**; `mobRenderer.js:38` is the mirror image. Both constant. `no-undef` cannot see it
because `typeof` is the one construct it exempts — which is decision 16's own argument for
deferring the D-27 sweep. **PR 33 must land this as its own commit with the e2e pair as the
gate**, not folded into the mechanical sweep. PR 23 fixed mob collision and mob spawn biomes
for mobs that are invisible.

**D-79 (medium) — the `esmRequire` hook has TWO install sites.** `run_tests.sh:71` **and
`test/e2e/saveLoad.js:91`.** PR 31 deleting it without converting `saveLoad.js` in the same
commit breaks both e2e hosts, and neither `npm test` nor CI would notice (CI has no Edge).

**D-83 (medium) — the harness orphans its vite child when it dies.** PR 26's first
`test:e2e:vite` run died at assertion 96 (`Target page, context or browser has been closed`)
and left a `vite` process **still listening on 3100** — the exact condition that has made a
green run a lie seven times. The teardown half is a `finally` and is unconditionally correct.

---

## 3. Rulings — sixteen new ones this session, do not re-litigate

`BUGS.md` has all **59**. **44–51 were made inside PR 23, 52–59 inside PR 26.** The ones that bind:

1. **Decision 44 — prototype mixins** are how a class with heavily-shared instance fields gets
   split. `Object.assign(Class.prototype, …)`, bodies move verbatim, plus a load-time
   collision guard. Composition was rejected for `ChunkManager`: twelve shared fields, and
   `flushDirty` reads five of them together *because* D-19 required it.
2. **Decisions 45, 57 — the 400-line ceiling forces more files than any plan section names.**
   Applied for the fourth, fifth and sixth time. §4.1's eleven files were 23; §27's 21 CSS
   files were 31. **`ChunkCache.js` was deliberately not created** and §9 PR 24's `Hotbar.js`
   row was not followed — that filename is occupied and the methods it names are not a seam.
3. **Decision 52 — one stylesheet, one `<link>`, an ordered `@import` manifest.** §27's
   per-module CSS imports would break a cascade whose responsive block has no `!important`.
4. **Decision 53 — templates mount eagerly, all of them, before wiring.** `UIManager`'s
   constructor resolves 19 elements and `src/` resolves 141 ids.
5. **Decision 50 — "passable" is `!BLOCK_PROPERTIES[id].solid`**, the registry's own field,
   the one `Player._isSolidAt` reads. Not a hand-written id set.
6. **Decision 51 — mobs sinking is the accepted cost of decision 50.** D-70, PR 34's.
7. **Decision 59 — a button that both opens and closes cannot be disabled.** Decision 55's
   greyed-out button applies to the two modals only.
8. **Decision 43 — §9 PR 22's accept criterion is SUPERSEDED, not missed.** Do not "finish" it.
9. **Decision 42 — D-25 split three ways.** Deleting a duplicate is triage; deleting five
   feature subsystems is a product decision. PR 34's.
10. **Decision 21 — `src/testBridge.js` is not deleted until PR 33**, and PR 33's inventory
    (§5 below) concludes **the condition can never be met** and should be written down as
    permanent. `window.__cuubz` is still the only sanctioned `window` assignment in `src/`.
11. **Decision 29 — a mechanical extraction does not RECREATE dead `typeof` guards**, but
    moving one unchanged is fine. PR 33 owns the sweep.
12. **Decision 23 — never add a `GameState` property by assigning to it.**

Still true: **never renumber `BLOCK_REGISTRY`**; **`DB_VERSION` stays at 2**; **do not
`npm install three`**; **`DEPLOY.md` §2 is authoritative for storage**; **never change
`'cuubz_last_session'`**; **Prettier reformats nothing**; **`publicDir: false`**; **CI lints
with `--quiet`**.

---

## 4. PR 31 is next, and here is its inventory

`refactor.md` §11 — Vitest plus the test restructure, absorbing PR 32. **Measured against the
current tree, not against the plan.**

### 4.1 §11 is stale in eleven places

| §11 says | Reality |
|---|---|
| "touching all **56** test files twice" | **59 on disk, 59 run** (PR 23 added 5, PR 26 added 3 and deleted 3) |
| D-33 "**172** warnings" | **151.** `BUGS.md`'s row says 172, `ci.yml:147-150` says 178 |
| `npm i -D vitest` | **Incomplete** — `fake-indexeddb` is also required and is not a dependency. `jsdom@^30.0.1` **is** already there |
| `include: ['test/**/*.test.js']` | **Matches zero files on day one**; `vitest run` exits non-zero. Needs `--passWithNoTests` or a file converted in the same commit |
| `environment: 'jsdom'` | Wrong for the five relay-port files and `test_globalCollisions.js` — they need `// @vitest-environment node` |
| "run the legacy runner and vitest side by side" | **Workable, for a reason §11 does not give:** `run_tests.sh` globs `test/test_*.js` (flat, prefix) and Vitest would glob `test/**/*.test.js` (recursive, suffix) — **the two are disjoint**, so a file leaves one and joins the other the instant it is renamed. **Trap:** `test/test_foo.test.js` matches BOTH and runs twice |
| accept: "`QUARANTINE.md` is empty or has an owner per entry" | **Already satisfied — PR 26 emptied it.** Not a gate for PR 31 |
| "D-28 — the hook, which this PR deletes" | **Incomplete and a blocker — D-79.** Two install sites |
| `helpers/setup.js` | **Does not exist.** `test/helpers/` holds one file, the hook this PR deletes; the directory would be empty |
| `unit/{core,engine,game,ui}` | **Incomplete.** `src/` has six top-level dirs. No home for `src/multiplayer/` (8 files), `src/util/` (1), `server/` (2), or the four repo-invariant tests |
| `integration/{gameLoop,multiplayerSync,worldPersistence}` | `multiplayerSync` and `worldPersistence` map to existing files. **`gameLoop` has no antecedent** — new work |
| "seeded with a **pre-refactor v2** database dump" | **D-80 — no such dump exists in the repo** |

### 4.2 The census — 59 files, and only ONE vacuous copy

| Shape | Count | Migration |
|---|---|---|
| pure-logic | 45 | mechanical: `require`→`import`, drop the local assert block, drop `process.exit`, wrap in `it()` |
| relay-port | 5 | rewrite lifecycle: `test_serverIntegration` **18765**, `test_multiplayerSync` **18770**, `test_maxPlayerAndDisconnect` **18780**, `test_sessionDiscovery` **18790** (D-20, no `'error'` handler on any listener), plus `test_multiplayerStress` which already uses `listen(0)` **correctly** |
| DOM-stubbed | 3 (2 overlap) | jsdom supersedes the stubs; `test_hotbarScroll.js:42-43` is a three-line deletion |
| vacuous-copy | **1** | `test_sessionUI.js` — D-47 |
| meta / repo-invariant | 4 | `test_globalCollisions`, `test_threePin`, `test_manifestGenerator`, `test_framework` |

**The vacuous-copy hunt is done and its result is a positive finding.** Two independent scans —
files referencing nothing under `src/` (11, of which 9 legitimately use `server/`), and
test-local declarations whose name matches a real `src/` export (14 hits, **13 false
positives**: scene fixtures, module namespaces, re-export aliases, loop constants, and the
CommonJS `server/session` alias `SessionManager`). **`test_sessionUI.js` is the only true
positive. There is no second one.**

**D-47 is smaller than 730 lines implies.** Its reimplementations are `MockElement` (:45),
`TestSessionManager` (:161 — its own comment says *"Since it's in a closure, we'll recreate it
here"*), `getHealthColor` (:372) and `escapeHtml` (:481) — **both exported by name from
`src/multiplayer/PlayerListHUD.js` and already covered for real by `test_playerListHUD.js`'s
133 assertions** — `validateSessionName`/`validateWorldSelection` (:394, :419), `switchTab`
(:447) and a second manager copy `LifecycleTestManager` (:515).

**Migration cost:** delete 1 (`test_framework.js` — it self-tests the assert helpers Vitest
replaces); full rewrite 1 (`test_sessionUI.js`); lifecycle rewrite 5 (relay ports); medium 5
(`test_globalCollisions` uses `execFileSync`+`__dirname`, `test_manifestGenerator` shells a CJS
script, `test_threePin` reads disk artifacts, `test_chunkStorage` and
`test_worldPersistenceIntegration` hand-roll IndexedDB stubs); mechanical 43; one-line 1.

### 4.3 The harness — what Vitest must reproduce, and what simply disappears

| Behaviour | `run_tests.sh` | Survives? |
|---|---|---|
| discovery | `:46` globs `test/test_*.js` — **flat** | Replaced by a glob. Recursion makes `test/e2e/` visible unless explicitly excluded |
| quarantine | `:31-34` greps the **first column of a markdown table** in `QUARANTINE.md` | **No equivalent, and no longer needed** — PR 26 emptied it |
| ESM hook | `:71` `node -r ./test/helpers/esmRequire.js` | Deleted — **D-79, two sites** |
| isolation | one **process per file** | Vitest defaults to worker threads. **`pool: 'forks'` / `fileParallelism: false` is mandatory, not optional** — five files bind real sockets and one shells out |
| exit code | `:113` `exit $FAIL`; a file fails iff its process exit code ≠ 0 | Native |
| assertion count | **There is none.** `:88` prints files. Each of the 59 files prints its own count in its own format and nothing aggregates them | **It does not exist to survive.** The 6,532 figure is produced by an ad-hoc loop, not by any tool in the repo |

**All 59 files call `process.exit`. That is how they signal failure, and `process.exit()` inside
a Vitest worker kills the worker and is reported as a crash, not a test failure.** Removing it
from every file is the single most universal edit in the PR. **18 files use `__dirname`**;
**one** (`test_skybox.js`) uses `module.exports`.

**`eslint.config.mjs:194` lints `test/**/*.js` as `sourceType: 'commonjs'`.** The first
converted file fails `no-undef` on its `import` until that block is split. Not in §11.

### 4.4 D-48 — the two-context multiplayer harness, costed

**Both source blockers are gone, verified:** `src/testBridge.js:77,:128` puts the live
`GameState` on `window.__cuubz`; `src/multiplayer/RelayUrl.js:30-35` honours `?relayUrl=`
before any other branch. **Note `RelayUrl.js:15` claims the harness already uses it — D-82;
it never has.**

- **Relay child:** `server/index.js:22` reads `MATCHMAKING_PORT`, `:190` listens, `:191-193`
  logs `[RELAY] Listening on port N`. Gate on that line, **not a sleep**. `SIGTERM` in a
  `finally`; `server/index.js:220` already warns a crash can leave 8765 held.
- **Both contexts load `?relayUrl=ws://127.0.0.1:8765`.** That query parameter is the whole
  integration.
- **Host path:** `#btn-host` → `#lobby-screen:not(.hidden)` → `#tab-host` → `#host-panel` →
  `#host-session-name` → `#host-character-select`/`#btn-host-create-char`/`#btn-host-save-char`
  → `#host-world-select`/`#btn-host-create-world`/`#host-world-name`/`#host-world-seed`/
  `#btn-host-save-world` → `#host-max-players` → **`#btn-start-hosting`** → `#hud:not(.hidden)`.
- **Guest path:** `#btn-join` → `#browse-character-select` (**must be non-empty or
  `LobbyScreen.js:198` `alert()`s and returns** — the guest needs its own character first) →
  `#btn-refresh-sessions` → wait for `.session-item` in `#session-list` → click it → `#hud`.
- **The first real assertion:**
  `guest.evaluate(() => window.__cuubz.state.chunkManager.worldSeed)` equals the seed the host
  typed. It proves the relay handshake, `JOIN_ACCEPTED` over a real socket, `mode`/`name`/`seed`
  surviving the message (the payload PR 16 added for D-43), the temp world built from the
  session seed rather than `LobbyScreen.js:212`'s `Math.random()` fallback, and `startGame()` on
  a joining client. **Non-vacuous by construction** — reverting `LobbyScreen.js:229`'s options
  object turns it red. Second assertion: the guest's `cuubz_last_session` carries the host's
  **mode**, not the hard-coded `'survival'` — D-43's regression test in a browser.
- **Cost:** +2–3 min on top of ~7. **Extrapolated from the six-entry / 7-minute ratio, not
  measured.** It will **not** run in CI — `ci.yml:44-54`, `ubuntu-latest` has no Edge.

### 4.5 D-62's root cause is measured now

`src/ui/screens/WorldScreen.js:191` **pre-fills `#world-seed` with a random uint32** before the
modal is unhidden, and a blank field yields a random uint32 via the **same expression** at
`WorldManager.js:125`. So **a `page.fill` that does not take is byte-indistinguishable from
success.** `openCreateModal()` is fully synchronous and the prefill precedes the `.hidden`
removal, so `waitForSelector` already proves it landed — **there is no post-unhide writer of
that field anywhere in `src/`**, which means the row's "the fill did not take" remains the best
explanation but is *not* established by the source. All five `page.fill` calls are unguarded;
the other four fail loudly. The `waitForFunction` is a correct **detector**; the cure is to make
a blank seed an explicit error.

---

## 5. PR 33's inventory, banked so it is not re-derived

### 5.1 `shared/protocol.js`
- `MESSAGE_TYPES` is at `src/multiplayer/Client.js:42` (24 keys) and `server/session.js:30`
  (10 keys). **§11's claim that `host.js` uses it undefined is FALSE** — `Host.js:19` imports
  it; PR 8 fixed that, and four documents still assert the defect (D-82).
- **They disagree on membership, not values.** 9 shared; **`HEARTBEAT_ACK` is server-only** and
  the client handles it by string literal at `Client.js:374`; 15 are client-only matchmaking
  keys. **`server/matchmaking.js` is a third de-facto copy carrying 13 bare string literals and
  no symbol**, so "deep-equal" is meetable only by unioning all three — 25 keys.
- **`HOST_REJECTED` (D-78) is the live defect** this deliverable exposes.
- **Recommended: ESM source of truth, `server/package.json` gets `"type": "module"`.** That
  scopes to `server/**` only (root, `test/`, `scripts/` unaffected — `eslint.config.mjs:7-11`
  explains why the root must not get one), costs **9 CJS lines** in `server/` plus 7 test files
  **that PR 31 is rewriting anyway**, and needs **no `vite.config.js` change at all**. The dual
  CJS/ESM alternative reintroduces the duplication the PR exists to remove.

### 5.2 D-27 — measured
**64 code occurrences across 31 files** (plus 11 in comments), not 61/20. **32** are the
genuine imported-binding case, **28** are `window`/`document`/`self`/`console`/`performance`/
`WebSocket` feature detection that must **stay**, 4 are other. Of the 32: 6 are logger
bootstrap (dead `else`), 5 are data-table ternaries, 7 are `init*` guards (**three have no
second half at all**), 12 are `THREE`/`BLOCK_PROPERTIES` — of which **`SkyGeometry.js:54`'s
`|| !this.renderer || !this.renderer.scene` is PR 9's D-27 fix and must be kept** — and **2 are
D-77**, the only pair whose removal changes browser behaviour.

**jsdom makes subset (b) worse, not better:** 28 guards that are false under bare Node become
**true** under Vitest, so `Keyboard`/`Mouse`/`Touch` will register real listeners and
`PlayerListHUD` will build DOM. **That belongs to PR 31, not PR 33.**

### 5.3 The CommonJS shims — §11's deliverable is already done
`typeof module`: **0** in `src/`. `module.exports`: **0**. `exports.`: **0**. `require(`: **6,
all inside comments**. PR 9 removed them. `scripts/check-globals.js` does not exist; of decision
11's four assertions two are live in `test_globalCollisions.js`, the `module.exports` one is
subsumed by `no-undef`, and **the "every `src/**.js` reachable from `src/index.js`" one has no
owner**.

### 5.4 D-30 — flipping `minify`
`Function.name`/`constructor.name` dependence re-checked across the ~60 files PR 17–23 added:
**still none** — 0 `constructor.name`, 0 `extends Error`, 0 `Function.prototype.toString`, and
all 122 `.name` reads are data properties. **But `test:e2e:vite` never builds, so it cannot see
the flip** — the plan's "both e2e hosts as the gate" is one host. And `build.sourcemap` is
unset, so flipping alone means the first real deploy is debugged from a minified bundle with no
map. **Flip `minify` and `sourcemap` together, or leave both until after the first `./sync.sh`.**

### 5.5 `src/testBridge.js` — the removal condition can never be met
`test/e2e/staticServer.js` serves **`dist/`**, and `dist/assets/index-<hash>.js` is a Rollup
entry chunk with **zero `export` statements** whose last statements bootstrap the game —
`import()`ing it yields `{}` **and starts a second instance of the application in the same
page**. There is no other importable JS in `dist/`; both workers are classic scripts. Making it
possible means shipping `preserveModules` output to the deploy host so a test can read a
constant — decision 13's rejected shape with the dependency inverted. **PR 33's job is to write
that down as permanent rather than leave it looking pending**, and to delete the **seven**
exposed bindings nothing reads (`CHUNK_WIDTH`, `CHUNK_DEPTH`, `SEA_LEVEL`, `MIN_Y`, `MAX_Y`,
`BLOCK_BY_ID`, `BLOCK_BY_NAME`) so the file's own rule is true again.

**D-71's fix is two changes, not one.** The guard's regex matches the literal token `window.x =`;
`workerGeneration.js:1060` assigns `globalScope._voxelgenGenerateChunk` where
`globalScope === window`. Adding `self|globalThis` to the alternation misses `globalScope`, and
matching any identifier produces false positives on the two workers' legitimate handler
installs. So: **(a)** resolve aliases per file — the literals plus any name bound by the IIFE
tail `)(typeof self !== 'undefined' ? …)` or by `const X = window|self|globalThis` — then match;
**(b)** move the allowlist from **files** to **(file, property) pairs**, so
`workerGeneration.js` is exempt for `onmessage`/`onerror`/`_voxelgenGenerateChunk` and nothing
else. **Rename the constant** — `ALLOWED_WINDOW_WRITERS` is now a lie about what it allows.

### 5.6 D-74 — measured
The dead fluid block is `ChunkMeshBuilder.js:300-552` (not `:329-581`) — 253 lines plus a
13-line commented call block at `:128-140`, taking the file 759 → **493**, still **93 over** the
ceiling, so the row's "under the ceiling for the first time" is wrong. After deletion
`HORIZONTAL_FACES` becomes an unused import (drop the import; keep the export —
`test_meshTables.js:131-132` asserts its shape). **The UV question is decidable: `1.0/16` is
correct.** The atlas is genuinely 16×16 (244 slots → `ceil(sqrt) = 16`, `atlasSize = 2082`,
true size `0.061479`); `1.0/16` errs 1.7%, `meshWorker.js:61`'s `1.0/6` errs **171%**. Best fix:
ship the fallback in the `msg.tables` payload D-63 already sends.

### 5.7 The honest final gate
§11 says `npm run dev`, `npm run build`, `npm test`, `npm run lint`, `./sync.sh`. **Two of those
are not gates:** `./sync.sh` cannot be run (decision 20) and `npm run dev` is a long-running
server with no exit code. **`./sync.sh --dry-run` is the executable substitute** — `sync.sh:111`
skips the SSH-key check under it, and it proves the script parses, resolves paths and would ship
`dist/`. The deploy box **stays unticked and labelled deliberately deferred.**

---

## 6. Things that are true and easy to break by accident

- **`npm test` only runs from Git Bash.** `package.json` calls `bash test/run_tests.sh`.
  **PR 31 removes this constraint entirely** — `vitest run` is a Node binary. When it does,
  delete `ci.yml:132-137`'s `shell: bash` pin and the four warnings about it, or the next
  reader re-learns a constraint that no longer exists.
- **When you edit a file mechanically, parse it with `acorn`.** `node --check` reported a
  brace-imbalanced file as valid during PR 13. `sourceType:'module'`, or `'script'` for the two
  worker files.
- **`no-undef` is the other half of that gate — run lint after every file you create.** And
  note **D-77**: `no-undef` is blind to `typeof`, which is how a whole subsystem stayed dead.
- **Do not edit a tracked file while an e2e run is in progress.** The vite host serves the
  working tree; the run asserts `git status --porcelain` is byte-identical before and after.
- **A stale `vite` on port 3100 makes a green run a lie. Seven occurrences, and now an eighth:
  the harness itself orphaned one (D-83).** `Get-NetTCPConnection -LocalPort 3100 -State Listen`
  → `Stop-Process -Force`. **Check this before every run, not only after a failure.**
- **Do not push a second commit while a CI run is in flight** — the workflow has a concurrency
  group on `refs/pull/1/merge`, so it **cancels** the running one and reports `cancelled` with
  one annotation reading *"Canceling since a higher priority waiting request exists"*. That
  looks like a red CI and is not.
- **`gh run list --limit 1` can return the PREVIOUS run** for up to a minute after a push.
  Match on `headSha`.
- **Capture the FULL e2e output.** `| tail -3` does not contain the `Results:` line, and a run
  that died early looks identical to one that passed — **which is exactly how PR 26's vite
  failure would have been missed.**
- **`test/run_tests.sh` globs `test/test_*.js` — flat, non-recursive**, which is the only reason
  `test/e2e/` is invisible to `npm test`. Never name anything `test/test_e2e*.js`. **Under
  Vitest a recursive glob makes `test/e2e/` visible — exclude it explicitly.**
- **The two worker files must stay classic scripts** (`sourceType: 'script'`).
- **`publicDir` is `false` and stays that way** — `textures/` is 118 MB across 3,370 files.
- **`waitForQuiesce` exists for a reason.** Do not replace it with a sleep, do not weaken exact
  counts to inequalities. **The screenshot assertion expects exactly six `.png` files.**
- **`page.waitForSelector('#modal.hidden')` waits for VISIBLE** and burns the full 30 s timeout.
  Use `waitForFunction` + `classList.contains`.
- **Never weaken an assertion to make a run pass.** New assertions must be proved non-vacuous by
  breaking the thing they check — PR 12 (D-35), PR 14 (D-18), PR 16 (D-43), PR 17 (D-49),
  PR 20 (D-55), PR 23 (nine rows), PR 26 (four).
- **A green harness proves less than it looks like, and so does a green adversarial pass on the
  previous PR.** D-32, D-34, D-43, D-45 and D-49 all sat under fully green runs. **Five
  consecutive PRs have now had a real defect found by the adversarial pass after five green
  gates** — and in PR 26 it was a regression that PR had just introduced. **Run it before
  committing, and never alongside the e2e pair.**

---

## 7. Acceptance criteria for whatever comes next

- `npm test` stays at **59 files / 0 failed / 0 quarantined**, exit 0. **`QUARANTINE.md` is
  empty — do not grow it.**
- `npm run lint` stays at **0 errors**. Warnings may not grow above **151** without a `BUGS.md`
  note. Do not disable `no-undef`. Do not undo `lint:ci`'s `--quiet`.
- `npm run build` stays at exit 0 — **and `dist/` must actually run**, which `test:e2e` proves.
- Both e2e hosts stay at 0 failures and stay **equal to each other**. If the count changes, say
  by how much and why, in the same PR.
- CI green on push, **zero annotations**.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.
- **No extracted file over 400 lines.**
- **Outcome sections are a paragraph and a gate table, not an essay** (decision 32).

---

## 8. The Phase 5 and Phase 6 gates

**Phase 5 — CLOSED.**

| Box | State |
|---|---|
| `index.html` under 80 lines | **Yes — 28**, and zero inline styles |
| `npm test` green | **59/59, 0 quarantined** |
| all screens render | **Automated** — 189 assertions on both hosts, plus `test_pageLoad.js` against the assembled DOM |
| mobile touch controls work | **Not automated.** No test sets a mobile viewport; the two that claimed to were deleted as vacuous (decision 54). **D-81** is the residue |
| CSS visual diff against the Phase 0 tag | **Replaced by a stronger check** — a 1,189-tuple equivalence proof, plus a computed-style comparison over 434 elements × 7 viewports |

**Phase 6 — 0 of 2.** PR 31 next (§4 is its inventory), then PR 33 (§5), then PR 34
(`PR20_HANDOFF.md` §5 is still its decision material and is not superseded).
