#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Manual Quick Update Script (Native Mode)
# ==============================================================================
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "=== 1. Pulling Latest Changes from GitHub ==="
git reset --hard origin/main || git pull origin main

echo "=== 2. Ensuring Permissions ==="
chmod -R 755 "$REPO_DIR/frontend/dist" 2>/dev/null || true
mkdir -p "$REPO_DIR/data/backups"
chmod -R 775 "$REPO_DIR/data" 2>/dev/null || true

if [ -d "$REPO_DIR/.venv" ]; then
    echo "=== 3. Checking Python Dependencies ==="
    "$REPO_DIR/.venv/bin/pip" install -r "$REPO_DIR/backend/requirements.txt" --quiet || true
fi

echo "=== 4. Restarting Sage OS Backend ==="
if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl restart sage-backend 2>/dev/null || systemctl restart sage-backend 2>/dev/null || true
fi

echo "=============================================================================="
echo "🎉 Sage OS is updated!"
echo "Status check: http://localhost/api/health"
echo "=============================================================================="
curl -s http://localhost/api/health || true
echo ""
