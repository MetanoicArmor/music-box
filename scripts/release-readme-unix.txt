Music Box — portable версия для macOS и Linux
==============================================

1. Распакуйте архив
2. macOS: откройте MusicBox.app (или дважды MusicBox.command)
   Linux: ./MusicBox
   AppImage: chmod +x MusicBox-linux-x64.AppImage && ./MusicBox-linux-x64.AppImage
   У AppImage настройки и медиа лежат в ~/.local/share/MetanoicArmor/Music Box
3. Смените пароль в окне хоста
4. QR-код для гостей — в окне хоста. Гости открывают сайт в браузере

Остановка: закройте окно (крестик), пункт «Выход» в трее или ./stop.sh
Консоль без окна: ./start.sh

Node.js, сервер и интерфейс уже внутри (runtime/node) — ставить Node не нужно.
Для YouTube нужен интернет. Загруженные mp3/mp4 работают офлайн.

macOS: mpv уже лежит в bin/.
Linux: если воспроизведение не стартует, поставьте mpv и запустите снова:
  sudo apt install mpv      # Debian / Ubuntu
  sudo dnf install mpv      # Fedora
  sudo pacman -S mpv        # Arch
Либо ещё раз ./start.sh — скрипт попробует поставить mpv сам (нужен sudo).

Окну на Linux нужны системные библиотеки (Qt уже внутри архива):
  sudo apt install libxcb-cursor0 libxkbcommon0 libgl1 libfontconfig1 libdbus-1-3
  sudo pacman -S --needed xcb-util-cursor libxkbcommon mesa fontconfig dbus
  sudo dnf install libxkbcommon xcb-util-cursor mesa-libGL fontconfig dbus-libs

Firewall, если телефон не открывает страницу:
  Linux: sudo ufw allow 3000/tcp
  macOS: Системные настройки → Сеть → Файрвол → разрешить входящие для node
