#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Raspberry Pi 5 Quick Launch Script
# ==============================================================================
set -e

echo "=== 1. Checking Docker on Pi 5 ==="
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    rm -f /tmp/get-docker.sh
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sudo sh /tmp/get-docker.sh
    sudo usermod -aG docker "$USER" || true
fi

echo "=== 2. Checking Docker Compose Plugin ==="
if ! docker compose version &> /dev/null; then
    sudo apt-get install -y docker-compose-plugin docker-compose || true
fi

echo "=== 3. Checking Ollama for Local AI (Qwen 2.5 1.5B) ==="
if ! command -v ollama &> /dev/null; then
    echo "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

sudo systemctl enable ollama || true
sudo systemctl start ollama || true
ollama pull qwen2.5:1.5b || true

echo "=== 4. Checking Cloudflare Tunnel (cloudflared) ==="
if ! command -v cloudflared &> /dev/null; then
    curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
    sudo dpkg -i /tmp/cloudflared.deb || true
    rm -f /tmp/cloudflared.deb
fi

echo "=== 5. Creating Local Data Folder ==="
mkdir -p data/backups
chmod -R 775 data || true

echo "=== 6. Launching Task Manager Containers ==="
if docker compose version &> /dev/null; then
    docker compose up -d --build
else
    sudo docker-compose up -d --build
fi

echo "=============================================================================="
echo "🎉 Sage OS is running on your Raspberry Pi 5!"
echo "Open in browser: http://$(hostname -I | awk '{print $1}')"
echo "=============================================================================="
