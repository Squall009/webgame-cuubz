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
| **H-2** | `onupgradeneeded` (`js/chunkmanager.js:263-276`) enumerates every object store, `deleteObjectStore`s all of them and recreates them empty. **Bumping `DB_VERSION` destroys every saved world on every player's device.** The comment calls it "handles schema changes cleanly" | **critical if triggered** | **PR 6d** | Open. `DEPLOY.md` §2.1. PR 6c migrated *around* it at version 2 rather than through it — see the note at `_migrateToWorldScopedKeys`. **Open decision 6.** This is the next landmine: the next genuine schema change has nowhere to go |
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
| H-3 | `js/main.js:545` opens IndexedDB with **no version argument**; on a device where the DB does not exist yet this creates `cuubz-worlds` at version 1 with no object stores, and the following `db.transaction([...])` throws into a silent `catch {}` | low — self-heals via the same handler as H-2 | **PR 6d** | Open. `DEPLOY.md` §2.4. Same file and same handler as H-2, so the same PR should own both |
| D-20 | Four relay tests call `http.listen()` on a **fixed port with no `'error'` handler** — `test_serverIntegration` 18765, `test_multiplayerSync` 18770, `test_maxPlayerAndDisconnect` 18780, `test_sessionDiscovery` 18790. Fine in practice (sequential, separate processes), but an occupied port dies on an unhandled `EADDRINUSE` and CI goes red with a misleading message | low | PR 31 | Open. Found by PR 5's audit. PR 31 rewrites the test harness onto Vitest and is where ephemeral ports belong |
| D-21 | `SurvivalSystem`'s default spawn is `{x:0, y:20, z:0}` while `SpawnManager` uses `SEA_LEVEL + 4` (68) — **y=20 is 44 blocks underground** | low — latent | PR 22 | Open. **Open decision 5.** Latent only because `SurvivalSystem.onDeath` / `onRespawn` are not wired to anything in production; PR 22 is the PR that wires death/respawn out of the render loop, which is when it stops being latent. Found by PR 4 |
| D-22 | `.github/workflows/ci.yml` uses `on: push` with no branch filter **plus** `on: pull_request`, so a same-repo PR branch runs CI twice | low — wasted runner minutes | PR 11 | Open. Kept literal to the plan text in PR 5; `push: branches: [main]` is the one-line fix. PR 11 is the next PR to touch `ci.yml` (it adds the lint step) |

## Fixed

| ID | What | Severity | Fixed in | Notes |
|---|---|---|---|---|
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

| # | Decision | Rows waiting |
|---|---|---|
| 1 | Push `pre-refactor-baseline`, open the PR, fast-forward `main` | — (a PR 1 acceptance criterion, and `DEPLOY.md` §6.2's rollback has no target without it) |
| 2 | Tick any of the seven Phase 0 gate checkboxes in `refactor.md` §5 | — |
| 3 | D-8: `Restart=always`, or a non-zero exit code | **D-8** |
| 4 | D-10: how the node version gets pinned | **D-10** |
| 5 | D-21: `SurvivalSystem`'s spawn `y` | **D-21** |
| 6 | H-2: rewrite `onupgradeneeded` to migrate instead of deleting | **H-2**, and **H-3** rides along |

---

## Where the numbers come from

Nothing in this file is inferred from source text alone. The measurements attached to
H-1 and D-15 were produced by `npm run test:e2e` (`test/e2e/saveLoad.js`) driving a real
browser and reading IndexedDB directly — see `DEPLOY.md` §9 for what that run does and
does not establish, and `refactor.md` §5 PR 6b for why it exists. Rows citing `sync.sh`
and the systemd unit are read from those files; `DEPLOY.md` §9 marks explicitly which of
them are **unverified** because nothing in this project has ever been run against the
deploy host.
