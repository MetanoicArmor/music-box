#!/usr/bin/env bash
# Build the Qt host window into the portable folder.
# macOS: MusicBox.app
# Linux: MusicBox binary plus Qt libraries in lib/ and plugins/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-}"
QT_VERSION="6.8.3"
BUILD_DIR="$ROOT/host-gui/build"

if [[ -z "$DEST" ]]; then
  echo "Usage: build-host-gui.sh <release-dir>" >&2
  exit 1
fi
mkdir -p "$DEST"

log() { printf '%s\n' "$*" >&2; }

ensure_cmake() {
  if command -v cmake >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    brew install cmake
    return 0
  fi
  log "cmake is required to build the host window."
  exit 1
}

ensure_linux_packages() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  local missing=0
  command -v cmake >/dev/null 2>&1 || missing=1
  command -v g++ >/dev/null 2>&1 || missing=1
  command -v patchelf >/dev/null 2>&1 || missing=1
  command -v python3 >/dev/null 2>&1 || missing=1
  if [[ ! -e /usr/lib/x86_64-linux-gnu/libGL.so && ! -e /usr/lib/aarch64-linux-gnu/libGL.so && ! -e /usr/lib64/libGL.so ]]; then
    missing=1
  fi
  if [[ "$missing" == "0" ]]; then
    return 0
  fi
  local pkgs=(cmake g++ make ninja-build patchelf python3 python3-venv libgl1-mesa-dev libxkbcommon-dev libxcb-cursor0 libfontconfig1 libdbus-1-3)
  if [[ "$(id -u)" -eq 0 ]]; then
    apt-get update
    apt-get install -y --no-install-recommends "${pkgs[@]}"
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends "${pkgs[@]}"
  else
    log "Install packages: ${pkgs[*]}"
    exit 1
  fi
}

find_qt() {
  if [[ -n "${QT_ROOT_DIR:-}" && -x "$QT_ROOT_DIR/bin/qmake" ]]; then
    printf '%s\n' "$QT_ROOT_DIR"
    return 0
  fi
  local qmake=""
  if command -v qmake6 >/dev/null 2>&1; then
    qmake="$(command -v qmake6)"
  elif command -v qmake >/dev/null 2>&1; then
    qmake="$(command -v qmake)"
  fi
  if [[ -n "$qmake" ]]; then
    "$qmake" -query QT_INSTALL_PREFIX
    return 0
  fi
  return 1
}

install_qt() {
  local host arch
  case "$(uname -s)-$(uname -m)" in
    Darwin-*) host="mac"; arch="clang_64" ;;
    Linux-x86_64|Linux-amd64) host="linux"; arch="linux_gcc_64" ;;
    Linux-aarch64|Linux-arm64) host="linux_arm64"; arch="linux_gcc_arm64" ;;
    *)
      log "No Qt build for $(uname -s) $(uname -m)."
      exit 1
      ;;
  esac
  local cache="$ROOT/release/.cache"
  local venv="$cache/aqt-venv"
  local out="$cache/qt"
  mkdir -p "$cache"
  if [[ ! -x "$venv/bin/aqt" ]]; then
    python3 -m venv "$venv"
    "$venv/bin/pip" install --disable-pip-version-check "aqtinstall==3.1.19"
  fi
  log "Downloading Qt $QT_VERSION..."
  "$venv/bin/aqt" install-qt "$host" desktop "$QT_VERSION" "$arch" -O "$out" --internal
  local qmake
  qmake="$(find "$out" -type f -name qmake -print -quit)"
  if [[ -z "$qmake" ]]; then
    log "qmake not found after aqt install."
    exit 1
  fi
  dirname "$(dirname "$qmake")"
}

deploy_macos() {
  local qt="$1"
  local app
  app="$(find "$BUILD_DIR" -type d -name 'MusicBox.app' -print -quit)"
  if [[ -z "$app" ]]; then
    log "MusicBox.app was not produced."
    exit 1
  fi

  local args=(-always-overwrite -no-codesign)
  local prefix qt_all
  prefix="$("$qt/bin/qmake" -query QT_INSTALL_PREFIX)"
  # Homebrew splits Qt modules across kegs. qmake from qtbase only searches
  # that keg, so plugins for SVG, PDF and the virtual keyboard fail to deploy.
  # The qt metapackage links all of them into one lib directory.
  qt_all="$prefix/opt/qt/lib"
  if [[ -d "$qt_all" ]]; then
    args+=("-libpath=$qt_all")
  fi

  "$qt/bin/macdeployqt" "$app" "${args[@]}"
  rm -rf "$DEST/MusicBox.app"
  cp -R "$app" "$DEST/MusicBox.app"
  codesign --force --deep --sign - "$DEST/MusicBox.app"
  codesign --verify --deep --strict "$DEST/MusicBox.app"
  log "  MusicBox.app OK"
}

deploy_linux() {
  local qt="$1"
  local bin="$BUILD_DIR/MusicBox"
  if [[ ! -x "$bin" ]]; then
    log "MusicBox binary was not produced."
    exit 1
  fi
  cp "$bin" "$DEST/MusicBox"
  cp "$ROOT/host-gui/assets/app-icon.png" "$DEST/app-icon.png"
  chmod +x "$DEST/MusicBox"
  rm -rf "$DEST/lib" "$DEST/plugins"
  mkdir -p "$DEST/lib" "$DEST/plugins"
  find "$qt/lib" -maxdepth 1 \( -name 'lib*.so' -o -name 'lib*.so.*' \) -exec cp -a {} "$DEST/lib/" \;
  local plug
  for plug in platforms imageformats tls xcbglintegrations platforminputcontexts iconengines; do
    if [[ -d "$qt/plugins/$plug" ]]; then
      mkdir -p "$DEST/plugins/$plug"
      cp -a "$qt/plugins/$plug"/. "$DEST/plugins/$plug/"
    fi
  done
  patchelf --set-rpath '$ORIGIN/lib' "$DEST/MusicBox"
  find "$DEST/lib" -type f \( -name 'lib*.so' -o -name 'lib*.so.*' \) -exec patchelf --set-rpath '$ORIGIN' {} \;
  find "$DEST/plugins" -type f -name '*.so*' -exec patchelf --set-rpath '$ORIGIN/../../lib' {} \;
  cat > "$DEST/qt.conf" << 'EOF'
[Paths]
Prefix = .
Libraries = lib
Plugins = plugins
EOF
  cat > "$DEST/MusicBox.desktop" << 'EOF'
[Desktop Entry]
Type=Application
Name=Music Box
Comment=Local party music host
Exec=sh -c 'cd "$(dirname "$1")" && exec ./MusicBox' dummy %k
Icon=app-icon
Terminal=false
Categories=AudioVideo;Audio;Player;
StartupWMClass=Music Box
EOF
  chmod +x "$DEST/MusicBox.desktop"
  log "  MusicBox OK"
}

log "Building host window..."
ensure_linux_packages
ensure_cmake

python3 "$ROOT/scripts/generate-app-icon.py" "$ROOT/host-gui/assets"
if [[ "$(uname -s)" == "Darwin" ]]; then
  iconset="$ROOT/host-gui/assets/app-icon.iconset"
  rm -rf "$iconset"
  mkdir -p "$iconset"
  for spec in \
    "16 icon_16x16.png" "32 icon_16x16@2x.png" \
    "32 icon_32x32.png" "64 icon_32x32@2x.png" \
    "128 icon_128x128.png" "256 icon_128x128@2x.png" \
    "256 icon_256x256.png" "512 icon_256x256@2x.png" \
    "512 icon_512x512.png" "1024 icon_512x512@2x.png"; do
    set -- $spec
    sips -z "$1" "$1" "$ROOT/host-gui/assets/app-icon.png" --out "$iconset/$2" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$ROOT/host-gui/assets/app-icon.icns"
  rm -rf "$iconset"
fi

QT_PREFIX=""
if QT_PREFIX="$(find_qt)"; then
  :
else
  QT_PREFIX="$(install_qt)"
fi
if [[ ! -x "$QT_PREFIX/bin/qmake" ]]; then
  log "Qt prefix is not usable: $QT_PREFIX"
  exit 1
fi

cmake -S "$ROOT/host-gui" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$QT_PREFIX"
cmake --build "$BUILD_DIR" --parallel

case "$(uname -s)" in
  Darwin) deploy_macos "$QT_PREFIX" ;;
  Linux) deploy_linux "$QT_PREFIX" ;;
  *)
    log "Host window build is not implemented for $(uname -s). Use build-host-gui.ps1 on Windows."
    exit 1
    ;;
esac
