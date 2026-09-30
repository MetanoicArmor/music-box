#!/bin/bash
cd "$(cd "$(dirname "$0")" && pwd)"
if [[ "$(uname -s)" == "Darwin" && -d "MusicBox.app" ]]; then
  open "./MusicBox.app"
  exit 0
fi
if [[ -x "./MusicBox" ]]; then
  exec ./MusicBox
fi
exec bash ./start.sh
