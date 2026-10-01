#!/usr/bin/env bash
# Pack a Linux release directory into an AppImage.
#   bash scripts/build-appimage.sh <release-dir> <output.appimage>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-}"
OUTPUT="${2:-}"

if [[ -z "$SRC" || -z "$OUTPUT" || ! -d "$SRC" ]]; then
  echo "Usage: build-appimage.sh <release-dir> <output.appimage>" >&2
  exit 1
fi
if [[ ! -x "$SRC/MusicBox" ]]; then
  echo "MusicBox binary is missing in $SRC" >&2
  exit 1
fi

log() { printf '%s\n' "$*" >&2; }

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    log "sudo is required to install squashfs-tools"
    exit 1
  fi
}

ensure_mksquashfs() {
  command -v mksquashfs >/dev/null 2>&1 && return 0
  if command -v apt-get >/dev/null 2>&1; then
    run_root apt-get update
    run_root apt-get install -y --no-install-recommends squashfs-tools
  elif command -v pacman >/dev/null 2>&1; then
    run_root pacman -S --needed --noconfirm squashfs-tools
  elif command -v dnf >/dev/null 2>&1; then
    run_root dnf install -y squashfs-tools
  else
    log "mksquashfs is required (package squashfs-tools)."
    exit 1
  fi
}

runtime_name() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s\n' runtime-x86_64 ;;
    aarch64|arm64) printf '%s\n' runtime-aarch64 ;;
    *)
      log "No AppImage runtime for $(uname -m)."
      exit 1
      ;;
  esac
}

ensure_runtime() {
  local name="$1"
  local cache="$ROOT/release/.cache"
  local file="$cache/$name"
  mkdir -p "$cache"
  if [[ -x "$file" ]]; then
    printf '%s\n' "$file"
    return 0
  fi
  log "Downloading AppImage runtime..."
  curl -fL --retry 3 --retry-delay 2 -o "$file.partial" \
    "https://github.com/AppImage/type2-runtime/releases/download/continuous/${name}"
  chmod +x "$file.partial"
  mv "$file.partial" "$file"
  printf '%s\n' "$file"
}

ensure_mksquashfs
runtime="$(ensure_runtime "$(runtime_name)")"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
appdir="$stage/AppDir"
mkdir -p "$appdir"
cp -a "$SRC"/. "$appdir/"
rm -rf "$appdir/data" "$appdir/media" "$appdir/config.json" "$appdir/MusicBox.desktop"

cp "$ROOT/host-gui/assets/app-icon.png" "$appdir/musicbox.png"
ln -s musicbox.png "$appdir/.DirIcon"
cat > "$appdir/musicbox.desktop" << 'EOF'
[Desktop Entry]
Type=Application
Name=Music Box
Comment=Local party music host
Exec=MusicBox
Icon=musicbox
Categories=AudioVideo;Audio;
Terminal=false
StartupWMClass=Music Box
EOF
cat > "$appdir/AppRun" << 'EOF'
#!/bin/sh
set -eu
here=$(dirname "$(readlink -f "$0")")
cd "$here"
exec "$here/MusicBox" "$@"
EOF
chmod +x "$appdir/AppRun" "$appdir/MusicBox"

squash="$stage/app.squashfs"
mksquashfs "$appdir" "$squash" -all-root -noappend -comp gzip -no-progress >/dev/null
mkdir -p "$(dirname "$OUTPUT")"
cat "$runtime" "$squash" > "$OUTPUT"
chmod +x "$OUTPUT"
log "AppImage: $OUTPUT"
