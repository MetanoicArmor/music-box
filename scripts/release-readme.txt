Music Box — portable версия для Windows
======================================

1. Распакуйте папку куда угодно
2. Запустите MusicBox.exe
3. Смените пароль в окне хоста
4. QR-код для гостей — в окне хоста. Гости открывают сайт в браузере

Остановка: закройте окно (крестик), пункт «Выход» в трее или Stop.bat

Node.js, сервер и интерфейс уже внутри — ничего ставить не нужно.
Для YouTube нужен интернет. mp3/mp4 работают офлайн.

Если mpv.exe нет в bin\ — установите: winget install shinchiro.mpv
и скопируйте mpv.exe в папку bin\

Firewall (если телефон не подключается):
  netsh advfirewall firewall add rule name="Music Box" dir=in action=allow protocol=TCP localport=3000
