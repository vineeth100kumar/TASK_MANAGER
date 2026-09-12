#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Auto-Sync Daemon for Raspberry Pi 5
# Automatically polls GitHub every 10 seconds.
# When new code is detected, it pulls it immediately and hot-reloads!
# Zero Docker rebuilds needed!
# ==============================================================================

REPO_DIR="$HOME/sage-os"
cd "$REPO_DIR"

echo "🚀 Sage OS Auto-Sync Daemon Started..."
echo "Monitoring GitHub repository for updates every 10 seconds..."

while true; do
    git fetch origin main >/dev/null 2>&1
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)

    if [ "$LOCAL" != "$REMOTE" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚡ New update detected on GitHub! Syncing..."
        git reset --hard origin/main
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Code synced! Live immediately."
    fi

    sleep 10
done
