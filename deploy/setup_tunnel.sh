#!/usr/bin/env bash
# Put Sage on the internet through a Cloudflare Tunnel.
#
#   sudo deploy/setup_tunnel.sh tasks.example.com
#
# The hostname must be on a domain in your Cloudflare account. Safe to run
# again. What it does:
#   1. Installs cloudflared from Cloudflare's apt repository.
#   2. Makes sure Sage's password is set (the tunnel won't start without it).
#   3. Logs cloudflared in to Cloudflare: open the printed link, pick the domain.
#   4. Creates a tunnel named "sage" and points the hostname at it.
#   5. Writes /etc/cloudflared/sage.yml and starts sage-tunnel.service.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HOSTNAME_="${1:-}"
TUNNEL=sage
ENV_FILE=/etc/sage/sage.env
# cloudflared keeps its login and tunnel keys in ~/.cloudflared; pin that to
# root's so re-runs find them however sudo set HOME.
export HOME=/root
step() { echo; echo "==> $*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -n "$HOSTNAME_" ] || { echo "Usage: sudo $0 <hostname, e.g. tasks.example.com>" >&2; exit 2; }

step "cloudflared"
if ! command -v cloudflared >/dev/null; then
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq
  apt-get install -y -qq cloudflared >/dev/null
fi
cloudflared --version

step "Sage password"
if ! grep -q '^SAGE_ACCESS_PASSWORD_HASH=.\+' "$ENV_FILE" 2>/dev/null; then
  echo "Sage has no password yet, and the tunnel would make it public. Choose one now."
  "$REPO/deploy/set_access_password.sh"
else
  echo "Already set (change it with: sudo deploy/set_access_password.sh)"
fi

step "Cloudflare login"
if [ ! -f /root/.cloudflared/cert.pem ]; then
  echo "Open the link below on any device, log in, and pick the domain for $HOSTNAME_."
  cloudflared tunnel login
else
  echo "Already logged in."
fi

step "Tunnel '$TUNNEL'"
tunnel_id() {
  cloudflared tunnel list --output json --name "$TUNNEL" 2>/dev/null \
    | python3 -c 'import json,sys; t=json.load(sys.stdin) or []; print(t[0]["id"] if t else "")'
}
ID="$(tunnel_id)"
if [ -z "$ID" ]; then
  cloudflared tunnel create "$TUNNEL"
  ID="$(tunnel_id)"
fi
[ -n "$ID" ] || { echo "Could not find the tunnel's id." >&2; exit 1; }
[ -f "/root/.cloudflared/$ID.json" ] || {
  echo "The credentials for tunnel $ID are not on this Pi. Delete it with" >&2
  echo "  cloudflared tunnel delete $TUNNEL" >&2
  echo "and run this script again." >&2
  exit 1
}
echo "Tunnel id $ID"

step "DNS: $HOSTNAME_ -> tunnel"
cloudflared tunnel route dns --overwrite-dns "$TUNNEL" "$HOSTNAME_"

step "Config and service"
install -d -m 755 /etc/cloudflared
install -m 600 "/root/.cloudflared/$ID.json" /etc/cloudflared/sage.json
sed -e "s|@TUNNEL_ID@|$ID|g" -e "s|@HOSTNAME@|$HOSTNAME_|g" \
  "$REPO/deploy/cloudflared/config.yml" > /etc/cloudflared/sage.yml
cloudflared tunnel --config /etc/cloudflared/sage.yml ingress validate
install -m 644 "$REPO/deploy/systemd/sage-tunnel.service" /etc/systemd/system/sage-tunnel.service
systemctl daemon-reload
systemctl enable --quiet sage-tunnel.service
systemctl restart sage-tunnel.service

step "Checking"
sleep 5
systemctl --no-pager --lines=5 status sage-tunnel.service || true
echo
echo "Done. Open https://$HOSTNAME_ and enter your password."
echo "It can take a minute or two for the new DNS name to work."
