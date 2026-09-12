#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Raspberry Pi 5 Quick Launch Script (NO system updates)
# ==============================================================================
set -e

echo "=== 1. Checking Docker on Pi 5 ==="
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
fi

echo "=== 2. Checking Ollama for Local AI (Qwen 2.5 1.5B) ==="
if ! command -v ollama &> /dev/null; then
    echo "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

sudo systemctl enable ollama || true
sudo systemctl start ollama || true
ollama pull qwen2.5:1.5b || true

echo "=== 3. Checking Cloudflare Tunnel (cloudflared) ==="
if ! command -v cloudflared &> /dev/null; then
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    sudo dpkg -i cloudflared.deb
    rm cloudflared.deb
fi

echo "=== 4. Creating Local Data Folder ==="
mkdir -p data/backups
chmod -R 775 data

echo "=== 5. Launching Task Manager Containers ==="
docker compose up -d --build

echo "=============================================================================="
echo "🎉 Sage OS is running on your Raspberry Pi 5!"
echo "Open in browser: http://$(hostname -I | awk '{print $1}')"
echo "=============================================================================="
