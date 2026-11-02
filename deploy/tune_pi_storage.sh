#!/usr/bin/env bash
# Makes a Pi that runs from a slow USB pen drive or SD card wait on its disk
# less, so Sage stays quick. Safe to run again; each change is skipped when
# it's already in place. Undo notes are printed at the end.
#
#   sudo deploy/tune_pi_storage.sh
#
# What it does:
#  1. Root filesystem: noatime (no write just for reading a file) and
#     commit=60 (journal flushed every 60 s instead of 5 s). fstab is backed
#     up first; takes effect now via remount.
#  2. Kernel: gathers writes for longer before sending them to the disk, so
#     many small writes go out as fewer bigger ones.
#  3. System journal kept in RAM (64 MB cap). Sage keeps its own log in
#     sage.log, so nothing Sage needs is lost; system logs reset on reboot.
#  4. Frees space: apt cache, old journals, unused Docker build cache and
#     dangling images (never images or containers you use).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo $0"; exit 1; }

echo "== 1. Root filesystem: noatime, commit=60"
ROOT_LINE=$(awk '$1 !~ /^#/ && $2 == "/" {print NR}' /etc/fstab | head -1)
if [ -z "$ROOT_LINE" ]; then
  echo "   No / line in /etc/fstab; skipped."
else
  OPTS=$(awk -v n="$ROOT_LINE" 'NR == n {print $4}' /etc/fstab)
  NEW="$OPTS"
  case ",$NEW," in *,noatime,*) ;; *) NEW="$NEW,noatime" ;; esac
  case ",$NEW," in *,commit=*) ;; *) NEW="$NEW,commit=60" ;; esac
  NEW=$(echo "$NEW" | sed 's/\(^\|,\)relatime\(,\|$\)/\1\2/; s/,,/,/g; s/^,//; s/,$//')
  if [ "$NEW" != "$OPTS" ]; then
    cp -n /etc/fstab /etc/fstab.before-sage-tune
    awk -v n="$ROOT_LINE" -v o="$NEW" 'NR == n {$4 = o} {print}' /etc/fstab > /etc/fstab.new
    mv /etc/fstab.new /etc/fstab
    systemctl daemon-reload
    echo "   $OPTS -> $NEW (backup: /etc/fstab.before-sage-tune)"
  else
    echo "   Already set."
  fi
  mount -o remount,noatime,commit=60 / && echo "   Applied now."
fi

echo "== 2. Kernel write batching"
cat > /etc/sysctl.d/90-sage-slow-disk.conf <<'CONF'
# Sage: fewer, bigger writes to a slow USB/SD disk (deploy/tune_pi_storage.sh)
vm.dirty_writeback_centisecs = 1500
vm.dirty_expire_centisecs = 3000
vm.dirty_background_ratio = 5
vm.dirty_ratio = 20
CONF
sysctl -q -p /etc/sysctl.d/90-sage-slow-disk.conf && echo "   Applied."

echo "== 3. System journal in RAM"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/90-sage-ram.conf <<'CONF'
[Journal]
Storage=volatile
RuntimeMaxUse=64M
CONF
systemctl restart systemd-journald && echo "   Applied."

echo "== 4. Free space"
BEFORE=$(df --output=avail -B1M / | tail -1)
apt-get clean
journalctl --vacuum-size=16M >/dev/null 2>&1 || true
rm -rf /var/log/journal/* 2>/dev/null || true
if command -v docker >/dev/null 2>&1; then
  docker builder prune -f >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
fi
AFTER=$(df --output=avail -B1M / | tail -1)
echo "   Freed $((AFTER - BEFORE)) MB. Now: $(df -h / | awk 'NR==2 {print $5 " used, " $4 " free"}')"

echo
echo "== Biggest space users (for you to decide)"
du -sh /var/lib/docker /usr/share/ollama /home/*/.ollama /home/*/.cache/ms-playwright 2>/dev/null | sort -h | tail -6 || true
command -v ollama >/dev/null 2>&1 && { echo "   Ollama models:"; ollama list 2>/dev/null | sed 's/^/     /'; } || true

cat <<'DONE'

Done. Restart Sage so it picks up the latest code: sudo systemctl restart sage

Undo:
  sudo cp /etc/fstab.before-sage-tune /etc/fstab
  sudo rm /etc/sysctl.d/90-sage-slow-disk.conf /etc/systemd/journald.conf.d/90-sage-ram.conf
  sudo reboot
DONE
