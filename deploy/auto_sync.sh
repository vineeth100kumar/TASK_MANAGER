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
# While an update is running, a lightweight update screen is served on the same
# port so the user sees an animated Sage logo + "Update in progress" instead of
# a connection error. If the deploy fails, the checkout is rolled back and Sage
# restarts on the previous working version.
#
# Sage also drives the desk clock (raspberry_pi/desk/); the clock's firmware
# (lumo/esp32_client/) is built by GitHub (.github/workflows/lumo-firmware.yml)
# and Sage sends it to the clock over Wi-Fi (raspberry_pi/desk/ota.py), so a
# firmware change restarts nothing here either.
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
UPDATE_PID_FILE="$REPO/deploy/.update-server.pid"

as_user() { if [ "$(id -un)" = "$RUN_AS" ]; then "$@"; else sudo -u "$RUN_AS" -H "$@"; fi; }
restart_unit() { if [ "$(id -u)" -eq 0 ]; then systemctl restart "$1"; else sudo -n /usr/bin/systemctl restart "$1"; fi; }
stop_unit()    { if [ "$(id -u)" -eq 0 ]; then systemctl stop "$1";    else sudo -n /usr/bin/systemctl stop "$1"; fi; }
log() { echo "[auto_sync] $*"; }

# ---------------------------------------------------------------------------
# Update screen: a tiny Python HTTP server on :8000 while Sage is down.
# ---------------------------------------------------------------------------
start_update_screen() {
  [ -f "$UPDATE_PID_FILE" ] && stop_update_screen
  log "showing update screen"
  as_user python3 "$REPO/deploy/update_server.py" --port 8000 --repo "$REPO" &
  local pid=$!
  # Give it a moment to bind
  local tries=0
  while [ $tries -lt 10 ]; do
    sleep 0.3
    if curl -fsS -o /dev/null http://127.0.0.1:8000/ 2>/dev/null; then
      log "update screen live (pid $pid)"
      return 0
    fi
    tries=$((tries + 1))
  done
  log "update screen did not start; continuing without it"
}

stop_update_screen() {
  if [ -f "$UPDATE_PID_FILE" ]; then
    local pid
    pid=$(cat "$UPDATE_PID_FILE" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null || true
      log "update screen stopped"
    fi
    rm -f "$UPDATE_PID_FILE"
  fi
  # Belt-and-suspenders: kill anything we backgrounded on the port
  for p in $(pgrep -f "update_server.py.*--port 8000" 2>/dev/null || true); do
    kill "$p" 2>/dev/null || true
  done
}
trap stop_update_screen EXIT

# ---------------------------------------------------------------------------
# Build helpers
# ---------------------------------------------------------------------------
build_web() {
  command -v npm >/dev/null || { log "npm not installed; web app not rebuilt"; return 0; }
  log "rebuilding the web app"
  rm -rf "$REPO/dist.next"
  (cd "$REPO" && as_user nice -n 10 env NODE_OPTIONS=--max-old-space-size=2048 VITE_PI_BACKEND_URL="${VITE_PI_BACKEND_URL:-/}" npm run build --silent -- --outDir dist.next --emptyOutDir) || {
    log "web build failed; keeping the previous dist/"; rm -rf "$REPO/dist.next"; return 1; }
  rm -rf "$REPO/dist.old"
  [ -d "$REPO/dist" ] && mv "$REPO/dist" "$REPO/dist.old"
  mv "$REPO/dist.next" "$REPO/dist"
  rm -rf "$REPO/dist.old"
}

# ---------------------------------------------------------------------------
# Deploy steps (pip, npm, web build). Sage is already stopped at this point.
# ---------------------------------------------------------------------------
deploy_changes() {
  local changed="$1"
  if grep -q '^raspberry_pi/requirements.txt$' <<<"$changed"; then
    as_user "$REPO/raspberry_pi/venv/bin/pip" install -q -r "$REPO/raspberry_pi/requirements.txt" || { log "pip failed for sage"; return 1; }
  fi
  if grep -qE '^(raspberry_pi/requirements-depth\.txt|deploy/install_depth\.sh)$' <<<"$changed"; then
    as_user "$REPO/deploy/install_depth.sh" "$REPO" || log "optional depth-face packages failed to install"
  fi

  if grep -qE '^(src/|public/|index\.html$|package(-lock)?\.json$|vite\.config\.|tailwind\.config\.|postcss\.config\.|\.env\.production$)' <<<"$changed"; then
    if grep -qE '^package(-lock)?\.json$' <<<"$changed" && command -v npm >/dev/null; then
      (cd "$REPO" && as_user nice -n 10 env NODE_OPTIONS=--max-old-space-size=1536 npm ci --silent --no-audit --no-fund) || { log "npm ci failed"; return 1; }
    fi
    build_web || return 1
  fi
  if grep -q '^deploy/' <<<"$changed"; then
    log "deploy/ changed; run 'sudo deploy/install_pi.sh' to apply it"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Main sync loop
# ---------------------------------------------------------------------------
sync_once() {
  as_user git -C "$REPO" fetch --quiet origin "$BRANCH" || { log "fetch failed"; return 0; }
  local head new deployed
  head=$(as_user git -C "$REPO" rev-parse HEAD)
  new=$(as_user git -C "$REPO" rev-parse "origin/$BRANCH")
  [ -f "$STATE" ] || echo "$head" > "$STATE"
  deployed=$(cat "$STATE")
  [ "$head" = "$new" ] && [ "$deployed" = "$new" ] && return 0

  # ------- Update detected: show the update screen -------
  log "updating ${deployed:0:7} -> ${new:0:7}"

  # 1. Stop Sage so :8000 is free
  stop_unit sage 2>/dev/null || true
  # 2. Start the update screen on :8000
  start_update_screen
  # 3. Pull the new code
  if [ "$head" != "$new" ]; then
    as_user git -C "$REPO" reset --hard --quiet "$new" || {
      log "reset failed; rolling back"
      stop_update_screen
      restart_unit sage
      return 1
    }
  fi

  local changed
  if as_user git -C "$REPO" cat-file -e "$deployed^{commit}" 2>/dev/null; then
    changed=$(as_user git -C "$REPO" diff --name-only "$deployed" "$new")
  else
    log "last deployed commit is unknown; redoing every step"
    changed=$(printf '%s\n' raspberry_pi/requirements.txt package.json src/ raspberry_pi/)
  fi

  # 4. Run the deploy (pip, npm, web build)
  if deploy_changes "$changed"; then
    echo "$new" > "$STATE"
    log "deploy succeeded"
  else
    # Rollback: go back to the last working commit and restart Sage on that
    log "deploy failed; rolling back to ${deployed:0:7}"
    as_user git -C "$REPO" reset --hard --quiet "$deployed" 2>/dev/null || true
    stop_update_screen
    restart_unit sage
    log "rolled back; will try again in ${RETRY_AFTER}s"
    return 1
  fi

  # 5. Stop the update screen, start Sage on the new code
  stop_update_screen
  restart_unit sage || { log "sage restart failed after deploy"; return 1; }
  log "update complete"
}

if [ "${SAGE_SYNC_ONCE:-}" = 1 ]; then sync_once; exit $?; fi

while true; do
  if sync_once; then sleep "$INTERVAL"; else sleep "$RETRY_AFTER"; fi
done
