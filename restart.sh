#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:-all}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${ROOT_DIR}/stop.sh" "$SERVICE"
sleep 1
exec "${ROOT_DIR}/bootstrap.sh" "$SERVICE"
