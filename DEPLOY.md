# Cuubz — Deployment & Data Invariants

**Purpose:** everything you need to deploy Cuubz, restart the relay, roll back a bad
deploy, and avoid destroying player save data — without reading `refactor.md`.

**Status of this document:** written at commit `749304b` (PR 6, 2026-07-29). Every
statement about repo contents was verified by reading the file cited. **No statement
about the remote server `10.0.30.160` was verified** — that needs SSH access this
document's author did not have. Unverified claims are marked `[UNVERIFIED]` with the
command that would confirm them. See [§9](#9-verification-status).

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
8. [Known defects and who owns them](#8-known-defects-and-who-owns-them)
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
call site in `js/`.

### 2.1 IndexedDB — worlds and terrain

| Invariant | Location | Value |
|---|---|---|
| Database name | `js/chunkmanager.js:20` | `'cuubz-worlds'` |
| Database version | `js/chunkmanager.js:21` | `2` — **see the warning below** |
| Object store | `js/chunkmanager.js:23,273` | `'chunks'`, `keyPath: 'chunkKey'` |
| Index on that store | `js/chunkmanager.js:274` | `'worldName'` → `worldName`, non-unique |
| Object store | `js/chunkmanager.js:24,275` | `'manifests'`, `keyPath: 'worldName'` |
| Chunk primary key format | `js/chunkmanager.js:455` | `` `${cx},${cz}` `` — e.g. `"-3,7"` |
| Manifest primary key | `js/main.js:2329` | the world's `id` (`currentWorld.id`) |

> ### ⛔ `DB_VERSION = 2` must never be incremented
>
> `onupgradeneeded` (`js/chunkmanager.js:264-276`) **enumerates every existing object
> store and deletes it**, then recreates them empty:
>
> ```js
> storesToDelete.forEach(name => db.deleteObjectStore(name));
> ```
>
> The comment calls this "handles schema changes cleanly". It does not — it destroys
> every saved world on every player's device, with no migration and no warning. Bumping
> that integer is a one-character change with total data loss as its effect. If a schema
> change is ever genuinely needed, the upgrade handler must be rewritten to migrate
> before the version is touched.

### 2.2 Chunk binary format

`js/world/chunkBinaryCodec.js`. Saved chunk bytes are RLE-compressed with a
20-byte header. Every constant below is part of the on-disk format.

| Invariant | Location | Value |
|---|---|---|
| Magic | `:28` | `0x43555542` (`"CUUB"`) |
| Format version | `:29` | `3` (v3 = Y-major block data) |
| Max readable version | `:107-109` | decode **throws** if `version > 3` |
| Legacy layout cutoff | `:30` | `LEGACY_LAYOUT_MAX = 2` — v1/v2 chunks are regenerated on load |
| Header size | `:30` | `20` bytes |
| Chunk height | `:31` | `256` — must match `CHUNK_HEIGHT` in `chunkData.js` |
| Chunk width/depth | `js/chunkmanager.js:18-19` | `16` × `16` |
| Checksum algorithm | `:37-46` | FNV-1a 32-bit, basis `0x811c9dc5`, prime `0x01000193` |
| Run encoding | `:19` | each run = `[blockID: Uint16, count: Uint16]` |

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
| `'cuubz:characters'` | `js/world/persistence.js:20` | JSON array of every character the player has created |
| `'cuubz:slotMap'` | `js/world/persistence.js:24` | JSON map of `worldId` → slot number |
| `'cuubz:worldSlot:{N}:conf'` | `js/world/persistence.js:28` | world config for slot `N`, `N ∈ {0,1,2}` |
| `'cuubz:settings'` | `js/renderer/performanceSettings.js:34,52` | performance/graphics settings |
| `'cuubz_last_session'` | `js/main.js:1593` (`REJOIN_STORAGE_KEY`), written at `1272,1284,1768,1785,4892,4902` | last multiplayer session, for rejoin |

`MAX_WORLD_SLOTS = 3` (`js/world/persistence.js:10`) is part of the key space: slots
are `0,1,2`. Raising it is additive and safe; lowering it orphans slot data.

Note the inconsistent separator — four keys use `cuubz:` and one uses `cuubz_`.
`'cuubz_last_session'` is the odd one out. **Do not "fix" it for consistency**; it
would log every player out of their last session. It is written and read as a literal
in six places plus one named constant.

### 2.4 Storage hazards — pre-existing, do not mistake these for refactor regressions

**H1 — Chunk keys are not scoped to a world. Worlds cross-contaminate. This is live.**

The `chunks` store's primary key is `chunkKey`, which is only
`` `${cx},${cz}` `` (`js/chunkmanager.js:455`). The record *also* carries a
`worldName` field and there is an index on it (`:274`), but **no read path uses
either**: `loadChunk` (`:322-330`), `hasChunk` (`:332-340`) and `_batchLoadChunks`
(`:857-880`) all do a bare `store.get(key)` / `store.count(key)`. Writes
(`:313`, `:680`, `:770`) set `worldName` and then key the record globally.

Consequence: chunk `(0,0)` is a **single shared record across all three world slots**.
Play world A, place blocks at spawn, then play world B at spawn — B's chunk overwrites
A's. Return to A and you are standing in B's terrain. Manifests *are* per-world
(`keyPath: 'worldName'`), so world A's manifest still claims the chunk is generated,
which is what makes the stale data load instead of regenerating.

`js/main.js:551-552` contains a comment reading *"chunks remain orphaned but harmless -
they're keyed by chunk coordinates"*. The premise is right and the conclusion is wrong:
coordinate-only keys are the bug, not a mitigation.

**Not fixed here.** The fix changes the primary key format, which is itself an entry in
the table above — every already-saved chunk would be orphaned unless a migration is
written. That is a data-migration PR with its own manual test plan, not a line in a
documentation PR. [§7](#7-saveload-checklist) steps 8–9 detect it deliberately and
**fail today**, so nobody spends a day blaming their own refactor.

> **Confirmed by observation in PR 6b, and worse than described above.** One visit to a
> second world destroyed **1,073 of the first world's 1,184 saved chunks**, and
> re-entering the first world served the second world's spawn chunk byte for byte. Full
> measurements, plus a cheap detection mechanism the stored data already supports, in
> [§7.1](#71-steps-89-fail-h-1-is-confirmed-not-predicted).

**H2 — `js/main.js:545` opens the database with no version.**

```js
const request = indexedDB.open('cuubz-worlds');   // no version argument
```

If the database already exists this opens it at its current version and is fine. If it
does *not* exist — a player who deletes a world before ever loading one — this **creates
`cuubz-worlds` at version 1 with no object stores**, and the following
`db.transaction(['manifests','chunks'])` throws `NotFoundError` into a silent
`catch {}` (`:557-559`). It self-heals: `ChunkManager` later opens with version `2`,
`onupgradeneeded` fires `1 → 2`, and the stores are created. Low severity, and the
self-heal path is the same handler described in the warning in §2.1, so it is worth
knowing about before anyone edits that handler.

---

## 3. Topology — what runs where

```
   your machine                    10.0.30.160 (dadmin)
  ┌─────────────┐                ┌──────────────────────────────────────┐
  │  repo root  │ ── sync.sh ──> │  /var/www/html/                      │
  │             │  tar/scp/ssh   │    index.html, js/, css/, textures/  │  ← served as
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
| Relay public hostname | `cuubz-relay.thehomelabguy.com` | `js/main.js:2126`, `multiplayer.md:35` |
| Service unit name | `cuubz-relay` | `cuubz-relay.service` |

### 3.1 What serves `/var/www/html` is UNVERIFIED

Nothing in this repo states it. Every `nginx` reference found
(`js/main.js:2112,2126`, `server/index.js:9`, `multiplayer.md:35,94,413`) describes
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

Line-by-line, from `sync.sh` at commit `749304b`. `set -e` (`:6`) is in force locally.

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
see [§8](#8-known-defects-and-who-owns-them) D-1.

The `${PROJECT_NAME}.tar.gz` staging location is worse in kind: for the duration of
every deploy, a complete copy of the source tree sits at a predictable URL
(`http://10.0.30.160/webgame-cuubz.tar.gz`). It is removed on success — but only on
success. **If `tar xzf` fails, the archive stays there indefinitely.** Not fixed here:
moving the staging path changes where the deploy writes, which is exactly the
restructuring PR 10 owns.

### 4.3 The `dist` landmine

`sync.sh:30` — `--exclude='dist'`. `.gitignore:3` also ignores `dist/`.

Today this excludes nothing, because nothing builds. **From PR 7 (Vite skeleton)
onward, `dist/` is the entire application.** A deploy in that window uploads the source
tree, excludes the only directory containing runnable JavaScript, and produces a live
site with no JS at all — a black page. `refactor.md` §1.4 calls this the single biggest
risk in the refactor and PR 10 ("must land with PR 9, not after") owns the fix.

**Operational rule: do not run `./sync.sh` between PR 7 and PR 10.** The current
`index.html` loads 65 individual `<script src>` tags directly from `js/`; the moment
that becomes a bundle, this script is wrong until rewritten.

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

This is currently invisible and becomes concrete at PR 9, which moves `js/` → `src/`:
the entire stale `js/` tree stays live next to the new `src/`, `index.html` is
overwritten to reference `src/`, and the server ends up hosting two full copies of the
codebase — one of them dead, both fetchable, and the dead one indistinguishable from
the live one to anyone debugging via the browser's network tab. Same for `test/` and
every planning doc ever deployed.

Manual cleanup after a rename-heavy deploy `[UNVERIFIED]`:

```bash
ssh dadmin@10.0.30.160 'ls /var/www/html'     # inspect first — this root may host other sites
# then remove only paths you have confirmed are stale, e.g.:
# ssh dadmin@10.0.30.160 'rm -rf /var/www/html/js'
```

Never script this blind. `/var/www/html` is a shared root
([§4.4](#44-the-chmod-is-the-fragile-step)) and `rm -rf` there is not recoverable.

---

## 5. Restarting the relay (the step `sync.sh` does not do)

**`sync.sh` never restarts anything.** There is no `systemctl`, `service`, `kill`, or
`pm2` call anywhere in this repo — verified across all tracked files. The only
`systemctl` text that exists is documentation prose in `multiplayer.md:376-377`.

Therefore: **after any change under `server/`, the deploy is not finished until someone
restarts the relay by hand.** The new source sits in `/var/www/html/server/` while the
old code keeps running from memory. This failure mode is silent — the deploy prints
`Sync complete!` and the relay keeps serving stale behaviour indefinitely.

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
production; flagged as D-8 in [§8](#8-known-defects-and-who-owns-them).

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

**Not changed here.** Repointing `ExecStart` at `/usr/bin/env node` or a different
binary changes which interpreter runs the production relay, and that cannot be
validated without SSH. Documented, deliberately unfixed.

---

## 6. Rollback

### 6.1 There is no rollback mechanism. This is the honest answer.

Read `sync.sh:37` again:

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
   `src/` to `js/` leaves `src/` live on disk. Rollback must be followed by manual
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

## 7. Save/load checklist

> ### ▶ Most of this is automated. Run the script first.
>
> ```bash
> npm run test:e2e        # test/e2e/saveLoad.js — added by PR 6b
> ```
>
> A real browser (Edge, driven by `playwright-core`, WebGL via SwiftShader) walks the
> menu flow, generates two worlds from pinned seeds, and reads IndexedDB and
> localStorage directly. **112 assertions, exit 0, ~5 minutes.** Screenshots land in
> `test/e2e/artifacts/` (gitignored).
>
> It covers steps 1, 2, 3, 5, 6, 7, 10, 11 and 14 outright, plus every invariant in
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
> **Two of its assertions describe defects rather than requirements** (H-1, D-15).
> They pass because the bug is present. Fixing either turns the script red on
> purpose; that is the signal to replace the block with the assertion the fix makes
> true. **D-14 was a third such block until PR 6b fixed it**, and it is now a real
> step-7 round trip — that is the intended lifecycle.

Run the manual remainder **at every Phase gate and after every deploy.**
`refactor.md` §1.5 specifies this as a manual gate until PR 32 can automate it.
Storage is the one part of this codebase with no automated coverage and
unrecoverable failure modes, so it is worth the ten minutes.

**Timing rules — these are why naive attempts produce false failures.** Save is not
synchronous with your actions:

| Data | Saved when | Source |
|---|---|---|
| Chunks / placed blocks | dirty-flush timer, **every 5 s** | `js/main.js:2359,4491` → `chunkmanager.js:597-600` |
| Chunks (best effort) | `beforeunload`, and `visibilitychange` → hidden | `chunkmanager.js:751-782` |
| Inventory + per-world spawn point | **every 30 s**, on **Escape**, and on `game.stop()` | `js/main.js:3864-3884` |

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
| 4 | Place ~10 blocks in a recognisable shape at spawn. Break 2–3 blocks. | Blocks appear/disappear. Broken blocks drop the **correct** item (PR 4 bug 1 — andesite must not drop cobblestone). | ❌ manual |
| 5 | Pick up the drops, note the hotbar contents. **Press Escape. Wait 5 s.** | Pause menu opens. Console logs `[Cuubz] Saved player state`. | ✅ (pause menu; hotbar is manual) |
| 6 | **Reload the page** (F5), re-enter the same world | **Your shape is exactly as you left it. Broken blocks are still broken. Inventory and hotbar match.** ← the load-bearing assertion | ✅ for terrain (byte-identical); ❌ for placed blocks + inventory |
| 7 | Quit to menu, re-enter the same world without reloading | Same result as step 6. | ✅ for terrain (was blocked by **D-14**, fixed in PR 6b — see [§7.2](#72-step-7-was-unrunnable-until-pr-6b--d-14)) |
| 8 | **Two-world test.** Create a world in slot 1. Enter it, look at spawn. | ⚠️ **FAILS TODAY — H-1, confirmed by observation.** See below. | ✅ (asserts the defect) |
| 9 | Return to the slot 0 world | ⚠️ **FAILS TODAY — H-1, confirmed by observation.** See below. | ✅ (asserts the defect) |
| 10 | Open DevTools → Application → IndexedDB | DB `cuubz-worlds`, **version 2**, stores `chunks` + `manifests`. If the version is not 2, **stop** — see [§2.1](#21-indexeddb--worlds-and-terrain). | ✅ read programmatically, without triggering an upgrade |
| 11 | Change a graphics setting, reload | Setting persists. `localStorage['cuubz:settings']` reflects it. | ✅ |
| 12 | Host a multiplayer session, join from a second browser profile, place a block as the guest | Block appears for both. Host's browser persists it (host is authoritative). | ❌ manual |
| 13 | Quit both. Reload as host, re-enter | The guest's block is still there. | ❌ manual |
| 14 | Confirm the tree is clean | `git status` clean — the manifest smoke test snapshots and restores `textures/blocks/manifest.json`; a dirty tree means it did not. | ✅ |

### 7.1 Steps 8–9 fail. H-1 is confirmed, not predicted.

**PR 6 wrote these two steps from the read paths and asked the first runner to correct
this document if the prediction did not hold. It held, and the run was worse than the
prediction.** Observed by `npm run test:e2e`, world A on seed `424242` (slot 0) and
world B on seed `999111` (slot 1):

| Observation | Value |
|---|---|
| Chunk record `"0,0"`'s own `worldName` field after visiting B | world **B**'s id — B's write replaced A's record at the same key |
| Re-entering world A and reading `"0,0"` | **byte-for-byte identical to world B's chunk.** The player is standing in the other world's terrain. |
| World A's manifest after B's visit | still lists `"0,0"` as generated, so A loads the stale record instead of regenerating |
| World A's manifest checksum for `"0,0"` | `3799605976` — but the bytes stored at that key now checksum to `1653333176`. **Nothing verifies this on load.** |
| World A chunks destroyed by one visit to world B | **1,073 of 1,184** (world-scoped keys would have left 2,393 records in the store; it holds 1,320) |

Two things follow that the original note did not say:

1. **The blast radius is the whole overlapping region, not just spawn.** ~90% of a
   world's saved chunks are destroyed by a single visit to another world. There is no
   "look at spawn and you'll see it" nuance — the worlds are the same world.
2. **The damage is already detectable with data the game stores today.**
   `manifest.generatedChunks[].checksum` is the chunk header's own FNV-1a
   (`chunkmanager.js:649`), so a manifest/record checksum mismatch identifies a
   contaminated chunk exactly. Nothing compares them. That is a cheap partial
   mitigation for whoever owns H-1 — verify on load, regenerate on mismatch — short of
   the primary-key migration, which is still the real fix.

**This is pre-existing, not something a refactor broke.** The harness asserts the
defect so a fix flips it red; when H-1 is fixed, replace that block with the inverse
assertions and delete this subsection.

### 7.2 Step 7 was unrunnable until PR 6b — D-14

`js/main.js:4562` called `game.playerSync.reset()`. `PlayerSyncManager` has no
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

| ID | Defect | Severity | Status |
|---|---|---|---|
| **D-1** | `sync.sh` did not exclude `.env`, so a local env file would ship into a world-readable public web root | credential leak (latent — no `.env` exists) | **FIXED in PR 6** (`sync.sh:31`) |
| D-2 | `sync.sh` never restarts the relay; `server/` changes are silently inert | high — silent stale deploys | Documented [§5](#5-restarting-the-relay-the-step-syncsh-does-not-do). Fix in **PR 10** |
| D-3 | No rollback of any kind: extract-in-place, no backup, no release dirs | high | Documented [§6](#6-rollback). Fix in **PR 10** |
| D-4 | `--exclude='dist'` will ship a JS-less site from PR 7 onward | **critical** from PR 7 | `refactor.md` §1.4. Fix in **PR 10**, must land with PR 9 |
| D-5 | `tar xzf` never deletes; removed files persist on the server forever | high at PR 9 (`js/` → `src/`) | Documented [§4.6](#46-tar-xzf-never-deletes). Fix in **PR 10** |
| D-6 | `chmod` fans out over all of `/var/www/html` and aborts the deploy *after* extraction if any file is not owned by `dadmin` | medium — confusing partial deploys | Documented [§4.4](#44-the-chmod-is-the-fragile-step). Fix in **PR 10** |
| D-7 | Source archive is staged **inside** the public web root and only removed on success | medium — source disclosure | Documented [§4.2](#42-what-gets-shipped). Fix in **PR 10** |
| D-8 | `uncaughtException` / `unhandledRejection` exit with code **0**, so `Restart=on-failure` does not restart the relay after an unhandled error | medium — relay stays down | `server/index.js:219-225`. Unowned — needs a decision |
| D-9 | `node_modules` excluded and no remote `npm ci`: dependency changes never reach production | medium | Documented [§4.5](#45-node_modules-is-never-shipped). Fix in **PR 10** |
| D-10 | `ExecStart` hardcodes `node-v22.22.0` by absolute path; CI validates 22.23.x | medium — node upgrade breaks the unit | Documented [§5.2](#52-the-node-version-is-pinned-by-absolute-path). Unowned |
| D-11 | `textures/` (120 MB, 3,370 files) re-uploaded on every deploy | low — transfer cost | Documented [§4.1](#41-measured-payload). Fix in **PR 10** |
| D-12 | `StrictHostKeyChecking=no` on both `scp` and `ssh` — any host key is accepted | low (LAN IP), by design | `sync.sh:34,36`. Unowned |
| D-13 | Whole repo (`test/`, `scripts/`, all planning `.md`, `.claude/`) ships to the public web root | low — information disclosure | Documented [§4.2](#42-what-gets-shipped). Fix in **PR 10** |
| **D-14** | `js/main.js:4562` called `game.playerSync.reset()`, which does not exist on `PlayerSyncManager`. **Every "Exit to Menu" threw**, skipping six cleanup steps and `showScreen('mainMenu')` — the player was left on a blank page, recoverable only by F5 | **high — the quit path was broken in every session, solo included** | Found *and* **FIXED in PR 6b** (call deleted; `clearAll()` was already the whole teardown). [§7.2](#72-step-7-was-unrunnable-until-pr-6b--d-14). §7 step 7 now automated |
| **D-16** | `#pause-pause-time` was a checkbox labelled "Pause Time of Day", `checked` by default, while `main.js:4693` sets `checked = !skybox.timePaused` — so checked meant time was **running**, and ticking "pause" un-paused it | low — confusing control, no data risk | **FIXED in PR 6b** by relabelling to "Day/Night Cycle" (`index.html:477`). Chosen over inverting the logic, which would have changed every existing player's default |
| **D-15** | `chunkBinaryCodec.js:63` sizes the buffer as `HEADER_SIZE + blockRuns.length * 4`, but a run is *two* `Uint16`s, so the payload written is half that. **Every stored chunk is exactly 2× the size it needs, half zero padding** — measured 24,156 bytes allocated / 12,088 used, ≈14 MB of zeroes per world | medium — 50% of IndexedDB footprint and 50% of every 5 s flush's write volume, wasted | Found by PR 6b. Not a corruption bug (`decode` stops at `blockRunCount`), but the fix changes stored byte length, i.e. a [§2.2](#22-chunk-binary-format) format change. **Unowned** |
| **H-1** | Chunk primary keys are not world-scoped; worlds cross-contaminate | **high — live data corruption** | Documented [§2.4](#24-storage-hazards--pre-existing-do-not-mistake-these-for-refactor-regressions). Needs a migration PR. **Unowned** |
| **H-2** | `onupgradeneeded` deletes every object store; bumping `DB_VERSION` destroys all player worlds | **critical if triggered** | Documented [§2.1](#21-indexeddb--worlds-and-terrain). Unowned |
| H-3 | `js/main.js:545` opens IndexedDB with no version; can create a store-less v1 DB | low — self-heals | Documented [§2.4](#24-storage-hazards--pre-existing-do-not-mistake-these-for-refactor-regressions). Unowned |

Only **D-1** was fixed in PR 6. Everything else is either owned by PR 10 (which
rewrites `sync.sh` and must land with PR 9) or needs a decision that a documentation
PR should not make unilaterally — H-1 in particular requires a data migration, and
"fixing" it carelessly would violate [§2](#2-do-not-change-player-data-invariants).

**PR 6b found four defects and fixed three.** Fixed: `js/main.js:4865,4878` logged the
`=== AUTO-REJOIN COMPLETE ===` and `=== INIT COMPLETE ===` success milestones through
`console.error`, so every successful page load reported two console errors — which
pollutes error monitoring and made "zero console errors on a clean load" unassertable.
Now `console.info`; same visibility, correct severity. `js/util/logger.js` is *not* the
problem and was left alone — `CuubzLogger.log` is `console.log` gated on `DEBUG = false`
and therefore silent in production, which is exactly why someone reached for
`console.error` to force visibility. Also fixed: **D-14** (the broken quit path — its
own one-line deletion, because it made a load-bearing checklist step unrunnable) and
**D-16** (the inverted day/night label). **D-15 is the one left open**: fixing it
changes the stored byte length of every future chunk, which is a
[§2.2](#22-chunk-binary-format) format change and wants its own PR rather than a ride
along in a test-harness one.

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
- `startFlushTimer(5000)` is genuinely wired up (`js/main.js:2359,4491`) — the 5 s
  figure in [§7](#7-saveload-checklist) is real, not a default that never runs.
- No `.env` exists in the repo.
- `pre-refactor-baseline` is local-only: `git ls-remote --tags origin` returns nothing.
- `npm test` exits 0 (50/50 passing, 4 quarantined) and `node scripts/check-globals.js`
  exits 0 (0 duplicates, 65 script-tagged files, 368 top-level symbols) at this commit.

### Verified by execution in a real browser — added by PR 6b

`npm run test:e2e` (`test/e2e/saveLoad.js`), Edge 150.0.4078.105 headless, WebGL via
SwiftShader, **112 assertions / 0 failures / exit 0**. This moved the following out of
"not verified":

- **Every value in [§2](#2-do-not-change-player-data-invariants)** — read from the
  running page rather than from source text. Database name, version `2` (read
  **without** firing `onupgradeneeded`), both object stores and their key paths, the
  non-unique `worldName` index, the `` `${cx},${cz}` `` key format, all four
  `persistence.js` localStorage keys, `MAX_WORLD_SLOTS = 3`,
  `BLOCK_REGISTRY.length === 193`, and every chunk-format constant.
- **The chunk binary format, decoded from bytes the browser actually wrote.** Magic
  `0x43555542` at offset 0, version `3` at 4, `chunkX`/`chunkZ` matching the record
  key, height `256`, flags `0`, the run count, and the FNV-1a checksum at offset 16
  re-derived from the payload. The same buffer then decodes cleanly through
  `js/world/chunkBinaryCodec.js` under Node — a browser-writes / Node-reads crossing
  that is what protects the on-disk format through PR 9's module conversion.
- **§7 steps 1, 2, 3, 5, 6, 7, 10, 11, 14.** The two load-bearing ones both hold for
  terrain: chunk `"0,0"` is byte-for-byte identical with `savedAt` unchanged both after
  a **reload** (step 6) and after a **quit to menu with no reload** (step 7) — the
  terrain was loaded from storage, not regenerated. Step 7 also asserts that `onExit`
  returns to the menu, raises nothing, and leaves no in-game overlay visible, which is
  the shape D-14 failed in.
- **§7 steps 8–9 — H-1 reproduces.** See [§7.1](#71-steps-89-fail-h-1-is-confirmed-not-predicted).
  The prediction PR 6 asked the first runner to confirm is confirmed, and quantified.
- **The clean-load claim is now literally true**: 0 uncaught exceptions, 0 console
  errors, 0 missing assets. It was not before — see the `console.error` fix in
  [§8](#8-known-defects-and-who-owns-them). The only exclusion on the asset check is
  `/favicon.ico`, which Chromium requests unprompted and the repo does not have.
- **`THREE.REVISION === 134`** and `window.__THREE_LOAD_FAILED` unset, i.e.
  `refactor.md` §1.2's pin is what the browser really loads. PR 8 must keep it there.

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

### NOT verified — requires SSH to `dadmin@10.0.30.160`

`./sync.sh` **was not run.** No command in this document was executed against the
remote host. The following are inferences from the scripts, and each is marked
`[UNVERIFIED]` where it appears:

| Claim | Command that would verify it |
|---|---|
| What serves `/var/www/html` | `ss -ltnp \| grep -E ':(80\|443) '` ; `ls /etc/nginx/sites-enabled/` |
| The site is actually reachable and playable | load `http://10.0.30.160/` in a browser |
| `cuubz-relay` is installed, enabled and running | `systemctl status cuubz-relay --no-pager` |
| The pinned node binary exists | `ls -l /home/dadmin/.local/node-v22.22.0-linux-x64/bin/node` |
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
correct it. PR 6b ran it. Nine steps are now automated and H-1 is confirmed
([§7.1](#71-steps-89-fail-h-1-is-confirmed-not-predicted)); two remain, and the harness
prints each as `⚠️ UNVERIFIED` on every run so a pass never overclaims:

| Step | Why it is not automated | What would close it |
|---|---|---|
| 4, and the placed-block half of 6/7 | Placing or breaking a block needs pointer lock plus mouse-look, and `blockInteraction` / `inventory` / `chunkManager` are closure locals | **PR 12–13.** Once they are on `Game`, place → flush → reload → assert the voxel is a few lines in `saveLoad.js` |
| 12–13 (multiplayer) | Needs a running relay, two browser contexts, **and** a guest placing a block | The relay half works today (spawn `server/index.js` as a child process); the placement half waits for PR 12–13 |

Note both are the *same* blocker. **PR 12–13 is what finishes this gate**, which is a
second, independent argument for Phase 2 existing at all.
