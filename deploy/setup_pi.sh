#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Raspberry Pi 5 Automated Setup Script
# ==============================================================================
set -e

export DEBIAN_FRONTEND=noninteractive

echo "=== 1. Updating System Package Repositories ==="
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends curl git ufw sqlite3 jq

echo "=== 2. Installing Docker & Docker Compose on Pi 5 ==="
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    echo "Docker installed successfully."
fi

echo "=== 3. Installing Ollama for Local AI (Qwen 2.5 1.5B) ==="
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
    echo "Ollama installed."
fi

echo "Starting Ollama service and pulling Qwen 2.5 1.5B model..."
sudo systemctl enable ollama
sudo systemctl start ollama || true
ollama pull qwen2.5:1.5b || echo "Ollama pull queued or model already present."

echo "=== 4. Installing Cloudflare Tunnel (cloudflared) ==="
if ! command -v cloudflared &> /dev/null; then
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    sudo dpkg -i cloudflared.deb
    rm cloudflared.deb
    echo "cloudflared installed."
fi

echo "=== 5. Creating Local Data Directory for SQLite ==="
mkdir -p data/backups
chmod -R 775 data

echo "=== 6. Launching Sage Life OS Containers ==="
docker compose up -d --build

echo "=============================================================================="
echo "🎉 Setup Complete! Sage Life OS is running on your Raspberry Pi 5."
echo "Local Network URL: http://$(hostname -I | awk '{print $1}')"
echo "See CLOUDFLARE_TUNNEL_GUIDE.md for 100% free public HTTPS setup for iOS/PC."
echo "=============================================================================="
