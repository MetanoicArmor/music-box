#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=3000

read_port() {
  local file="$1"
  local port
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  port=$(sed -nE 's/^[[:space:]]*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$file" || true)
  port=${port%%$'\n'*}
  if [[ -n "$port" ]]; then
    PORT="$port"
  fi
}

if [[ -f "$ROOT/config.json" ]]; then
  read_port "$ROOT/config.json"
elif [[ -f "$ROOT/config.example.json" ]]; then
  read_port "$ROOT/config.example.json"
fi

printf '\nMusic Box - Stop\n'
printf 'Port: %s\n\n' "$PORT"

stopped=0

stop_pid() {
  local pid="$1"
  local label="$2"
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  printf 'Stopping %s (PID %s)...\n' "$label" "$pid"
  kill "$pid" 2>/dev/null || true
  stopped=1
}

listener_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$PORT" 2>/dev/null || true
  fi
}

pids="$(listener_pids || true)"
if [[ -z "${pids// /}" ]]; then
  printf 'No process listening on port %s.\n' "$PORT"
else
  for pid in $pids; do
    comm="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
    case "$comm" in
      *node*)
        stop_pid "$pid" "Music Box server"
        ;;
      *)
        printf 'Port %s is used by %s (PID %s), not node - skipped.\n' "$PORT" "$comm" "$pid"
        ;;
    esac
  done
fi

if command -v pgrep >/dev/null 2>&1; then
  mpv_pids="$(pgrep -f "$ROOT/bin/mpv" || true)"
  for pid in $mpv_pids; do
    if [[ "$pid" == "$$" ]]; then
      continue
    fi
    stop_pid "$pid" "mpv player"
  done
fi

printf '\n'
if [[ "$stopped" == "1" ]]; then
  printf 'Music Box stopped.\n'
else
  printf 'Nothing to stop - Music Box is not running.\n'
fi
