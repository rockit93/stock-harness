#!/usr/bin/env bash
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python_cmd=()
python_candidates=(
  "py -3.12"
  "py -3.11"
  "py -3"
  "python3"
  "python"
)

for candidate in "${python_candidates[@]}"; do
  read -r -a parts <<< "${candidate}"
  if "${parts[@]}" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' >/dev/null 2>&1; then
    python_cmd=("${parts[@]}")
    break
  fi
done

if [[ "${#python_cmd[@]}" -eq 0 ]]; then
  echo "Python was not found. Install Python 3.11+ first." >&2
  exit 1
fi

exec "${python_cmd[@]}" "${SERVICE_DIR}/start.py" "$@"
