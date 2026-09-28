#!/usr/bin/env bash
# Set or change the password the web app asks for (see raspberry_pi/access_gate.py).
#
#   sudo deploy/set_access_password.sh
#
# Only a salted PBKDF2 hash goes into /etc/sage/sage.env. Changing the
# password logs every browser out. To turn the gate off, delete the
# SAGE_ACCESS_PASSWORD_HASH line from that file and restart sage.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE=/etc/sage/sage.env

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE is missing; run deploy/install_pi.sh first." >&2; exit 1; }

HASH="$(python3 "$REPO/raspberry_pi/access_gate.py")"
sed -i '/^SAGE_ACCESS_PASSWORD_HASH=/d' "$ENV_FILE"
echo "SAGE_ACCESS_PASSWORD_HASH=$HASH" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
systemctl restart sage.service
echo "Password saved. Sage restarted; browsers will ask for it at /login."
