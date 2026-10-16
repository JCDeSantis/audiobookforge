#!/usr/bin/env bash
set -euo pipefail

# Add Homebrew to PATH for cmake and other build tools
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

WHISPER_COMMIT="2eeeba56e9edd762b4b38467bab96c2517163158"
OUTPUT="build/whisper-macos/whisper-cli"
SRC="/tmp/abf-whisper-src"

if [[ -f "${OUTPUT}" ]]; then
  lipo -verify_arch arm64 "${OUTPUT}"
  echo "whisper-cli already built at ${OUTPUT}, skipping"
  exit 0
fi

echo "Building whisper-cli with Metal support..."

rm -rf "${SRC}"
git init "${SRC}"
git -C "${SRC}" remote add origin https://github.com/ggml-org/whisper.cpp.git
git -C "${SRC}" fetch --depth 1 origin "${WHISPER_COMMIT}"
git -C "${SRC}" checkout --detach FETCH_HEAD

cmake -S "${SRC}" -B "${SRC}/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON

cmake --build "${SRC}/build" --target whisper-cli -j"$(sysctl -n hw.physicalcpu)"

mkdir -p "$(dirname "${OUTPUT}")"
install -m755 "${SRC}/build/bin/whisper-cli" "${OUTPUT}"
lipo -verify_arch arm64 "${OUTPUT}"

echo "Built: ${OUTPUT}"
