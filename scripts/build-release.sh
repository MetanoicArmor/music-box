#!/usr/bin/env bash
# Portable Music Box archive for the current OS.
#   bash scripts/build-release.sh            # macOS or Linux, this machine
#   bash scripts/build-release.sh linux      # Linux x64 (Docker if not already Linux x64)
#   bash scripts/build-release.sh linux-arm64
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION="22.20.0"
RELEASE_NAME="MusicBox"
APP_VERSION="$(node "$ROOT/scripts/sync-version.mjs")"

log() { printf '%s\n' "$*"; }

host_arch_kind() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s\n' x64 ;;
    arm64|aarch64) printf '%s\n' arm64 ;;
    *) printf '%s\n' unknown ;;
  esac
}

docker_build() {
  local platform="$1"
  if ! command -v docker >/dev/null 2>&1; then
    log "Docker is required to build a Linux release on $(uname -s)."
    log "Install Docker, or run this script on a Linux machine."
    exit 1
  fi
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if docker info >/dev/null 2>&1; then
      break
    fi
    if [[ "$attempt" == "10" ]]; then
      log "Docker is installed but the daemon is not running."
      exit 1
    fi
    sleep 2
  done

  mkdir -p "$ROOT/release"
  log ""
  log "Music Box - Linux release via Docker ($platform)"
  log ""
  docker run --rm --platform "$platform" -i \
    -e HOME=/tmp \
    -e MUSICBOX_IN_DOCKER=1 \
    -e MUSICBOX_SKIP_SYSTEM_MPV=1 \
    -e MUSICBOX_MPV_OPTIONAL=1 \
    -v "$ROOT:/src:ro" \
    -v "$ROOT/release:/out" \
    "node:${NODE_VERSION}-bookworm" \
    bash -s << 'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl xz-utils python3 python3-venv make g++ cmake ninja-build patchelf unzip libgl1-mesa-dev libxkbcommon-dev libxcb-cursor0 libfontconfig1 libdbus-1-3
rm -rf /tmp/src
mkdir -p /tmp/src
tar -C /src \
  --exclude node_modules \
  --exclude release \
  --exclude dist \
  --exclude data \
  --exclude media \
  --exclude bin \
  --exclude .git \
  --exclude host-gui/build \
  -cf - . | tar -C /tmp/src -xf -
cd /tmp/src
bash scripts/build-release.sh
mkdir -p /out
cp -f release/*.tar.gz /out/
EOF
}

TARGET="${1:-}"
case "$TARGET" in
  linux|linux-x64|linux-arm64)
    want="x64"
    if [[ "$TARGET" == "linux-arm64" ]]; then want="arm64"; fi
    have="$(host_arch_kind)"
    if [[ "$(uname -s)" == "Linux" && "$have" == "$want" ]]; then
      :
    elif [[ "${MUSICBOX_IN_DOCKER:-}" == "1" ]]; then
      log "Inside Docker but the container architecture is not $want."
      exit 1
    else
      if [[ "$want" == "arm64" ]]; then
        docker_build linux/arm64
      else
        docker_build linux/amd64
      fi
      exit 0
    fi
    ;;
  ""|host|macos|darwin)
    if [[ "$TARGET" == "macos" || "$TARGET" == "darwin" ]] && [[ "$(uname -s)" != "Darwin" ]]; then
      log "A macOS release has to be built on a Mac."
      exit 1
    fi
    ;;
  *)
    log "Unknown target: $TARGET"
    log "Use: build-release.sh [linux|linux-arm64]"
    exit 1
    ;;
esac

OS="$(uname -s)"
ARCH_KIND="$(host_arch_kind)"
if [[ "$ARCH_KIND" == "unknown" ]]; then
  log "Unsupported architecture: $(uname -m)"
  exit 1
fi

case "$OS-$ARCH_KIND" in
  Darwin-arm64) SUFFIX="macos-arm64"; NODE_PLAT="darwin-arm64"; NODE_EXT="tar.gz" ;;
  Darwin-x64) SUFFIX="macos-x64"; NODE_PLAT="darwin-x64"; NODE_EXT="tar.gz" ;;
  Linux-x64) SUFFIX="linux-x64"; NODE_PLAT="linux-x64"; NODE_EXT="tar.xz" ;;
  Linux-arm64) SUFFIX="linux-arm64"; NODE_PLAT="linux-arm64"; NODE_EXT="tar.xz" ;;
  *)
    log "Unsupported platform: $OS $(uname -m)"
    exit 1
    ;;
esac

RELEASE_DIR="$ROOT/release/$RELEASE_NAME"
ARCHIVE="$ROOT/release/${RELEASE_NAME}-${SUFFIX}.tar.gz"
CACHE_DIR="$ROOT/release/.cache"
NODE_DIST="node-v${NODE_VERSION}-${NODE_PLAT}"
NODE_HOME="$CACHE_DIR/$NODE_DIST"
NODE_ARCHIVE="$CACHE_DIR/${NODE_DIST}.${NODE_EXT}"

ensure_node() {
  if [[ -x "$NODE_HOME/bin/node" ]]; then
    return 0
  fi
  mkdir -p "$CACHE_DIR"
  if [[ ! -f "$NODE_ARCHIVE" ]]; then
    log "Downloading Node.js $NODE_VERSION ($NODE_PLAT)..."
    curl -fL --retry 3 --retry-delay 2 -o "${NODE_ARCHIVE}.partial" \
      "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.${NODE_EXT}"
    mv "${NODE_ARCHIVE}.partial" "$NODE_ARCHIVE"
  fi
  log "Extracting Node.js runtime..."
  rm -rf "$NODE_HOME"
  if [[ "$NODE_EXT" == "tar.xz" ]]; then
    tar -xJf "$NODE_ARCHIVE" -C "$CACHE_DIR"
  else
    tar -xzf "$NODE_ARCHIVE" -C "$CACHE_DIR"
  fi
  if [[ ! -x "$NODE_HOME/bin/node" ]]; then
    log "node binary missing after extract: $NODE_HOME/bin/node"
    exit 1
  fi
}

log ""
log "Music Box $APP_VERSION - Release Build ($SUFFIX)"
log ""

if [[ ! -d "$ROOT/node_modules/typescript" ]]; then
  log "Installing dependencies..."
  if ! (cd "$ROOT" && npm ci); then
    log "System npm ci failed, retrying with Node.js $NODE_VERSION..."
    rm -rf "$ROOT/node_modules"
    ensure_node
    export PATH="$NODE_HOME/bin:$PATH"
    hash -r
    (cd "$ROOT" && npm ci)
  fi
fi

log "Building app..."
(cd "$ROOT" && npm run build)

log "Preparing binaries..."
export MUSICBOX_MPV_OPTIONAL=1
bash "$ROOT/scripts/setup-binaries.sh"

if [[ ! -x "$ROOT/bin/yt-dlp" ]]; then
  log "yt-dlp is missing; refusing to pack a release without it."
  exit 1
fi
if [[ "$OS" == "Darwin" && ! -x "$ROOT/bin/mpv" ]]; then
  log "mpv is missing; refusing to pack a macOS release without it."
  exit 1
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

log "Copying files..."
for item in dist scripts package.json package-lock.json config.example.json README.md start.sh stop.sh MusicBox.command; do
  if [[ -e "$ROOT/$item" ]]; then
    cp -R "$ROOT/$item" "$RELEASE_DIR/$item"
  fi
done
if [[ -f "$ROOT/README.md" ]]; then
  cp "$ROOT/README.md" "$RELEASE_DIR/README.txt"
fi

mkdir -p "$RELEASE_DIR/server/db" "$RELEASE_DIR/bin" "$RELEASE_DIR/media" "$RELEASE_DIR/data" "$RELEASE_DIR/runtime"
cp "$ROOT/server/db/schema.sql" "$RELEASE_DIR/server/db/schema.sql"

if [[ -d "$ROOT/bin/mpv.app" ]]; then
  cp -R "$ROOT/bin/mpv.app" "$RELEASE_DIR/bin/mpv.app"
fi
if [[ -f "$ROOT/bin/mpv" && ! -L "$ROOT/bin/mpv" ]]; then
  cp "$ROOT/bin/mpv" "$RELEASE_DIR/bin/mpv"
  chmod +x "$RELEASE_DIR/bin/mpv"
fi
if [[ -f "$ROOT/bin/yt-dlp" && ! -L "$ROOT/bin/yt-dlp" ]]; then
  cp "$ROOT/bin/yt-dlp" "$RELEASE_DIR/bin/yt-dlp"
  chmod +x "$RELEASE_DIR/bin/yt-dlp"
fi

cp "$ROOT/scripts/release-readme-unix.txt" "$RELEASE_DIR/START-HERE.txt"

ensure_node
export PATH="$NODE_HOME/bin:$PATH"
hash -r

log "Installing production dependencies with Node $($NODE_HOME/bin/node -v)..."
(
  cd "$RELEASE_DIR"
  npm ci --omit=dev
)

cp "$NODE_HOME/bin/node" "$RELEASE_DIR/runtime/node"
chmod +x "$RELEASE_DIR/runtime/node"
chmod +x "$RELEASE_DIR/start.sh" "$RELEASE_DIR/stop.sh" "$RELEASE_DIR/MusicBox.command"
find "$RELEASE_DIR/scripts" -name '*.sh' -exec chmod +x {} \;

if [[ -f "$RELEASE_DIR/START-HERE.txt" ]]; then
  chmod 644 "$RELEASE_DIR/START-HERE.txt"
fi

bash "$ROOT/scripts/build-host-gui.sh" "$RELEASE_DIR"
if [[ ! -x "$RELEASE_DIR/MusicBox" && ! -d "$RELEASE_DIR/MusicBox.app" ]]; then
  log "Host window was not packaged."
  exit 1
fi

find "$RELEASE_DIR" -name '.DS_Store' -delete 2>/dev/null || true

rm -f "$ARCHIVE"
log "Creating archive..."
COPYFILE_DISABLE=1 tar -C "$ROOT/release" -czf "$ARCHIVE" "$RELEASE_NAME"

log ""
log "Done."
log "  Folder: $RELEASE_DIR"
log "  Archive: $ARCHIVE"
log ""
