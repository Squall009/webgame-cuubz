# Cuubz — Bug Ledger

**This is the single list of known defects. There is no other.** `DEPLOY.md` §8 used to
hold a second copy; it is now a pointer to this file.

**Every row has an owner PR. No row may say "Unowned".** That rule exists because
"documented and unowned" is how this codebase reached the state Phase 0 is unpicking:
`DEPLOY.md` §8 shipped with six unowned rows, one of which (**H-1**) was live data
corruption that destroyed ~90% of a world's saved chunks per cross-world visit and sat
unowned through two PRs. A defect with a severity and no owner is a defect nobody is
going to fix.

**The process, which applies to every session from PR 6c onward:**

1. Every bug found gets a row here — ID, what, severity, owner PR, status — at the time
   it is found, not at the time someone decides what to do about it.
2. Every row gets **either a fix in the current PR or an explicit PR slot**. If no
   suitable PR exists, create the slot in `refactor.md` and cite it here.
3. A bug found mid-task that is out of scope is **logged with an owner and left**, not
   silently absorbed and not merely mentioned in prose. Prose is not a ledger.
4. IDs are never reused and never renumbered — they are cited from `refactor.md`,
   `DEPLOY.md`, source comments and test messages.

Severity means:

| | |
|---|---|
| **critical** | destroys player data, or takes production down, if triggered |
| **high** | player-visible breakage, silent stale deploys, or unrecoverable data loss in a narrow case |
| **medium** | real cost or real risk, with a workaround or a bounded blast radius |
| **low** | waste, confusion, or a latent trap with no live consequence |

---

## Open

| ID | What | Severity | Owner PR | Status |
|---|---|---|---|---|
| D-2 | `sync.sh` never restarts the relay; `server/` changes are silently inert | high | PR 10 | Open. `DEPLOY.md` §5 |
| D-3 | No rollback of any kind: extract-in-place, no backup, no release dirs | high | PR 10 | Open. `DEPLOY.md` §6 |
| D-4 | `--exclude='dist'` ships a JS-less site from PR 7 onward | **critical from PR 7** | PR 10 | Open, and **must land with PR 9**. `refactor.md` §1.4, `DEPLOY.md` §4.3 |
| D-5 | `tar xzf` never deletes; removed files persist on the server forever | high at PR 9 (`js/` → `src/`) | PR 10 | Open. `DEPLOY.md` §4.6 |
| D-6 | `chmod` fans out over all of `/var/www/html` and aborts the deploy *after* extraction if any file is not owned by `dadmin` | medium | PR 10 | Open. `DEPLOY.md` §4.4. The single highest-value unverified check in `DEPLOY.md` §9 |
| D-7 | Source archive is staged **inside** the public web root, removed only on success | medium — source disclosure | PR 10 | Open. `DEPLOY.md` §4.2 |
| D-8 | `server/index.js:219-225` routes `uncaughtException` / `unhandledRejection` into `process.exit(0)`, so `Restart=on-failure` never fires and **the relay stays down** after an unhandled error | medium — relay stays down | PR 10 | Open. **Open decision 3** — `Restart=always` or a non-zero exit code; both change production restart behaviour. PR 10 owns the systemd unit, so it owns this |
| D-9 | `node_modules` excluded and no remote `npm ci`: dependency changes never reach production | medium | PR 10 | Open. `DEPLOY.md` §4.5 |
| D-10 | `ExecStart` hardcodes `node-v22.22.0` by absolute path; CI validates 22.23.x | medium — a node upgrade breaks the unit | PR 10 | Open. **Open decision 4.** `DEPLOY.md` §5.2 |
| D-11 | `textures/` (120 MB, 3,370 files) re-uploaded on every deploy | low — transfer cost | PR 10 | Open. `DEPLOY.md` §4.1 |
| D-12 | `StrictHostKeyChecking=no` on both `scp` and `ssh` — any host key is accepted | low (LAN IP), by design | PR 10 | Accepted for now; revisit when PR 10 rewrites `sync.sh`. `sync.sh:34,36` |
| D-13 | The whole repo (`test/`, `scripts/`, every planning `.md`, `.claude/`) ships to the public web root | low — information disclosure | PR 10 | Open. `DEPLOY.md` §4.2 |
| D-20 | Four relay tests call `http.listen()` on a **fixed port with no `'error'` handler** — `test_serverIntegration` 18765, `test_multiplayerSync` 18770, `test_maxPlayerAndDisconnect` 18780, `test_sessionDiscovery` 18790. Fine in practice (sequential, separate processes), but an occupied port dies on an unhandled `EADDRINUSE` and CI goes red with a misleading message | low | PR 31 | Open. Found by PR 5's audit. PR 31 rewrites the test harness onto Vitest and is where ephemeral ports belong |
| D-21 | `SurvivalSystem`'s default spawn is `{x:0, y:20, z:0}` while `SpawnManager` uses `SEA_LEVEL + 4` (68) — **y=20 is 44 blocks underground** | low — latent | PR 22 | Open. **Open decision 5.** Latent only because `SurvivalSystem.onDeath` / `onRespawn` are not wired to anything in production; PR 22 is the PR that wires death/respawn out of the render loop, which is when it stops being latent. Found by PR 4 |
| D-22 | `.github/workflows/ci.yml` uses `on: push` with no branch filter **plus** `on: pull_request`, so a same-repo PR branch runs CI twice | low — wasted runner minutes | PR 11 | Open, and now **observed** rather than predicted: PR #1 is open, so every push to `refactor/phase-0` produces two runs. `push: branches: [main]` is the one-line fix. **PR 7 edited `ci.yml`** (it added the `build` step, as PR 5's comment required) **and deliberately left this alone** — narrowing `on: push` while a refactor branch is the only branch being worked on would remove the push-triggered feedback loop this whole plan depends on, and it is PR 11's call to make once `main` is moving again |
| D-24 | **`npm run build` exits 0 but produces a `dist/` that cannot run.** `index.html`'s 65 `<script src>` tags are classic scripts, and Vite does not bundle a non-module script — it emits one *"can't be bundled without `type="module"`"* warning per tag and copies neither the scripts nor `textures/` into `dist/`. `dist/index.html` therefore ships 65 references to files that are not there | medium — a build that succeeds and produces a broken site invites someone to deploy it | **PR 9** | Open, and **expected at this point in the plan** rather than a regression: PR 9 is the PR that makes those 65 files ES modules, which is exactly what makes them bundleable. Not deployable in the meantime and not deployed — `sync.sh` excludes `dist/` (**D-4**), so the risk is a human running `npm run build` and copying the output by hand. `refactor.md` §6 PR 7's outcome and `DEPLOY.md` §4.3 both say so. **`textures/` is a second, separate reason** `dist/` cannot run and it is not PR 9's: `publicDir` is deliberately `false` because copying 118 MB per build is what `refactor.md` §1.8 forbids, so **PR 10** owns how textures reach a built site. Found by PR 7 |
| D-23 | **`index.html`'s 65 `?v=` cache-bust strings are maintained by hand, and nothing checks them.** 28 of the 65 scripts changed during Phase 0 (PR 2, 3, 4, 6b, 6c) and **not one `?v=` was bumped** — so a deploy of Phase 0 would have served returning players their cached pre-Phase-0 JavaScript, including a `js/chunkmanager.js` with no H-1 migration in it | medium — a shipped fix silently does not reach returning players. Bounded because the actual cache headers of whatever serves `/var/www/html` are **unverified** (`DEPLOY.md` §3.1): with plain ETag revalidation a changed file is refetched anyway | **PR 7** | **Mitigated in PR 6d** — all 28 stale strings bumped to `?v=20260729-1`, so a deploy from this branch is correct today. The *class* of bug is what PR 7 owns: Vite emits content-hashed asset filenames, which makes the whole convention (and this row) disappear. Until then, **bumping the string is a manual step in every PR that edits a `js/` file** — recorded in `DEPLOY.md` §2.1 step 4 for the schema case. Found by PR 6d |

## Fixed

| ID | What | Severity | Fixed in | Notes |
|---|---|---|---|---|
| **H-2** | **`onupgradeneeded` enumerated every object store, `deleteObjectStore`d all of them and recreated them empty**, under a comment reading "handles schema changes cleanly". Incrementing `DB_VERSION` — a one-character change — destroyed every saved world on every player's device, with no migration and no warning | **critical if triggered** | **PR 6d** | Replaced by a version ladder: `ChunkManager.SCHEMA_STEPS[v]` brings a database from `v-1` to `v`, an upgrade runs every step in `(oldVersion, newVersion]`, steps only ever create (`_ensureStore` / `_ensureIndex` are create-if-absent), and a version with no registered step **throws**, aborting the versionchange transaction and leaving the database at its old version with its data intact. `deleteObjectStore` no longer appears anywhere in `js/`. **Proved, not reasoned about:** `npm run test:e2e` seeds a version-2 database with three real encoded chunks and a real manifest, increments to version 3 through the shipped handler, and asserts every record survives field for field — same keys, `worldName`s, byte lengths, offset-16 checksums and `savedAt`. `test/test_chunkStorage.js` §17 runs the same increment in CI. The `DEPLOY.md` §2.1 ⛔ is now a procedure |
| **H-3** | `js/main.js:545` opened IndexedDB with **no version argument**; on a device where the DB did not exist yet this created `cuubz-worlds` at version 1 with no object stores, and the following `db.transaction([...])` threw `NotFoundError` into a silent `catch {}` | low — self-healed via the same handler as H-2 | **PR 6d** | Fixed by deleting the second opener rather than patching it. `ChunkManager.openDatabase()` is now the only opener in the codebase; it always names `DB_VERSION` and carries the schema ladder, and returns a fresh un-memoized connection the caller owns. The repair pass at the end of every upgrade re-creates missing stores, so an H-3 database created by an older build still heals — asserted directly (`test_chunkStorage.js` §20) rather than left to the delete-everything side effect that used to do it by accident |
| **H-1** | **Chunk primary keys were not world-scoped, so worlds cross-contaminated.** The `chunks` store keyed records on `` `${cx},${cz}` `` alone, so chunk (0,0) was ONE shared record across all three world slots. Measured: one visit to a second world destroyed **1,073 of the first world's 1,184 saved chunks**, and re-entering the first world served the second world's spawn chunk byte for byte | **high — live data corruption** | **PR 6c** | Store key is now `` `${worldName}:${cx},${cz}` `` at all seven chunk-store sites, plus a runtime migration at `DB_VERSION 2` (H-2 makes an upgrade-handler migration impossible). The logical key `ChunkManager.key` is unchanged — 17 call sites and the manifest format depend on it. Re-measured after the fix: world A keeps **1,184 of 1,184** and the store holds **2,393 = 1,184 + 1,209, the sum**. `DEPLOY.md` §2.4. **Already-destroyed data is not recoverable**; affected chunks regenerate from the seed |
| **D-15** | `chunkBinaryCodec.js` sized the buffer as `HEADER_SIZE + blockRuns.length * 4`, but `blockRuns` is a flat `Uint16Array` of `[id, count, …]`, so a run is *two* entries. **Every stored chunk was exactly 2× the size it needed, half zero padding** — 24,156 bytes allocated / 12,088 used, ≈14 MB of zeroes per world. `estimateSize` had the same error and over-reported 2× | medium — 50% of IndexedDB footprint and 50% of every 5 s flush's write volume, wasted | **PR 6c** | Both sites now `blockRuns.length * 2`. Shipped in the same migration as H-1 so players' bytes are rewritten once, not twice. Backward compatible: `decode()` never consults buffer length, it stops after `blockRunCount` runs. Found by PR 6b |
| **D-17** | `deleteChunk` called `store.delete(key)` **twice** — two separate `IDBRequest`s, one per handler — so every call issued two delete operations | low — idempotent, hence unnoticed | **PR 6c** | One request, both handlers. Asserted by operation count in `test/test_chunkStorage.js` |
| **D-18** | Deleting a world removed its manifest but **left every chunk record behind**, under a comment reading *"chunks remain orphaned but harmless — they're keyed by chunk coordinates"*. The premise was H-1: the records were not orphaned, they were **shared** with whatever world next generated the same coordinates | low pre-6c (the records were being overwritten anyway); a growing leak post-6c | **PR 6c** | Found while scoping PR 6c. World-scoped keys are what make a world's chunks both identifiable and safe to remove, so `js/main.js` now deletes them as a key range. Records already orphaned by a pre-6c deletion stay orphaned — they have no `worldName` prefix to match |
| **D-19** | The `beforeunload` chunk flush wrote chunk records **without updating the manifest**, so a chunk saved on tab close kept the checksum the manifest had recorded for its previous bytes | low pre-6c (nothing read those checksums); would have been **high** as soon as something did | **PR 6c** | Found while designing PR 6c's load-time integrity check, which is the first reader of those checksums — verifying them without fixing this would have deterministically discarded whatever a player built immediately before closing the tab. Both stores now written in one transaction, and a stale entry found on load is repaired rather than treated as corruption |
| **D-14** | `js/main.js:4562` called `game.playerSync.reset()`, which does not exist on `PlayerSyncManager`. **Every "Exit to Menu" threw**, skipping six cleanup steps and `showScreen('mainMenu')` — a blank page, F5 the only way out | high — the quit path was broken in every session, solo included | PR 6b | Call deleted; `clearAll()` was already the whole teardown. `DEPLOY.md` §7.2 |
| **D-16** | `#pause-pause-time` was a checkbox labelled "Pause Time of Day", `checked` by default, while `main.js:4693` sets `checked = !skybox.timePaused` — so checked meant time was **running** | low — confusing control, no data risk | PR 6b | Relabelled to "Day/Night Cycle" on the owner's decision. Inverting the logic would have started every existing player's cycle paused |
| **D-1** | `sync.sh` did not exclude `.env`, so a local env file would ship into a world-readable public web root | credential leak (latent — no `.env` exists) | PR 6 | `sync.sh:31` |

**Also fixed, before this ledger existed.** PR 3 fixed 8 global-scope collisions plus a
ninth consumer it uncovered (`js/input/interaction.js` calling an undeclared `_log`,
which would have made breaking or placing a block throw once the three colliding
definitions were renamed). PR 4 fixed seven more, including block drops resolved from a
pre-renumbering ID table (andesite dropped cobblestone), a duplicate block ID (`115`
claimed by two blocks), and a test that would have hung `npm test` the moment it went
green. Those thirteen predate the ID scheme and are not renumbered into it — the record
is `refactor.md` §5 PR 3 and PR 4. **Everything found from PR 6c onward gets an ID here.**

---

## Open decisions, and which rows wait on them

These are the owner's calls, not the implementer's. Each is cited from the row that
waits on it, so a decision is never made twice or lost.

**All six are now settled.** Decisions 1–6 were answered by the owner on 2026-07-29 and
are recorded below as rulings, not as questions. Do not re-open them; the row that waits
on each cites this table, so a re-litigation would be silent.

| # | Decision | Ruling | Rows waiting |
|---|---|---|---|
| 1 | Push `pre-refactor-baseline`, open the PR, fast-forward `main` | **Push the tag. Open the PR** (`--base main --head refactor/phase-0`) once PR 6d lands, and **leave it open — the owner merges.** Do *not* fast-forward `main` from a session. Both done in PR 6d | — (a PR 1 acceptance criterion, and `DEPLOY.md` §6.2's rollback has no target without it) |
| 2 | Tick any of the seven Phase 0 gate checkboxes in `refactor.md` §5 | **Tick what has been verified by running it, and nothing else.** "Manual save/load test passes" is ticked with a footnote naming exactly what is automated (eleven of fourteen steps) and what waits on PR 12–13. Done in PR 6d | — |
| 3 | D-8: `Restart=always`, or a non-zero exit code | **Non-zero exit code**, so `Restart=on-failure` fires as the unit already intends. `Restart=always` would also restart a deliberate shutdown | **D-8** |
| 4 | D-10: how the node version gets pinned | **Resolve `node` from the environment** rather than pinning a patch version by absolute path. CI validates 22.23.x while the unit names 22.22.0; a pin that drifts from CI is worse than no pin | **D-10** |
| 5 | D-21: `SurvivalSystem`'s spawn `y` | **Match `SpawnManager`: `SEA_LEVEL + 4` = 68.** `y = 20` is 44 blocks underground | **D-21** |
| 6 | H-2: rewrite `onupgradeneeded` to migrate instead of deleting | **Rewrite it as a version ladder, and do not bump `DB_VERSION` while doing so.** Shipping a mechanism and exercising it are separate risks: the ladder is proved by an increment against a *seeded probe* database in both the browser harness and CI, so no player's database is moved off version 2 by the PR that makes moving it safe. Done in PR 6d | **H-2**, **H-3** — both closed |

---

## Where the numbers come from

Nothing in this file is inferred from source text alone. The measurements attached to
H-1 and D-15 were produced by `npm run test:e2e` (`test/e2e/saveLoad.js`) driving a real
browser and reading IndexedDB directly — see `DEPLOY.md` §9 for what that run does and
does not establish, and `refactor.md` §5 PR 6b for why it exists. Rows citing `sync.sh`
and the systemd unit are read from those files; `DEPLOY.md` §9 marks explicitly which of
them are **unverified** because nothing in this project has ever been run against the
deploy host.
