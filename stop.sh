#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:-all}"

usage() {
  echo "Usage: $0 [all|python-core|node-api|web]" >&2
}

service_port() {
  case "$1" in
    python-core) echo "8765" ;;
    node-api) echo "8787" ;;
    web) echo "5173" ;;
    *) return 1 ;;
  esac
}

service_name() {
  case "$1" in
    python-core) echo "Python Core" ;;
    node-api) echo "Node API" ;;
    web) echo "Vue Web" ;;
    *) return 1 ;;
  esac
}

selected_services() {
  case "$SERVICE" in
    all) echo "python-core node-api web" ;;
    python-core|node-api|web) echo "$SERVICE" ;;
    *)
      usage
      exit 1
      ;;
  esac
}

pids_for_port() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser "$port"/tcp 2>/dev/null || true
    return
  fi

  echo "Neither lsof nor fuser is available; cannot find processes by port." >&2
  exit 1
}

for service in $(selected_services); do
  port="$(service_port "$service")"
  name="$(service_name "$service")"
  pids="$(pids_for_port "$port" | tr '\n' ' ' | xargs || true)"

  if [[ -z "$pids" ]]; then
    echo "$name is not running on port $port."
    continue
  fi

  for pid in $pids; do
    echo "Stopping $name on port $port (PID $pid)..."
    kill "$pid" 2>/dev/null || true
  done
done
