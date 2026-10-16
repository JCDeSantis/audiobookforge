#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FFMPEG_OUT="build/ffmpeg-macos/ffmpeg"
FFPROBE_OUT="build/ffmpeg-macos/ffprobe"

# ffprobe is built from FFmpeg source — ffprobe-static ships x86_64 mislabeled as arm64
if [[ ! -f "${FFPROBE_OUT}" ]]; then
  bash "${SCRIPT_DIR}/build-ffprobe-macos.sh"
fi

if [[ -f "${FFMPEG_OUT}" ]]; then
  lipo -verify_arch arm64 "${FFMPEG_OUT}" "${FFPROBE_OUT}"
  echo "ffmpeg already bundled at ${FFMPEG_OUT}, skipping"
  exit 0
fi

# Use ffmpeg-static npm package — statically linked against system frameworks only,
# so it can be re-signed with a Developer ID cert and spawned from a hardened-runtime process.
FFMPEG_SRC="node_modules/ffmpeg-static/ffmpeg"

if [[ ! -f "${FFMPEG_SRC}" ]]; then
  echo "ffmpeg-static not found — run: npm ci" >&2
  exit 1
fi

mkdir -p build/ffmpeg-macos
install -m755 "${FFMPEG_SRC}" "${FFMPEG_OUT}"
lipo -verify_arch arm64 "${FFMPEG_OUT}" "${FFPROBE_OUT}"

echo "Bundled: ${FFMPEG_OUT} ($(file "${FFMPEG_OUT}" | awk -F: '{print $2}' | xargs))"
echo "Bundled: ${FFPROBE_OUT} ($(file "${FFPROBE_OUT}" | awk -F: '{print $2}' | xargs))"
