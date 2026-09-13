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

if [ ! -d "$REPO_DIR/.venv" ]; then
    echo "=== 3. Virtual Environment missing, creating .venv... ==="
    python3 -m venv "$REPO_DIR/.venv"
    "$REPO_DIR/.venv/bin/pip" install --upgrade pip setuptools --quiet || true
    "$REPO_DIR/.venv/bin/pip" install -r "$REPO_DIR/backend/requirements.txt" --quiet
else
    echo "=== 3. Checking Python Dependencies ==="
    "$REPO_DIR/.venv/bin/pip" install -r "$REPO_DIR/backend/requirements.txt" --quiet || true
fi

echo "=== 4. Restarting Sage OS Backend ==="
if command -v systemctl >/dev/null 2>&1; then
    if [ ! -f /etc/systemd/system/sage-backend.service ]; then
        echo "⚠️  sage-backend.service not found in /etc/systemd/system/."
        echo "👉 Please run one-time setup: sudo bash $REPO_DIR/deploy/install_native.sh"
    else
        sudo systemctl restart sage-backend 2>/dev/null || systemctl restart sage-backend 2>/dev/null || true
    fi
fi

# Wait up to 5 seconds for backend to become ready
echo "--> Waiting for backend to initialize..."
HEALTH=""
for i in {1..5}; do
    HEALTH=$(curl -s http://127.0.0.1:8000/api/health 2>/dev/null || curl -s http://localhost/api/health 2>/dev/null || true)
    if echo "$HEALTH" | grep -q "healthy"; then
        break
    fi
    sleep 1
done

echo "=============================================================================="
if echo "$HEALTH" | grep -q "healthy"; then
    echo "🎉 Sage OS is live on version v$VERSION_TAG (commit: $COMMIT_HASH)!"
    echo "Health response: $HEALTH"
else
    echo "⚠️ Backend not responding yet. Checking service logs:"
    if command -v systemctl >/dev/null 2>&1; then
        sudo journalctl -u sage-backend -n 20 --no-pager 2>/dev/null || true
    fi
fi
echo "=============================================================================="
