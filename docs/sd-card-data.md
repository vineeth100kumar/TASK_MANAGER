# Sage data on the SD card

The Pi boots from a slow USB drive (~4.7 MB/s writes). The SD card mounted at
`/mnt/sagedata` is ~7x faster, so Sage's write-heavy data lives there.

## What lives where
| Data | Where |
|---|---|
| SQLite DB + WAL, `sage.log`, Drop sites/clips, secrets, desk photos | `/mnt/sagedata/sage/` (card) |
| Nightly backups (`SAGE_BACKUP_DIR`) | old drive, `~/sage-os/raspberry_pi/backups` (a different device than the live DB) |
| Code, Python venv, built web app | boot drive |

Everything follows `SAGE_DB_PATH`, so the move is a few lines in `/etc/sage/sage.env`:
`SAGE_DB_PATH`, `SAGE_DATA_MOUNT`, `SAGE_DB_FALLBACK`, `SAGE_BACKUP_DIR`.

## Migrate (once)
```
cd ~/sage-os && git pull
sudo deploy/migrate_data_to_card.sh --check    # look only
sudo deploy/migrate_data_to_card.sh            # stops sage, copies, verifies, switches, starts
```
The old files are never deleted by the script.

## If the card is missing
`data_dir.py` runs before anything opens the DB. Card not mounted (or DB not yet
copied there) -> Sage starts on the old copy on the boot drive and `sage_health`
says "Sage is NOT on the SD card". That copy is frozen at migration time: reseat
the card and reboot instead of working on it.

## Settings to review
- `deploy/tune_pi_storage.sh` still applies to `/` (noatime, commit=60, dirty
  sysctl, journald in RAM). Those are device-wide or boot-drive only, so keep them.
  The card is mounted `defaults,noatime`; no change needed.
- SQLite stays at `synchronous=NORMAL` with WAL (`sqlite_tuning.py`): safe on a
  power cut, and fine on the card. `SAGE_SQLITE_SYNCHRONOUS=FULL` is now an
  affordable option on the card if you want the strictest durability.
- SD cards wear out: `sage_health` now reports card free space, read-only mounts
  (ext4 flips to read-only on errors) and fallback state; `sage_diagnostics` includes `storage`.
