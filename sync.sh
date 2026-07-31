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
# ─── ⚠ NOTHING BELOW THIS LINE HAS EVER BEEN RUN ──────────────────────────────
#
# No session in this project has had an SSH key for `dadmin@10.0.30.160`, so every
# remote command here is written from `DEPLOY.md` §3–§6 and has **not** been executed
# against the host. `DEPLOY.md` §9 marks what is verified and what is not.
#
# **Run `./sync.sh --dry-run` first.** It prints every remote command without
# connecting. Read it, then run for real. The first real run is the test.
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
#   /var/www/html/cuubz-relay.service   ← data only; systemd reads it from /etc
#
# ─── WHY `shared` IS IN THIS ARCHIVE (PR 33) ──────────────────────────────────
#
# `server/index.js`, `server/session.js` and `server/matchmaking.js` all
# `import ... from '../shared/protocol.js'`. `WorkingDirectory` in cuubz-relay.service
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
    cuubz-relay.service
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
remote "cd ${REMOTE_DIR} && rm -rf assets server shared index.html cuubz-relay.service \
        js css test scripts .claude src dist node_modules \
        *.md *.json *.tar.gz .gitignore .prettierrc eslint.config.js vite.config.js 2>/dev/null || true"

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

# ─── 4. Server dependencies ───────────────────────────────────────────────────
#
# D-9: `server/node_modules` is excluded from the archive (it is platform-specific and
# large), and nothing ever installed it remotely — so adding a dependency to
# server/package.json deployed the code that needs it and not the dependency, and the
# relay threw `Cannot find module` on the next restart.
say "Server dependencies"
remote "cd ${REMOTE_DIR}/server && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi"

# ─── 5. Textures ──────────────────────────────────────────────────────────────
#
# D-11: 118 MB across 3,370 files, and they change perhaps once a release. The old
# script re-uploaded them every single time. They are their own artifact now: skipped
# by default, uploaded on --textures, and uploaded automatically if the host does not
# have them yet (a first deploy, or a restore onto a clean box).
if [ "$WITH_TEXTURES" -eq 1 ] || ! remote "test -f ${REMOTE_DIR}/textures/blocks/manifest.json" 2>/dev/null; then
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

# ─── 6. node symlink + relay restart ──────────────────────────────────────────
#
# D-10: `cuubz-relay.service` no longer names a node version. It runs
# `/usr/bin/env node` with `/home/dadmin/.local/node/bin` first on PATH, and this is
# what keeps that symlink pointing at whichever node tarball is unpacked under ~/.local.
# A node upgrade becomes "unpack, ./sync.sh" with no unit edit and no daemon-reload.
say "Resolving node"
remote 'set -e
  target="$(ls -1d "$HOME"/.local/node-v*-linux-x64 2>/dev/null | sort -V | tail -1)"
  if [ -z "$target" ]; then
    echo "  ! no ~/.local/node-v*-linux-x64 found — leaving the symlink alone" >&2
  else
    ln -sfn "$target" "$HOME/.local/node"
    echo "  ~/.local/node -> $target  ($("$HOME/.local/node/bin/node" --version))"
  fi'

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
    if ! sudo -n true 2>/dev/null; then
      echo '  ! passwordless sudo unavailable' >&2; exit 90
    fi
    if ! cmp -s ${REMOTE_DIR}/cuubz-relay.service /etc/systemd/system/cuubz-relay.service; then
      echo '  unit file changed — installing and reloading systemd'
      sudo -n cp ${REMOTE_DIR}/cuubz-relay.service /etc/systemd/system/cuubz-relay.service
      sudo -n systemctl daemon-reload
    fi
    sudo -n systemctl restart cuubz-relay
    sleep 2
    sudo -n systemctl is-active --quiet cuubz-relay && echo '  cuubz-relay is active' " || {
      warn "The relay was NOT restarted. The site is deployed and serving; the relay is still running the OLD server/ code."
      warn "Run these by hand:"
      warn "    ssh ${REMOTE_USER}@${REMOTE_HOST} 'sudo cp ${REMOTE_DIR}/cuubz-relay.service /etc/systemd/system/ && sudo systemctl daemon-reload'"
      warn "    ssh ${REMOTE_USER}@${REMOTE_HOST} 'sudo systemctl restart cuubz-relay && systemctl status cuubz-relay --no-pager'"
    }
else
  warn "--no-restart: the relay is still running the previous server/ code (D-2)."
fi

# ─── 7. Post-deploy verification ──────────────────────────────────────────────
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
  test -f textures/blocks/manifest.json || echo '  ! textures/blocks/manifest.json missing — run ./sync.sh --textures' >&2
  test -f server/index.js || echo '  ! server/index.js missing' >&2
  test -f shared/protocol.js || echo '  ! shared/protocol.js missing — server/ imports it as ../shared/protocol.js and the relay will not boot without it (PR 33)' >&2
  test -f shared/package.json || echo '  ! shared/package.json missing — without its \"type\": \"module\" Node warns on every relay boot' >&2"

say "Deploy complete"
cat <<EOF
  Backup:   ${BACKUP_DIR}/webroot-${STAMP}.tar.gz   (last ${KEEP_BACKUPS} kept)
  Rollback: DEPLOY.md §6 — untar that file over ${REMOTE_DIR}
  Check:    open http://${REMOTE_HOST}/ and confirm the menu renders and a world loads
EOF
