#!/usr/bin/env bash
# ==============================================================================
# Nightly Automated SQLite WAL Backup for Sage Life OS on Raspberry Pi 5
# ==============================================================================
set -e

BACKUP_DIR="$(pwd)/data/backups"
DB_FILE="$(pwd)/data/sage_life.db"
DATE=$(date +%Y-%m-%d_%H%M%S)
BACKUP_TARGET="$BACKUP_DIR/sage_backup_$DATE.db"

mkdir -p "$BACKUP_DIR"

if [ -f "$DB_FILE" ]; then
    echo "Creating hot SQLite backup..."
    sqlite3 "$DB_FILE" ".backup '$BACKUP_TARGET'"
    gzip -f "$BACKUP_TARGET"
    echo "Backup saved to: ${BACKUP_TARGET}.gz"

    # Retain only last 14 days of backups locally
    find "$BACKUP_DIR" -type f -name "sage_backup_*.db.gz" -mtime +14 -delete

    # Optional: If rclone is configured with Google Drive (free 15GB), upload snapshot
    if command -v rclone &> /dev/null; then
        rclone copy "${BACKUP_TARGET}.gz" "gdrive:Sage_Backups/" || true
    fi
else
    echo "Database file $DB_FILE not found."
fi
