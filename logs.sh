#!/usr/bin/env bash
set -euo pipefail

service="${1:-all}"
tail_lines="${2:-120}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log_dir="$root/logs"

if [[ "$service" == "all" ]]; then
  services=(python-core node-api web)
else
  services=("$service")
fi

for name in "${services[@]}"; do
  path="$log_dir/$name.log"
  if [[ ! -f "$path" ]]; then
    echo "No log file yet: $path"
    continue
  fi
  echo
  echo "===== $name ====="
  tail -n "$tail_lines" "$path"
done
