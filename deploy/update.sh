#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - 1-Click Update Script for Raspberry Pi 5
# ==============================================================================
set -e

# Auto-detect if sudo is needed for docker
DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
    DOCKER_CMD="sudo docker"
fi

echo "=== 1. Pulling Latest Changes from GitHub ==="
git pull origin main

echo "=== 2. Updating Docker Containers (Instant Reload) ==="
$DOCKER_CMD compose up -d --build

echo "=== 3. Cleaning Unused Docker Images ==="
$DOCKER_CMD image prune -f

echo "=============================================================================="
echo "✅ Update complete! Sage Life OS has been updated to the latest version."
echo "=============================================================================="
