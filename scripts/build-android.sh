#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID="$ROOT/android"

if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME}/bin/java" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]] && /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
    JAVA_HOME="$(/usr/libexec/java_home -v 17)"
    export JAVA_HOME
  fi
fi
if ! command -v java >/dev/null 2>&1; then
  printf 'JDK 17 not found. Install it and set JAVA_HOME.\n' >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "${HOME}/Android/Sdk" ]]; then
    ANDROID_HOME="${HOME}/Android/Sdk"
  elif [[ -d "${HOME}/Library/Android/sdk" ]]; then
    ANDROID_HOME="${HOME}/Library/Android/sdk"
  fi
  export ANDROID_HOME
fi
if [[ -z "${ANDROID_HOME:-}" || ! -d "${ANDROID_HOME}" ]]; then
  printf 'ANDROID_HOME is not set.\n' >&2
  exit 1
fi

printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ANDROID/local.properties"
chmod +x "$ANDROID/gradlew"
(cd "$ANDROID" && ./gradlew assembleRelease --no-daemon)

APK="$ANDROID/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK" ]]; then
  printf 'APK was not produced: %s\n' "$APK" >&2
  exit 1
fi
mkdir -p "$ROOT/release"
cp "$APK" "$ROOT/release/MusicBox-android.apk"
printf 'Android APK: %s\n' "$ROOT/release/MusicBox-android.apk"
