<p align="center">
  <a href="README.md">Русский</a> · <strong>English</strong>
</p>

<p align="center">
  <img src="host-gui/assets/app-icon.png" alt="Music Box" width="160" />
</p>

# Music Box

A local music player with voting, for parties. The computer connected to the speakers opens a host window. Guests join from their phones over Wi‑Fi, add tracks, and vote — the queue reorders in real time. The music plays on that computer.

Guests always open the site in a browser. The host window is available for Windows, macOS, and Linux. A phone can be the host too, through a separate Android app. The icon is the same on every platform.

## Screenshots

<p align="center">
  <img src="screenshots/1.png" alt="Host window: now playing and the queue" width="720" />
</p>

<p align="center">
  <img src="screenshots/2.png" alt="Host window: add a track and the local library" width="720" />
</p>

<p align="center">
  <img src="screenshots/3.png" alt="Guest site: now playing" width="280" />
  &nbsp;
  <img src="screenshots/4.png" alt="Admin on a phone" width="280" />
</p>

## Download

Builds: [latest release](https://github.com/MetanoicArmor/music-box/releases/latest)

| Platform | File | How to start |
|-----------|------|--------|
| Windows | [MusicBox-win64.zip](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-win64.zip) | `MusicBox.exe` |
| macOS (Apple Silicon) | [MusicBox-macos-arm64.tar.gz](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-macos-arm64.tar.gz) | `MusicBox.app` |
| Linux x64 | [MusicBox-linux-x64.tar.gz](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-linux-x64.tar.gz) | `./MusicBox` |
| Linux x64 (AppImage) | [MusicBox-linux-x64.AppImage](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-linux-x64.AppImage) | make it executable and run it |
| Android (host) | [MusicBox-android.apk](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-android.apk) | install the APK |

## Quick start

The archive is only needed on the computer with the speakers. Node.js does not need to be installed: it is already inside.

1. Download the archive for your system from the table above and unpack it.
2. Start the host window: **`MusicBox.exe`**, **`MusicBox.app`**, **`./MusicBox`**, or the AppImage.
3. Change the password on the Settings tab, or in `config.json`, field `adminPassword`.
4. Show guests the QR code from the window. They open the site in a browser. The music plays on this computer.

Closing the window stops the server and quits the program. The tray menu also has Quit. Without the window: `stop.bat` / `./stop.sh`.

On macOS, if the system will not open the app, right-click `MusicBox.app` and choose Open. On Linux the window needs libraries from the distro (Qt itself is already in the archive):

```bash
sudo apt install libxcb-cursor0 libxkbcommon0 libgl1 libfontconfig1 libdbus-1-3
sudo pacman -S --needed xcb-util-cursor libxkbcommon mesa fontconfig dbus
sudo dnf install libxkbcommon xcb-util-cursor mesa-libGL fontconfig dbus-libs
```

Console without the window: `start.bat` or `./start.sh`.

## Host window

The window replaces the console and the browser admin page for the person at the speakers. The language switches in Settings: **Ru** / **En**. The choice is remembered. The guest site switches separately, with its own button in the header.

**Host**

- Now playing: pause, previous, next, stop, seek
- Queue and history: score, duration, who added it, delete a track or an artist, restore from history, clear
- Search the history
- Ban and unban an IP
- QR code centered at the bottom, the `http://LAN:port` link, the number of guests online, and an Open site button
- Right-click a track: play it here, download, delete, ban

**Add**

- A YouTube / Spotify link, or a search by title
- The local library on this computer
- A drop zone: drag a file or click and choose one. The same formats as the site: mp3, m4a, flac, wav, ogg, and other audio

In event mode, adding and uploading are off. Only voting remains.

**Settings**

Password, port, kick thresholds, vote limit, upload size, maximum track length, event mode, language. The port and password apply after the server restarts from the window. Vote thresholds apply immediately.

**Log**

Admin actions and the server output.

## Features

- **Voting** — ▲/▼ on every track, an automatic upvote when a track is added
- **Queue** — sorted by votes, kicked at −2 (configurable)
- **Local files** — upload from a phone or drop a file in the host window, works **without internet**
- **YouTube / Spotify** — by link or by search (needs internet)
- **Admin** — delete a track, delete a whole artist, ban an IP, skip / pause, event mode, history
- **QR code** — so guests can join from a phone

## Configuration

The first launch copies `config.example.json`. The `config.json` file:

```json
{
  "port": 3000,
  "adminPassword": "changeme",
  "kickThreshold": -2,
  "playingKickDislikes": 3,
  "voteRateLimit": 10,
  "voteRateWindowSec": 30,
  "maxUploadMb": 100,
  "maxTrackMinutes": 10,
  "eventMode": false
}
```

`maxTrackMinutes: 0` removes the length limit. `eventMode: true` leaves guests with voting only, and they cannot add tracks. `playingKickDislikes` is how many dislikes it takes to skip the track that is already playing.

## Development

```bash
npm install
npm run dev             # server :3000 + client :5173
npm run build           # production build
npm start               # run the production build
npm run setup           # download mpv + yt-dlp
npm run release         # archive for this OS, including the host window
npm run release:linux   # Linux x64; from a Mac and from Arch/Fedora, via Docker
npm run release:macos   # Mac only
npm run build:android   # host APK
```

To develop without the window: `start.bat` on Windows and `./start.sh` on macOS/Linux. The window is built by `npm run release` (CMake and a compiler are required; the script downloads Qt 6.9.3 if it is missing). The version number comes from the `VERSION` file.

A `v*` tag on GitHub builds Windows, macOS, Linux, and Android and publishes them to a release. The tag must match `VERSION` (`v1.1.0` when the file says `1.1.0`). To update a release that already exists: Actions → Release → Run workflow.

## Open-air party

1. Bring up Wi‑Fi (a router or a phone hotspot)
2. Connect the computer and the speakers (AUX / Bluetooth)
3. Start `MusicBox.exe`, `MusicBox.app`, or `./MusicBox`
4. Hand guests the QR code from the host window
5. Without internet, only uploaded files work

If phones cannot open the page:

```powershell
netsh advfirewall firewall add rule name="Music Box" dir=in action=allow protocol=TCP localport=3000
```

```bash
sudo ufw allow 3000/tcp
```

On macOS: System Settings → Network → Firewall → allow incoming connections for the app.

## Android host

A phone or tablet can be the host instead of a computer. Guests still open the same site over Wi‑Fi. The app icon matches the window on the computer.

Download the APK: [MusicBox-android.apk](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-android.apk) (sideload).

Build it yourself:

```bash
npm run build:android
```

APK: `android/app/build/outputs/apk/release/app-release.apk`. JDK 17 and the Android SDK (`ANDROID_HOME`) are required.

In the app: **Start**, then share the QR code. Music plays on the host's speaker or Bluetooth. Without internet, only uploaded files work.

The local library on the phone is **Music/MusicBox** (over USB in Windows Explorer: internal storage → `Music` → `MusicBox`). After copying files, start the host or open the Add tab.

## Dependencies

- **Node.js 20+** — server and site. The desktop archive includes Node.js 22
- **Qt 6.9** — host window. It is bundled in the archive, and `npm run release` downloads it when needed
- **mpv** — playback (`npm run setup`: Windows via winget, macOS as a build in `bin/`, Linux from the distro package)
- **yt-dlp** — YouTube and Spotify (downloaded by `npm run setup`)

If mpv does not install on its own: on Windows, `winget install shinchiro.mpv`; on Linux, `sudo apt install mpv` (or `dnf` / `pacman`). `start.bat` and `./start.sh` run the install themselves.

## Layout

```
music-box/
├── VERSION             # version number for every build
├── MusicBox.bat        # Windows: MusicBox.exe, otherwise start.bat
├── MusicBox.command    # macOS: MusicBox.app, otherwise ./MusicBox
├── start.bat           # console on Windows
├── start.sh            # console on macOS and Linux
├── stop.bat            # stop on Windows
├── stop.sh             # stop on macOS and Linux
├── config.json         # settings
├── host-gui/           # host window (Qt 6)
├── server/             # Fastify API + WebSocket + mpv
├── client/             # guest site (React)
├── android/            # Android host
├── media/              # uploaded files
├── data/               # SQLite
└── bin/                # mpv and yt-dlp
```

## License

© 2026 Vade (MetanoicArmor). All rights reserved.
