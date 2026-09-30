#!/usr/bin/env bash
# Download yt-dlp and mpv into bin/ (or into the directory passed as $1).
# macOS: official mpv app bundle. Linux: distro package, then a symlink in bin/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${1:-$ROOT/bin}"
CACHE_DIR="$ROOT/release/.cache"
MPV_TAG="v0.41.0"

OS="$(uname -s)"
ARCH="$(uname -m)"

mkdir -p "$BIN_DIR" "$CACHE_DIR"

log() { printf '%s\n' "$*"; }

download() {
  local url="$1"
  local dest="$2"
  log "Downloading $url"
  curl -fL --retry 3 --retry-delay 2 -o "${dest}.partial" "$url"
  mv "${dest}.partial" "$dest"
}

clear_download_attrs() {
  local target="$1"
  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
  fi
}

sign_adhoc() {
  local target="$1"
  if [[ "$OS" == "Darwin" ]] && command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "$target" >/dev/null 2>&1 || true
  fi
}

ytdlp_url() {
  case "$OS" in
    Darwin)
      printf '%s\n' "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
      ;;
    Linux)
      local musl=0
      if [[ -f /etc/alpine-release ]]; then
        musl=1
      elif command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
        musl=1
      fi
      case "$ARCH" in
        aarch64|arm64)
          if [[ "$musl" == "1" ]]; then
            printf '%s\n' "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_musllinux_aarch64"
          else
            printf '%s\n' "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64"
          fi
          ;;
        x86_64|amd64)
          if [[ "$musl" == "1" ]]; then
            printf '%s\n' "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_musllinux"
          else
            printf '%s\n' "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
          fi
          ;;
        *)
          log "Unsupported Linux architecture: $ARCH"
          return 1
          ;;
      esac
      ;;
    *)
      log "Unsupported OS: $OS"
      return 1
      ;;
  esac
}

install_ytdlp() {
  local dest="$BIN_DIR/yt-dlp"
  if [[ -x "$dest" ]] && "$dest" --version >/dev/null 2>&1; then
    log "  yt-dlp OK ($dest)"
    return 0
  fi
  local url
  url="$(ytdlp_url)"
  download "$url" "$dest"
  chmod +x "$dest"
  clear_download_attrs "$dest"
  sign_adhoc "$dest"
  if ! "$dest" --version >/dev/null 2>&1; then
    log "  yt-dlp was downloaded but does not run: $dest"
    return 1
  fi
  log "  yt-dlp installed ($("$dest" --version))"
}

mpv_asset_name() {
  local major
  major="$(sw_vers -productVersion | cut -d. -f1)"
  case "$ARCH" in
    arm64|aarch64)
      if [[ "$major" -ge 26 ]]; then
        printf '%s\n' "mpv-${MPV_TAG}-macos-26-arm.zip"
      elif [[ "$major" -ge 15 ]]; then
        printf '%s\n' "mpv-${MPV_TAG}-macos-15-arm.zip"
      else
        printf '%s\n' "mpv-${MPV_TAG}-macos-14-arm.zip"
      fi
      ;;
    x86_64|amd64)
      printf '%s\n' "mpv-${MPV_TAG}-macos-15-intel.zip"
      ;;
    *)
      log "Unsupported macOS architecture: $ARCH"
      return 1
      ;;
  esac
}

first_match() {
  local needle="$1"
  shift
  local candidate=""
  while IFS= read -r candidate; do
    if [[ -n "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(find "$@" -print 2>/dev/null || true)
  return 1
}

write_mpv_wrapper() {
  cat > "$BIN_DIR/mpv" << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/mpv.app/Contents/MacOS/mpv" "$@"
EOF
  chmod +x "$BIN_DIR/mpv"
}

mpv_runs() {
  [[ -x "$BIN_DIR/mpv" ]] && "$BIN_DIR/mpv" --version >/dev/null 2>&1
}

install_mpv_macos() {
  if mpv_runs; then
    log "  mpv OK ($BIN_DIR/mpv)"
    return 0
  fi

  local asset zip tmp app
  asset="$(mpv_asset_name)"
  zip="$CACHE_DIR/$asset"
  if [[ ! -f "$zip" ]]; then
    download "https://github.com/mpv-player/mpv/releases/download/${MPV_TAG}/${asset}" "$zip"
  else
    log "  using cached $asset"
  fi

  tmp="$CACHE_DIR/mpv-extract"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  unzip -q "$zip" -d "$tmp"

  local nested=""
  nested="$(first_match mpv.tar.gz "$tmp" -type f -name 'mpv.tar.gz' || true)"
  if [[ -n "$nested" ]]; then
    tar -xzf "$nested" -C "$tmp"
  fi

  app="$(first_match mpv.app "$tmp" -type d -name 'mpv.app' || true)"
  if [[ -z "$app" || ! -f "$app/Contents/MacOS/mpv" ]]; then
    log "  mpv.app not found inside $asset"
    return 1
  fi

  rm -rf "$BIN_DIR/mpv.app"
  rm -f "$BIN_DIR/mpv"
  cp -R "$app" "$BIN_DIR/mpv.app"
  chmod +x "$BIN_DIR/mpv.app/Contents/MacOS/mpv"
  clear_download_attrs "$BIN_DIR/mpv.app"
  sign_adhoc "$BIN_DIR/mpv.app"
  write_mpv_wrapper

  if ! mpv_runs; then
    log "  mpv was extracted but does not run."
    log "  If macOS blocked it: System Settings → Privacy & Security → Open Anyway,"
    log "  then run this script again."
    return 1
  fi
  local ver
  ver=$("$BIN_DIR/mpv" --version || true)
  ver=${ver%%$'\n'*}
  log "  mpv installed ($ver)"
}

install_with_pkg_manager() {
  if [[ "${MUSICBOX_SKIP_SYSTEM_MPV:-}" == "1" ]]; then
    return 1
  fi
  if command -v mpv >/dev/null 2>&1; then
    return 0
  fi
  log "Installing mpv from the system package manager..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y mpv
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y mpv
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm mpv
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper --non-interactive install mpv
  elif command -v apk >/dev/null 2>&1; then
    sudo apk add mpv
  elif command -v brew >/dev/null 2>&1; then
    brew install mpv
  else
    log "  no supported package manager (apt, dnf, pacman, zypper, apk, brew)"
    return 1
  fi
  command -v mpv >/dev/null 2>&1
}

install_mpv_linux() {
  if mpv_runs; then
    log "  mpv OK ($BIN_DIR/mpv)"
    return 0
  fi
  if ! install_with_pkg_manager; then
    return 1
  fi
  local src
  src="$(command -v mpv)"
  ln -sfn "$src" "$BIN_DIR/mpv"
  if ! mpv_runs; then
    log "  mpv is installed at $src but bin/mpv does not run"
    return 1
  fi
  log "  mpv linked ($src)"
}

log "Music Box - Binary Setup"
log ""

if ! command -v curl >/dev/null 2>&1; then
  log "curl is required."
  exit 1
fi

ytdlp_ok=0
mpv_ok=0
install_ytdlp && ytdlp_ok=1
case "$OS" in
  Darwin)
    if ! command -v unzip >/dev/null 2>&1; then
      log "unzip is required to install mpv."
      exit 1
    fi
    install_mpv_macos && mpv_ok=1
    ;;
  Linux)
    install_mpv_linux && mpv_ok=1
    ;;
  *)
    log "Unsupported OS: $OS"
    exit 1
    ;;
esac

log ""
if [[ "$ytdlp_ok" != "1" ]]; then
  log "yt-dlp is missing. YouTube and Spotify links will not resolve."
  exit 1
fi
if [[ "$mpv_ok" != "1" ]]; then
  if [[ "$OS" == "Darwin" ]]; then
    log "mpv is missing. Playback will not work until bin/mpv runs."
    exit 1
  fi
  log "mpv is not installed. Playback stays disabled until mpv is on PATH."
  log "Install it with your package manager, then run this script again."
  if [[ "${MUSICBOX_MPV_OPTIONAL:-}" == "1" ]]; then
    exit 0
  fi
  exit 1
fi

log "Setup complete."
