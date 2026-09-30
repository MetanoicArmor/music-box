Music Box — portable версия для macOS и Linux
==============================================

1. Распакуйте архив
2. В терминале из этой папки:
     chmod +x start.sh stop.sh
     ./start.sh
   На Mac можно дважды открыть MusicBox.command
3. Смените adminPassword в config.json
4. QR-код для гостей — в разделе Админ

Остановка: ./stop.sh

Node.js, сервер и интерфейс уже внутри (runtime/node) — ставить Node не нужно.
Для YouTube нужен интернет. Загруженные mp3/mp4 работают офлайн.

macOS: mpv уже лежит в bin/.
Linux: если воспроизведение не стартует, поставьте mpv и запустите снова:
  sudo apt install mpv      # Debian / Ubuntu
  sudo dnf install mpv      # Fedora
  sudo pacman -S mpv        # Arch
Либо ещё раз ./start.sh — скрипт попробует поставить mpv сам (нужен sudo).

Firewall, если телефон не открывает страницу:
  Linux: sudo ufw allow 3000/tcp
  macOS: Системные настройки → Сеть → Файрвол → разрешить входящие для node
