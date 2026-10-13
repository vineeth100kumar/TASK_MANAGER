#!/usr/bin/env bash
# The depth clock face's cutout packages (raspberry_pi/requirements-depth.txt),
# best effort: Sage runs without them. Run as the Sage user, from install_pi.sh
# and auto_sync.sh.
#
# They come from PyPI only. On the Pi, piwheels (Raspberry Pi OS's default extra
# index) served a rembg 2.0.85 whose rembg/__init__.py had no new_session, so
# rembg imported but every cutout failed. If that copy is already there, it is
# swapped for PyPI's.
set -u
REPO="${1:?usage: install_depth.sh REPO}"
VENV="$REPO/raspberry_pi/venv"
PYPI="https://pypi.org/simple"

"$VENV/bin/pip" install -q --index-url "$PYPI" -r "$REPO/raspberry_pi/requirements-depth.txt" || exit 1
if ! "$VENV/bin/python" -c "from rembg import new_session, remove" 2>/dev/null; then
  echo "rembg is broken; reinstalling it from PyPI"
  "$VENV/bin/pip" install -q --force-reinstall --no-deps --no-cache-dir --index-url "$PYPI" rembg || exit 1
  "$VENV/bin/python" -c "from rembg import new_session, remove" || exit 1
fi
