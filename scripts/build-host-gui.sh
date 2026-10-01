#!/usr/bin/env bash
# Build the Qt host window into the portable folder.
# macOS: MusicBox.app
# Linux: MusicBox binary plus Qt libraries in lib/ and plugins/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-}"
QT_VERSION="6.9.3"
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

have_lib() {
  local listing
  listing="$(ldconfig -p 2>/dev/null || true)"
  [[ "$listing" == *"$1 "* ]]
}

libs_missing() {
  local listing
  listing="$(ldd "$1" 2>/dev/null || true)"
  [[ "$listing" == *"not found"* ]]
}

ensure_linux_packages() {
  [[ "$(uname -s)" == "Linux" ]] || return 0

  local pm=""
  if command -v apt-get >/dev/null 2>&1; then
    pm="apt"
  elif command -v pacman >/dev/null 2>&1; then
    pm="pacman"
  elif command -v dnf >/dev/null 2>&1; then
    pm="dnf"
  fi

  local -A need=()
  command -v cmake >/dev/null 2>&1 || need[cmake]=1
  command -v g++ >/dev/null 2>&1 || need[compiler]=1
  command -v make >/dev/null 2>&1 || need[compiler]=1
  command -v patchelf >/dev/null 2>&1 || need[patchelf]=1
  command -v python3 >/dev/null 2>&1 || need[python]=1
  if ! python3 -c 'import venv' >/dev/null 2>&1; then
    need[python]=1
  fi
  have_lib "libGL.so.1" || need[gl]=1
  have_lib "libxkbcommon.so.0" || need[xkb]=1
  have_lib "libxcb-cursor.so.0" || need[cursor]=1
  have_lib "libfontconfig.so.1" || need[font]=1
  have_lib "libdbus-1.so.3" || need[dbus]=1

  if [[ ${#need[@]} -eq 0 ]]; then
    return 0
  fi
  if [[ -z "$pm" ]]; then
    log "Missing build dependencies: ${!need[*]}"
    log "Install cmake, g++, make, patchelf, python3, plus OpenGL, libxkbcommon, libxcb-cursor, fontconfig and dbus."
    exit 1
  fi

  local -a pkgs=()
  local key
  for key in "${!need[@]}"; do
    case "$pm:$key" in
      apt:cmake) pkgs+=(cmake) ;;
      apt:compiler) pkgs+=(g++ make) ;;
      apt:patchelf) pkgs+=(patchelf) ;;
      apt:python) pkgs+=(python3 python3-venv) ;;
      apt:gl) pkgs+=(libgl1 libgl1-mesa-dev) ;;
      apt:xkb) pkgs+=(libxkbcommon0 libxkbcommon-dev) ;;
      apt:cursor) pkgs+=(libxcb-cursor0) ;;
      apt:font) pkgs+=(libfontconfig1) ;;
      apt:dbus) pkgs+=(libdbus-1-3) ;;
      pacman:cmake) pkgs+=(cmake) ;;
      pacman:compiler) pkgs+=(gcc make) ;;
      pacman:patchelf) pkgs+=(patchelf) ;;
      pacman:python) pkgs+=(python) ;;
      pacman:gl) pkgs+=(mesa) ;;
      pacman:xkb) pkgs+=(libxkbcommon) ;;
      pacman:cursor) pkgs+=(xcb-util-cursor) ;;
      pacman:font) pkgs+=(fontconfig) ;;
      pacman:dbus) pkgs+=(dbus) ;;
      dnf:cmake) pkgs+=(cmake) ;;
      dnf:compiler) pkgs+=(gcc-c++ make) ;;
      dnf:patchelf) pkgs+=(patchelf) ;;
      dnf:python) pkgs+=(python3) ;;
      dnf:gl) pkgs+=(mesa-libGL) ;;
      dnf:xkb) pkgs+=(libxkbcommon) ;;
      dnf:cursor) pkgs+=(xcb-util-cursor) ;;
      dnf:font) pkgs+=(fontconfig) ;;
      dnf:dbus) pkgs+=(dbus-libs) ;;
    esac
  done

  log "Installing packages: ${pkgs[*]}"
  run_root() {
    if [[ "$(id -u)" -eq 0 ]]; then
      "$@"
    elif command -v sudo >/dev/null 2>&1; then
      sudo "$@"
    else
      log "sudo is required to install: ${pkgs[*]}"
      exit 1
    fi
  }
  case "$pm" in
    apt)
      run_root apt-get update
      run_root apt-get install -y --no-install-recommends "${pkgs[@]}"
      ;;
    pacman)
      run_root pacman -S --needed --noconfirm "${pkgs[@]}"
      ;;
    dnf)
      run_root dnf install -y "${pkgs[@]}"
      ;;
  esac
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
    # pip writes its progress to stdout. The caller captures this function's
    # stdout as the Qt path, so the install log has to stay on stderr.
    "$venv/bin/pip" install --disable-pip-version-check "aqtinstall==3.1.19" >&2
  fi
  log "Downloading Qt $QT_VERSION..."
  "$venv/bin/aqt" install-qt "$host" desktop "$QT_VERSION" "$arch" -O "$out" --internal >&2
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

  local args=(-always-overwrite)
  # Qt 6.9 macdeployqt does not know -no-codesign. Newer Qt does, and skipping
  # its own signature avoids a broken ad-hoc sign on Homebrew's split libraries.
  if "$qt/bin/macdeployqt" -h 2>&1 | grep -q -- '-no-codesign'; then
    args+=(-no-codesign)
  fi
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

qmake_is_qt6() {
  local ver
  ver="$("$1" -query QT_VERSION 2>/dev/null || true)"
  [[ "$ver" == 6.* ]]
}

qt_qmake() {
  local prefix="$1"
  local candidate
  # Arch keeps Qt 5 at /usr/bin/qmake and Qt 6 at qmake6. Same prefix, different plugins.
  for candidate in \
    "$prefix/bin/qmake6" \
    "$prefix/lib/qt6/bin/qmake6" \
    "$prefix/lib/qt6/bin/qmake"; do
    if [[ -x "$candidate" ]] && qmake_is_qt6 "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  if command -v qmake6 >/dev/null 2>&1 && qmake_is_qt6 "$(command -v qmake6)"; then
    command -v qmake6
    return 0
  fi
  for candidate in "$prefix/bin/qmake" "$(command -v qmake 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]] && qmake_is_qt6 "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

deploy_linux() {
  local qt="$1"
  local qmake="$2"
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

  # The release binary's RPATH points at ./lib, which is still empty.
  # Official Qt is not on the linker path inside Docker, so ldd only sees
  # those libraries when the Qt prefix is added for the scan.
  local qt_libs
  qt_libs="$("$qmake" -query QT_INSTALL_LIBS)"
  export LD_LIBRARY_PATH="${qt_libs}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

  # Distro Qt lives in /usr/lib next to glibc. Copying that directory
  # produces a binary that loads its own libc and does not start.
  # Bundle Qt itself, plus libraries shipped inside a private Qt prefix.
  local private=0
  case "$qt" in
    /|/usr|/usr/lib|/usr/lib64|/usr/lib/*) private=0 ;;
    *) private=1 ;;
  esac

  never_bundle() {
    case "$1" in
      linux-vdso.so*|ld-linux*.so*|libc.so*|libm.so*|libdl.so*|librt.so*|libpthread.so*|libresolv.so*|libutil.so*|libnss_*.so*|libnsl.so*|libstdc++.so*|libgcc_s.so*|libgomp.so*)
        return 0
        ;;
    esac
    return 1
  }

  should_bundle() {
    local path="$1"
    local base
    base="$(basename "$path")"
    if never_bundle "$base"; then
      return 1
    fi
    case "$base" in
      libQt6*.so*) return 0 ;;
    esac
    [[ "$private" == "1" && "$path" == "$qt"/* ]]
  }

  local plugins_root pattern src real dest_dir
  plugins_root="$("$qmake" -query QT_INSTALL_PLUGINS)"
  local plug
  for plug in platforms imageformats tls xcbglintegrations platforminputcontexts iconengines wayland-shell-integration wayland-decoration-client; do
    [[ -d "$plugins_root/$plug" ]] || continue
    dest_dir="$DEST/plugins/$plug"
    mkdir -p "$dest_dir"
    case "$plug" in
      platforminputcontexts|wayland-shell-integration|wayland-decoration-client) pattern='*.so' ;;
      *) pattern='libq*.so' ;;
    esac
    while IFS= read -r src; do
      [[ -n "$src" ]] || continue
      if libs_missing "$src"; then
        local missing_line
        log "Skipping $(basename "$src"): a library it needs is not installed"
        while IFS= read -r missing_line; do
          [[ "$missing_line" == *"not found"* ]] && log "  $missing_line"
        done < <(ldd "$src" 2>/dev/null || true)
        continue
      fi
      real="$(readlink -f "$src")"
      cp -a "$real" "$dest_dir/$(basename "$real")"
    done < <(find "$plugins_root/$plug" -maxdepth 1 \( -type f -o -type l \) -name "$pattern")
  done

  local -A seen=()
  local -a queue=()
  local missing=0

  bundle_file() {
    local src="$1"
    local real base soname
    real="$(readlink -f "$src")"
    [[ -n "$real" && -f "$real" ]] || return 0
    # ldd of an already bundled library resolves siblings inside DEST/lib.
    if [[ "$real" == "$DEST/lib/"* ]]; then
      return 0
    fi
    if ! should_bundle "$real"; then
      return 0
    fi
    if [[ -n "${seen[$real]:-}" ]]; then
      return 0
    fi
    seen["$real"]=1
    base="$(basename "$real")"
    cp -a "$real" "$DEST/lib/$base"
    soname="$(patchelf --print-soname "$DEST/lib/$base" 2>/dev/null || true)"
    if [[ -n "$soname" && "$soname" != "$base" ]]; then
      ln -sfn "$base" "$DEST/lib/$soname"
    fi
    queue+=("$DEST/lib/$base")
  }

  scan_deps() {
    local file="$1"
    local line path
    while IFS= read -r line; do
      if [[ "$line" == *"not found"* ]]; then
        log "Missing library for $(basename "$file"): ${line#"${line%%[![:space:]]*}"}"
        missing=1
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]*([^[:space:]]+)[[:space:]]=\>[[:space:]]([^[:space:]]+) ]]; then
        path="${BASH_REMATCH[2]}"
        bundle_file "$path"
      fi
    done < <(ldd "$file" 2>/dev/null || true)
  }

  queue=("$DEST/MusicBox")
  while IFS= read -r src; do
    [[ -n "$src" ]] && queue+=("$src")
  done < <(find "$DEST/plugins" -type f -name '*.so')

  local index=0
  while [[ "$index" -lt ${#queue[@]} ]]; do
    scan_deps "${queue[$index]}"
    index=$((index + 1))
  done
  if [[ "$missing" != "0" ]]; then
    log "Refusing to package MusicBox with missing libraries."
    exit 1
  fi

  patchelf --set-rpath '$ORIGIN/lib' "$DEST/MusicBox"
  find "$DEST/lib" -type f -name 'lib*.so*' -exec patchelf --set-rpath '$ORIGIN' {} +
  find "$DEST/plugins" -type f -name '*.so' -exec patchelf --set-rpath '$ORIGIN/../../lib' {} +
  if libs_missing "$DEST/MusicBox"; then
    log "MusicBox still has missing libraries:"
    ldd "$DEST/MusicBox" >&2 || true
    exit 1
  fi
  if [[ ! -f "$DEST/plugins/platforms/libqxcb.so" ]] || libs_missing "$DEST/plugins/platforms/libqxcb.so"; then
    log "Qt xcb platform plugin was not packaged."
    exit 1
  fi
  local xcb_deps
  xcb_deps="$(ldd "$DEST/plugins/platforms/libqxcb.so" 2>/dev/null || true)"
  if [[ "$xcb_deps" != *libQt6Gui.so* ]]; then
    log "Packaged xcb plugin is not Qt 6."
    exit 1
  fi
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

# Keep the last absolute path. Installers sometimes print logs on stdout.
qt_prefix_from() {
  local line path=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ "$line" == /* ]] && path="$line"
  done
  printf '%s\n' "$path"
}

QT_PREFIX=""
if found="$(find_qt)"; then
  QT_PREFIX="$(printf '%s\n' "$found" | qt_prefix_from)"
else
  QT_PREFIX="$(install_qt | qt_prefix_from)"
fi
if [[ -z "$QT_PREFIX" || ! -d "$QT_PREFIX" ]]; then
  log "Qt prefix is not usable: ${QT_PREFIX:-<empty>}"
  exit 1
fi
QMAKE="$(qt_qmake "$QT_PREFIX")" || {
  log "Qt prefix is not usable: $QT_PREFIX"
  exit 1
}

cmake -S "$ROOT/host-gui" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$QT_PREFIX"
cmake --build "$BUILD_DIR" --parallel

case "$(uname -s)" in
  Darwin) deploy_macos "$QT_PREFIX" ;;
  Linux) deploy_linux "$QT_PREFIX" "$QMAKE" ;;
  *)
    log "Host window build is not implemented for $(uname -s). Use build-host-gui.ps1 on Windows."
    exit 1
    ;;
esac
