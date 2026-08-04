#!/bin/bash
# ==============================================================================
# sync.sh — deploy Cuubz to 10.0.30.160
#
# Rewritten by PR 10 (refactor.md §6). The previous version is kept verbatim as
# `sync-legacy.sh` for one release cycle; read the header there for what it did.
#
#   ./sync.sh                 build, deploy the app + server, restart the relay
#   ./sync.sh --textures      also upload textures/ (118 MB — only when they change)
#   ./sync.sh --dry-run       print every remote command instead of running it
#   ./sync.sh --no-restart    deploy but leave the relay alone
#
# ─── WHY THIS EXISTS ──────────────────────────────────────────────────────────
#
# PR 9 turned `index.html` into a single `<script type="module" src="/src/index.js">`.
# The application is now `dist/`, produced by `npm run build` — and the old script
# carried `--exclude='dist'`, so the first deploy after PR 9 would have uploaded
# everything EXCEPT the application and served a black page. That is D-4, the defect
# `refactor.md` §1.4 calls the single biggest risk in the refactor, and it is why the
# plan requires PR 9 and PR 10 to land together.
#
# Twelve `BUGS.md` rows land here. Each is marked at the step that closes it:
#
#   D-2   the relay was never restarted; server/ changes were silently inert
#   D-3   no rollback of any kind — extract in place, no backup
#   D-4   --exclude='dist' shipped a JS-less site
#   D-5   `tar xzf` never deletes; removed files lived on the server forever
#   D-6   chmod fanned out over ALL of /var/www/html and aborted AFTER extraction
#   D-7   the source archive was staged inside the public web root
#   D-9   node_modules excluded, no remote npm ci — server deps never updated
#   D-10  ExecStart pinned node 22.22.0 by absolute path
#   D-11  textures/ (118 MB, 3,370 files) re-uploaded on every deploy
#   D-12  StrictHostKeyChecking=no accepted any host key
#   D-13  the whole repo — test/, scripts/, every planning .md — went to a public web root
#
# ─── ✔ THIS HAS NOW BEEN RUN — 2026-07-31 ─────────────────────────────────────
#
# This banner used to read "NOTHING BELOW THIS LINE HAS EVER BEEN RUN". That was true
# for every session up to the first real deploy, and it is not true any more: the script
# has been executed end to end against `dadmin@10.0.30.160` and verified with the site
# loaded in a real browser and the relay answering `/health`.
#
# **Five defects the first deploy settled, all of them now closed here:**
#
#   D-94  `npm ci` ran BEFORE node was resolved, and this box's non-interactive PATH is
#         `/usr/local/bin:/usr/bin:/bin:/usr/games` — no node, no npm, no curl. The
#         deploy aborted AFTER replacing the web root. Node is step 4 now, deps step 5.
#   D-95  the unit is `cuubz.service` on the host; this repo said `cuubz-relay`. The
#         files were byte-identical — the repo was renamed to match, ruling above.
#   D-96  `sync-legacy.sh` was run as a fallback and re-extracted the source tree over
#         the top. Step 8 now refuses any web root whose entry is not a hashed
#         `/assets/` path, which is the one thing an unbuilt tree cannot produce.
#   D-97  six repo files survived the pre-extract `rm` — including this script and
#         `sync-legacy.sh`, both of which name the host, the user and every remote path.
#         Apache has `Indexes` on, so they were browsable, not merely reachable.
#   D-99  a hand-started relay from 14 July held port 8765 and was invisible behind
#         D-94; the moment D-94 was fixed the failure became EADDRINUSE on the same
#         silent `Restart=on-failure` loop. Step 8 now names what owns the port.
#
# **What is still true and still worth reading:** run `./sync.sh --dry-run` first when
# you change anything here. It prints every remote command without connecting.
#
# **D-98 — there is no `sudo` on 10.0.30.160**, so step 7 cannot restart the relay and
# takes the warning path on every run. That is the owner's standing decision, not an
# oversight: restart by hand with the `su -c` command step 7 prints. See DEPLOY.md §3.1.1.
#
# The script is written to fail loudly and early rather than half-apply: it aborts
# before touching the host if the build is missing, and the backup is taken before
# anything is deleted.
# ==============================================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_USER="dadmin"
REMOTE_HOST="10.0.30.160"
REMOTE_DIR="/var/www/html"           # the public web root, served as static files
STAGING_DIR="/home/dadmin/cuubz-deploy"   # D-7: staging lives OUTSIDE the web root
BACKUP_DIR="${STAGING_DIR}/backups"
KEEP_BACKUPS=5                       # D-3
SSH_KEY="$HOME/.ssh/id_ed25519"

# D-12: `accept-new` trusts a host key the first time and pins it after, so a changed
# key is an error instead of a shrug. `no` accepted anything, every time. On a LAN IP
# the practical risk is low, which is why this is an improvement and not a fix.
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

WITH_TEXTURES=0
DRY_RUN=0
RESTART_RELAY=1

for arg in "$@"; do
  case "$arg" in
    --textures)   WITH_TEXTURES=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    --no-restart) RESTART_RELAY=0 ;;
    -h|--help)    sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$(mktemp -t cuubz-app-XXXXXX).tar.gz"
TEX_ARCHIVE=""
cleanup() { rm -f "$ARCHIVE" ${TEX_ARCHIVE:+"$TEX_ARCHIVE"}; }
trap cleanup EXIT

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# Run a command on the host — or print it, under --dry-run.
remote() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] ssh %s@%s %s\n' "$REMOTE_USER" "$REMOTE_HOST" "$(printf '%q ' "$@")"
    return 0
  fi
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "$@"
}

copy() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  [dry-run] scp %s -> %s@%s:%s\n' "$1" "$REMOTE_USER" "$REMOTE_HOST" "$2"
    return 0
  fi
  scp "${SSH_OPTS[@]}" "$1" "${REMOTE_USER}@${REMOTE_HOST}:$2"
}

# ─── 1. Preflight, locally, before the host is touched ────────────────────────
say "Preflight"

[ -f "$SSH_KEY" ] || [ "$DRY_RUN" -eq 1 ] || die "SSH key not found at $SSH_KEY"
cd "$SOURCE_DIR"

# D-4: the build is the deploy. No build, no deploy — and the check is here, before
# anything on the host has changed, rather than after extraction.
say "Building (npm run build)"
npm run build
[ -f dist/index.html ] || die "npm run build produced no dist/index.html — refusing to deploy"
grep -q '<script type="module"' dist/index.html \
  || die "dist/index.html has no module script tag — the build did not bundle the app"

# ─── 2. Pack the application ──────────────────────────────────────────────────
#
# D-13: what ships is the built site, the relay, and the systemd unit. NOT test/,
# scripts/, src/, node_modules/, .git/, .claude/, or any planning .md — all of which
# the old script extracted into a world-readable public web root.
#
# Layout on the host:
#   /var/www/html/            ← dist/* (index.html + assets/)
#   /var/www/html/server/     ← server/ (the relay — a Node ES MODULE since PR 33)
#   /var/www/html/shared/     ← shared/ (PR 33) — see below, this one is load-bearing
#   /var/www/html/textures/   ← uploaded separately, see step 5
#   /var/www/html/cuubz.service   ← data only; systemd reads it from /etc
#
# ─── WHY `shared` IS IN THIS ARCHIVE (PR 33) ──────────────────────────────────
#
# `server/index.js`, `server/session.js` and `server/matchmaking.js` all
# `import ... from '../shared/protocol.js'`. `WorkingDirectory` in cuubz.service
# is `/var/www/html/server`, so that specifier resolves to `/var/www/html/shared/…` —
# one level UP from the deployed relay, outside the `server` member this archive used
# to carry. Ship `server` without `shared` and the relay dies on boot with
# ERR_MODULE_NOT_FOUND, systemd retries it every 5 s forever, and the site keeps
# serving perfectly while multiplayer is simply gone. That is D-2's shape exactly.
# `shared/package.json` (`"type": "module"`) must travel with it or Node reparses the
# file with a MODULE_TYPELESS_PACKAGE_JSON warning on every boot.
say "Packing application"
# `--exclude='*.map'` is D-13 again, and it is the reason `vite.config.js` may keep
# `sourcemap` on — decision 67. `dist/assets/index-<hash>.js.map` carries `sourcesContent`
# for 148 files / 2,526,003 bytes: the whole of `src/` plus `node_modules/three`. Shipping
# it puts the source tree back in the web root at a URL that is just the bundle's plus
# `.map`, chmod 644, which is precisely what the header above says this script exists to
# stop. `sourcemap: 'hidden'` was NOT enough — it drops the `//# sourceMappingURL` comment
# and still emits, packs and deploys the file. The map stays in the local `dist/`, where
# `npm run test:e2e` uses it and where an operator debugging a production stack trace
# loads it by hand against the same build (the hash in `index.html` names which one).
# BOTH `--exclude`s MUST STAY BEFORE THE FIRST `-C`. GNU tar processes options in order
# and an `--exclude` applies only to members named AFTER it — so with them at the end,
# where `--exclude='server/node_modules'` used to sit, neither one filters `dist/` and the
# map ships anyway. Verified by building the archive both ways and listing it: trailing
# excludes give 18 members including `./assets/index-<hash>.js.map`, leading excludes give
# 17 without it. `server/node_modules` never existed at pack time, which is why the old
# placement looked like it worked.
tar czf "$ARCHIVE" \
    --exclude='server/node_modules' \
    --exclude='*.map' \
    -C dist . \
    -C "$SOURCE_DIR" server shared \
    cuubz.service
printf '  %s (%s)\n' "$ARCHIVE" "$(du -h "$ARCHIVE" | cut -f1)"

# ─── 3. Back up, then replace ─────────────────────────────────────────────────
say "Deploying"

remote "mkdir -p ${STAGING_DIR}/incoming ${BACKUP_DIR}"

copy "$ARCHIVE" "${STAGING_DIR}/incoming/app-${STAMP}.tar.gz"

# D-3: a backup, taken BEFORE anything is removed, kept outside the web root, with the
# last $KEEP_BACKUPS retained. `DEPLOY.md` §6 had no rollback target at all before this.
# textures/ is excluded — it is 118 MB, it is not what a bad deploy breaks, and copying
# it into every backup would fill the disk in a week.
remote "cd ${REMOTE_DIR} && tar czf ${BACKUP_DIR}/webroot-${STAMP}.tar.gz --exclude=textures . 2>/dev/null || true"
remote "ls -1t ${BACKUP_DIR}/webroot-*.tar.gz 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f"

# D-5 + D-13: `tar xzf` never deletes, so every file ever deployed is still on that host
# — including, right now, the entire pre-PR-9 js/ tree. Removing the managed paths
# before extracting is what makes a deploy converge on what the repo actually contains.
#
# textures/ is deliberately NOT in this list (step 5 owns it), and neither is anything
# outside it: this removes only what this script puts there. A blanket `rm -rf
# ${REMOTE_DIR}/*` would take textures with it and would be unrecoverable if the path
# were ever wrong.
# D-97: this list was written from what the repo looked like at PR 10 and never
# reconciled against what `sync-legacy.sh` actually leaves behind. Verified against the
# real web root on 2026-07-31, six repo files survived every entry above: `.github/`
# (CI workflows), `.prettierignore`, `vitest.config.js`, `sync.sh` and `sync-legacy.sh`
# (both naming the host and its deploy paths), and `eslint.config.mjs` — the list said
# `eslint.config.js`, a name this repo has never used. A file that is not in this list
# is not "left alone", it is **served**, chmod 644, from a public DocumentRoot.
#
# `docs/`, `sounds/` and `test_worldgen.js` are deliberately NOT here. They pre-date every
# deploy (May–June), they are not in this repo, and this list removes only what this
# script puts there — same argument as textures/. Removing something the repo has never
# owned is a one-time operator decision, not a thing a deploy script should do on a
# schedule to a directory it did not create.
# `cuubz-relay.service` is the PRE-RENAME name (D-95). It is still sitting in the web
# root of any host deployed before 2026-07-31, and nothing else would ever remove it.
# Keep it in this list.
remote "cd ${REMOTE_DIR} && rm -rf assets server shared index.html cuubz.service cuubz-relay.service \
        js css test scripts .claude src dist node_modules .github \
        *.md *.json *.tar.gz .gitignore .prettierrc .prettierignore \
        eslint.config.js eslint.config.mjs vite.config.js vitest.config.js \
        sync.sh sync-legacy.sh 2>/dev/null || true"

remote "tar xzf ${STAGING_DIR}/incoming/app-${STAMP}.tar.gz -C ${REMOTE_DIR}"
remote "rm -f ${STAGING_DIR}/incoming/app-${STAMP}.tar.gz"

# D-6: chmod scoped to what was just extracted, not to all of /var/www/html. The old
# `find /var/www/html -type f -exec chmod 644 {} +` walked 3,370 texture files on every
# deploy and — because it ran with `&&` AFTER extraction — aborted the script mid-way
# with the new files already live if a single file was owned by another user.
# `|| true` here is deliberate and is not hiding a gate: extraction has already
# succeeded at this point, and a permission the deployer cannot change is a thing to
# warn about, not to fail a completed deploy over.
remote "cd ${REMOTE_DIR} && find . -path ./textures -prune -o -type f -exec chmod 644 {} + 2>/dev/null; \
        find . -path ./textures -prune -o -type d -exec chmod 755 {} + 2>/dev/null; true"

# ─── 4. Resolve node ──────────────────────────────────────────────────────────
#
# D-10: `cuubz.service` no longer names a node version. It runs
# `/usr/bin/env node` with `/home/dadmin/.local/node/bin` first on PATH, and this is
# what keeps that symlink pointing at whichever node tarball is unpacked under ~/.local.
# A node upgrade becomes "unpack, ./sync.sh" with no unit edit and no daemon-reload.
#
# D-94 (closed by the first real deploy, 2026-07-31): this step used to run AFTER the
# dependency install below, which is backwards — the install needs the interpreter this
# step resolves. `ssh host 'cmd'` is non-interactive, Debian's default `~/.bashrc` returns
# early for non-interactive shells, and node lives only under `~/.local/node-v*-linux-x64`
# on this box, so `npm` was not on PATH at all. `set -e` then aborted the deploy AFTER the
# web root had been replaced: site up, `server/node_modules` missing, relay dead in a
# 5-second `Restart=on-failure` loop with `ERR_MODULE_NOT_FOUND: Cannot find package 'ws'`.
# The symlink is now resolved first and step 5 puts it on PATH explicitly.
say "Resolving node"
remote 'set -e
  target="$(ls -1d "$HOME"/.local/node-v*-linux-x64 2>/dev/null | sort -V | tail -1)"
  if [ -z "$target" ]; then
    echo "  ! no ~/.local/node-v*-linux-x64 found — leaving the symlink alone" >&2
  else
    ln -sfn "$target" "$HOME/.local/node"
    echo "  ~/.local/node -> $target  ($("$HOME/.local/node/bin/node" --version))"
  fi'

# ─── 5. Server dependencies ───────────────────────────────────────────────────
#
# D-9: `server/node_modules` is excluded from the archive (it is platform-specific and
# large), and nothing ever installed it remotely — so adding a dependency to
# server/package.json deployed the code that needs it and not the dependency, and the
# relay threw `Cannot find module` on the next restart.
#
# D-94: the `export PATH` is the load-bearing half of the fix above, and it must name the
# SAME `~/.local/node/bin` the unit file's `Environment=PATH` names — otherwise the deploy
# could install dependencies with one node and run them under another. The explicit
# `command -v npm` check turns "npm: command not found" (exit 127, no context) into a
# message that says which PATH was searched, because this is the step that decides whether
# the relay can boot at all.
say "Server dependencies"
remote "set -e
  export PATH=\"\$HOME/.local/node/bin:\$HOME/.local/bin:\$PATH\"
  command -v npm >/dev/null 2>&1 || {
    echo '  ! npm not found. PATH searched:' >&2
    echo \"      \$PATH\" >&2
    echo '  ! unpack a node tarball under ~/.local/node-v<version>-linux-x64 and re-run' >&2
    exit 1
  }
  cd ${REMOTE_DIR}/server
  if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
  echo \"  npm \$(npm --version) / node \$(node --version) — \$(ls node_modules | wc -l) packages\""

# ─── 6. Textures ──────────────────────────────────────────────────────────────
#
# D-11: 118 MB across 3,370 files, and they change perhaps once a release. The old
# script re-uploaded them every single time. They are their own artifact now: skipped
# by default, uploaded on --textures, and uploaded automatically if the host does not
# have them yet (a first deploy, or a restore onto a clean box).
#
# The probe asks for BOTH manifests. It used to ask only for blocks/, which was complete
# when blocks/ was the only manifest — the item atlas built its list from a hardcoded
# array in the client bundle, so items needed nothing on disk. That stopped being true
# when items/manifest.json became a build artifact: a host provisioned before it existed
# passes a blocks-only probe, skips the upload, and then 404s the item manifest, at which
# point every named item in the inventory renders as a "?" placeholder while every block
# renders fine. Probing for the newer of the two artifacts is what makes the first deploy
# after this change self-correcting instead of needing someone to remember --textures.
if [ "$WITH_TEXTURES" -eq 1 ] \
   || ! remote "test -f ${REMOTE_DIR}/textures/blocks/manifest.json && test -f ${REMOTE_DIR}/textures/items/manifest.json" 2>/dev/null; then
  say "Uploading textures (118 MB — this is the slow part)"
  TEX_ARCHIVE="$(mktemp -t cuubz-tex-XXXXXX).tar.gz"
  tar czf "$TEX_ARCHIVE" -C "$SOURCE_DIR" textures
  copy "$TEX_ARCHIVE" "${STAGING_DIR}/incoming/textures-${STAMP}.tar.gz"
  remote "rm -rf ${REMOTE_DIR}/textures && tar xzf ${STAGING_DIR}/incoming/textures-${STAMP}.tar.gz -C ${REMOTE_DIR} \
          && rm -f ${STAGING_DIR}/incoming/textures-${STAMP}.tar.gz \
          && find ${REMOTE_DIR}/textures -type f -exec chmod 644 {} + \
          && find ${REMOTE_DIR}/textures -type d -exec chmod 755 {} +"
else
  say "Textures unchanged — skipped (use --textures to force)"
fi

# ─── 7. Relay restart ─────────────────────────────────────────────────────────
#
# The node symlink this unit resolves through is step 4 now, not here — see D-94 there.
#
# D-2: the old script never restarted anything. There is no systemctl, service, kill or
# pm2 call anywhere in the pre-PR-10 repo — so every server/ change was deployed to disk
# and silently ignored by the relay running from memory, and the script printed
# "Sync complete!" over the top of it.
#
# `sudo -n` fails immediately if dadmin does not have passwordless sudo, instead of
# hanging on a password prompt with no TTY. A failure here is a WARNING, not an abort:
# the static site is already deployed and correct, and the operator needs to be told
# exactly what to run, not to be left guessing which half succeeded.
if [ "$RESTART_RELAY" -eq 1 ]; then
  say "Restarting the relay"
  # The unit file is data in the web root; systemd reads it from /etc. Copy it across
  # only when it differs, so a normal deploy does not need a daemon-reload.
  remote "set -e
    # D-98. Distinguish the two failures, because the operator's next move is different.
    # 10.0.30.160 has NO sudo package at all — dadmin is not in a sudo group and
    # /usr/bin/sudo does not exist — so the old single 'passwordless sudo unavailable'
    # line sent the reader off to run four sudo commands that cannot work on this host.
    if ! command -v sudo >/dev/null 2>&1; then
      echo '  ! sudo is NOT INSTALLED on this host (D-98) — this script cannot restart the relay' >&2
      exit 92
    fi
    if ! sudo -n true 2>/dev/null; then
      echo '  ! sudo is installed but not passwordless for this user' >&2; exit 90
    fi
    # D-95. The box had the relay installed BY HAND as \`cuubz.service\` before this
    # script existed, while every line in this repo said \`cuubz-relay\` — DEPLOY.md §7
    # had recorded the unit name from the repo FILENAME without ever having looked at
    # the host. The two files were byte-identical; the name was the whole difference.
    # **Ruling: the repo moved to \`cuubz.service\`** — renaming the repo needs no root
    # and no downtime, renaming a running enabled unit needs both.
    #
    # The guard therefore points the OTHER way now. If a \`cuubz-relay.service\` ever
    # appears on a host, it is the pre-rename name and it declares the same
    # WorkingDirectory and the same MATCHMAKING_PORT=8765 — two enabled units racing for
    # one port, where the loser gets EADDRINUSE and crash-loops on Restart=on-failure
    # forever and which one loses is a boot-order coin flip. Refuse rather than guess.
    if systemctl list-unit-files cuubz-relay.service --no-legend 2>/dev/null | grep -q .; then
      echo '  ! cuubz-relay.service also exists on this host — the pre-rename unit, same port (8765).' >&2
      echo '  ! Retire it first, then re-run:' >&2
      echo '  !     systemctl disable --now cuubz-relay.service' >&2
      echo '  !     rm /etc/systemd/system/cuubz-relay.service && systemctl daemon-reload' >&2
      exit 91
    fi
    if ! cmp -s ${REMOTE_DIR}/cuubz.service /etc/systemd/system/cuubz.service; then
      echo '  unit file changed — installing and reloading systemd'
      sudo -n cp ${REMOTE_DIR}/cuubz.service /etc/systemd/system/cuubz.service
      sudo -n systemctl daemon-reload
    fi
    sudo -n systemctl restart cuubz
    sleep 2
    sudo -n systemctl is-active --quiet cuubz && echo '  cuubz is active' " || {
      warn "The relay was NOT restarted. The site is deployed and serving; the relay is still running the OLD server/ code."
      warn "On 10.0.30.160 this is expected — D-98, there is no sudo package. Restart as root:"
      warn "    ssh ${REMOTE_USER}@${REMOTE_HOST} -t \"su -c 'systemctl restart cuubz && systemctl status cuubz --no-pager'\""
      warn "If the unit file itself changed, install it first (it is data in the web root; systemd reads /etc):"
      warn "    ssh ${REMOTE_USER}@${REMOTE_HOST} -t \"su -c 'cp ${REMOTE_DIR}/cuubz.service /etc/systemd/system/cuubz.service && systemctl daemon-reload'\""
      warn "Where sudo DOES exist, the same two are 'sudo systemctl ...' with no -t."
    }
else
  warn "--no-restart: the relay is still running the previous server/ code (D-2)."
fi

# ─── 8. Post-deploy verification ──────────────────────────────────────────────
#
# "Sync complete!" used to print unconditionally. These are the two cheapest checks
# that would have caught a JS-less deploy (D-4), which is the failure this whole PR is
# about — and they run against the host, not against the local tree.
say "Verifying"
remote "set -e
  cd ${REMOTE_DIR}
  test -f index.html || { echo '  ! no index.html in the web root' >&2; exit 1; }
  bundle=\$(grep -o 'src=\"[^\"]*\\.js\"' index.html | head -1 | sed 's/src=\"//; s/\"//')
  test -n \"\$bundle\" || { echo '  ! index.html references no JS at all — this is D-4' >&2; exit 1; }
  test -f \".\${bundle}\" || { echo \"  ! index.html points at \$bundle, which is not on disk\" >&2; exit 1; }
  echo \"  index.html -> \$bundle  (\$(stat -c%s \".\${bundle}\") bytes)\"
  # D-96. The first deploy served the UNBUILT tree — the repo-root index.html, whose
  # \`<script type=\"module\" src=\"/src/index.js\">\` reaches \`import * as THREE from 'three'\`
  # and dies in the browser with 'Failed to resolve module specifier \"three\"'. Every check
  # above passes on that web root: index.html exists, it names a .js, and /src/index.js is
  # on disk. What separates a built deploy from an unbuilt one is that Vite rewrites the
  # entry to a content-hashed /assets/ path, so that is what to assert.
  case \"\$bundle\" in
    /assets/*) ;;
    *) echo \"  ! index.html points at \$bundle, not a hashed /assets/ bundle — this web root is the UNBUILT source tree, not dist/. The browser will fail on the bare 'three' specifier.\" >&2; exit 1 ;;
  esac
  test ! -d src || { echo '  ! /var/www/html/src exists — a legacy sync-legacy.sh deploy is still on this host' >&2; exit 1; }
  # D-94: the relay boots by importing 'ws' on server/index.js:12, before it ever reaches
  # ../shared/protocol.js. Without this the deploy reports success and the unit crash-loops.
  test -d server/node_modules/ws || { echo '  ! server/node_modules/ws missing — the relay cannot boot (D-94)' >&2; exit 1; }
  test -f textures/blocks/manifest.json || echo '  ! textures/blocks/manifest.json missing — run ./sync.sh --textures' >&2
  test -f textures/items/manifest.json || echo '  ! textures/items/manifest.json missing — every named item will render as a \"?\" placeholder; run ./sync.sh --textures' >&2
  test -f server/index.js || echo '  ! server/index.js missing' >&2
  test -f shared/protocol.js || echo '  ! shared/protocol.js missing — server/ imports it as ../shared/protocol.js and the relay will not boot without it (PR 33)' >&2
  test -f shared/package.json || echo '  ! shared/package.json missing — without its \"type\": \"module\" Node warns on every relay boot' >&2
  # D-99. Every check above is a claim about FILES. None of them can tell a working relay
  # from one that has been crash-looping for a fortnight, which is how a hand-started
  # process from 14 July kept port 8765 while the unit retried every 5 s behind it — and
  # once D-94 was fixed the symptom merely changed from ERR_MODULE_NOT_FOUND to
  # EADDRINUSE on the same silent loop. Ask the port who owns it and ask the relay whether
  # it is alive. Warnings, not failures: the static site is deployed and correct at this
  # point, and on a host where this script cannot restart the relay (D-98) a stale relay
  # must not fail an otherwise good deploy.
  echo \"  8765 owner -> \$(ss -ltnp 2>/dev/null | awk '/:8765 /{print \$NF; exit}' || echo 'nothing listening')\"
  export PATH=\"\$HOME/.local/node/bin:\$PATH\"
  if command -v node >/dev/null 2>&1; then
    node -e \"fetch('http://127.0.0.1:8765/health').then(r=>r.json()).then(j=>console.log('  relay /health ->',JSON.stringify(j))).catch(e=>console.error('  ! relay /health unreachable:',e.message))\" || true
  else
    echo '  ! node not on PATH — cannot health-check the relay' >&2
  fi"

say "Deploy complete"
cat <<EOF
  Backup:   ${BACKUP_DIR}/webroot-${STAMP}.tar.gz   (last ${KEEP_BACKUPS} kept)
  Rollback: DEPLOY.md §6 — untar that file over ${REMOTE_DIR}
  Check:    open http://${REMOTE_HOST}/ and confirm the menu renders and a world loads
EOF
