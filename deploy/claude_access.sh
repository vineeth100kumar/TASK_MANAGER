#!/usr/bin/env bash
# Give Claude its own key to your Sage data (see raspberry_pi/claude_api.py).
#
#   sudo deploy/claude_access.sh          # make a new token (replaces the old one)
#   sudo deploy/claude_access.sh --off    # take Claude's access away
#
# The token goes into /etc/sage/sage.env as SAGE_CLAUDE_TOKEN. It opens your
# tasks, notes and the web app, not your settings or passwords. Making a new
# one cuts off the old one straight away.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE=/etc/sage/sage.env

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE is missing; run deploy/install_pi.sh first." >&2; exit 1; }

sed -i '/^SAGE_CLAUDE_TOKEN=/d' "$ENV_FILE"
if [ "${1:-}" = "--off" ]; then
  systemctl restart sage.service
  echo "Claude's access is off. Sage restarted."
  exit 0
fi

TOKEN="$(openssl rand -hex 32)"
echo "SAGE_CLAUDE_TOKEN=$TOKEN" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
systemctl restart sage.service

URL="$(grep '^SAGE_PUBLIC_URL=' "$ENV_FILE" | cut -d= -f2- || true)"
if [ -z "$URL" ]; then
  URL="$(cd "$REPO/raspberry_pi" && python3 -c 'import public_link; print(public_link.find()["url"] or "")' 2>/dev/null || true)"
fi
URL="${URL:-https://<your Sage address>}"
URL="${URL%/}"

cat <<MSG

Claude can now reach Sage. Sage restarted.

  Sage address:   $URL
  Claude token:   $TOKEN

For a custom connector in Claude (Settings > Connectors > Add custom connector):
  $URL/mcp/$TOKEN

For a Claude Code cloud environment, add these environment variables:
  SAGE_URL=$URL
  SAGE_CLAUDE_TOKEN=$TOKEN

Keep the token private: anyone with it can read and change your Sage data.
Run this script again for a new one, or with --off to stop.
MSG
