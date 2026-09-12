#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - 1-Click Update Script for Raspberry Pi 5
# ==============================================================================
set -e

echo "=== 1. Pulling Latest Changes from GitHub ==="
git pull origin main

echo "=== 2. Rebuilding & Updating Docker Containers ==="
docker compose down
docker compose up -d --build

echo "=== 3. Cleaning Unused Docker Cache ==="
docker image prune -f

echo "=============================================================================="
echo "✅ Update complete! Sage Life OS has been updated to the latest version."
echo "=============================================================================="
