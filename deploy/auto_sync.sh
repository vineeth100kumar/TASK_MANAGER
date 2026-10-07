#!/usr/bin/env bash
# Keep the Pi's checkout on origin/main and restart only what changed.
#
# Runs as the checkout's owner (not root) under sage-autosync.service. The only
# thing it needs root for is restarting sage, which install_pi.sh allows
# through a sudoers rule limited to exactly that command.
# Untracked files (the SQLite database, venvs, .env files, the firmware's
# secrets.h) survive the reset.
#
#   Sage server changed (raspberry_pi/)       -> reinstall its deps if needed, restart sage
#   Web app changed (src/, public/, ...)      -> npm ci if the lockfile changed, rebuild dist/
#   deploy/ changed                           -> nothing automatic; re-run install_pi.sh
#
# Sage also drives the desk clock (raspberry_pi/desk/); the clock's firmware
# (lumo/esp32_client/) is flashed by hand and never restarts anything.
#
# The commit that was last deployed completely is remembered in
# .git/sage-deployed. If a step fails (a network blip during pip or npm, a
# broken build), that commit is not recorded, so the same changes are tried
# again a few minutes later instead of being skipped until some later commit
# happens to touch the same files. The web app is built beside dist/ and only
# swapped in when the build works, so a failed build leaves the old app running.

set -uo pipefail

REPO="${SAGE_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
RUN_AS="${SAGE_USER:-$(stat -c %U "$REPO")}"
BRANCH="${SAGE_BRANCH:-main}"
INTERVAL="${SAGE_SYNC_INTERVAL:-30}"
RETRY_AFTER="${SAGE_SYNC_RETRY:-300}"
STATE="$REPO/.git/sage-deployed"

# Run as the checkout's owner: directly when already that user, through sudo when started as root.
as_user() { if [ "$(id -un)" = "$RUN_AS" ]; then "$@"; else sudo -u "$RUN_AS" -H "$@"; fi; }
restart_unit() { if [ "$(id -u)" -eq 0 ]; then systemctl restart "$1"; else sudo -n /usr/bin/systemctl restart "$1"; fi; }
log() { echo "[auto_sync] $*"; }

build_web() {
  command -v npm >/dev/null || { log "npm not installed; web app not rebuilt"; return 0; }
  log "rebuilding the web app"
  rm -rf "$REPO/dist.next"
  (cd "$REPO" && as_user env VITE_PI_BACKEND_URL="${VITE_PI_BACKEND_URL:-/}" npm run build --silent -- --outDir dist.next --emptyOutDir) || {
    log "web build failed; keeping the previous dist/"; rm -rf "$REPO/dist.next"; return 1; }
  rm -rf "$REPO/dist.old"
  [ -d "$REPO/dist" ] && mv "$REPO/dist" "$REPO/dist.old"
  mv "$REPO/dist.next" "$REPO/dist"
  rm -rf "$REPO/dist.old"
}

# Returns non-zero when a step failed, so the caller doesn't record the commit as deployed.
deploy_changes() {
  local changed="$1"
  if grep -q '^raspberry_pi/requirements.txt$' <<<"$changed"; then
    as_user "$REPO/raspberry_pi/venv/bin/pip" install -q -r "$REPO/raspberry_pi/requirements.txt" || { log "pip failed for sage"; return 1; }
  fi

  if grep -qE '^(src/|public/|index\.html$|package(-lock)?\.json$|vite\.config\.|tailwind\.config\.|postcss\.config\.|\.env\.production$)' <<<"$changed"; then
    if grep -qE '^package(-lock)?\.json$' <<<"$changed" && command -v npm >/dev/null; then
      (cd "$REPO" && as_user npm ci --silent) || { log "npm ci failed"; return 1; }
    fi
    build_web || return 1
  fi

  if grep -q '^raspberry_pi/' <<<"$changed"; then
    log "restarting sage"; restart_unit sage || return 1
  fi
  if grep -q '^deploy/' <<<"$changed"; then
    log "deploy/ changed; run 'sudo deploy/install_pi.sh' to apply it"
  fi
  return 0
}

sync_once() {
  as_user git -C "$REPO" fetch --quiet origin "$BRANCH" || { log "fetch failed"; return 0; }
  local head new deployed
  head=$(as_user git -C "$REPO" rev-parse HEAD)
  new=$(as_user git -C "$REPO" rev-parse "origin/$BRANCH")
  # First run: the commit already checked out counts as deployed.
  [ -f "$STATE" ] || echo "$head" > "$STATE"
  deployed=$(cat "$STATE")
  [ "$head" = "$new" ] && [ "$deployed" = "$new" ] && return 0

  if [ "$head" != "$new" ]; then
    log "updating ${head:0:7} -> ${new:0:7}"
    as_user git -C "$REPO" reset --hard --quiet "$new" || { log "reset failed"; return 1; }
  fi

  local changed
  if as_user git -C "$REPO" cat-file -e "$deployed^{commit}" 2>/dev/null; then
    changed=$(as_user git -C "$REPO" diff --name-only "$deployed" "$new")
  else
    log "last deployed commit is unknown; redoing every step"
    changed=$(printf '%s\n' raspberry_pi/requirements.txt package.json src/ raspberry_pi/)
  fi

  if deploy_changes "$changed"; then
    echo "$new" > "$STATE"
  else
    log "will try again in ${RETRY_AFTER}s"
    return 1
  fi
}

# SAGE_SYNC_ONCE=1 runs a single pass, for tests.
if [ "${SAGE_SYNC_ONCE:-}" = 1 ]; then sync_once; exit $?; fi

while true; do
  if sync_once; then sleep "$INTERVAL"; else sleep "$RETRY_AFTER"; fi
done
