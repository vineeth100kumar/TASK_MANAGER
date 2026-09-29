#!/usr/bin/env bash
# One installer for Sage and LUMO on the Raspberry Pi.
#
#   sudo deploy/install_pi.sh [--user vk] [--no-autosync] [--no-lumo]
#
# Run it from the checkout you want the Pi to serve. It is safe to run again:
# existing settings in /etc/sage/sage.env, the database and both venvs are kept.
#
# What it does:
#   1. Writes /etc/sage/sage.env with a fresh API_SECRET if there isn't one.
#   2. Creates raspberry_pi/venv and lumo/rpi_server/venv and installs deps.
#   3. Builds the web app into dist/ (needs Node/npm), served by Sage at :8000.
#   4. Installs sage, lumo, lumo-obex and sage-autosync systemd units for one
#      user and this checkout path, and stops the old sage-backend unit.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUN_AS="${SUDO_USER:-$(stat -c %U "$REPO")}"
AUTOSYNC=1
LUMO=1
while [ $# -gt 0 ]; do
  case "$1" in
    --user) RUN_AS="$2"; shift 2 ;;
    --no-autosync) AUTOSYNC=0; shift ;;
    --no-lumo) LUMO=0; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
id "$RUN_AS" >/dev/null 2>&1 || { echo "No such user: $RUN_AS" >&2; exit 1; }
as_user() { sudo -u "$RUN_AS" -H "$@"; }
step() { echo; echo "==> $*"; }

echo "Installing Sage + LUMO from $REPO for user $RUN_AS"

step "System packages"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip sqlite3 git >/dev/null
if [ "$LUMO" -eq 1 ]; then
  # Audio, Bluetooth photo inbox and OpenCV runtime for LUMO.
  apt-get install -y -qq libportaudio2 obexpushd libgl1 >/dev/null || echo "Some LUMO packages failed to install; see above."
fi

step "Settings in /etc/sage/sage.env"
install -d -m 755 /etc/sage
ENV_FILE=/etc/sage/sage.env
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

step "Sage server venv"
as_user python3 -m venv "$REPO/raspberry_pi/venv"
as_user "$REPO/raspberry_pi/venv/bin/pip" install -q --upgrade pip
as_user "$REPO/raspberry_pi/venv/bin/pip" install -q -r "$REPO/raspberry_pi/requirements.txt"
command -v ollama >/dev/null || echo "Ollama is not installed, so AI task parsing will fail. See raspberry_pi/README.md."

if [ "$LUMO" -eq 1 ]; then
  step "LUMO server venv"
  as_user python3 -m venv "$REPO/lumo/rpi_server/venv"
  as_user "$REPO/lumo/rpi_server/venv/bin/pip" install -q --upgrade pip
  as_user "$REPO/lumo/rpi_server/venv/bin/pip" install -q -r "$REPO/lumo/rpi_server/requirements.txt"
  [ -f "$REPO/lumo/rpi_server/.env" ] || as_user cp "$REPO/lumo/rpi_server/.env.example" "$REPO/lumo/rpi_server/.env"
  as_user mkdir -p "$REPO/lumo/rpi_server/static/memories/inbox"
fi

step "Web app"
if command -v npm >/dev/null; then
  BACKEND_URL="$(grep '^VITE_PI_BACKEND_URL=' "$ENV_FILE" | cut -d= -f2-)"
  (cd "$REPO" && as_user npm ci --silent && as_user env VITE_PI_BACKEND_URL="${BACKEND_URL:-/}" npm run build --silent)
else
  echo "npm is not installed, so the web app was not built. Install Node.js 20+ and re-run."
fi

step "systemd units"
UNITS=(sage)
[ "$LUMO" -eq 1 ] && UNITS+=(lumo lumo-obex)
[ "$AUTOSYNC" -eq 1 ] && UNITS+=(sage-autosync)
for unit in "${UNITS[@]}"; do
  sed -e "s|@USER@|$RUN_AS|g" -e "s|@REPO@|$REPO|g" \
    "$REPO/deploy/systemd/$unit.service" > "/etc/systemd/system/$unit.service"
done
# The old backend's unit points at backend/app, which no longer exists.
if systemctl list-unit-files sage-backend.service >/dev/null 2>&1; then
  systemctl disable --now sage-backend.service 2>/dev/null || true
fi
systemctl daemon-reload
for unit in "${UNITS[@]}"; do
  systemctl enable --quiet "$unit.service"
  systemctl restart "$unit.service"
done

step "Checking"
sleep 3
if curl -fsS http://127.0.0.1:8000/api/health; then echo; else echo "Sage did not answer; see: journalctl -u sage -n 50"; fi
echo
echo "Done. Enter this key in the web app under Settings > Server & Reset:"
echo "    sudo grep API_SECRET $ENV_FILE"
if [ "$LUMO" -eq 1 ]; then
  echo "Check LUMO's link to Sage with:"
  echo "    cd $REPO/lumo/rpi_server && sudo env \$(sudo cat $ENV_FILE | xargs) venv/bin/python test_sage.py"
fi
