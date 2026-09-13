#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Manual Quick Update Script (Native Mode)
# ==============================================================================
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "=== 1. Pulling Latest Changes from GitHub ==="
git reset --hard origin/main || git pull origin main

COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
VERSION_TAG=$(grep 'VERSION =' backend/app/version.py 2>/dev/null | cut -d'"' -f2 || echo "v2.1.0")

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

# Allow uvicorn 2 seconds to bind socket
sleep 2

echo "=============================================================================="
echo "🎉 Sage OS is updated to version v$VERSION_TAG (commit: $COMMIT_HASH)!"
echo "Status check: http://localhost/api/health"
echo "=============================================================================="
curl -s http://localhost/api/health || curl -s http://127.0.0.1:8000/api/health || true
echo ""
