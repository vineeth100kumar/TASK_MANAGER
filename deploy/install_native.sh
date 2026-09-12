#!/usr/bin/env bash
# ==============================================================================
# Sage Life OS - Native (No-Docker) Installer & Setup for Raspberry Pi 5
# ==============================================================================
# This script sets up Sage OS to run directly on Raspberry Pi OS:
# 1. System Nginx for static frontend and API reverse proxy
# 2. Python 3 Virtual Environment (.venv) for backend
# 3. Systemd service (sage-backend.service) with auto-restart
# 4. Systemd auto-sync daemon (sage-autosync.service) for zero-command updates
# ==============================================================================
set -e

# Detect user and directory dynamically
ACTUAL_USER="${SUDO_USER:-$USER}"
USER_HOME=$(getent passwd "$ACTUAL_USER" | cut -d: -f6)
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=============================================================================="
echo "🌿 Installing Sage Life OS (Native High-Performance Mode)"
echo "Target User: $ACTUAL_USER"
echo "Directory:   $REPO_DIR"
echo "=============================================================================="

# 1. Stop and tear down Docker containers to release port 80 & 8000
echo "--> [1/8] Stopping any existing Docker containers..."
if command -v docker >/dev/null 2>&1; then
    if [ -f "$REPO_DIR/docker-compose.yml" ]; then
        sudo docker compose -f "$REPO_DIR/docker-compose.yml" down 2>/dev/null || true
    fi
fi

# 2. Install Required System Packages via APT
echo "--> [2/8] Installing Nginx, Python venv, and build dependencies..."
sudo apt-get update -y
sudo apt-get install -y nginx python3-venv python3-pip python3-dev build-essential libffi-dev libssl-dev sqlite3 curl

# 3. Fix File Ownership and Permissions
echo "--> [3/8] Configuring permissions (resolving Docker root-locks & Nginx access)..."
mkdir -p "$REPO_DIR/data/backups"
sudo chown -R "$ACTUAL_USER:$ACTUAL_USER" "$REPO_DIR/data"
chmod -R 775 "$REPO_DIR/data"

# Ensure Nginx (www-data) can traverse home directory and read frontend/dist
chmod o+x "$USER_HOME" || true
chmod -R 755 "$REPO_DIR/frontend/dist"

# Configure Git credential storage so background sync never hangs on passwords
git config --global credential.helper store || true

# 4. Set Up Python Virtual Environment & Install Dependencies
echo "--> [4/8] Setting up Python virtual environment (.venv)..."
if [ ! -d "$REPO_DIR/.venv" ]; then
    python3 -m venv "$REPO_DIR/.venv"
fi
"$REPO_DIR/.venv/bin/pip" install --upgrade pip setuptools wheel --quiet
"$REPO_DIR/.venv/bin/pip" install -r "$REPO_DIR/backend/requirements.txt" --quiet

# 5. Configure Nginx
echo "--> [5/8] Configuring Nginx reverse proxy & static SPA..."
sudo tee /etc/nginx/sites-available/sage-os > /dev/null <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 50M;

    # Gzip Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Static Frontend PWA
    location / {
        root $REPO_DIR/frontend/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }

    # API Proxy to FastAPI Backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # WebSocket Proxy for Real-Time Sync & Events
    location /ws {
        proxy_pass http://127.0.0.1:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF

# Remove default Debian site if present and activate sage-os
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/sage-os /etc/nginx/sites-enabled/sage-os
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

# 6. Configure Sudoers Drop-In for Auto-Sync Service
echo "--> [6/8] Configuring passwordless systemctl permissions for auto-sync..."
sudo tee /etc/sudoers.d/sage-os > /dev/null <<EOF
$ACTUAL_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart sage-backend, /bin/systemctl reload sage-backend, /bin/systemctl status sage-backend, /bin/systemctl start sage-backend, /bin/systemctl stop sage-backend
EOF
sudo chmod 0440 /etc/sudoers.d/sage-os

# 7. Create and Start Systemd Services
echo "--> [7/8] Creating Systemd services for Backend and 24/7 Auto-Sync..."

# A. Backend Service
sudo tee /etc/systemd/system/sage-backend.service > /dev/null <<EOF
[Unit]
Description=Sage Life OS - FastAPI Backend Service
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$REPO_DIR/backend
Environment=DATA_DIR=$REPO_DIR/data
Environment=OLLAMA_HOST=http://localhost:11434
Environment=OLLAMA_MODEL=qwen2.5:1.5b
Environment=PYTHONPATH=$REPO_DIR/backend
ExecStart=$REPO_DIR/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir $REPO_DIR/backend
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# B. Auto-Sync Service
chmod +x "$REPO_DIR/deploy/auto_sync.sh"
sudo tee /etc/systemd/system/sage-autosync.service > /dev/null <<EOF
[Unit]
Description=Sage Life OS - Automatic GitHub Sync Daemon
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$REPO_DIR
ExecStart=/bin/bash $REPO_DIR/deploy/auto_sync.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Reload and start services
sudo systemctl daemon-reload
sudo systemctl enable sage-backend
sudo systemctl restart sage-backend
sudo systemctl enable sage-autosync
sudo systemctl restart sage-autosync

# 8. Verification & Health Check
echo "--> [8/8] Verifying installation..."
sleep 3

HEALTH_OUTPUT=$(curl -s http://127.0.0.1:8000/api/health || true)

echo "=============================================================================="
if echo "$HEALTH_OUTPUT" | grep -q "healthy"; then
    echo "🎉 SUCCESS: Sage OS is fully running natively without Docker!"
else
    echo "⚠️ Backend is still initializing or encountered an issue. Checking logs..."
    sudo journalctl -u sage-backend -n 15 --no-pager
fi

IP_ADDRS=$(hostname -I 2>/dev/null || echo "localhost")
echo ""
echo "Access Sage OS in your browser:"
for ip in $IP_ADDRS; do
    echo "  -> http://$ip/"
done
echo ""
echo "Useful Commands:"
echo "  Backend logs:   sudo journalctl -u sage-backend -f"
echo "  Auto-sync logs: sudo journalctl -u sage-autosync -f"
echo "  Restart:        sudo systemctl restart sage-backend"
echo "=============================================================================="
