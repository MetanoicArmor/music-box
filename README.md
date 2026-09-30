# Music Box

Локальный музыкальный плеер-голосовалка для тусовок. Сервер крутится на Windows, гости подключаются с телефонов по WiFi, добавляют треки и голосуют — очередь перестраивается в реальном времени. Музыка играет на колонках компьютера-хоста.

## Скриншоты

<p align="center">
  <img src="screenshots/Screenshot_20260831_155217.png" alt="Сейчас играет" width="280" />
  &nbsp;
  <img src="screenshots/Screenshot_20260831_143434.png" alt="Админ на телефоне" width="280" />
</p>

<p align="center">
  <img src="screenshots/2026-09-09_21-41-03.png" alt="Админ-панель в браузере" width="720" />
</p>

## Скачать

Готовые сборки: [последний релиз](https://github.com/MetanoicArmor/music-box/releases/latest)

| Платформа | Файл |
|-----------|------|
| Windows (portable) | [MusicBox-win64.zip](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-win64.zip) |
| macOS (Apple Silicon) | [MusicBox-macos-arm64.tar.gz](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-macos-arm64.tar.gz) |
| Linux x64 | [MusicBox-linux-x64.tar.gz](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-linux-x64.tar.gz) |
| Android (хост) | [MusicBox-android.apk](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-android.apk) |

## Быстрый старт

### Portable (для хоста, без установки Node.js)

Архив нужен только на ПК с колонками — гости подключаются с телефонов по Wi‑Fi.

1. Скачайте [MusicBox-win64.zip](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-win64.zip)
2. Распакуйте и запустите **`MusicBox.bat`**
3. Смените пароль в `config.json` (`adminPassword`)
4. Гостям — QR-код из админки (или ссылку из консоли)

Собрать архив самому (нужен Node.js):

```bash
npm run release            # Windows → ZIP, macOS/Linux → tar.gz текущей ОС
npm run release:linux      # Linux x64; с Mac — через Docker
npm run release:macos      # только на Mac
```

На macOS и Linux запуск собранной папки: `./start.sh` (на Mac ещё `MusicBox.command`).

### Из исходников (для разработки)

1. Установите [Node.js 20+](https://nodejs.org/)
2. Windows: дважды кликните `start.bat` (или `MusicBox.bat`). macOS/Linux: `./start.sh` (на Mac можно открыть `MusicBox.command`)
3. Смените пароль в `config.json` (`adminPassword`)
4. Гостям — QR из админки или Network-ссылка из консоли

## Возможности

- **Голосование** — ▲/▼ на каждом треке, автo-upvote при добавлении
- **Очередь** — сортировка по голосам, кик при -2 (настраивается)
- **Локальные файлы** — загрузка mp3/mp4 с телефона, работает **без интернета**
- **YouTube / Spotify** — по ссылке или поиску (нужен интернет)
- **Админ-панель** — удалить трек, удалить артиста целиком, бан IP, skip/pause, event mode
- **QR-код** — для быстрого подключения на open-air

## Конфигурация

Скопируйте `config.example.json` → `config.json`:

```json
{
  "port": 3000,
  "adminPassword": "changeme",
  "kickThreshold": -2,
  "voteRateLimit": 10,
  "voteRateWindowSec": 30,
  "maxUploadMb": 100,
  "eventMode": false
}
```

## Разработка

```bash
npm install
npm run dev          # сервер :3000 + клиент :5173
npm run build        # production build
npm start            # запуск production
npm run setup        # скачать mpv + yt-dlp (Windows, macOS, Linux)
npm run release      # portable-архив текущей ОС (release/)
npm run release:linux   # Linux x64, с Mac через Docker
```

Тег `v*` на GitHub запускает сборку всех четырёх файлов и публикует их в релиз. Обновить уже существующий релиз: Actions → Release → Run workflow.

## Open-air тусовка

1. Поднимите WiFi (роутер или hotspot с телефона)
2. Подключите ноутбук и колонки (AUX / Bluetooth)
3. Запустите `start.bat` (Windows) или `./start.sh` (macOS/Linux)
4. Раздайте гостям QR-код из админки (`/admin`)
5. Без интернета работают только загруженные mp3/mp4

### Firewall (если телефоны не видят сервер)

```powershell
netsh advfirewall firewall add rule name="Music Box" dir=in action=allow protocol=TCP localport=3000
```

## Android-хост

Телефон/планшет может быть хостом вместо Windows-ПК: гости по-прежнему открывают тот же веб-UI по Wi‑Fi.

Скачать APK: [MusicBox-android.apk](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-android.apk) (sideload).

Собрать самому:

```bash
npm run build:android
```

APK: `android/app/build/outputs/apk/release/app-release.apk`. Нужны JDK 17 и Android SDK (`ANDROID_HOME`).

В приложении: **Старт** → раздайте QR. Музыка играет на динамике/Bluetooth хоста. Без интернета работают только загруженные файлы.

Локальная библиотека на телефоне: **Music/MusicBox** (в проводнике Windows по USB: внутренняя память → `Music` → `MusicBox`). После копирования файлов запустите хост или откройте вкладку «Добавить».

## Зависимости

- **Node.js 20+** — сервер и UI (в portable-архив кладётся Node.js 22)
- **mpv** — воспроизведение (`npm run setup`: Windows через winget, macOS — официальная сборка в `bin/`, Linux — пакет дистрибутива)
- **yt-dlp** — YouTube/Spotify резолв (скачивается через `npm run setup`)

Если mpv не встал сам: Windows — `winget install shinchiro.mpv`; Linux — `sudo apt install mpv` (или `dnf` / `pacman`). `start.bat` / `./start.sh` вызывают установку сами.

## Структура

```
music-box/
├── start.bat           # запуск на Windows
├── start.sh            # запуск на macOS и Linux
├── stop.bat            # остановка на Windows
├── stop.sh             # остановка на macOS и Linux
├── config.json         # настройки
├── server/             # Fastify API + WebSocket + mpv
├── client/             # React UI
├── android/            # Kotlin-хост (Ktor + ExoPlayer)
├── media/              # загруженные файлы
├── data/               # SQLite база
└── bin/                # mpv и yt-dlp (на Windows — .exe)
```

## Лицензия

© 2026 Vade (MetanoicArmor). All rights reserved.
