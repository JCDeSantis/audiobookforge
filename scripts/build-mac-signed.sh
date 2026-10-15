#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="$(dirname "$0")/../.env.mac"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing .env.mac — copy .env.mac.example and fill in CSC_NAME." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

if [[ -z "${CSC_NAME:-}" ]]; then
  echo "CSC_NAME not set in .env.mac" >&2
  exit 1
fi

exec npm run build:mac:arm64
