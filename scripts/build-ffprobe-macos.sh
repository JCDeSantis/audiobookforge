#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

FFMPEG_TAG="n7.1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${REPO_ROOT}/build/ffmpeg-macos/ffprobe"
SRC="/tmp/abf-ffmpeg-src"

if [[ -f "${OUTPUT}" ]]; then
  lipo "${OUTPUT}" -verify_arch arm64
  echo "ffprobe already built at ${OUTPUT}, skipping"
  exit 0
fi

echo "Building ffprobe from FFmpeg ${FFMPEG_TAG}..."

rm -rf "${SRC}"
git clone --depth 1 --branch "${FFMPEG_TAG}" https://github.com/FFmpeg/FFmpeg.git "${SRC}"

cd "${SRC}"

./configure \
  --arch=arm64 \
  --target-os=darwin \
  --cc=clang \
  --disable-everything \
  --disable-shared \
  --enable-static \
  --disable-asm \
  --disable-doc \
  --disable-htmlpages \
  --disable-manpages \
  --disable-podpages \
  --disable-txtpages \
  --enable-ffprobe \
  --disable-ffmpeg \
  --disable-ffplay \
  --enable-protocol=file \
  --enable-demuxer=aac,aiff,ape,flac,matroska,mov,mp3,ogg,wav \
  --enable-parser=aac,flac,mpegaudio

make -j"$(sysctl -n hw.physicalcpu)" ffprobe

mkdir -p "$(dirname "${OUTPUT}")"
install -m755 ffprobe "${OUTPUT}"
lipo "${OUTPUT}" -verify_arch arm64

echo "Built: ${OUTPUT}"
