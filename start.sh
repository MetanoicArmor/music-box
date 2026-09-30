#!/usr/bin/env bash
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(pwd)"

fail() {
  printf '%s\n' "$1" >&2
  if [[ -t 0 ]]; then
    read -r -p "Press Enter to close..." _
  fi
  exit 1
}

NODE_CMD="node"
if [[ -x "$ROOT/runtime/node" ]]; then
  NODE_CMD="$ROOT/runtime/node"
fi

BUNDLED=0
if [[ -x "$ROOT/runtime/node" && -d "$ROOT/node_modules" && -f "$ROOT/dist/client/index.html" ]]; then
  BUNDLED=1
fi

node_loads_native() {
  local bin="$1"
  (cd "$ROOT" && "$bin" -e "require('better-sqlite3')" >/dev/null 2>&1)
}

cached_node() {
  local candidate
  for candidate in "$ROOT"/release/.cache/node-v*/bin/node; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ "$BUNDLED" == "0" ]]; then
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    fail "Node.js not found. Install it from https://nodejs.org/ or use a portable archive with runtime/node."
  fi
  if [[ ! -d "$ROOT/node_modules" ]]; then
    printf 'Installing dependencies...\n'
    if ! npm install; then
      cached="$(cached_node || true)"
      if [[ -z "$cached" ]]; then
        fail "npm install failed. better-sqlite3 needs Node.js 22 — run: bash scripts/build-release.sh"
      fi
      printf 'Retrying npm install with %s\n' "$("$cached" -v)"
      PATH="$(dirname "$cached"):$PATH" npm install || fail "npm install failed"
    fi
  fi
fi

if [[ ! -f "$ROOT/config.json" ]]; then
  cp "$ROOT/config.example.json" "$ROOT/config.json"
  printf 'Created config.json - change adminPassword!\n'
fi

PORT=3000
if [[ -f "$ROOT/config.json" ]]; then
  parsed=$(sed -nE 's/^[[:space:]]*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$ROOT/config.json" || true)
  parsed=${parsed%%$'\n'*}
  if [[ -n "$parsed" ]]; then
    PORT="$parsed"
  fi
fi

mpv_present() {
  [[ -x "$ROOT/bin/mpv" ]] && return 0
  command -v mpv >/dev/null 2>&1 && return 0
  [[ -x /opt/homebrew/bin/mpv || -x /usr/local/bin/mpv || -x /usr/bin/mpv ]] && return 0
  return 1
}

if ! mpv_present; then
  printf '\nmpv not found. Downloading / installing...\n'
  export MUSICBOX_MPV_OPTIONAL=1
  if ! bash "$ROOT/scripts/setup-binaries.sh"; then
    printf '\n[WARN] mpv is still missing. Local files can be queued; playback needs mpv.\n\n'
  fi
fi

if [[ "$BUNDLED" == "0" ]]; then
  printf 'Building...\n'
  npm run build || fail "Build failed"
  if ! node_loads_native "$NODE_CMD"; then
    cached="$(cached_node || true)"
    if [[ -z "$cached" ]] || ! node_loads_native "$cached"; then
      fail "This Node.js cannot load better-sqlite3. Install Node.js 22, or run: bash scripts/build-release.sh"
    fi
    NODE_CMD="$cached"
    printf 'Using %s for the server (system Node is incompatible with better-sqlite3).\n' "$("$NODE_CMD" -v)"
  fi
fi

URL="http://localhost:${PORT}"
printf '\nStarting Music Box...\n'
if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

exec "$NODE_CMD" dist/server/index.js
