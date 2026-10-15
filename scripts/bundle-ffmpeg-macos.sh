#!/usr/bin/env bash
set -euo pipefail

FFMPEG_OUT="build/ffmpeg-macos/ffmpeg"
FFPROBE_OUT="build/ffmpeg-macos/ffprobe"

if [[ -f "${FFMPEG_OUT}" && -f "${FFPROBE_OUT}" ]]; then
  echo "ffmpeg already bundled at build/ffmpeg-macos/, skipping"
  exit 0
fi

# Use ffmpeg-static npm package — statically linked against system frameworks only,
# so it can be re-signed with a Developer ID cert and spawned from a hardened-runtime process.
FFMPEG_SRC="node_modules/ffmpeg-static/ffmpeg"
FFPROBE_SRC="node_modules/ffprobe-static/bin/darwin/arm64/ffprobe"

if [[ ! -f "${FFMPEG_SRC}" ]]; then
  echo "ffmpeg-static not found — run: npm ci" >&2
  exit 1
fi
if [[ ! -f "${FFPROBE_SRC}" ]]; then
  echo "ffprobe-static not found — run: npm ci" >&2
  exit 1
fi

mkdir -p build/ffmpeg-macos
install -m755 "${FFMPEG_SRC}" "${FFMPEG_OUT}"
install -m755 "${FFPROBE_SRC}" "${FFPROBE_OUT}"

echo "Bundled: ${FFMPEG_OUT} ($(file "${FFMPEG_OUT}" | awk -F: '{print $2}' | xargs))"
echo "Bundled: ${FFPROBE_OUT} ($(file "${FFPROBE_OUT}" | awk -F: '{print $2}' | xargs))"
