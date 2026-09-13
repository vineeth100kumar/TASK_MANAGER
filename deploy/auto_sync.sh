#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Auto-Sync Daemon for Raspberry Pi 5 (Native Mode)
# ==============================================================================
# Automatically polls GitHub every 10 seconds.
# When new code is detected on origin/main:
# 1. Resets hard to the latest commit
# 2. Re-runs pip install if requirements.txt changed
# 3. Restarts the systemd backend service in <1 second
# 4. Frontend is served live immediately by Nginx (no builds required)
# ==============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "=============================================================================="
echo "🚀 Sage OS Auto-Sync Daemon Active"
echo "Watching: origin/main every 10 seconds"
echo "Working directory: $REPO_DIR"
echo "=============================================================================="

while true; do
    # Fetch latest remote changes silently
    git fetch origin main >/dev/null 2>&1 || true

    LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "local")
    REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "remote")

    if [ "$LOCAL" != "$REMOTE" ] && [ "$REMOTE" != "remote" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚡ New update detected on GitHub ($REMOTE)! Syncing..."
        
        # Check if python dependencies changed in incoming commit(s)
        REQ_CHANGED=$(git diff HEAD origin/main -- backend/requirements.txt 2>/dev/null || true)

        # Pull latest code
        git reset --hard origin/main

        # Ensure permissions on dist folder and scripts
        chmod -R 755 "$REPO_DIR/frontend/dist" 2>/dev/null || true
        chmod +x "$REPO_DIR"/deploy/*.sh 2>/dev/null || true

        # Update dependencies if requirements changed
        if [ -n "$REQ_CHANGED" ] && [ -d "$REPO_DIR/.venv" ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] 📦 Dependencies changed, updating virtualenv..."
            "$REPO_DIR/.venv/bin/pip" install -r "$REPO_DIR/backend/requirements.txt" --quiet || true
        fi

        # Restart backend service
        if command -v systemctl >/dev/null 2>&1; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔄 Restarting sage-backend service..."
            sudo systemctl restart sage-backend 2>/dev/null || systemctl restart sage-backend 2>/dev/null || true
        fi

        COMMIT_MSG=$(git log -1 --pretty=format:"%s" 2>/dev/null || echo "latest")
        VERSION_TAG=$(grep 'VERSION =' "$REPO_DIR/backend/app/version.py" 2>/dev/null | cut -d'"' -f2 || echo "2.1.0")
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Synced successfully to v$VERSION_TAG: \"$COMMIT_MSG\""
    fi

    sleep 10
done
