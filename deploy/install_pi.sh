#!/usr/bin/env bash
# One installer for Sage on the Raspberry Pi, desk clock (LUMO) included.
#
#   sudo deploy/install_pi.sh [--user vk] [--no-autosync] [--no-desk]
#   sudo deploy/install_pi.sh --only web          # one part at a time
#   sudo deploy/install_pi.sh --skip depth,web    # everything except these
#   sudo deploy/install_pi.sh --list              # show the parts
#
# The parts, in the order they run: packages settings server depth web
# autosync services audio check. On a small Pi, run them one by one
# (the heavy ones are server, depth and web) rather than all together.
#
# Run it from the checkout you want the Pi to serve. It is safe to run again:
# existing settings in /etc/sage/sage.env, the database and the venv are kept.
#
# What it does:
#   1. Writes /etc/sage/sage.env with a fresh API_SECRET if there isn't one,
#      and turns the desk clock on (SAGE_DESK=1) unless --no-desk.
#   2. Creates raspberry_pi/venv and installs Sage's deps.
#   3. Builds the web app into dist/ (needs Node/npm), served by Sage at :8000.
#   4. Installs the sage and sage-autosync systemd units for one user and this
#      checkout path. Stops and disables the old sage-backend, lumo and
#      lumo-obex units: Sage drives the desk clock itself now.
#   5. Stops the Pi offering itself as Bluetooth audio, so your phone's sound
#      stays on the phone (the Pi has no speaker).

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUN_AS="${SUDO_USER:-$(stat -c %U "$REPO")}"
AUTOSYNC=1
DESK=1
PARTS=(packages settings server depth web autosync services audio check)
ONLY=""
SKIP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user) RUN_AS="$2"; shift 2 ;;
    --no-autosync) AUTOSYNC=0; shift ;;
    --no-desk|--no-lumo) DESK=0; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --skip) SKIP="$2"; shift 2 ;;
    --list) echo "${PARTS[*]}"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
id "$RUN_AS" >/dev/null 2>&1 || { echo "No such user: $RUN_AS" >&2; exit 1; }
ENV_FILE=/etc/sage/sage.env
for p in ${ONLY//,/ } ${SKIP//,/ }; do
  [[ " ${PARTS[*]} " == *" $p "* ]] || { echo "Unknown part: $p (parts: ${PARTS[*]})" >&2; exit 2; }
done
wanted() {
  [ -z "$ONLY" ] || [[ ",$ONLY," == *",$1,"* ]] || return 1
  [[ ",$SKIP," != *",$1,"* ]]
}
as_user() { sudo -u "$RUN_AS" -H "$@"; }
step() { echo; echo "==> $*"; }

echo "Installing Sage from $REPO for user $RUN_AS"



part_packages() {
  step "System packages"
  apt-get update -qq
  apt-get install -y -qq python3-venv python3-pip sqlite3 git >/dev/null
}

part_settings() {
  step "Settings in /etc/sage/sage.env"
  install -d -m 755 /etc/sage
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  set_default() {  # add NAME=value only when NAME is not already set
    grep -q "^$1=" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"
  }
  if ! grep -q '^API_SECRET=.\+' "$ENV_FILE"; then
    sed -i '/^API_SECRET=/d' "$ENV_FILE"
    echo "API_SECRET=$(openssl rand -hex 24)" >> "$ENV_FILE"
    echo "Generated a new API_SECRET."
  fi
  set_default SAGE_DB_PATH "$REPO/raspberry_pi/sage_sync.db"
  set_default SAGE_DIST_DIR "$REPO/dist"
  set_default SAGE_CORS_ORIGINS "*"
  set_default VITE_PI_BACKEND_URL "/"
  if [ "$DESK" -eq 1 ]; then
    set_default SAGE_DESK 1
  fi
}

part_server() {
  step "Sage server venv"
  as_user python3 -m venv "$REPO/raspberry_pi/venv"
  as_user "$REPO/raspberry_pi/venv/bin/pip" install -q --upgrade pip
  as_user "$REPO/raspberry_pi/venv/bin/pip" install -q -r "$REPO/raspberry_pi/requirements.txt"
  command -v ollama >/dev/null || echo "Ollama is not installed, so AI task parsing will fail. See raspberry_pi/README.md."
}

part_depth() {
  step "Depth clock face (optional)"
  # The depth clock face's cutout is optional and heavy; Sage runs without it.
  as_user "$REPO/deploy/install_depth.sh" "$REPO" \
    || echo "The depth face's cutout packages didn't install; photos will show without a cutout."
}

part_web() {
  step "Web app"
  # The build is the biggest memory user in the whole install (Excalidraw makes
  # it ~2 GB). On a 4 GB Pi, with Sage and Ollama also resident, it ran the Pi out
  # of memory and the Pi rebooted. So: stop the other memory users while it runs,
  # cap Node's heap so it fails with an error instead of taking the Pi down, run
  # at low priority, and skip npm ci when node_modules already matches the lockfile.
  if command -v npm >/dev/null; then
    BACKEND_URL="$(grep '^VITE_PI_BACKEND_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
    STOPPED=()
    for svc in sage ollama; do
      if systemctl is-active --quiet "$svc"; then systemctl stop "$svc"; STOPPED+=("$svc"); fi
    done
    restart_stopped() { for svc in "${STOPPED[@]}"; do systemctl start "$svc" || true; done; STOPPED=(); }
    trap restart_stopped EXIT
    if [ -f "$REPO/node_modules/.package-lock.json" ] && cmp -s "$REPO/package-lock.json" "$REPO/node_modules/.package-lock.json.src" 2>/dev/null; then
      echo "node_modules already matches package-lock.json; skipping npm ci."
    else
      (cd "$REPO" && as_user nice -n 10 env NODE_OPTIONS=--max-old-space-size=1536 npm ci --silent --no-audit --no-fund) \
        && cp "$REPO/package-lock.json" "$REPO/node_modules/.package-lock.json.src" \
        || { echo "npm ci failed" >&2; exit 1; }
    fi
    rm -rf "$REPO/dist.next"
    (cd "$REPO" && as_user nice -n 10 env NODE_OPTIONS=--max-old-space-size=2048 VITE_PI_BACKEND_URL="${BACKEND_URL:-/}" npm run build --silent -- --outDir dist.next --emptyOutDir) \
      || { rm -rf "$REPO/dist.next"; echo "The web build failed (out of memory?). The old dist/ is kept; re-run this script." >&2; exit 1; }
    rm -rf "$REPO/dist.old"
    [ -d "$REPO/dist" ] && mv "$REPO/dist" "$REPO/dist.old"
    mv "$REPO/dist.next" "$REPO/dist"
    rm -rf "$REPO/dist.old"
    restart_stopped
    trap - EXIT
  else
    echo "npm is not installed, so the web app was not built. Install Node.js 20+ and re-run."
  fi
}

part_autosync() {
  if [ "$AUTOSYNC" -eq 1 ]; then
    step "Letting auto-sync restart sage (and nothing else) without root"
    SUDOERS=/etc/sudoers.d/sage-autosync
    printf '%s ALL=(root) NOPASSWD: /usr/bin/systemctl restart sage\n' "$RUN_AS" > "$SUDOERS.tmp"
    chmod 440 "$SUDOERS.tmp"
    if visudo -cf "$SUDOERS.tmp" >/dev/null; then mv "$SUDOERS.tmp" "$SUDOERS"; else rm -f "$SUDOERS.tmp"; echo "Couldn't install the sudoers rule; auto-sync won't be able to restart services." >&2; fi
  fi
}

part_services() {
  step "systemd units"
  UNITS=(sage)
  [ "$AUTOSYNC" -eq 1 ] && UNITS+=(sage-autosync)
  for unit in "${UNITS[@]}"; do
    sed -e "s|@USER@|$RUN_AS|g" -e "s|@REPO@|$REPO|g" \
      "$REPO/deploy/systemd/$unit.service" > "/etc/systemd/system/$unit.service"
  done
  # Retired units: the old backend (backend/app is gone), and LUMO's own
  # server and photo inbox, whose jobs Sage does now. lumo would also hold the
  # clock's port (8765) that Sage needs.
  for old in sage-backend lumo lumo-obex; do
    if systemctl list-unit-files "$old.service" >/dev/null 2>&1; then
      systemctl disable --now "$old.service" 2>/dev/null || true
      rm -f "/etc/systemd/system/$old.service"
    fi
  done
  systemctl daemon-reload
  for unit in "${UNITS[@]}"; do
    systemctl enable --quiet "$unit.service"
    systemctl restart "$unit.service"
  done
}

part_audio() {
  step "No Bluetooth audio"
  # Without this, a paired iPhone can route its sound to the Pi, which has no
  # speaker. The phone link (notifications, now playing) doesn't use audio.
  # Both spellings: WirePlumber 0.4 (Bookworm) reads Lua, 0.5 reads .conf.
  HOME_DIR="$(getent passwd "$RUN_AS" | cut -d: -f6)"
  as_user mkdir -p "$HOME_DIR/.config/wireplumber/bluetooth.lua.d" "$HOME_DIR/.config/wireplumber/wireplumber.conf.d"
  echo 'bluez_monitor.enabled = false' | as_user tee "$HOME_DIR/.config/wireplumber/bluetooth.lua.d/51-sage-no-audio.lua" >/dev/null
  printf 'wireplumber.profiles = {\n  main = {\n    monitor.bluez = disabled\n  }\n}\n' | as_user tee "$HOME_DIR/.config/wireplumber/wireplumber.conf.d/51-sage-no-audio.conf" >/dev/null
  as_user env XDG_RUNTIME_DIR="/run/user/$(id -u "$RUN_AS")" systemctl --user restart wireplumber 2>/dev/null || true
}

part_check() {
  step "Checking"
  sleep 3
  if curl -fsS http://127.0.0.1:8000/api/health; then echo; else echo "Sage did not answer; see: journalctl -u sage -n 50"; fi
}

summary() {
  echo
  echo "Sage listens on this Pi only (127.0.0.1:8000). Reach it through your tunnel or Tailscale link."
  echo "To also open it on the home network, add SAGE_BIND=0.0.0.0 to $ENV_FILE and restart sage."
  echo
  echo "Done. Enter this key in the web app under Settings > Server & Reset:"
  echo "    sudo grep API_SECRET $ENV_FILE"
  if grep -q '^SAGE_DESK=1' "$ENV_FILE"; then
    TOKEN_FILE="$(dirname "$(grep '^SAGE_DB_PATH=' "$ENV_FILE" | cut -d= -f2-)")/desk_token.txt"
    echo
    echo "Desk clock: put this pairing code in lumo/esp32_client/secrets.h as DESK_TOKEN, with this Pi's IP as PI_HOSTNAME:"
    if [ -f "$TOKEN_FILE" ]; then echo "    $(cat "$TOKEN_FILE")"; else echo "    (not made yet; see Settings or $TOKEN_FILE once Sage has started)"; fi
    echo "    This Pi's addresses: $(hostname -I)"
  fi
}

for part in "${PARTS[@]}"; do
  if wanted "$part"; then "part_$part"; fi
done
wanted check && summary
exit 0
