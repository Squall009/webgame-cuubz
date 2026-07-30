# Cuubz — Deployment & Data Invariants

**Purpose:** everything you need to deploy Cuubz, restart the relay, roll back a bad
deploy, and avoid destroying player save data — without reading `refactor.md`.

**Status of this document:** written at commit `749304b` (PR 6, 2026-07-29), amended at
`0889448` (PR 6b) and again by PR 6c and PR 6d (same day). Every statement about repo contents was
verified by reading the file cited. **No statement about the remote server
`10.0.30.160` was verified** — that needs SSH access no author had. Unverified claims are
marked `[UNVERIFIED]` with the command that would confirm them.
See [§9](#9-verification-status).

**What PR 6b changed:** [§7](#7-saveload-checklist) is now mostly executable
(`npm run test:e2e`) instead of entirely manual, and nine of its fourteen steps are
verified by a real browser rather than inferred from code. That run confirmed **H-1** and
found four defects: **D-14**, **D-15**, **D-16** and the `console.error` severity bug,
three of which it fixed.

**What PR 6c changed:** **H-1 and D-15 are fixed** — chunk records are keyed
`` `${worldName}:${cx},${cz}` `` and existing records are migrated at runtime, and the
chunk buffer is no longer allocated at twice the size it uses. Both were shipped in **one
migration**, deliberately: they touch the same bytes, so players' data is rewritten once
rather than twice. Steps 8–9 of [§7](#7-saveload-checklist) now **pass**. See
[§2.4](#24-storage-hazards--pre-existing-do-not-mistake-these-for-refactor-regressions).

**What PR 6d changed:** **H-2 and H-3 are fixed.** `onupgradeneeded` no longer deletes
every object store — [§2.1](#21-indexeddb--worlds-and-terrain)'s ⛔ is now a **procedure**
for changing the schema, proved by an actual `DB_VERSION` increment over a seeded
version-2 database in a real browser. `ChunkManager.openDatabase()` is the codebase's only
database opener. Separately, **28 stale `?v=` cache-bust strings in `index.html` were
bumped** — every Phase 0 source change had been shipping to returning players' caches as a
no-op (**D-23**).

> **The defect list moved.** [`BUGS.md`](./BUGS.md) is now the single ledger — every known
> defect, its severity, its **owner PR** and its status, in one table with a rule that no
> row may be unowned. [§8](#8-known-defects-and-who-owns-them) is a pointer to it. Do not
> start a second list here; that is how H-1 stayed unowned through two PRs.

> ### ⛔ Read this before your first deploy
>
> 1. **`./sync.sh` does not restart the relay.** There is no `systemctl` call anywhere
>    in this repo. Changes under `server/` are inert until a human restarts the service
>    by hand. See [§5](#5-restarting-the-relay-the-step-syncsh-does-not-do).
> 2. **There is no rollback mechanism.** `tar xzf` extracts over the live tree. Nothing
>    is backed up, no previous copy is kept, there are no versioned release directories.
>    See [§6](#6-rollback) — the honest answer is not "run the rollback script".
> 3. **Do not deploy between PR 7 and PR 10.** `sync.sh` excludes `dist/`. Once the
>    build step lands, deploying ships a site with **no JavaScript at all**.
>    See [§4.3](#43-the-dist-landmine).

---

## Table of Contents

1. [The short version](#1-the-short-version)
2. [Do not change: player data invariants](#2-do-not-change-player-data-invariants)
3. [Topology — what runs where](#3-topology--what-runs-where)
4. [What `./sync.sh` actually does](#4-what-syncsh-actually-does)
5. [Restarting the relay](#5-restarting-the-relay-the-step-syncsh-does-not-do)
6. [Rollback](#6-rollback)
7. [Save/load checklist — automated + manual remainder](#7-saveload-checklist)
8. [Known defects and who owns them](#8-known-defects-and-who-owns-them) → [`BUGS.md`](./BUGS.md)
9. [Verification status](#9-verification-status)

---

## 1. The short version

```bash
# From the repo root, on a machine with ~/.ssh/id_ed25519 authorized for dadmin@10.0.30.160
./sync.sh                    # tar → scp → extract over /var/www/html → chmod

# Static assets are live immediately (raw file serving, no build, no cache to bust).
# Relay code is NOT. If you changed anything under server/, also:
ssh dadmin@10.0.30.160 'sudo systemctl restart cuubz-relay && systemctl status cuubz-relay'
```

That is the entire deploy. There is no build step, no CI deployment, no release
versioning, no health check, and no rollback. Everything else in this document is the
detail behind those two commands and the ways they bite.

**Preconditions**

| Requirement | Why | If missing |
|---|---|---|
| `~/.ssh/id_ed25519` exists | `sync.sh:14,17-20` checks it explicitly | `sync.sh` exits 1 with a clear message |
| That key is authorized for `dadmin@10.0.30.160` | `scp`/`ssh` in `sync.sh:34,36` | password prompt, or `Permission denied` |
| `dadmin` can write every file under `/var/www/html` | the `chmod` fan-out, `sync.sh:38-39` | **partial deploy** — see [§4.4](#44-the-chmod-is-the-fragile-step) |
| `/var/www/html/node_modules` already contains `ws` | the relay `require`s it; `sync.sh` **excludes** `node_modules` | relay fails to start — see [§4.5](#45-node_modules-is-never-shipped) |
| `sudo` rights for `dadmin` on `systemctl` | restarting the relay | `[UNVERIFIED]` — may need a different account |
| GNU `tar` locally | `--exclude` flags, `czf` | works from Windows Git Bash, macOS, Linux |

---

## 2. DO NOT CHANGE: player data invariants

> **Every string and number in this table is a load-bearing storage key or wire
> format. Changing any of them silently orphans or corrupts existing player data.**
> Player data lives **only in the player's browser** — there is no server-side copy
> and no backup anywhere (see [§3](#3-topology--what-runs-where)). A mistake here is
> unrecoverable for every player who has already played.

This is a superset of `refactor.md` §1.5, which listed four of these. The rest were
found while writing this document, by reading every `localStorage` and `indexedDB`
call site in `src/`.

> **PR 9 moved every path in the tables below** — `js/` became `src/` and most files
> were renamed (`refactor.md` §4.1). The paths here are current. **Line numbers are
> approximate**: every converted file gained an import block at the top, so citations
> drifted by a handful of lines. The ones in [§2.1](#21-indexeddb--worlds-and-terrain)
> were re-read after the move; the rest are close, not exact. Grep for the value, not
> the line. **The invariant values themselves did not change and must not.**

### 2.1 IndexedDB — worlds and terrain

| Invariant | Location | Value |
|---|---|---|
| Database name | `src/engine/world/ChunkManager.js:50` | `'cuubz-worlds'` |
| Database version | `src/engine/world/ChunkManager.js:51` | `2` — changing it is now a **procedure**, not a prohibition. See below |
| Object store | `src/engine/world/ChunkManager.js:52`, `_ensureBaseSchema` | `'chunks'`, `keyPath: 'chunkKey'` |
| Index on that store | `_ensureBaseSchema` | `'worldName'` → `worldName`, non-unique |
| Object store | `src/engine/world/ChunkManager.js:53`, `_ensureBaseSchema` | `'manifests'`, `keyPath: 'worldName'` |
| **Chunk primary key format** | `ChunkManager.prototype._storeKey` | `` `${worldName}:${cx},${cz}` `` — e.g. `"world-1753...:-3,7"`. **Changed by PR 6c**; see below |
| Logical chunk key format | `ChunkManager.key` | `` `${cx},${cz}` `` — e.g. `"-3,7"`. **Unchanged** |
| Manifest primary key | `src/main.js:2329` | the world's `id` (`currentWorld.id`) |

> ### The two chunk keys, and why there are two
>
> **PR 6c changed the `chunks` store's primary key and nothing else.** It used to be the
> bare `` `${cx},${cz}` ``, which made chunk (0,0) a **single shared record across all
> three world slots** — H-1, live data corruption, measured at 1,073 of 1,184 chunks
> destroyed per cross-world visit. It is now prefixed with the world name.
>
> `ChunkManager.key(cx, cz)` — the **logical** key — did *not* change, and must not. It
> has 17 call sites and is the key of the in-memory `memoryCache`, of
> `manifest.generatedChunks[].key`, and of the worker protocol. None of those are
> world-scoped concepts, and changing it would cascade into the manifest format, which is
> itself a row in this table.
>
> So the two live side by side: logical keys everywhere in memory, storage keys at exactly
> the **seven** sites that touch the `chunks` object store (`saveChunk`, `loadChunk`,
> `hasChunk`, `deleteChunk`, the `flushDirty` batch write, the `beforeunload` flush, and
> `_batchLoadChunks`). `_storeKey()` is the only bridge. If you add an eighth site, it
> goes through `_storeKey` too.
>
> **Existing records are migrated at runtime, at `DB_VERSION = 2`.** Not in
> `onupgradeneeded` — at the time, that handler could not be used to migrate anything
> (H-2, fixed in PR 6d; the box below is the procedure that replaced it). It stays where
> it is regardless: rewriting record *data* is not a job for a versionchange transaction,
> which cannot await. `_migrateToWorldScopedKeys` runs from `_openDB`, which all seven sites
> await, so no read can observe a half-migrated store. It is idempotent: a key that
> already contains `:` is skipped, so a migrated database costs one key scan and no
> writes. A record with no `worldName` field cannot be attributed to a world and is left
> in place rather than guessed at.

> ### How to change the schema (H-2, fixed in PR 6d)
>
> **This box used to be a ⛔ saying `DB_VERSION` must never be incremented.** It said so
> because `onupgradeneeded` enumerated every existing object store, deleted all of them
> and recreated them empty —
>
> ```js
> storesToDelete.forEach(name => db.deleteObjectStore(name));   // removed in PR 6d
> ```
>
> — under a comment reading "handles schema changes cleanly". It did not: bumping that
> integer was a one-character change with total data loss on every player's device as its
> effect. That is **H-2**, and it is why PR 6c had to run the H-1 key migration from
> `_openDB` at an unchanged version 2 rather than doing the obvious thing.
>
> **PR 6d replaced the handler with a version ladder.** `ChunkManager.SCHEMA_STEPS[v]` is
> the step that brings a database from version `v-1` to version `v`; an upgrade runs every
> step in `(oldVersion, newVersion]` in order. Two rules make an increment survivable:
>
> 1. **Steps create; steps never delete.** `_ensureStore` / `_ensureIndex` are
>    create-if-absent, so a step re-run against a database that already has the store is a
>    no-op rather than a data loss. `deleteObjectStore` no longer appears anywhere in
>    `src/`.
> 2. **A version with no registered step throws**, which aborts the versionchange
>    transaction and leaves the database at its old version with its data intact. Bumping
>    `DB_VERSION` without writing the step fails loudly at development time instead of
>    silently marking an un-migrated database as migrated.
>
> **The procedure:**
>
> 1. Add `ChunkManager.SCHEMA_STEPS[DB_VERSION + 1]` at the bottom of
>    `src/engine/world/ChunkManager.js`, using only `_ensureStore` and `_ensureIndex`. To reshape an
>    existing store, create the new one alongside it and leave the old one in place.
> 2. Increment `DB_VERSION` (`src/engine/world/ChunkManager.js:51`) **and the row in the table above**.
> 3. **Data** that must be rewritten — as opposed to schema that must exist — does not go
>    in a step. A versionchange transaction cannot await anything and a half-applied one
>    aborts the whole upgrade. Write it as an `_openDB` migration beside
>    `_migrateToWorldScopedKeys`, which all seven chunk-store boundary sites await, and
>    make it idempotent.
> 4. Bump the `?v=` cache-bust string on `src/engine/world/ChunkManager.js` in `index.html`
>    (**D-23** — nothing enforces this yet).
> 5. Run `npm run test:e2e` **and** `npm test`. Both drive a real 2 → 3 increment against
>    a database seeded with real chunk and manifest records — the browser harness against
>    real IndexedDB, `test/test_chunkStorage.js` §17 against a stub, in CI. That pair is
>    what makes an increment survivable rather than merely intended.
>
> **Opening the database:** `ChunkManager.openDatabase()` is the only opener in the
> codebase and it always names `DB_VERSION`. Do not add a second one — a caller that does
> not name the version can create a database this codebase does not recognise, which is
> exactly what H-3 was.

### 2.2 Chunk binary format

`src/engine/world/ChunkBinaryCodec.js`. Saved chunk bytes are RLE-compressed with a
20-byte header. Every constant below is part of the on-disk format.

| Invariant | Location | Value |
|---|---|---|
| Magic | `:28` | `0x43555542` (`"CUUB"`) |
| Format version | `:29` | `3` (v3 = Y-major block data) |
| Max readable version | `:107-109` | decode **throws** if `version > 3` |
| Legacy layout cutoff | `:30` | `LEGACY_LAYOUT_MAX = 2` — v1/v2 chunks are regenerated on load |
| Header size | `:30` | `20` bytes |
| Chunk height | `:31` | `256` — must match `CHUNK_HEIGHT` in `chunkData.js` |
| Chunk width/depth | `src/engine/world/ChunkManager.js:48-49` | `16` × `16` |
| Checksum algorithm | `:37-46` | FNV-1a 32-bit, basis `0x811c9dc5`, prime `0x01000193` |
| Run encoding | `:19` | each run = `[blockID: Uint16, count: Uint16]` |
| Encoded length | `encode`, `estimateSize` | exactly `HEADER_SIZE + runCount * 4`. **Changed by PR 6c** (D-15) — see below |

> ### Stored chunks used to be twice this size (D-15, fixed in PR 6c)
>
> `encode()` sized the buffer as `HEADER_SIZE + blockRuns.length * 4`, but `blockRuns` is
> a **flat** `Uint16Array` of `[id, count, id, count, …]` — so the run count is
> `blockRuns.length / 2` and the payload is `blockRuns.length * 2` bytes. Every stored
> chunk was allocated at exactly double what was written, with a zero tail the same size
> as its real payload: **24,156 bytes allocated / 12,088 used**, ≈14 MB of zeroes per
> world. `estimateSize` carried the same error and over-reported 2×.
>
> **The fix is backward compatible, and this is why:** `decode()` never consults the
> buffer length — it stops after `blockRunCount` runs. So an old padded chunk and a new
> tight one decode identically, and a player's existing worlds load unchanged.
>
> **But the checksum spans the whole data portion**, so re-encoding a chunk produces a
> *different* checksum than its padded original. That is safe only because every write
> path records the new checksum in the manifest in the same pass — `flushDirty` phase 3
> and, as of PR 6c, the `beforeunload` flush too (**D-19**). If you add a write path,
> it records the checksum or it breaks the check in `_batchEnsureChunks`.

**Block IDs are baked into every saved chunk.** The format stores numeric block IDs,
not names. Renumbering an entry in `BLOCK_REGISTRY` reinterprets every chunk every
player has ever saved — stone becomes cobblestone, and so on. This is not theoretical:
PR 4 found a duplicate ID (`115`, claimed by both `yellow_poplar_leaves` and
`white_concrete`) and deliberately moved the *new* block to the first free ID (`192`)
rather than shifting 32 existing blocks, precisely to avoid this. **Append new blocks
at the end. Never renumber.**

### 2.3 localStorage

| Key | Location | Contents |
|---|---|---|
| `'cuubz:characters'` | `src/engine/world/Persistence.js:20` | JSON array of every character the player has created |
| `'cuubz:slotMap'` | `src/engine/world/Persistence.js:24` | JSON map of `worldId` → slot number |
| `'cuubz:worldSlot:{N}:conf'` | `src/engine/world/Persistence.js:28` | world config for slot `N`, `N ∈ {0,1,2}` |
| `'cuubz:settings'` | `src/engine/renderer/PerformanceSettings.js:34,52` | performance/graphics settings |
| `'cuubz_last_session'` | `src/main.js:1643` (`REJOIN_STORAGE_KEY`), written at `1272,1284,1768,1785,4892,4902` | last multiplayer session, for rejoin |

`MAX_WORLD_SLOTS = 3` (`src/engine/world/Persistence.js:10`) is part of the key space: slots
are `0,1,2`. Raising it is additive and safe; lowering it orphans slot data.

Note the inconsistent separator — four keys use `cuubz:` and one uses `cuubz_`.
`'cuubz_last_session'` is the odd one out. **Do not "fix" it for consistency**; it
would log every player out of their last session. It is written and read as a literal
in six places plus one named constant.

### 2.4 Storage hazards — pre-existing, do not mistake these for refactor regressions

**H1 — Chunk keys were not scoped to a world, so worlds cross-contaminated. FIXED in
PR 6c.** Kept here because it is the largest thing that has gone wrong with this
project's player data, and because a future refactor of the storage layer needs to know
what it must not undo.

The `chunks` store's primary key is `chunkKey`, and it used to be only
`` `${cx},${cz}` ``. The record *also* carried a `worldName` field and there was an index
on it (`:274`), but **no read path used either**: `loadChunk`, `hasChunk` and
`_batchLoadChunks` all did a bare `store.get(key)` / `store.count(key)`. The three write
sites set `worldName` and then keyed the record globally.

Consequence: chunk `(0,0)` was a **single shared record across all three world slots**.
Play world A, place blocks at spawn, then play world B at spawn — B's chunk overwrote A's.
Return to A and you were standing in B's terrain. Manifests *are* per-world
(`keyPath: 'worldName'`), so world A's manifest still claimed the chunk was generated,
which is what made the stale data load instead of regenerating.

**Confirmed by observation in PR 6b, and worse than the original prediction.** One visit
to a second world destroyed **1,073 of the first world's 1,184 saved chunks**, and
re-entering the first world served the second world's spawn chunk byte for byte. The blast
radius is the whole overlapping pre-generated region — at `regionRadius: 16`, nearly all
of both worlds — not just spawn.

**Fixed in PR 6c** by scoping the store key (see the box in
[§2.1](#21-indexeddb--worlds-and-terrain)) and migrating existing records at runtime.
`npm run test:e2e` steps 8–9 are now the regression test: world A's spawn chunk is
byte-for-byte unchanged by a full visit to world B, and the store holds the **sum** of
both worlds rather than the union of their coordinates.

> **The migration cannot recover data H-1 already destroyed, and does not pretend to.** A
> contaminated record only remembers its **last** writer, so it migrates into that world
> and the other world regenerates those chunks from its seed. Terrain is deterministic, so
> the ground comes back identical; what is gone is any player edit inside those chunks,
> and it was gone before the migration ran.

Two smaller things fixed alongside it, both cited in `BUGS.md`:

- **D-18** — `src/main.js` used to delete a world's manifest and leave every chunk record
  behind, under a comment reading *"chunks remain orphaned but harmless — they're keyed by
  chunk coordinates"*. The premise was H-1 itself: those records were not orphaned, they
  were **shared** with whatever world next generated the same coordinates. World-scoped
  keys are what make a world's chunks both identifiable and safe to delete, so deletion
  now removes them as a key range.
- **D-19** — the `beforeunload` flush wrote chunk records without updating the manifest,
  leaving the manifest's recorded checksum describing the record's *previous* bytes. It
  now writes both stores in one transaction.

**There is also a load-time check now, as defence in depth rather than a substitute.**
`_batchEnsureChunks` compares each loaded record's `worldName` against the world doing the
loading and discards a record that names a different world, regenerating instead of
serving foreign terrain. That is the tripwire that would catch H-1 coming back. It also
compares the manifest's recorded checksum against the header checksum at offset 16 — but
on a mismatch with intact, correctly-owned bytes it **repairs the manifest entry** rather
than deleting the chunk. Deleting would be wrong: `decode()` already verifies the bytes
against the checksum they carry, so real corruption is caught there, and a stale manifest
entry with good bytes means the manifest is the thing out of date. Regenerating on that
signal would deterministically discard whatever a player built immediately before the
write that outran the manifest.

**H-3 — `src/main.js:545` opened the database with no version. FIXED in PR 6d.**
(This entry was labelled `H2` before PR 6c gave the ledger its IDs; `BUGS.md` calls it
**H-3**, and H-2 is the upgrade handler in §2.1.)

```js
const request = indexedDB.open('cuubz-worlds');   // no version argument
```

If the database already existed this opened it at its current version and was fine. If it
did *not* — a player who deletes a world before ever loading one — this **created
`cuubz-worlds` at version 1 with no object stores**, and the following
`db.transaction(['manifests','chunks'])` threw `NotFoundError` into a silent
`catch {}` (`:557-559`). It self-healed through the same handler as H-2, which is why the
two were one PR.

**Fixed in PR 6d** by deleting the second opener rather than patching it: that call site
is now `await ChunkManager.openDatabase()`, the single opener, which always names
`DB_VERSION` and carries the schema ladder. The database it finds or creates is therefore
always one this codebase recognises. If you need a connection anywhere else, call
`openDatabase()` — it returns a fresh, un-memoized connection the caller owns and closes.

**H-2 — `onupgradeneeded` deleted every object store. FIXED in PR 6d.** The full write-up
and the procedure that replaced it are the box in
[§2.1](#21-indexeddb--worlds-and-terrain).

---

## 3. Topology — what runs where

```
   your machine                    10.0.30.160 (dadmin)
  ┌─────────────┐                ┌──────────────────────────────────────┐
  │  repo root  │ ── sync.sh ──> │  /var/www/html/                      │
  │             │  tar/scp/ssh   │    index.html, dist/, css/, textures/│  ← served as
  └─────────────┘                │    server/  ← relay source           │    raw static
                                 │    node_modules/  ← NOT shipped      │    files
                                 │    (+ test/, scripts/, *.md ...)     │
                                 │                                      │
                                 │  systemd: cuubz-relay.service        │
                                 │    WorkingDirectory=…/html/server    │
                                 │    node index.js  →  port 8765       │
                                 └──────────────────────────────────────┘
                                        ▲                      ▲
                        HTTP :80/:443 ──┘                      │ wss:// via nginx
                        [UNVERIFIED: what serves this]         │ cuubz-relay.thehomelabguy.com
```

| Thing | Value | Source |
|---|---|---|
| Host | `10.0.30.160` | `sync.sh:12` |
| User | `dadmin` | `sync.sh:11` |
| Web root / deploy target | `/var/www/html` | `sync.sh:13` |
| Relay working directory | `/var/www/html/server` | `cuubz-relay.service:8` |
| Relay port | `8765` | `cuubz-relay.service:13`, `server/index.js:22` |
| Relay entry point | `index.js` | `cuubz-relay.service:9` |
| Relay node binary | `/home/dadmin/.local/node-v22.22.0-linux-x64/bin/node` | `cuubz-relay.service:9` |
| Relay public hostname | `cuubz-relay.thehomelabguy.com` | `src/main.js:2126`, `multiplayer.md:35` |
| Service unit name | `cuubz-relay` | `cuubz-relay.service` |

### 3.1 What serves `/var/www/html` is UNVERIFIED

Nothing in this repo states it. Every `nginx` reference found
(`src/main.js:2112,2126`, `server/index.js:9`, `multiplayer.md:35,94,413`) describes
nginx **only** as the TLS reverse proxy in front of the *relay* on port 8765.
`multiplayer.md:47-48` hedges the static server as `"(nginx / built-in)"`. There is no
nginx config, no Apache config, and no `systemctl` invocation in the repo.

So: nginx is confirmed to be in the picture for `wss://cuubz-relay.thehomelabguy.com`
→ `127.0.0.1:8765`, and **unconfirmed** for the static root.

To determine it:

```bash
ssh dadmin@10.0.30.160 'ss -ltnp | grep -E ":(80|443) " ; ls /etc/nginx/sites-enabled/ 2>/dev/null'
```

Why it matters: it decides whether a deploy needs a reload at all (raw file serving
does not), whether directory indexes expose the files listed in [§4.2](#42-what-gets-shipped),
and whether any caching sits in front of `index.html`.

### 3.2 The relay is stateless. All player data is client-side.

`server/` performs **no filesystem writes** — no `writeFile`, no `mkdir`, verified
across all of `server/*.js`. Sessions live in an in-memory `Map` and are disposed on
shutdown (`server/index.js:198-213`). `multiplayer.md:34,82-89` confirms the design:
the relay is a dumb message forwarder, the *host player's browser* is authoritative and
persists world state.

Two consequences, both good and both worth stating plainly:

- **There is nothing on the server to back up.** No database, no save files. A rebuild
  of `10.0.30.160` from scratch loses no player data.
- **A bad deploy cannot corrupt player data** — only break the code that reads it. The
  data risk lives entirely in [§2](#2-do-not-change-player-data-invariants), i.e. in
  changing storage keys or formats, not in deploying.

The flip side: restarting the relay **immediately drops every connected player** and
destroys all in-flight sessions. See [§5](#5-restarting-the-relay-the-step-syncsh-does-not-do).

---

## 4. What `./sync.sh` actually does

> ### ▶ PR 10 REWROTE `sync.sh`. READ [§4.7](#47-the-pr-10-syncsh) FIRST.
>
> **[§4](#4-what-syncsh-actually-does) through [§4.6](#46-tar-xzf-never-deletes) describe
> the OLD script**, which is kept verbatim as **`sync-legacy.sh`** for one release cycle.
> They are the forensic record of eleven defects (D-2 … D-13) and of why each one
> mattered; every `sync.sh:NN` line number below refers to `sync-legacy.sh`. Do not read
> them as a description of the current deploy — read them as the reason it looks the way
> it does. [§4.7](#47-the-pr-10-syncsh) is the current one, defect by defect.
>
> **Nothing in the new script has ever been run against the host.** No session in this
> project has had an SSH key for `dadmin@10.0.30.160`. Run `./sync.sh --dry-run` — it
> prints every remote command without connecting — read it, then run it for real.
> [§9](#9-verification-status) is the authority on what is and is not verified.

Line-by-line, from `sync.sh` at commit `749304b` — now `sync-legacy.sh`. `set -e` (`:6`)
is in force locally.

| Step | Line | What happens |
|---|---|---|
| 1 | `9-10` | `SOURCE_DIR` = script's directory; `PROJECT_NAME` = its **basename** |
| 2 | `17-20` | exit 1 if `~/.ssh/id_ed25519` is missing |
| 3 | `25-31` | `tar czf /tmp/${PROJECT_NAME}-sync.tar.gz` of `.`, excluding `node_modules`, `.git`, `dist` |
| 4 | `34` | `scp` the archive to **`/var/www/html/${PROJECT_NAME}.tar.gz`** — inside the web root |
| 5 | `37` | `cd /var/www/html && tar xzf …` — extract **over the live tree** |
| 6 | `37` | `rm ${PROJECT_NAME}.tar.gz` |
| 7 | `38` | `find /var/www/html -type f -exec chmod 644 {} +` — **all** of it |
| 8 | `39` | `find /var/www/html -type d -exec chmod 755 {} +` |
| 9 | `41` | delete the local archive |

Steps 5–8 are a single `&&` chain in one `ssh` invocation. There is no `--delete`,
no backup, no atomic swap, and no verification that the site still works afterwards.

`PROJECT_NAME` comes from the **local directory name** (`sync.sh:10`), not from
`package.json`. In a checkout named `webgame-cuubz` the remote archive is
`/var/www/html/webgame-cuubz.tar.gz`. Renaming your local clone changes that filename.

### 4.1 Measured payload

Reproduced locally with the exact `tar` flags from `sync.sh:27-31`:

| Metric | Value |
|---|---|
| Compressed archive | **116,004,047 bytes (≈110 MiB)** |
| Entries in archive | **3,544** |
| Entries **not** under `textures/` | **171** |
| `textures/` on disk | **120 MB, 3,370 files** |
| Local `tar` time | ≈3.4 s |

**Every deploy ships all 118–120 MB of textures.** There is no `--exclude` for them and
no content check — `textures/` changes rarely and is re-uploaded in full every time.
`refactor.md` §1.8 covers the repo-size half of this problem; the deploy half is a
transfer-time cost on every single sync. Not fixed here: adding an exclude means the
first deploy to a fresh host ships no textures, so it needs a
`--exclude-if-unchanged`-style mechanism or a separate one-off asset sync. That is
PR 10's call.

### 4.2 What gets shipped

Excluded: `node_modules`, `.git`, `dist`, and (added by this PR) `.env`.

**Everything else in the repo root goes to the public web root**, including:

`.claude/settings.local.json` · `.github/` · `.gitignore` · `CRAFTING_PLAN.md` ·
`IMPLEMENTATION_PLAN.md` · `MOB_PLAN.md` · `PR4_HANDOFF.md` · `README.md` ·
`multiplayer.md` · `performance.md` · `refactor.md` · `DEPLOY.md` (this file) ·
`cuubz-relay.service` · `sync.sh` · `package.json` · `package-lock.json` ·
`scripts/` · `test/` (1.2 MB)

All of it then `chmod 644`, i.e. world-readable, under a web root. Whether it is
actually *reachable* over HTTP depends on the unidentified static server
([§3.1](#31-what-serves-varwwwhtml-is-unverified)); with default nginx or Apache
static serving, it is. That means `sync.sh` (host, user, key path), the systemd unit,
and `refactor.md` are fetchable. None of these contain credentials today — the SSH key
itself is never shipped — so this is information disclosure, not a key leak.

**`.env` was not excluded, and now is.** `.gitignore:2` lists `.env`, so the project
anticipates one existing locally; `sync.sh` had no matching exclude, so it would have
been tarred, extracted into the web root, and `chmod 644`'d. No `.env` exists in the
repo today, which is the only reason this was never a live leak. Fixed in this PR —
see [`BUGS.md`](./BUGS.md) D-1.

The `${PROJECT_NAME}.tar.gz` staging location is worse in kind: for the duration of
every deploy, a complete copy of the source tree sits at a predictable URL
(`http://10.0.30.160/webgame-cuubz.tar.gz`). It is removed on success — but only on
success. **If `tar xzf` fails, the archive stays there indefinitely.** Not fixed here:
moving the staging path changes where the deploy writes, which is exactly the
restructuring PR 10 owns.

### 4.3 The `dist` landmine

`sync.sh:30` — `--exclude='dist'`. `.gitignore:3` also ignores `dist/`.

**From PR 9 onward, `dist/` is the entire application.** A deploy in that window uploads
the source tree, excludes the only directory containing runnable JavaScript, and produces
a live site with no JS at all — a black page. `refactor.md` §1.4 calls this the single
biggest risk in the refactor and PR 10 ("must land with PR 9, not after") owns the fix.

> ### ⛔ PR 9 HAS LANDED. THE WINDOW IS OPEN. DO NOT RUN `./sync.sh`.
>
> This is no longer a prediction. As of PR 9:
>
> - `index.html` loads exactly one `<script type="module" src="/src/index.js">`. There
>   is no `js/` directory any more and there are no classic script tags.
> - `npm run build` produces a `dist/` that **runs** — `dist/index.html`, one bundled
>   JS asset, one CSS asset, and the two Web Worker sources as separate hashed assets.
>   `npm run test:e2e` drives a real browser against that output and passes 152/152,
>   so "the build works" is now checked rather than assumed. **D-24 is closed.**
> - `sync.sh` still carries `--exclude='dist'` and has not been touched.
>
> So a `./sync.sh` right now uploads `index.html`, `css/`, `textures/`, `test/`, `src/`
> and every planning document, **excludes the one directory that contains the
> application**, and serves a page whose only `<script>` points at `/src/index.js` —
> which is a raw ES module tree full of bare specifiers (`import … from 'three'`) that
> no browser can resolve without a bundler. The result is a black page.
>
> The earlier note here said the danger was "a human who runs `npm run build` and copies
> the output by hand". That has inverted: copying `dist/` by hand is now *closer* to
> correct than running `sync.sh` — it is only missing `textures/`. Neither is the
> supported path.
>
> **PR 10 rewrites `sync.sh` to build and ship `dist/` + `server/` + `textures/`, and
> until it lands there is no correct way to deploy this branch.** That is D-4, and it is
> why the plan requires PR 9 and PR 10 to land together.

> **PR 10 HAS ALSO LANDED, AND THE OPERATIONAL RULE HAS BEEN REPLACED.** Everything in
> the block above is a historical record of the PR 9 → PR 10 window; that window closed.
> The rule below is the current one and it is a different rule for a different reason.

**Operational rule (owner, 2026-07-30 — `BUGS.md` decision 20): do not deploy to
`10.0.30.160` until the entire rewrite is finished.** Not at the Phase 1 gate, not at the
Phase 2 gate. **PR 10's `sync.sh` stays unverified on purpose.**

This replaces "do not run `./sync.sh` until PR 10 lands", which after PR 10 landed read as
permission to deploy. It is not a technical block — `./sync.sh --dry-run` works, and §9's
eleven checks are ready for whenever the first real deploy happens. It is a scheduling
decision by the owner, and it comes with a cost that is accepted rather than overlooked:

> **The delta between `refactor/phase-0` and anything that has ever run on the host grows
> with every PR, and the first real `./sync.sh` will be debugged against a codebase that
> has changed shape six times.** `sync.sh` deletes before it extracts, installs a systemd
> unit, and repoints which node binary production runs — all of it against a machine no
> session in this project has ever connected to. Doing that once, at the end, against a
> tree that no longer resembles the last known-good deploy, is harder than doing it six
> times incrementally. That trade is the owner's to make and it has been made.

What follows from it, so nothing waits on a deploy that is not coming:

- The Phase 1 gate's "Deploy works end to end" box stays **unticked and deliberately
  deferred**, not blocked. `refactor.md`'s Phase 1 gate says so in those words.
- **D-30 (`minify: false`) and D-12 (`StrictHostKeyChecking`) both say "revisit after the
  first real deploy".** That is now "after the rewrite", not "after Phase 1". Neither
  should be re-litigated in the meantime.
- Every `npm run test:e2e` still rehearses the deployed layout — `test/e2e/staticServer.js`
  serves `dist/` with a repo-root fallback for `textures/`, which is exactly the two-artifact
  split PR 10 creates on the host. That is the only deploy evidence this project has, and it
  is worth keeping green for that reason.

### 4.4 The `chmod` is the fragile step

```bash
find /var/www/html -type f -exec chmod 644 {} +
```

Three problems:

1. **Scope.** It recurses all of `/var/www/html`, not `/var/www/html`'s Cuubz files.
   Any other site hosted in that root gets its permissions flattened too.
2. **It fails on files `dadmin` does not own.** `chmod` returns non-zero, so `find`
   does, so the `&&` chain stops, so `ssh` exits non-zero, so `set -e` aborts
   `sync.sh` — **after step 5 already overwrote the live tree**. The failure message
   is about permissions and gives no hint that a partial deploy is now live. This is
   the most likely way for a deploy to fail confusingly. `[UNVERIFIED]` — whether any
   such file exists on this host is unknown.
3. **It flattens the executable bit off everything**, including the copy of `sync.sh`
   it just uploaded. Harmless here (nothing on the server is executed as a script;
   the relay is launched by systemd with an explicit node binary), but it means file
   modes are not preserved across a deploy and cannot be relied on.

### 4.5 `node_modules` is never shipped

`sync.sh:28` excludes `node_modules`, and **nothing in the deploy runs `npm ci` or
`npm install` on the remote.** But `server/index.js:14` and `server/matchmaking.js:21`
both `require('ws')`.

So the relay depends on `ws` already being present on the host. Node resolves it by
walking up from `/var/www/html/server/index.js`, i.e. it will find
`/var/www/html/server/node_modules/ws` or `/var/www/html/node_modules/ws`. One of
those must exist, installed manually at some point in the past. `[UNVERIFIED]`:

```bash
ssh dadmin@10.0.30.160 'ls -d /var/www/html/node_modules/ws /var/www/html/server/node_modules/ws 2>&1'
```

**Consequence: dependency changes never reach production.** Bumping `ws` in
`package.json`, or adding any new runtime dependency to `server/`, deploys the code
that needs it and not the dependency itself. The relay then throws
`Cannot find module` on restart. Whoever changes `server/`'s dependencies must
`npm install --omit=dev` on the host by hand, in the directory that owns the existing
`node_modules`.

### 4.6 `tar xzf` never deletes

Extraction overwrites and adds. It never removes. **A file deleted from the repo lives
on the server forever.**

**PR 9 made this concrete.** `js/` is gone from the repo — 65 files moved to `src/` and
`js/three.min.js` was deleted — but the next deploy will not remove one byte of it from
the host. The server will host the entire pre-PR-9 `js/` tree, dead, still fetchable,
alongside whatever PR 10 starts uploading, and indistinguishable from the live code to
anyone debugging via the browser's network tab. `index.html` will point at the new
layout, so the stale copy stays invisible until someone goes looking. Same for `test/`
and every planning doc ever deployed. **PR 10 owns making a deploy delete.**

Manual cleanup after a rename-heavy deploy `[UNVERIFIED]`:

```bash
ssh dadmin@10.0.30.160 'ls /var/www/html'     # inspect first — this root may host other sites
# then remove only paths you have confirmed are stale, e.g.:
# ssh dadmin@10.0.30.160 'rm -rf /var/www/html/js'
```

Never script this blind. `/var/www/html` is a shared root
([§4.4](#44-the-chmod-is-the-fragile-step)) and `rm -rf` there is not recoverable.

---

### 4.7 The PR 10 `sync.sh`

The rewrite exists because of **D-4**: PR 9 turned the application into `dist/`, and the
old script's `--exclude='dist'` would have uploaded everything except it. `refactor.md`
§1.4 calls that the single biggest risk in the whole refactor, which is why the plan
requires PR 9 and PR 10 to land together.

```bash
./sync.sh                # build, deploy the app + relay, restart the relay
./sync.sh --textures     # also upload textures/ (118 MB — only when they change)
./sync.sh --dry-run      # print every remote command, connect to nothing
./sync.sh --no-restart   # deploy but leave the relay running
```

**What ships, and where it lands:**

| Local | Remote | Notes |
|---|---|---|
| `dist/*` | `/var/www/html/` | `index.html` + `assets/` — the built application |
| `server/` | `/var/www/html/server/` | unchanged by PR 9; still CommonJS, still the relay |
| `cuubz-relay.service` | `/var/www/html/` | data only; systemd reads it from `/etc` |
| `textures/` | `/var/www/html/textures/` | **separate artifact** — skipped unless `--textures` or absent on the host |

Nothing else. Not `src/`, `test/`, `scripts/`, `node_modules/`, `.git/`, `.claude/`, or
any planning `.md`.

**Step by step, with the row each step closes:**

| Step | What it does | Closes |
|---|---|---|
| 1 | `npm run build`, then refuse to continue unless `dist/index.html` exists **and contains a module script tag**. Runs before the host is touched at all | **D-4** |
| 2 | Pack `dist/*` + `server/` + the unit file into a temp archive **outside** the repo and outside the web root | **D-7**, **D-13** |
| 3 | Stage it in `/home/dadmin/cuubz-deploy/incoming/`, not in `/var/www/html` | **D-7** |
| 4 | Tar the current web root (minus `textures/`) to `/home/dadmin/cuubz-deploy/backups/webroot-<stamp>.tar.gz`, keep the last 5 — **before** anything is deleted | **D-3** |
| 5 | `rm -rf` the managed paths in the web root, then extract. A deploy now converges on what the repo contains instead of accreting | **D-5** |
| 6 | `chmod` scoped to what was extracted, `textures/` pruned, and after extraction has already succeeded | **D-6** |
| 7 | `npm ci --omit=dev` in `/var/www/html/server` | **D-9** |
| 8 | Textures uploaded only on `--textures`, or automatically if `textures/blocks/manifest.json` is missing on the host | **D-11** |
| 9 | Point `~/.local/node` at the newest `node-v*-linux-x64` under `~/.local` | **D-10** |
| 10 | Install the unit file **only if it differs**, `daemon-reload` if so, then `systemctl restart cuubz-relay` and confirm it came back | **D-2** |
| 11 | Verify on the host: `index.html` exists, it references a `.js`, and that file is on disk. Then `textures/blocks/manifest.json` and `server/index.js` | the D-4 failure mode |

`StrictHostKeyChecking` went from `no` to `accept-new` (**D-12**): the first key is
trusted and pinned, a *changed* key is an error. On a LAN IP that is an improvement
rather than a fix, and the row stays open with that note.

**Two deliberate soft failures.** A deploy is not all-or-nothing once files are on the
host, and pretending otherwise produces the worst outcome — a script that aborts halfway
and leaves the operator guessing which half ran.

- **The relay restart warns, it does not abort.** `sudo -n` fails immediately if `dadmin`
  has no passwordless sudo (rather than hanging on a password prompt with no TTY), and
  the script then prints the exact two commands to run by hand. The static site is
  already deployed and correct at that point; only the relay is stale.
- **`chmod` is `|| true`.** Extraction has already succeeded. A file owned by another
  user is something to be told about, not something to fail a completed deploy over.
  This is the specific ordering bug D-6 describes, inverted.

**The deploy layout is tested locally, on every `npm run test:e2e`.** That is not a
coincidence: `test/e2e/staticServer.js` serves `dist/` with a fallback to the repo root
for `textures/` — the same two-artifact split this script creates on the host. So the
152-assertion harness is, among other things, a rehearsal of the served layout. What it
cannot rehearse is `ssh`, `sudo`, `systemctl`, and the filesystem on the other end.

**Not fixed here, and why.** `D-12` stays open as a note (see above). The web root is
still overwritten in place rather than swapped via a `releases/current` symlink — an
atomic swap needs the web server's document root to point at a symlink, and nothing in
this project has ever verified what serves `/var/www/html` ([§3.1](#31-what-serves-the-static-site-unverified)).
Guessing at nginx configuration from a machine that cannot reach the host is how you
take a site down for real. The backup in step 4 is the rollback until that is known.


## 5. Restarting the relay

> **PR 10 fixed this (D-2).** `sync.sh` now installs the unit file if it changed,
> `daemon-reload`s if so, runs `systemctl restart cuubz-relay`, and confirms the unit
> came back active. If `dadmin` has no passwordless sudo the script **warns and prints
> the two commands below** rather than failing the deploy — the static site is already
> live and correct at that point, and only the relay is stale. `[UNVERIFIED]` against the
> host, like everything else on the remote side.
>
> The paragraph below is the pre-PR-10 state and the reason the step exists.

**The old `sync.sh` never restarted anything.** There was no `systemctl`, `service`,
`kill`, or `pm2` call anywhere in the repo — verified across all tracked files; the only
`systemctl` text was documentation prose in `multiplayer.md:376-377`.

So **after any change under `server/`, the deploy was not finished until someone
restarted the relay by hand.** The new source sat in `/var/www/html/server/` while the
old code kept running from memory. The failure mode was silent — the deploy printed
`Sync complete!` and the relay served stale behaviour indefinitely.

```bash
# Restart (required after any server/ change)
ssh dadmin@10.0.30.160 'sudo systemctl restart cuubz-relay'

# Confirm it came back
ssh dadmin@10.0.30.160 'systemctl status cuubz-relay --no-pager'
ssh dadmin@10.0.30.160 'journalctl -u cuubz-relay -n 50 --no-pager'
```

A healthy start logs three lines (`server/index.js:190-194`):

```
[RELAY] Listening on port 8765
[RELAY] Matchmaking: ws://<host>:8765/matchmaking
[RELAY] Sessions:    ws://<host>:8765/session/:id
```

First-time setup only (`multiplayer.md:376-377`, `[UNVERIFIED]`):

```bash
sudo cp /var/www/html/cuubz-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cuubz-relay
```

Note the unit file is deployed *into the web root* as data; it is not read from there
by systemd. Editing `cuubz-relay.service` in the repo and running `sync.sh` changes
nothing until it is copied to `/etc/systemd/system/` and `daemon-reload`ed.

### 5.1 Restarting drops every connected player

`SIGTERM` is handled (`server/index.js:215-217`, delegating to the `SIGINT` handler at
`:198-213`): it disposes every live session, clears the map, closes the WebSocket
server and the HTTP server, then exits 0. So the shutdown is *clean* — but it is not
*graceful* toward players. Every in-flight multiplayer session is destroyed.

Because the relay is stateless ([§3.2](#32-the-relay-is-stateless-all-player-data-is-client-side))
no world data is lost — the host player's browser holds it. Clients reconnect with
exponential backoff (`multiplayer.md:125`) and `'cuubz_last_session'` supports rejoin.
Still: restart when nobody is playing if you can.

`Restart=on-failure` + `RestartSec=5` (`cuubz-relay.service:10-11`) means a crash
self-heals in 5 s. Note that `uncaughtException` and `unhandledRejection`
(`server/index.js:219-225`) both route into the clean-shutdown path with
`process.exit(0)` — **exit code 0 is not a failure**, so `on-failure` will *not*
restart the relay after an unhandled error. It stays down. `[UNVERIFIED]` in
production; flagged as D-8 in [`BUGS.md`](./BUGS.md).

### 5.2 The node version is pinned by absolute path

```ini
ExecStart=/home/dadmin/.local/node-v22.22.0-linux-x64/bin/node index.js
```

Production runs **node 22.22.0**, from a hand-unpacked tarball in `dadmin`'s home
directory — not a package-managed node, not on `PATH`, not a version manager shim.

- **Upgrading or removing that directory breaks the unit**, by path. systemd reports
  `status=203/EXEC` and `Restart=on-failure` retries forever, 5 s apart. Any node
  upgrade on this host requires editing `ExecStart` and `daemon-reload` in the same
  change window.
- **CI does not test this version.** `.github/workflows/ci.yml` uses
  `node-version: '22'`, which resolves to the latest 22.x (currently 22.23.x). So CI
  validates a newer node than production runs.
- The skew has one known sharp edge: `jsdom@30.0.1` declares
  `engines: node ^22.22.2 || ^24.15.0 || >=26.0.0`, and production's 22.22.0 is *below*
  that floor. Harmless in practice — `jsdom` is a devDependency used only by
  `test_pageLoad` (currently quarantined) and no test runs in production. But it means
  "green in CI" is not the same statement as "runs on the relay host".

**Changed by PR 10 (D-10).** The unit no longer names a version:

```ini
ExecStart=/usr/bin/env node index.js
Environment="PATH=/home/dadmin/.local/node/bin:/home/dadmin/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
```

`/home/dadmin/.local/node` is a **symlink `sync.sh` creates and refreshes on every
deploy**, pointing at the newest `node-v*-linux-x64` directory under `~/.local`. So a
node upgrade is "unpack the tarball, run `./sync.sh`" — no unit edit, no
`daemon-reload`, and no path that goes stale the moment the old directory is removed.
That is the owner's ruling (`BUGS.md` decision 4): resolve node from the environment
rather than pin a patch version that has already drifted from the one CI tests.

**This is the single highest-risk unverified change in PR 10.** It decides which
interpreter runs the production relay and it has not been executed against the host.
The specific ways it can fail, in order of likelihood:

1. `~/.local` contains no `node-v*-linux-x64` directory (a differently-named unpack).
   `sync.sh` prints `no ~/.local/node-v*-linux-x64 found — leaving the symlink alone`
   and continues; the relay then fails `203/EXEC` on restart. **Read the deploy output.**
2. The symlink is created but systemd's `PATH` override is wrong for this systemd
   version — quote handling around `Environment=` differs across releases.
   `systemctl show cuubz-relay -p Environment` is the check.
3. It works and silently starts a *different* node than 22.22.0, because the glob picks
   the newest. That is the intent, and it is why CI's node 22.23.x is now the closer
   match rather than the skew this section used to describe.

If any of it goes wrong the fallback is one line — put the absolute path back in
`/etc/systemd/system/cuubz-relay.service` and `daemon-reload`. Verify with:

```bash
ssh dadmin@10.0.30.160 'ls -l ~/.local/node && ~/.local/node/bin/node --version'
ssh dadmin@10.0.30.160 'systemctl show cuubz-relay -p ExecStart -p Environment'
ssh dadmin@10.0.30.160 'systemctl status cuubz-relay --no-pager'
```

The CI-skew note above still stands and is now smaller: CI runs the latest 22.x and the
host will run whatever is newest under `~/.local`, so the two converge instead of
drifting by construction.

---

## 6. Rollback

> ### ▶ PR 10 gave this a target (D-3). Read [§6.5](#65-the-pr-10-rollback) first.
>
> `sync.sh` now tars the web root into
> `/home/dadmin/cuubz-deploy/backups/webroot-<stamp>.tar.gz` **before** it deletes
> anything, and keeps the last five. That is a real artifact to roll back *to*, which
> [§6.1](#61-there-is-no-rollback-mechanism-this-is-the-honest-answer) correctly said
> did not exist. §6.1–§6.4 describe the pre-PR-10 state and remain accurate about
> `sync-legacy.sh`; §6.5 is the current procedure. It is `[UNVERIFIED]` like everything
> else on the remote side.

### 6.1 There is no rollback mechanism. This is the honest answer.

*(Pre-PR-10. Describes `sync-legacy.sh`.)* Read `sync.sh:37` again:

```bash
cd /var/www/html && tar xzf webgame-cuubz.tar.gz && rm webgame-cuubz.tar.gz
```

`tar xzf` extracts **over the live tree in place**. Before that line runs:

- no backup is taken;
- no previous copy is retained anywhere;
- there are no versioned or timestamped release directories;
- there is no symlink to flip;
- the uploaded archive — the one artifact that could serve as a record — is deleted
  immediately afterwards.

**Once you deploy, the previous state of the server no longer exists.** There is
nothing to roll back *to*, on the server. Any procedure that claims otherwise is
describing machinery this repo does not have.

### 6.2 What you can actually do: re-deploy a known-good commit

This is roll-*forward*-to-old-code, not rollback. It is the only option today.

```bash
# 1. Identify the last known-good commit or tag.
git tag -l                       # pre-refactor-baseline is the Phase 0 rollback point
git log --oneline -20

# 2. Check it out into a SEPARATE directory. Do not do this in your working clone:
#    sync.sh derives the remote archive name from the directory basename (sync.sh:10),
#    and you want your own branch state left alone.
git worktree add ../cuubz-rollback pre-refactor-baseline
cd ../cuubz-rollback

# 3. Verify before shipping — the gates exist for exactly this moment.
npm ci && npm test && npm run check-globals

# 4. Deploy it.
./sync.sh

# 5. If server/ differed, restart the relay.
ssh dadmin@10.0.30.160 'sudo systemctl restart cuubz-relay'

# 6. Clean up.
cd - && git worktree remove ../cuubz-rollback
```

**Step 2 caveat:** the worktree directory is named `cuubz-rollback`, so `sync.sh` will
stage `/var/www/html/cuubz-rollback.tar.gz` instead of `webgame-cuubz.tar.gz`
(`sync.sh:10`). Harmless — it extracts to the same place — but if that deploy fails,
the leftover archive has a different name than you might expect when cleaning up.

### 6.3 Three ways this still does not fully restore the server

1. **Deletions do not un-happen.** `tar xzf` never removes files
   ([§4.6](#46-tar-xzf-never-deletes)). Re-deploying an older commit restores the old
   files *and leaves every file the bad deploy added*. After PR 9, rolling back from
   the PR 9 layout to the pre-PR-9 one leaves `src/` live on disk. Rollback must be followed by manual
   inspection and removal.
2. **It requires the known-good ref to be reachable.** `pre-refactor-baseline` is
   **currently a local-only tag** — `git ls-remote --tags origin` returns nothing. If
   the machine holding it dies, the Phase 0 rollback point is gone, and with it the
   only usable rollback target. **Pushing that tag is a prerequisite for this section
   working at all**, and it is still an open PR 1 accept criterion.
3. **It does not restore permissions or the relay's `node_modules`.** Modes were
   flattened to 644 ([§4.4](#44-the-chmod-is-the-fragile-step)) and dependencies are
   not part of any deploy ([§4.5](#45-node_modules-is-never-shipped)).

### 6.4 Assessment against PR 6's accept criterion

> *"Accept: a fresh implementer can deploy and roll back from the doc alone."*

**Deploy: met.** [§1](#1-the-short-version), [§4](#4-what-syncsh-actually-does) and
[§5](#5-restarting-the-relay-the-step-syncsh-does-not-do) are complete and specific,
including the relay restart that `sync.sh` omits. Unverifiable-without-SSH steps are
marked as such rather than asserted.

**Rollback: not met, and it cannot be met by documentation.** The accept criterion
assumes a capability the system does not have. §6.2 is the best procedure that exists,
and it is a re-deploy with three documented gaps, not a rollback. Writing anything
stronger would mean inventing machinery — a release directory, a retained previous
copy, a symlink flip — that no line of this repo implements, and a fresh implementer
following such a procedure during an outage would discover that mid-incident.

**PR 6 therefore closes with one accept criterion partially unmet, deliberately.**
Two things close the gap, neither of them a documentation task:

- **Push `pre-refactor-baseline`** (open PR 1 criterion). Cheap, and §6.2 depends on it.
- **PR 10 must add a real rollback path** — versioned release directories plus an
  atomic symlink swap, or at minimum retaining the previous tree — alongside the
  build-then-ship rewrite it already owns. PR 10 is already scoped to rewrite
  `sync.sh`; rollback belongs in that rewrite, and this document should be updated in
  the same PR.

---

### 6.5 The PR 10 rollback

**There is now something to roll back to.** Every `./sync.sh` run tars the web root —
minus `textures/`, which is 118 MB and is not what a bad deploy breaks — into
`/home/dadmin/cuubz-deploy/backups/webroot-<UTC stamp>.tar.gz`, **before** it deletes
anything, and prunes to the last five. That is D-3's fix, and it is deliberately the
boring one: no release directories, no symlink to flip, no web-server configuration
touched.

```bash
# 1. What is available.
ssh dadmin@10.0.30.160 'ls -lt /home/dadmin/cuubz-deploy/backups/'

# 2. Restore. Remove the managed paths first — untarring over a broken tree leaves
#    the broken files that the backup does not happen to contain (the same D-5 trap
#    the deploy itself had to solve).
ssh dadmin@10.0.30.160 'cd /var/www/html \
  && rm -rf assets server index.html cuubz-relay.service \
  && tar xzf /home/dadmin/cuubz-deploy/backups/webroot-<STAMP>.tar.gz -C /var/www/html'

# 3. The relay is a separate concern — server/ came back with the tarball, but the
#    running process did not.
ssh dadmin@10.0.30.160 'sudo systemctl restart cuubz-relay && systemctl status cuubz-relay --no-pager'

# 4. Confirm the site serves JS. This is the check whose absence was D-4.
curl -s http://10.0.30.160/ | grep -o 'src="[^"]*\.js"'
curl -sI "http://10.0.30.160/$(curl -s http://10.0.30.160/ | grep -o 'assets/[^\"]*\.js' | head -1)" | head -1
```

**Three things this still does not cover, stated rather than implied:**

1. **Textures are not in the backup.** If a deploy breaks `textures/` — only possible
   with `--textures` — restore them with `./sync.sh --textures` from a good commit.
2. **The database is untouched and that is correct.** Player worlds live in the
   browser's IndexedDB ([§2](#2-do-not-change-player-data-invariants)), not on this
   host. A rollback of the site does not roll back player data, and a rollback that
   moves `DB_VERSION` *down* is the one genuinely dangerous case —
   [§2.1](#21-indexeddb--worlds-and-terrain)'s five-step procedure exists for that.
3. **`/etc/systemd/system/cuubz-relay.service` is not in the backup.** `sync.sh` only
   copies the unit into `/etc` when it differs, so rolling back the web root can leave a
   *newer* unit installed than the code you just restored. Check with
   `systemctl cat cuubz-relay` and re-copy from the restored `/var/www/html/` if needed.

**Still preferred where it applies: re-deploy a known-good commit**
([§6.2](#62-what-you-can-actually-do-re-deploy-a-known-good-commit)). It is reproducible
from git rather than from a tarball on one host, and `pre-refactor-baseline` (`27959d3`)
is pushed. The backups are for the case where the last good state is not a commit — a
half-applied deploy, or a host you cannot rebuild from source right now.


---

## 7. Save/load checklist

> ### ▶ Most of this is automated. Run the script first.
>
> ```bash
> npm run test:e2e        # test/e2e/saveLoad.js — added by PR 6b
> ```
>
> A real browser (Edge, driven by `playwright-core`, WebGL via SwiftShader) walks the
> menu flow, generates two worlds from pinned seeds, and reads IndexedDB and
> localStorage directly. **152 assertions, exit 0, ~6 minutes.** Since PR 9 it builds
> first and serves `dist/`, so it also proves the deployed artifact runs. Screenshots land in
> `test/e2e/artifacts/` (gitignored).
>
> ```bash
> npm run test:e2e:vite   # the same 152 assertions against `npm run dev` (PR 7)
> ```
>
> Added by PR 7 so "Vite serves the existing site unchanged" is checked rather than
> asserted. The two hosts must produce the same numbers; if they diverge, the dev
> pipeline changed the game. `test/e2e/staticServer.js` remains the default and the
> parity baseline.
>
> It covers steps 1, 2, 3, 5, 6, 7, **8, 9**, 10, 11 and 14 outright, plus every invariant in
> [§2](#2-do-not-change-player-data-invariants) — including the chunk binary header
> decoded from bytes the browser actually wrote, and the database version read
> **without** triggering the `onupgradeneeded` handler described in
> [§2.1](#21-indexeddb--worlds-and-terrain).
>
> **Two steps it cannot do, and you still have to:** step 4 (place/break blocks) and
> steps 12–13 (multiplayer). Both need pointer lock, so both wait for PR 12–13. The
> script prints them as `⚠️ UNVERIFIED` with what would close each, so a passing run
> never implies more than it checked. It is deliberately **not** in `npm test` and
> **not** in CI — see the comment block in `.github/workflows/ci.yml`.
>
> **No assertion in it describes a defect any more.** PR 6b shipped three that did —
> **D-14**, **D-15** and **H-1** — each headed `ASSERTING A KNOWN DEFECT`, passing
> because the bug was present, on the rule that a run goes red if a new failure appears
> **or** if a known failure stops reproducing. All three have been fixed and their
> blocks rewritten into the assertions the fixes make true: D-14 inside PR 6b, D-15 and
> H-1 in PR 6c. **Steps 8–9 are now the H-1 regression test.** If a future PR needs the
> pattern again, keep the header and write the replacement assertion beside it.

Run the manual remainder **at every Phase gate and after every deploy.**
`refactor.md` §1.5 specifies this as a manual gate until PR 32 can automate it.
Storage is the one part of this codebase with no automated coverage and
unrecoverable failure modes, so it is worth the ten minutes.

**Timing rules — these are why naive attempts produce false failures.** Save is not
synchronous with your actions:

| Data | Saved when | Source |
|---|---|---|
| Chunks / placed blocks | dirty-flush timer, **every 5 s** | `src/main.js:2359,4491` → `chunkmanager.js:597-600` |
| Chunks (best effort) | `beforeunload`, and `visibilitychange` → hidden | `chunkmanager.js:751-782` |
| Inventory + per-world spawn point | **every 30 s**, on **Escape**, and on `game.stop()` | `src/main.js:3864-3884` |

The `beforeunload` chunk flush starts an IndexedDB transaction during teardown
(`chunkmanager.js:757-776`); by spec that is best-effort and may not complete.
**So: after placing blocks, wait 5+ seconds, and press Escape, before reloading.** A
block that vanishes after an instant reload is not necessarily a regression.

### The checklist

Serve the repo over HTTP — `file://` breaks the relative `fetch` in
`textureAtlas.js` and the Web Worker Blob loader. Any static server works
(`python3 -m http.server 8080`). Open the browser console and keep it visible; every
step below has a console-visible failure mode.

| # | Step | Expected | Automated |
|---|---|---|---|
| 1 | Load the page | No console errors. Menu renders. | ✅ |
| 2 | Create a character | Appears in the character list. `localStorage['cuubz:characters']` is a non-empty array. | ✅ |
| 3 | Create a world in slot 0, enter it, **survival** | Terrain generates. `localStorage['cuubz:slotMap']` maps the world id → `0`. | ✅ |
| 4 | Place ~10 blocks in a recognisable shape at spawn. Break 2–3 blocks. | Blocks appear/disappear. Broken blocks drop the **correct** item (PR 4 bug 1 — andesite must not drop cobblestone). | ✅ **for the edit itself, as of PR 12** — the harness places one block and breaks one through the production `setBlock` + `markChunkDirty` path. ❌ for the mouse (pointer lock) and for the drop table |
| 5 | Pick up the drops, note the hotbar contents. **Press Escape. Wait 5 s.** | Pause menu opens. Console logs `[Cuubz] Saved player state`. | ✅ (pause menu; hotbar is manual) |
| 6 | **Reload the page** (F5), re-enter the same world | **Your shape is exactly as you left it. Broken blocks are still broken. Inventory and hotbar match.** ← the load-bearing assertion | ✅ for terrain (byte-identical) **and, as of PR 12, for a placed block and a broken block**; ❌ for inventory + hotbar |
| 7 | Quit to menu, re-enter the same world without reloading | Same result as step 6. | ✅ for terrain (was blocked by **D-14**, fixed in PR 6b — see [§7.2](#72-step-7-was-unrunnable-until-pr-6b--d-14)) |
| 8 | **Two-world test.** Create a world in slot 1. Enter it, look at spawn. | The slot 1 world generates its own terrain. The slot 0 world's saved chunks are **untouched** — the store now holds both worlds in full. Failed until PR 6c (**H-1**); see [§7.1](#71-steps-89-were-h-1-fixed-in-pr-6c). | ✅ |
| 9 | Return to the slot 0 world | **Your own terrain, not the other world's.** Same result as step 6. | ✅ |
| 10 | Open DevTools → Application → IndexedDB | DB `cuubz-worlds`, **version 2**, stores `chunks` + `manifests`. If the version is not 2, **stop** — see [§2.1](#21-indexeddb--worlds-and-terrain). | ✅ read programmatically, without triggering an upgrade |
| 11 | Change a graphics setting, reload | Setting persists. `localStorage['cuubz:settings']` reflects it. | ✅ |
| 12 | Host a multiplayer session, join from a second browser profile, place a block as the guest | Block appears for both. Host's browser persists it (host is authoritative). | ❌ manual |
| 13 | Quit both. Reload as host, re-enter | The guest's block is still there. | ❌ manual |
| 14 | Confirm the tree is clean | `git status` clean — the manifest smoke test snapshots and restores `textures/blocks/manifest.json`; a dirty tree means it did not. | ✅ |

### 7.1 Steps 8–9 were H-1. Fixed in PR 6c.

This subsection used to document why these two steps failed, and instructed whoever
fixed H-1 to invert the harness block and delete it. PR 6c did both. What is left is the
pointer, because the anchor is cited from
[§2.4](#24-storage-hazards--pre-existing-do-not-mistake-these-for-refactor-regressions)
and [§9](#9-verification-status), and because the numbers are worth being able to find.

- **What the bug was, and what fixed it:** the H-1 entry in
  [§2.4](#24-storage-hazards--pre-existing-do-not-mistake-these-for-refactor-regressions),
  and the two-key box in [§2.1](#21-indexeddb--worlds-and-terrain).
- **The full measurements from both runs, before and after:** `refactor.md` §5 PR 6b (the
  damage) and PR 6c (the fix).
- **The ledger row, with severity and owner:** [`BUGS.md`](./BUGS.md).

**In one line each.** Before: one visit to a second world destroyed **1,073 of the first
world's 1,184 saved chunks**, and re-entering the first world served the second world's
spawn chunk byte for byte. After: world A keeps **1,184 of 1,184**, its spawn chunk is
byte-identical with `savedAt` unchanged, and the store holds **2,393 records — the sum of
both worlds** (1,184 + 1,209), not the union of their coordinates.

**Neither of these was ever a refactor regression.** H-1 predated Phase 0 entirely; PR 6
predicted it from the read paths, PR 6b observed it, PR 6c fixed it. That sequence is the
argument for the gate existing.

### 7.2 Step 7 was unrunnable until PR 6b — D-14

`src/main.js:4562` called `game.playerSync.reset()`. `PlayerSyncManager` has no
`reset()` — that method belongs to `PingTracker` (`playerSync.js:103`; class
boundaries at `:51`, `:125`, `:366`). `game.playerSync` is set whenever
`sessionManager.client` exists, **including solo play** (`main.js:2612`), so **every
"Exit to Menu" threw a `TypeError`** partway through `onExit`.

The throw skipped six cleanup steps and, critically, `showScreen('mainMenu')`
(`main.js:4603`) — leaving **every screen hidden: a blank page with no way back except
F5.** So step 7 was not "expected to fail", it was unreachable: there was no menu to
re-enter the world from. It had presumably been broken since `playerSync` was wired in,
because nothing exercised the quit path.

**Fixed in PR 6b by deleting the call.** `clearAll()` on the line above already disposes
every remote-player mesh and clears the map (`playerSync.js:523-531`), so it was
redundant as well as wrong. Step 7 is now a real automated round trip — quit to menu,
re-enter without a reload, assert chunk `"0,0"` is byte-identical with `savedAt`
unchanged — plus a guard that `onExit` returns to the menu, raises nothing, and leaves
no in-game overlay visible, which is exactly how D-14 presented.

**If steps 6, 7 or 13 fail, stop the refactor and bisect.** Those three are the whole
point of the checklist. 6 and 7 are now automated for terrain; 13 is still manual.

---

## 8. Known defects and who owns them

> ### ➜ The defect list is [`BUGS.md`](./BUGS.md). This section is a pointer.
>
> **One list, not two.** This table used to be the list, and it shipped with six rows
> reading **"Unowned"** — one of which was **H-1**, live data corruption that destroyed
> ~90% of a world's saved chunks per cross-world visit and stayed unowned through two
> PRs. `BUGS.md` consolidates every defect in this document plus the ones that were only
> ever mentioned in `refactor.md` prose, under a rule that **no row may be unowned**:
> every one names the PR that will fix it, and a PR slot gets created in `refactor.md` if
> none exists. Do not restart a table here.
>
> What `BUGS.md` holds that this table did not:
>
> - **Owners for the six rows that had none** — D-8 and D-10 → PR 10, D-12 → PR 10,
>   H-2 and H-3 → **PR 6d** (a new slot), plus the two defects that were loose in
>   `refactor.md` prose with no ID at all: the `SurvivalSystem` spawn `y` (**D-21** →
>   PR 22) and the four relay tests binding fixed ports (**D-20** → PR 31).
> - **The defects PR 6c found and fixed** — D-17, D-18, D-19 — and the two it closed:
>   **H-1** and **D-15**.
> - **Which open decisions block which rows**, so a decision is neither made twice nor
>   lost.
>
> The deploy-side rows (**D-1** … **D-13**) are all still real and all still owned by
> **PR 10**, which rewrites `sync.sh` and must land with PR 9. The sections of this
> document they cite are unchanged: [§4](#4-what-syncsh-actually-does),
> [§5](#5-restarting-the-relay-the-step-syncsh-does-not-do), [§6](#6-rollback).


---

## 9. Verification status

### Verified by reading the cited file at commit `749304b`

Every line, path, port, constant, storage key and format value in this document. Also
verified by execution:

- The `tar` payload — reproduced locally with `sync.sh`'s exact flags: 116,004,047
  bytes, 3,544 entries, 171 non-texture entries, 120 MB / 3,370 files of textures.
- No `systemctl` / `service` / `pm2` call exists anywhere in the repo.
- `server/` performs no filesystem writes (no `writeFile` / `mkdir` in any `server/*.js`).
- `ws` is required by `server/index.js:14` and `server/matchmaking.js:21`.
- `startFlushTimer(5000)` is genuinely wired up (`src/main.js:2359,4491`) — the 5 s
  figure in [§7](#7-saveload-checklist) is real, not a default that never runs.
- No `.env` exists in the repo.
- `pre-refactor-baseline` is local-only: `git ls-remote --tags origin` returns nothing.
- `npm test` exits 0 (50/50 passing, 4 quarantined) and `node scripts/check-globals.js`
  exits 0 (0 duplicates, 65 script-tagged files, 368 top-level symbols) at this commit.

### Verified by execution in a real browser — added by PR 6b

`npm run test:e2e` (`test/e2e/saveLoad.js`), Edge 150.0.4078.105 headless, WebGL via
SwiftShader, **152 assertions / 0 failures / exit 0** (112 at PR 6b; PR 6c added 25 and
rewrote the H-1 and D-15 blocks from asserting the defects to asserting the fixes; PR 6d
added 12; PR 9 removed the `__THREE_LOAD_FAILED` check, which no longer has a flag to
read, and added three: the module bundle evaluated, both worker pools spawned, and
`navigator.hardwareConcurrency` is readable). This moved the following out of
"not verified":

- **Every value in [§2](#2-do-not-change-player-data-invariants)** — read from the
  running page rather than from source text. Database name, version `2` (read
  **without** firing `onupgradeneeded`), both object stores and their key paths, the
  non-unique `worldName` index, **both** chunk key formats (the logical
  `` `${cx},${cz}` `` and the world-scoped `` `${worldName}:${cx},${cz}` ``), all four
  `persistence.js` localStorage keys, `MAX_WORLD_SLOTS = 3`,
  `BLOCK_REGISTRY.length === 193`, and every chunk-format constant.
- **The chunk binary format, decoded from bytes the browser actually wrote.** Magic
  `0x43555542` at offset 0, version `3` at 4, `chunkX`/`chunkZ` matching the record
  key, height `256`, flags `0`, the run count, and the FNV-1a checksum at offset 16
  re-derived from the payload. The same buffer then decodes cleanly through
  `src/engine/world/ChunkBinaryCodec.js` under Node — a browser-writes / Node-reads crossing
  that is what protects the on-disk format through PR 9's module conversion.
- **§7 steps 1, 2, 3, 5, 6, 7, 10, 11, 14.** The two load-bearing ones both hold for
  terrain: chunk `"0,0"` is byte-for-byte identical with `savedAt` unchanged both after
  a **reload** (step 6) and after a **quit to menu with no reload** (step 7) — the
  terrain was loaded from storage, not regenerated. Step 7 also asserts that `onExit`
  returns to the menu, raises nothing, and leaves no in-game overlay visible, which is
  the shape D-14 failed in.
- **The clean-load claim is now literally true**: 0 uncaught exceptions, 0 console
  errors, 0 missing assets. It was not before — see the `console.error` fix recorded in
  `refactor.md` §5 PR 6b. The only exclusion on the asset check is `/favicon.ico`, which
  Chromium requests unprompted and the repo does not have.
- **`THREE.REVISION === 134`** and `window.__THREE_LOAD_FAILED` unset, i.e.
  `refactor.md` §1.2's pin is what the browser really loads. PR 8 must keep it there.

### Verified by execution in a real browser — added by PR 6c

Same harness, same browser. The four things PR 6c changed about a player's stored bytes
are each asserted end to end, against a database the browser itself wrote:

- **§7 steps 8–9 — H-1 is fixed, and the two-world test is now its regression test.**
  World A generated **1,184** chunk records; a full visit to world B (its own seed, 1,209
  records of its own) left **every one of A's 1,184 intact**, with A's spawn chunk
  byte-identical and `savedAt` unchanged, and A's manifest checksum for `"0,0"` matching
  the bytes stored under A's key. The store held **2,393 records = 1,184 + 1,209, the
  sum** — which is the number PR 6b predicted world-scoped keys would leave. The equality
  asserted is between the two worlds' own counts and the store total, not against that
  literal: world B's count moves by a chunk or two between runs depending on where its
  region pre-generation quiesces. Re-entering world A served world A's own bytes, not B's.
  Pre-6c the same run destroyed 1,073 of those 1,184 and served B's chunk byte for byte.
  **Zero records anywhere in the store carry an unscoped key.**
- **The migration, against a database seeded with pre-migration keys.** The harness writes
  a record the pre-6c way — bare `` `${cx},${cz}` `` primary key, `worldName` field beside
  it — then loads the game. The record is re-keyed under its own `worldName`, the bare row
  is gone, and the payload is **byte-identical** with `savedAt` preserved: the migration
  moves records, it does not re-encode them. Idempotency and the no-`worldName` case are
  covered by `test/test_chunkStorage.js`, which runs in CI.
- **D-15 — the stored length is exactly `20 + runCount * 4`**, asserted as an equality
  against the run count in the chunk's own header. The unit test that missed this bug for
  the life of the codec asserted `< actual * 1.5`, which both the bug and the fix satisfy.
- **D-17** — `deleteChunk` issues one delete request, asserted by operation count against
  a stub store in `test/test_chunkStorage.js`.

**Nine of the fourteen §7 steps were automated at PR 6b; it is twelve now** — 1, 2, 3,
**4 (PR 12)**, 5, 6, 7, **8, 9**, 10, 11, 14. Steps 12–13 remain, plus the mouse-driven half
of step 4 (see below). The 152-assertion run of PR 11 is **166** as of PR 12.

Two limits on that run, both stated because they bound what a green result means:

- **SwiftShader is not a GPU.** The screenshots in `test/e2e/artifacts/` are a
  self-consistent baseline — comparable to another SwiftShader run on the same
  Chromium, and useful as PR 9's "zero visual change" gate. They are **not** evidence
  that the game looks correct on real hardware.
- **Live game state is out of reach.** Only four things are on `window`
  (`CuubzGame`, `CuubzBlockPalette`, `MobIntegration`, `CuubzLogger`) and all four are
  classes. The running `renderer` / `chunkManager` / `player` / `inventory` are among
  the ~184 closure locals inside `startGame()`'s `setTimeout` (`refactor.md` §1.6), so
  the harness can click and type but cannot place a block or read the player's
  position. That is why the persistence checks read storage directly, and why steps 4
  and 12–13 stay manual until PR 12–13 hoist those locals onto `Game`.

### Verified by execution in a real browser — added by PR 6d

Same harness, same browser. One thing, and it is the thing this document spent three PRs
telling people not to do:

- **`DB_VERSION` was incremented over a pre-existing version-2 database and every record
  survived.** The harness creates a probe database through the shipped upgrade handler at
  version 2, writes three real encoded chunk records (two worlds) and a real manifest with
  real checksums, closes it, then reopens at **version 3** with a registered step that
  creates a new object store. After the increment: the version is 3, the new store exists
  **alongside** `chunks` and `manifests`, and every chunk and manifest record compares
  equal field for field — same primary keys, same `worldName`s, same byte lengths, same
  offset-16 checksums, same `savedAt`. Pre-6d that handler deleted every object store on
  the way, so the same run would have gone from three chunk records to zero.
- **It runs against a separate database name** (`cuubz-h2-upgrade-probe`), deleted before
  and after. `cuubz-worlds` is the live database the other ~140 assertions depend on, and
  driving an upgrade over it would bet all of them on the thing under test. The ladder
  receives the database, not the name, so the proof is unaffected. The run asserts
  afterwards that `cuubz-worlds` is still at version 2 with its record count unchanged.
- **The same increment runs in CI**, against the stub in `test/test_chunkStorage.js` §17,
  together with the H-3 repair path, the create-only property of every shipped step, and
  the abort-on-unregistered-version rule. `npm test` is 52/52 with that file at 129
  assertions.

### Verified by execution in a real browser — added by PR 7

- **The Vite dev server serves the identical game.** The full harness — all 150
  assertions, both terrain round trips, the two-world H-1 regression test, the migration,
  PR 6d's `DB_VERSION` increment, the clean-load error budget — runs against `npm run dev`
  via `npm run test:e2e:vite` and produces **the same 150 / 0 / exit 0** (152 since PR 9) as against
  `staticServer.js`. That is what makes PR 7's "no source changes, identical game" a
  measurement rather than a claim.
- **`npm run build` exits 0 and its output does not run.** Both halves verified: the
  command's exit status, and the contents of `dist/` (one HTML file, one CSS asset, 65
  dangling script references, no `js/`, no `textures/`). See **D-24** and
  [§4.3](#43-the-dist-landmine). **Superseded by PR 9 — see below.**

### Verified by execution in a real browser — added by PR 9

- **The built site runs, and it is what the harness now tests.** `test/e2e/staticServer.js`
  serves `dist/`, falling back to the repo root for `textures/` because `publicDir` is
  `false` (`refactor.md` §1.8). `npm run test:e2e` therefore builds first and then drives
  a real browser against the artifact PR 10 will deploy: **152 assertions, 0 failures.**
  That closes **D-24** — "the build succeeds" and "the build output works" used to be
  different claims with only the first one checked, and now the second one is the gate.
  The old baseline, serving the working tree, is not possible for any static server any
  more: `index.html` loads one ES module whose graph contains bare specifiers.
- **Both hosts still agree.** `npm run test:e2e:vite` runs the same 152 against
  `npm run dev` and produces **152 / 0**, identical. The pair is now "built bundle" vs
  "dev server", which is a stronger pair than "raw source" vs "dev server" was.
- **Both worker pools still spawn.** Each pool is built from fetched source wrapped in a
  Blob, inside a try/catch that falls back to main-thread generation and only
  `console.warn`s — so a broken worker URL produces a game that works, passes every
  storage assertion, and is silently single-threaded. The harness asserts that warning
  never fires, on both hosts.
- **Textures still load.** `TextureAtlas.js` fetches `/textures/…` absolutely now
  (`refactor.md` §1.8), and the harness asserts zero 404s — so a base-URL regression is a
  red run rather than an untextured world nobody notices in a SwiftShader screenshot.

### NOT verified — requires SSH to `dadmin@10.0.30.160`

> **PR 10 rewrote the deploy path and did not run one line of it.** Everything below was
> already unverified; PR 10 *added* to it rather than reducing it, because the new
> `sync.sh` deletes before it extracts, installs a systemd unit, restarts a service and
> repoints which node binary production runs. The mitigations are that it backs up before
> it deletes ([§6.5](#65-the-pr-10-rollback)), that `--dry-run` prints every remote
> command without connecting, and that the served *layout* — `dist/` plus a separate
> `textures/` — is exercised locally by all 152 assertions of `npm run test:e2e`. None of
> that is a substitute for running it once.
>
> **Run `./sync.sh --dry-run` and read it before the first real deploy.**

`./sync.sh` **was not run.** No command in this document was executed against the
remote host. The following are inferences from the scripts, and each is marked
`[UNVERIFIED]` where it appears:

| Claim | Command that would verify it |
|---|---|
| What serves `/var/www/html` | `ss -ltnp \| grep -E ':(80\|443) '` ; `ls /etc/nginx/sites-enabled/` |
| The site is actually reachable and playable | load `http://10.0.30.160/` in a browser |
| `cuubz-relay` is installed, enabled and running | `systemctl status cuubz-relay --no-pager` |
| A node tarball exists under `~/.local` for the D-10 symlink to point at | `ls -1d ~/.local/node-v*-linux-x64` |
| The D-10 symlink resolves and the unit picks it up | `ls -l ~/.local/node` ; `systemctl show cuubz-relay -p ExecStart -p Environment` |
| `rm -rf` of the managed web-root paths removes the stale pre-PR-9 `js/` tree and nothing else | `ls -la /var/www/html` before and after the first deploy |
| The backup is actually written and readable | `ls -lt /home/dadmin/cuubz-deploy/backups/` |
| `npm ci --omit=dev` works in `/var/www/html/server` (needs npm on PATH for a non-login ssh) | `ssh dadmin@10.0.30.160 "cd /var/www/html/server && npm --version"` |
| The relay comes back after `systemctl restart`, and exits **non-zero** on a crash (D-8) | `systemctl status cuubz-relay --no-pager` ; `journalctl -u cuubz-relay -n 50` |
| `ws` is installed on the host | `ls -d /var/www/html/{,server/}node_modules/ws` |
| `dadmin` owns everything under `/var/www/html` (the D-6 risk) | `find /var/www/html ! -user dadmin -print -quit` |
| `dadmin` has `sudo` for `systemctl` | `sudo -n systemctl status cuubz-relay` |
| Whether stale files from past deploys are already present | `ls -la /var/www/html` |
| Deployed docs/tests are fetchable over HTTP (D-13) | `curl -sI http://10.0.30.160/refactor.md` |

The highest-value single check is the D-6 one: if any file under `/var/www/html` is not
owned by `dadmin`, then **every** deploy already fails halfway through the `chmod`,
after overwriting the live tree — and the error message says nothing about that.

### Still unverified in §7 — two steps, and both wait on the same thing

PR 6 wrote [§7](#7-saveload-checklist) from the code paths and asked the first runner to
correct it. PR 6b ran it and confirmed H-1; PR 6c fixed H-1 and automated the two steps
that detected it ([§7.1](#71-steps-89-were-h-1-fixed-in-pr-6c)). **PR 12 closed step 4 and
the placed-block half of 6/7** — the biggest single item on this list, and one that had
been waiting since PR 6b. **Twelve of fourteen steps are automated.** What remains is
printed as `⚠️ UNVERIFIED` on every run so a pass never overclaims:

| Step | Why it is not automated | What would close it |
|---|---|---|
| ~~4, and the placed-block half of 6/7~~ | ~~needs pointer lock, and `blockInteraction`/`inventory`/`chunkManager` are closure locals~~ | **CLOSED IN PR 12.** The locals moved onto `GameState`, which is published as `window.__cuubz.state`, so the harness places one block and breaks one through `chunkData.setBlock()` + `chunkManager.markChunkDirty()` + `flushDirty()` — the exact calls `BlockInteraction._doPlace()` makes after its raycast — then reloads and asserts both voxels. **The break is the stronger half:** the seed is fixed, so AIR at a coordinate that generation fills proves the world was loaded rather than regenerated |
| The **mouse-driven** half of step 4 | Pointer lock. A headless driver cannot be granted it, so `BlockInteraction.update()` never resolves a raycast target. This is a browser limit, not a code-shape one — hoisting more state will not fix it | A headed run, or a driver that can fake pointer lock. The raycast, the 7-block range check, the AIR/CAVE_AIR guard and `inventory.consumeSelectedBlock()` are what sit above the write path and stay unexercised |
| 12–13 (multiplayer) | Needs a running relay and two browser contexts | The relay half works today (spawn `server/index.js` as a child process). The guest-places-a-block half **stopped being blocked at PR 12**; what is left is two-context orchestration, which is a harness change, not a source one |

The blocker these three shared was `refactor.md` §1.6, and **PR 12 removing it is a
second, independent argument for Phase 2 existing at all** — it was justified purely as a
prerequisite for Phase 3, and it paid for itself in coverage before Phase 3 started.
