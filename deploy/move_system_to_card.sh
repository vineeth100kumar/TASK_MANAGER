#!/usr/bin/env bash
# Moves the rest of Sage off the slow boot drive (USB) onto the SD card.
# The live data already moved (deploy/migrate_data_to_card.sh). This moves:
#
#   * the whole checkout (~/sage-os): code, raspberry_pi/venv, node_modules,
#     the built web app (dist/), lumo/, __pycache__
#   * ~/.cache (pip, Playwright's Chromium) and ~/.npm (npm ci's cache)
#   * swap: a 1 GB swap file on the card (cushion for the web build)
#   * /tmp: into RAM (tmpfs, 512 MB cap), from the next reboot
#
#   cd ~/sage-os && sudo deploy/move_system_to_card.sh --check   # only look
#   cd ~/sage-os && sudo deploy/move_system_to_card.sh           # move
#   cd ~/sage-os && sudo deploy/move_system_to_card.sh --undo    # back to USB
#
# How: each folder is copied to /mnt/sagedata/system/<name> and then
# bind-mounted over its old path. Paths do not change, so the venv, systemd
# units, install_pi.sh, auto-sync and `cd ~/sage-os` all keep working. The USB
# copy is NOT deleted; it stays underneath. If the card is missing at boot the
# bind mounts are skipped (nofail) and the Pi runs the older USB copy, with the
# data fallback from data_dir.py. Nightly backups stay on USB.
set -euo pipefail

MOUNT="${SAGE_DATA_MOUNT:-/mnt/sagedata}"
DEST="$MOUNT/system"
TAG="# sage-card"
MODE=move
case "${1:-}" in
  --check) MODE=check ;;
  --undo) MODE=undo ;;
  "") ;;
  *) echo "Usage: $0 [--check|--undo]" >&2; exit 2 ;;
esac
say() { echo; echo "==> $*"; }
die() { echo "STOP: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo."
# Run from a copy in /tmp, standing in /: this script lives in the checkout it
# mounts over (or unmounts), and an open file or working folder there would
# keep that mount busy.
if [ -z "${SAGE_MOVE_REPO:-}" ]; then
  # -P: the real folder, not a path through a mount or symlink.
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  self="$(mktemp /tmp/move_system_to_card.XXXXXX)"
  cp "${BASH_SOURCE[0]}" "$self"
  cd /
  SAGE_MOVE_REPO="$repo" exec bash "$self" "$@"
fi
REPO="$SAGE_MOVE_REPO"
rm -f "${BASH_SOURCE[0]}" 2>/dev/null || true  # the /tmp copy; bash keeps it open
RUN_AS="${SUDO_USER:-$(stat -c %U "$REPO")}"
HOME_DIR="$(getent passwd "$RUN_AS" | cut -d: -f6)"
[ -n "$HOME_DIR" ] || die "No home folder for $RUN_AS."

# path on the boot drive -> name of its copy on the card
declare -A NAME=(
  ["$REPO"]="sage-os"
  ["$HOME_DIR/.cache"]="cache"
  ["$HOME_DIR/.npm"]="npm"
)
ORDER=("$REPO" "$HOME_DIR/.cache" "$HOME_DIR/.npm")
SWAPFILE="$MOUNT/swapfile"
UNITS=(sage sage-autosync)

unit_of() { systemd-escape -p --suffix=mount "$1"; }
on_card() { [ "$(stat -c %d "$1" 2>/dev/null)" = "$(stat -c %d "$MOUNT")" ]; }

stop_sage() {
  say "Stopping Sage while folders switch"
  for u in sage-autosync sage; do systemctl stop "$u" 2>/dev/null || true; done
  sleep 2
}
start_sage() {
  say "Starting Sage"
  systemctl daemon-reload
  for u in sage sage-autosync; do
    systemctl is-enabled --quiet "$u" 2>/dev/null && systemctl start "$u" || true
  done
  sleep 4
  curl -fsS -o /dev/null -w "Sage answered in %{time_total}s\n" http://127.0.0.1:8000/api/health \
    || echo "Sage did not answer yet; see: journalctl -u sage -n 50"
}

report() {
  say "Where things are now"
  printf '  %-28s %s\n' "SD card ($MOUNT)" "$(mountpoint -q "$MOUNT" && df -h "$MOUNT" | awk 'NR==2{print $4" free of "$2}' || echo 'NOT MOUNTED')"
  for p in "${ORDER[@]}"; do
    [ -e "$p" ] || { printf '  %-28s %s\n' "$p" "(none)"; continue; }
    where="USB"; on_card "$p" && where="SD card"
    printf '  %-28s %-8s %s\n' "$p" "$where" "$(du -sh "$p" 2>/dev/null | cut -f1)"
  done
  printf '  %-28s %s\n' "swap" "$(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ' || true)"
  printf '  %-28s %s\n' "/tmp" "$(findmnt -no FSTYPE,SOURCE /tmp 2>/dev/null || echo 'on / (USB)')"
  [ -d /var/lib/docker ] && printf '  %-28s %s (not moved by this script)\n' "/var/lib/docker" "$(du -sh /var/lib/docker 2>/dev/null | cut -f1)"
  [ -d /usr/share/ollama/.ollama ] && printf '  %-28s %s (unused since Groq; ollama rm frees it)\n' "Ollama models" "$(du -sh /usr/share/ollama/.ollama 2>/dev/null | cut -f1)"
  df -h / | awk 'NR==2{print "  USB boot drive              "$4" free of "$2" ("$5" used)"}'
}

if [ "$MODE" = check ]; then
  mountpoint -q "$MOUNT" || echo "NOTE: $MOUNT is not mounted, so nothing could move yet."
  report
  echo; echo "Check only. Nothing changed."
  exit 0
fi

if [ "$MODE" = undo ]; then
  stop_sage
  say "Taking the bind mounts and the card swap away"
  swapoff "$SWAPFILE" 2>/dev/null || true
  for p in "${ORDER[@]}"; do
    on_card "$p" || continue
    umount "$p" 2>/dev/null || umount -l "$p"   # -l: a shell still standing in it
  done
  cp /etc/fstab /etc/fstab.before-undo
  sed -i "/$TAG\$/d" /etc/fstab
  for u in "${UNITS[@]}"; do rm -f "/etc/systemd/system/$u.service.d/sage-card.conf"; done
  if [ -f /etc/dphys-swapfile.before-card ]; then
    cp /etc/dphys-swapfile.before-card /etc/dphys-swapfile
    systemctl enable --now dphys-swapfile 2>/dev/null || true
  fi
  start_sage
  report
  cat <<UNDONE

Back on the USB drive. In any open terminal: cd ~ && cd ~/sage-os
The card copies are still in $DEST; nothing was deleted.
NOTE: the USB checkout is the code from before the move. Bring it up to date:
  cd ~/sage-os && git pull && sudo deploy/install_pi.sh --only server,web
/tmp goes back to the disk at the next reboot.
UNDONE
  exit 0
fi

# ---------------------------------------------------------------- move
mountpoint -q "$MOUNT" || die "$MOUNT is not mounted. Check: lsblk; findmnt $MOUNT"
command -v rsync >/dev/null || die "rsync is not installed (sudo apt-get install -y rsync)."
opts="$(findmnt -no OPTIONS "$MOUNT")"
[[ ",$opts," == *",ro,"* ]] && die "$MOUNT is read-only (card errors?). Not moving anything."

need_kb=0
for p in "${ORDER[@]}"; do
  [ -d "$p" ] && ! on_card "$p" && need_kb=$(( need_kb + $(du -sk "$p" | cut -f1) ))
done
[ -f "$SWAPFILE" ] || need_kb=$(( need_kb + 1048576 ))
need_kb=$(( need_kb + 51200 ))  # and 50 MB to spare
free_kb="$(df -Pk "$MOUNT" | awk 'NR==2{print $4}')"
[ "$need_kb" -lt "$free_kb" ] || die "Not enough room on the card: need ~$(( need_kb/1024 )) MB, have $(( free_kb/1024 )) MB."

stop_sage
install -d -m 755 "$DEST"
[ -e /etc/fstab.before-card ] || cp /etc/fstab /etc/fstab.before-card

for p in "${ORDER[@]}"; do
  n="${NAME[$p]}"
  [ -d "$p" ] || install -d -o "$RUN_AS" -g "$RUN_AS" "$p"
  if on_card "$p"; then echo "   $p already on the card"; continue; fi
  say "Copying $p -> $DEST/$n"
  rsync -aHx --delete "$p/" "$DEST/$n/"
  a="$(find "$p" -xdev | wc -l)"; b="$(find "$DEST/$n" | wc -l)"
  [ "$a" = "$b" ] || die "$p has $a entries and the copy has $b. Nothing was switched for it (rerun to retry)."
  chown "$(stat -c %u:%g "$p")" "$DEST/$n"
  echo "   $a files and folders copied and counted"
  # Bind the card copy over the old path; nofail = still boots without the card.
  sed -i "\|^$DEST/$n |d" /etc/fstab
  echo "$DEST/$n $p none bind,nofail,x-systemd.requires-mounts-for=$MOUNT 0 0 $TAG" >> /etc/fstab
  systemctl daemon-reload
  mount "$p"
  on_card "$p" || die "$p did not switch to the card. Undo: sudo deploy/move_system_to_card.sh --undo"
  echo "   $p now runs from the SD card"
done

say "Sage waits for the card folders at boot (but still starts without them)"
CODE_UNIT="$(unit_of "$REPO")"
for u in "${UNITS[@]}"; do
  install -d "/etc/systemd/system/$u.service.d"
  printf '[Unit]\n# Written by deploy/move_system_to_card.sh. Ordering only: no card -> USB copy.\nAfter=%s\n' "$CODE_UNIT" \
    > "/etc/systemd/system/$u.service.d/sage-card.conf"
done

say "Swap: 1 GB on the card"
if ! swapon --show=NAME --noheadings | grep -qx "$SWAPFILE"; then
  if [ ! -f "$SWAPFILE" ]; then
    fallocate -l 1G "$SWAPFILE" || dd if=/dev/zero of="$SWAPFILE" bs=1M count=1024 status=none
    chmod 600 "$SWAPFILE"; mkswap -q "$SWAPFILE"
  fi
  sed -i "\|^$SWAPFILE |d" /etc/fstab
  echo "$SWAPFILE none swap sw,nofail,x-systemd.requires-mounts-for=$MOUNT 0 0 $TAG" >> /etc/fstab
  swapon "$SWAPFILE"
fi
# The stock swap file lives on the USB drive; turn it off so it stops writing there.
if systemctl list-unit-files dphys-swapfile.service >/dev/null 2>&1; then
  [ -e /etc/dphys-swapfile.before-card ] || cp /etc/dphys-swapfile /etc/dphys-swapfile.before-card 2>/dev/null || true
  dphys-swapfile swapoff 2>/dev/null || true
  systemctl disable --now dphys-swapfile 2>/dev/null || true
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-sage-swap.conf
sysctl -q -p /etc/sysctl.d/90-sage-swap.conf || true

say "/tmp in RAM from the next reboot (512 MB cap)"
if ! grep -qE '^[^#]\S*\s+/tmp\s' /etc/fstab; then
  echo "tmpfs /tmp tmpfs defaults,noatime,nosuid,nodev,mode=1777,size=512M 0 0 $TAG" >> /etc/fstab
fi
systemctl daemon-reload

start_sage
report
cat <<DONE

Done. Sage's code, venv, web app and caches now run from the SD card.
  * The USB copies are untouched underneath (a fallback if the card fails).
  * In any open terminal, step back in so it sees the card copy: cd ~ && cd ~/sage-os
  * Deploy exactly as before: cd ~/sage-os && git pull && sudo deploy/install_pi.sh --only server,web
  * Reboot once to put /tmp in RAM and prove the boot order: sudo reboot
  * Undo any time: cd ~/sage-os && sudo deploy/move_system_to_card.sh --undo
DONE
