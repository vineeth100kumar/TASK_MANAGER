#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Fast Setup Script (No system updates)
# ==============================================================================
set -e

echo "=== 1. Checking Docker on Pi 5 ==="
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
fi

echo "=== 2. Checking Ollama for Local AI (Qwen 2.5 1.5B) ==="
if ! command -v ollama &> /dev/null; then
    echo "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

echo "Starting Ollama and pulling Qwen 2.5 1.5B..."
sudo systemctl enable ollama || true
sudo systemctl start ollama || true
ollama pull qwen2.5:1.5b || echo "Ollama ready."

echo "=== 3. Checking Cloudflare Tunnel (cloudflared) ==="
if ! command -v cloudflared &> /dev/null; then
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    sudo dpkg -i cloudflared.deb
    rm cloudflared.deb
fi

echo "=== 4. Setting Up Storage Directory ==="
mkdir -p data/backups
chmod -R 775 data

echo "=== 5. Launching Sage Life OS Containers ==="
docker compose up -d --build

echo "=============================================================================="
echo "🎉 Sage Life OS is running!"
echo "Open in your browser: http://$(hostname -I | awk '{print $1}')"
echo "=============================================================================="
