## Downloads

- **MusicBox-win64.zip** — portable Windows host. Распаковать и запустить `MusicBox.exe`.
- **MusicBox-macos-arm64.tar.gz** — portable macOS (Apple Silicon). Распаковать и открыть `MusicBox.app`.
- **MusicBox-linux-x64.tar.gz** — portable Linux x64. Распаковать и запустить `./MusicBox`. Если нет mpv: `sudo apt install mpv` (или `dnf` / `pacman`). Окну нужны libxcb, libxkbcommon и OpenGL из дистрибутива.
- **MusicBox-android.apk** — Android-хост (sideload). Гости подключаются по Wi‑Fi к тому же веб-UI.

В архивах для компьютера уже есть Node.js, интерфейс и yt-dlp. На Windows и macOS mpv тоже внутри.

## Notes

- Смените `adminPassword` в `config.json` (компьютер) или в Настройках (Android).
- Гостям — QR из админки / экрана хоста.
- Без интернета работают локальные файлы; YouTube/Spotify нужен интернет.

## Highlights

- Очередь с голосованием в реальном времени
- Ru | En
- Очередь сохраняется после перезапуска хоста
- Пороги кика/дизлайков можно менять без полного рестарта (Windows: правки `config.json`)
