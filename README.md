# Music Box

Локальный музыкальный плеер-голосовалка для тусовок. На компьютере с колонками открывается окно хоста, гости подключаются с телефонов по Wi‑Fi, добавляют треки и голосуют — очередь перестраивается в реальном времени. Музыка играет на этом компьютере.

Гости всегда открывают сайт в браузере. Окно хоста есть для Windows, macOS и Linux. Телефон тоже может быть хостом — отдельное Android-приложение.

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

| Платформа | Файл | Запуск |
|-----------|------|--------|
| Windows | [MusicBox-win64.zip](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-win64.zip) | `MusicBox.exe` |
| macOS (Apple Silicon) | [MusicBox-macos-arm64.tar.gz](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-macos-arm64.tar.gz) | `MusicBox.app` |
| Linux x64 | [MusicBox-linux-x64.tar.gz](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-linux-x64.tar.gz) | `./MusicBox` |
| Android (хост) | [MusicBox-android.apk](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-android.apk) | установить APK |

## Быстрый старт

Архив нужен только на компьютере с колонками. Node.js ставить не нужно: он уже внутри.

1. Скачайте архив своей системы из таблицы выше и распакуйте его.
2. Запустите окно хоста: **`MusicBox.exe`**, **`MusicBox.app`** или **`./MusicBox`**.
3. Смените пароль в окне (вкладка «Настройки») или в `config.json`, поле `adminPassword`.
4. Покажите гостям QR из окна. Они открывают сайт в браузере, музыка играет на этом компьютере.

Закрытие окна (крестик) останавливает сервер и выходит. В трее тоже есть «Выход». Без окна: `stop.bat` / `./stop.sh`.

На macOS, если система не даёт открыть приложение, щёлкните `MusicBox.app` правой кнопкой и выберите «Открыть». На Linux окну нужны библиотеки дистрибутива (сам Qt уже в архиве):

```bash
sudo apt install libxcb-cursor0 libxkbcommon0 libgl1 libfontconfig1 libdbus-1-3
```

Консоль без окна: `start.bat` или `./start.sh`.

## Окно хоста

Окно заменяет консоль и браузерную админку для человека у колонок.

- Сейчас играет: пауза, предыдущий, следующий, стоп, перемотка
- Очередь: счёт голосов, удалить трек, очистить очередь
- QR, ссылка `http://LAN:port`, число гостей online, кнопка «Открыть сайт»
- Настройки из `config.json`: пароль, порт, пороги кика, лимиты голосов, event mode
- Бан IP и журнал действий

Порт и пароль применяются после перезапуска сервера из окна. Пороги голосов подхватываются сразу.

## Возможности

- **Голосование** — ▲/▼ на каждом треке, авто-upvote при добавлении
- **Очередь** — сортировка по голосам, кик при -2 (настраивается)
- **Локальные файлы** — загрузка mp3/mp4 с телефона, работает **без интернета**
- **YouTube / Spotify** — по ссылке или поиску (нужен интернет)
- **Админ-панель** — удалить трек, удалить артиста целиком, бан IP, skip/pause, event mode
- **QR-код** — для быстрого подключения на open-air

## Конфигурация

При первом запуске берётся `config.example.json`. Файл `config.json`:

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

`maxTrackMinutes: 0` снимает ограничение длины. `eventMode: true` оставляет гостям только голосование, без добавления треков.

## Разработка

```bash
npm install
npm run dev             # сервер :3000 + клиент :5173
npm run build           # production build
npm start               # запуск production
npm run setup           # скачать mpv + yt-dlp
npm run release         # архив текущей ОС, вместе с окном хоста
npm run release:linux   # Linux x64; с Mac — через Docker
npm run release:macos   # только на Mac
```

Для разработки без окна: `start.bat` на Windows и `./start.sh` на macOS/Linux. Окно собирается командой `npm run release` (CMake и компилятор нужны на машине; Qt 6.8.3 скрипт скачает сам, если его нет).

Тег `v*` на GitHub собирает Windows, macOS, Linux и Android и публикует их в релиз. Обновить уже существующий релиз: Actions → Release → Run workflow.

## Open-air тусовка

1. Поднимите Wi‑Fi (роутер или hotspot с телефона)
2. Подключите компьютер и колонки (AUX / Bluetooth)
3. Запустите `MusicBox.exe`, `MusicBox.app` или `./MusicBox`
4. Раздайте гостям QR из окна хоста
5. Без интернета работают только загруженные mp3/mp4

Если телефоны не открывают страницу:

```powershell
netsh advfirewall firewall add rule name="Music Box" dir=in action=allow protocol=TCP localport=3000
```

```bash
sudo ufw allow 3000/tcp
```

На macOS: Системные настройки → Сеть → Файрвол → разрешить входящие для приложения.

## Android-хост

Телефон или планшет может быть хостом вместо компьютера. Гости по-прежнему открывают тот же сайт по Wi‑Fi.

Скачать APK: [MusicBox-android.apk](https://github.com/MetanoicArmor/music-box/releases/latest/download/MusicBox-android.apk) (sideload).

Собрать самому:

```bash
npm run build:android
```

APK: `android/app/build/outputs/apk/release/app-release.apk`. Нужны JDK 17 и Android SDK (`ANDROID_HOME`).

В приложении: **Старт** → раздайте QR. Музыка играет на динамике или Bluetooth хоста. Без интернета работают только загруженные файлы.

Локальная библиотека на телефоне: **Music/MusicBox** (по USB в проводнике Windows: внутренняя память → `Music` → `MusicBox`). После копирования файлов запустите хост или откройте вкладку «Добавить».

## Зависимости

- **Node.js 20+** — сервер и сайт. В архив для компьютера кладётся Node.js 22
- **Qt 6.8** — окно хоста. В архив попадает само, для `npm run release` скачивается при необходимости
- **mpv** — воспроизведение (`npm run setup`: Windows через winget, macOS — сборка в `bin/`, Linux — пакет дистрибутива)
- **yt-dlp** — YouTube и Spotify (скачивается через `npm run setup`)

Если mpv не встал сам: Windows — `winget install shinchiro.mpv`; Linux — `sudo apt install mpv` (или `dnf` / `pacman`). `start.bat` и `./start.sh` вызывают установку сами.

## Структура

```
music-box/
├── MusicBox.bat        # Windows: MusicBox.exe, иначе start.bat
├── MusicBox.command    # macOS: MusicBox.app, иначе ./MusicBox
├── start.bat           # консоль на Windows
├── start.sh            # консоль на macOS и Linux
├── stop.bat            # остановка на Windows
├── stop.sh             # остановка на macOS и Linux
├── config.json         # настройки
├── host-gui/           # окно хоста (Qt 6)
├── server/             # Fastify API + WebSocket + mpv
├── client/             # сайт для гостей (React)
├── android/            # Android-хост (Ktor + ExoPlayer)
├── media/              # загруженные файлы
├── data/               # SQLite
└── bin/                # mpv и yt-dlp
```

## Лицензия

© 2026 Vade (MetanoicArmor). All rights reserved.
