#!/usr/bin/env bash
# Keep the Pi's checkout on origin/main and restart only what changed.
#
# Runs as root under sage-autosync.service. Git, npm and pip run as the
# checkout's owner. Untracked files (the SQLite database, venvs, .env files,
# the firmware's secrets.h, LUMO's photo library) survive the reset.
#
#   Sage server changed (raspberry_pi/)       -> reinstall its deps if needed, restart sage
#   Web app changed (src/, public/, ...)      -> npm ci if the lockfile changed, rebuild dist/
#   LUMO server changed (lumo/rpi_server/)    -> reinstall its deps if needed, restart lumo
#   deploy/ changed                           -> nothing automatic; re-run install_pi.sh
#
# A LUMO-only change never restarts Sage, and the other way round.

set -uo pipefail

REPO="${SAGE_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
RUN_AS="${SAGE_USER:-$(stat -c %U "$REPO")}"
BRANCH="${SAGE_BRANCH:-main}"
INTERVAL="${SAGE_SYNC_INTERVAL:-30}"

as_user() { sudo -u "$RUN_AS" -H "$@"; }
log() { echo "[auto_sync] $*"; }

sync_once() {
  as_user git -C "$REPO" fetch --quiet origin "$BRANCH" || { log "fetch failed"; return; }
  local old new
  old=$(as_user git -C "$REPO" rev-parse HEAD)
  new=$(as_user git -C "$REPO" rev-parse "origin/$BRANCH")
  [ "$old" = "$new" ] && return

  local changed
  changed=$(as_user git -C "$REPO" diff --name-only "$old" "$new")
  log "updating ${old:0:7} -> ${new:0:7}"
  as_user git -C "$REPO" reset --hard --quiet "$new" || { log "reset failed"; return; }

  if grep -q '^raspberry_pi/requirements.txt$' <<<"$changed"; then
    as_user "$REPO/raspberry_pi/venv/bin/pip" install -q -r "$REPO/raspberry_pi/requirements.txt"
  fi
  if grep -q '^lumo/rpi_server/requirements.txt$' <<<"$changed"; then
    as_user "$REPO/lumo/rpi_server/venv/bin/pip" install -q -r "$REPO/lumo/rpi_server/requirements.txt"
  fi

  if grep -qE '^(src/|public/|index\.html$|package(-lock)?\.json$|vite\.config\.|tailwind\.config\.|postcss\.config\.|\.env\.production$)' <<<"$changed"; then
    if command -v npm >/dev/null; then
      if grep -qE '^package(-lock)?\.json$' <<<"$changed"; then
        (cd "$REPO" && as_user npm ci --silent)
      fi
      log "rebuilding the web app"
      (cd "$REPO" && as_user env VITE_PI_BACKEND_URL="${VITE_PI_BACKEND_URL:-/}" npm run build --silent) || log "web build failed; keeping the previous dist/"
    else
      log "npm not installed; web app not rebuilt"
    fi
  fi

  if grep -q '^raspberry_pi/' <<<"$changed"; then
    log "restarting sage"; systemctl restart sage
  fi
  if grep -q '^lumo/rpi_server/' <<<"$changed"; then
    log "restarting lumo"; systemctl restart lumo
  fi
  if grep -q '^deploy/' <<<"$changed"; then
    log "deploy/ changed; run 'sudo deploy/install_pi.sh' to apply it"
  fi
}

while true; do
  sync_once
  sleep "$INTERVAL"
done
