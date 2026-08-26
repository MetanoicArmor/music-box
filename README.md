# Music Box

Локальный музыкальный голосовалка для тусовок. Сервер крутится на Windows, гости подключаются с телефонов по WiFi, добавляют треки и голосуют — очередь перестраивается в реальном времени. Музыка играет на колонках компьютера-хоста.

## Быстрый старт

### Portable (для хоста, без установки Node.js)

Архив нужен только на ПК с колонками — гости подключаются с телефонов по Wi‑Fi.

1. Соберите архив: `npm run release` (Node.js нужен только при сборке)
2. На хосте: распаковать `release/MusicBox-win64.zip` → запустить **`MusicBox.bat`**
3. Смените пароль в `config.json` (`adminPassword`)
4. Гостям — QR-код из админки (или ссылку из консоли)

### Из исходников (для разработки)

1. Установите [Node.js 20+](https://nodejs.org/)
2. Дважды кликните `start.bat` (или `MusicBox.bat`)
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
npm run setup        # скачать mpv + yt-dlp
npm run release      # portable ZIP для Windows (release/MusicBox-win64.zip)
```

## Open-air тусовка

1. Поднимите WiFi (роутер или hotspot с телефона)
2. Подключите ноутбук и колонки (AUX / Bluetooth)
3. Запустите `start.bat`
4. Раздайте гостям QR-код из админки (`/admin`)
5. Без интернета работают только загруженные mp3/mp4

### Firewall (если телефоны не видят сервер)

```powershell
netsh advfirewall firewall add rule name="Music Box" dir=in action=allow protocol=TCP localport=3000
```

## Зависимости

- **Node.js 20+** — сервер и UI
- **mpv** — воспроизведение на Windows (скачивается через `npm run setup`)
- **yt-dlp** — YouTube/Spotify резолв (скачивается через `npm run setup`)

Если mpv не скачался автоматически: `winget install shinchiro.mpv` (или просто запустите `start.bat` — установит сам)

## Структура

```
music-box/
├── start.bat           # запуск одной кнопкой
├── stop.bat            # остановка сервера и mpv
├── config.json         # настройки
├── server/             # Fastify API + WebSocket + mpv
├── client/             # React UI
├── media/              # загруженные файлы
├── data/               # SQLite база
└── bin/                # mpv.exe, yt-dlp.exe
```

## Лицензия

MIT
