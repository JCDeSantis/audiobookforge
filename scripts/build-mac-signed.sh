#!/usr/bin/env bash
set -euo pipefail

# Load signing environment if .env.mac exists.
if [ -f ".env.mac" ]; then
  set -a
  # shellcheck source=/dev/null
  source .env.mac
  set +a
fi

if [ -z "${CSC_NAME:-}" ]; then
  echo "Error: CSC_NAME is not set. Copy .env.mac.example to .env.mac and set your Developer ID identity." >&2
  exit 1
fi

npm run build:whisper:macos
npm run build:ffmpeg:macos
npm run build
npm run build:server
electron-builder --mac --arm64
