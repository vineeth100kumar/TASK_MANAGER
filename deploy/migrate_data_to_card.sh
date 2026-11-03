#!/usr/bin/env bash
# Moves Sage's write-heavy data from the slow boot drive to the SD card.
# Safe to run again. The old files are NEVER deleted here; they stay as the
# fallback until you remove them yourself (see the end of the output).
#
#   cd ~/sage-os && sudo deploy/migrate_data_to_card.sh            # migrate
#   cd ~/sage-os && sudo deploy/migrate_data_to_card.sh --check    # only look
#   (a second run says "already migrated" and stops; --force overrides, and loses card-only changes)
#
# What moves (everything that lives next to the database): the SQLite database
# (WAL folded in first), sage.log, sage_settings/secrets/vapid/uptime files,
# Drop sites and clips (drops/), the desk clock's photos and token.
# What stays on the boot drive: nightly backups (SAGE_BACKUP_DIR), so a copy of
# your data always lives on a different device than the live database.
set -euo pipefail

MOUNT="${SAGE_DATA_MOUNT:-/mnt/sagedata}"
DEST="$MOUNT/sage"
ENV_FILE=/etc/sage/sage.env
CHECK=0; FORCE=0
[ "${1:-}" = "--check" ] && CHECK=1
[ "${1:-}" = "--force" ] && FORCE=1
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say() { echo "==> $*"; }
die() { echo "STOP: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo."
mountpoint -q "$MOUNT" || die "$MOUNT is not a mounted disk. Check: lsblk, and the fstab line (UUID=f0c5f865-... $MOUNT ext4 defaults,noatime,nofail 0 2)."
command -v sqlite3 >/dev/null || die "sqlite3 is not installed (sudo apt-get install -y sqlite3)."
command -v rsync >/dev/null || die "rsync is not installed (sudo apt-get install -y rsync)."
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found; run deploy/install_pi.sh first."

env_get() { grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
env_set() {  # NAME VALUE: replace or append, keeping the rest of the file
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}

CUR_DB="$(env_get SAGE_DB_PATH)"
FALLBACK_DB="$(env_get SAGE_DB_FALLBACK)"
# Re-running after the move would copy the frozen old files over newer card data.
if [ "$CUR_DB" = "$DEST/sage_sync.db" ] && [ -f "$CUR_DB" ] && [ "$FORCE" -eq 0 ]; then
  echo "Already migrated: Sage uses $CUR_DB. Nothing to do. (--force copies the old files over it again; that LOSES anything saved on the card since.)"
  exit 0
fi
# Where the data lives now: the fallback if a previous run already switched.
SRC_DB="${FALLBACK_DB:-${CUR_DB:-$REPO/raspberry_pi/sage_sync.db}}"
SRC="$(dirname "$SRC_DB")"
[ -f "$SRC_DB" ] || die "No database at $SRC_DB."
RUN_AS="$(stat -c %U "$SRC_DB")"

say "From $SRC  ->  To $DEST  (owner $RUN_AS)"
du -sh "$SRC_DB" "$SRC/drops" 2>/dev/null || true
df -h "$MOUNT" | tail -1
if [ "$CHECK" -eq 1 ]; then
  echo "Check only. Nothing changed."; exit 0
fi

# What gets copied from the old folder. A whitelist, because on a default
# install the old folder is the repo's raspberry_pi/, which also holds code.
ITEMS=(sage.log sage.log.1 sage.log.2 sage_settings.json sage_secrets.json sage_vapid_private.pem
       sage_uptime.json song_cache.json desk_token.txt desk_link.json drops depth_face gallery_photos posts)

say "Stopping sage"
systemctl stop sage 2>/dev/null || true
sleep 2

install -d -o "$RUN_AS" -g "$RUN_AS" -m 755 "$DEST"

say "Database: fold the WAL in, then copy with SQLite's own backup"
sqlite3 "$SRC_DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
rm -f "$DEST/sage_sync.db.partial"
sqlite3 "$SRC_DB" ".backup '$DEST/sage_sync.db.partial'"
SRC_CHECK="$(sqlite3 "$SRC_DB" "PRAGMA integrity_check;")"
NEW_CHECK="$(sqlite3 "$DEST/sage_sync.db.partial" "PRAGMA integrity_check;")"
[ "$SRC_CHECK" = "ok" ] || echo "WARNING: the old database's integrity_check says: $SRC_CHECK"
[ "$NEW_CHECK" = "ok" ] || die "The copy failed its integrity check ($NEW_CHECK). Nothing was switched."
# Same rows in every table, or we don't switch.
for t in $(sqlite3 "$SRC_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"); do
  a="$(sqlite3 "$SRC_DB" "SELECT count(*) FROM \"$t\";")"
  b="$(sqlite3 "$DEST/sage_sync.db.partial" "SELECT count(*) FROM \"$t\";")"
  [ "$a" = "$b" ] || die "Table $t has $a rows before and $b after. Nothing was switched."
done
mv -f "$DEST/sage_sync.db.partial" "$DEST/sage_sync.db"
chown "$RUN_AS:$RUN_AS" "$DEST/sage_sync.db"
echo "   database verified (integrity ok, row counts match)"

say "Other files"
for item in "${ITEMS[@]}"; do
  [ -e "$SRC/$item" ] || continue
  rsync -a --chown="$RUN_AS:$RUN_AS" "$SRC/$item" "$DEST/"
  if [ -d "$SRC/$item" ]; then
    a="$(find "$SRC/$item" -type f | wc -l)"; b="$(find "$DEST/$item" -type f | wc -l)"
    [ "$a" = "$b" ] || die "$item has $a files before and $b after. Nothing was switched."
  else
    cmp -s "$SRC/$item" "$DEST/$item" || die "$item differs after copy. Nothing was switched."
  fi
  echo "   $item ok"
done

say "Pointing Sage at the card"
cp -n "$ENV_FILE" "$ENV_FILE.before-card"
# Backups stay where they are now: a different device than the live database.
[ -n "$(env_get SAGE_BACKUP_DIR)" ] || env_set SAGE_BACKUP_DIR "$SRC/backups"
env_set SAGE_DB_FALLBACK "$SRC_DB"
env_set SAGE_DATA_MOUNT "$MOUNT"
env_set SAGE_DB_PATH "$DEST/sage_sync.db"
# An explicit Drop folder would keep clips on the old drive; let it follow the DB.
if [ -n "$(env_get SAGE_DROP_DIR)" ]; then echo "   NOTE: SAGE_DROP_DIR is set in $ENV_FILE and still points at the old place."; fi

say "Starting sage"
systemctl start sage
sleep 4
curl -fsS http://127.0.0.1:8000/api/health && echo || echo "Sage did not answer; see: journalctl -u sage -n 50  (undo: cp $ENV_FILE.before-card $ENV_FILE)"

cat <<DONE

Done. Sage now writes to $DEST. Old files are untouched in $SRC.
  * Backups stay on the boot drive: $(env_get SAGE_BACKUP_DIR)
  * If the card is missing at boot, Sage starts on the old copy and says so in sage_health.
    That copy is frozen at today's data, so reseat the card and reboot rather than keep working on it.
  * Undo: sudo cp $ENV_FILE.before-card $ENV_FILE && sudo systemctl restart sage
  * After a few good days, free the old drive yourself:
      rm -r "$SRC/drops"; rm -f "$SRC"/sage_sync.db* "$SRC"/sage.log*   (keep "\$SRC/backups")
    Do not delete them until you have checked Sage on the card (open it, look at Drop, run sage_health).
DONE
