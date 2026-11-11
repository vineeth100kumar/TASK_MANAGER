#!/usr/bin/env bash
# Reels' voice and word-timing models, best effort: Sage runs without them, and Reels still
# work from your own recording (voice: mine). Run as the Sage user, from install_pi.sh.
#
#   - kokoro-onnx + soundfile + faster-whisper (raspberry_pi/requirements-reels.txt), from PyPI
#   - Kokoro's model files (~330 MB) into REEL_MODEL_DIR (default ~/.cache/sage-reels)
#   - Whisper's base.en model (~150 MB) into the Hugging Face cache, so word timing never has to
#     go online while a reel is being made
#
# Re-running skips what is already there.
set -u
REPO="${1:?usage: install_reels.sh REPO}"
VENV="$REPO/raspberry_pi/venv"
DIR="${REEL_MODEL_DIR:-$HOME/.cache/sage-reels}"
BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
fail=0

"$VENV/bin/pip" install -q --index-url https://pypi.org/simple -r "$REPO/raspberry_pi/requirements-reels.txt" \
  || { echo "The voice packages didn't install."; fail=1; }

mkdir -p "$DIR"
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ -s "$DIR/$f" ]; then
    echo "$f is already in $DIR"
  else
    echo "Downloading $f ..."
    curl -fL --retry 3 --retry-delay 5 -o "$DIR/$f.part" "$BASE/$f" && mv "$DIR/$f.part" "$DIR/$f" \
      || { rm -f "$DIR/$f.part"; echo "Couldn't download $f from $BASE"; fail=1; }
  fi
done

"$VENV/bin/python" - <<'PY' || { echo "Couldn't fetch Whisper's base.en; word timing will be estimated from the sound."; }
from faster_whisper.utils import download_model
print("Whisper base.en:", download_model("base.en"))
PY

exit $fail
