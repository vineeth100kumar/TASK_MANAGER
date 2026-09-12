#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Raspberry Pi 5 Automated Setup Script
# ==============================================================================
set -e

echo "=== 1. Updating System Packages ==="
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git ufw sqlite3 jq

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
sudo systemctl start ollama
ollama pull qwen2.5:1.5b

echo "=== 4. Installing Cloudflare Tunnel (cloudflared) ==="
if ! command -v cloudflared &> /dev/null; then
    # Download ARM64 deb package for Raspberry Pi 5
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
echo "Local Access: http://$(hostname -I | awk '{print $1}')"
echo "Next step: Run 'cloudflared tunnel login' or paste your free tunnel token."
echo "See CLOUDFLARE_TUNNEL_GUIDE.md for public 100% free HTTPS setup."
echo "=============================================================================="
