#!/bin/bash
# run_db.sh - Starts the SQLite Database Backend

echo "Checking system dependencies..."
sudo apt update -yqq
sudo apt install -yqq python3-venv python3-pip sqlite3

echo "Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

echo "Installing Python dependencies..."
pip install -r requirements.txt -q

echo "Starting Sage Database Backend Server (Port 8000)..."
python3 db_server.py
