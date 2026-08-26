Music Box — portable версия для Windows
======================================

1. Распакуйте папку куда угодно
2. Запустите MusicBox.bat (двойной клик)
3. Откройте админку и смените adminPassword в config.json
4. QR-код для гостей — в разделе Админ

Остановка: Stop.bat

Node.js, сервер и интерфейс уже внутри — ничего ставить не нужно.
Для YouTube нужен интернет. mp3/mp4 работают офлайн.

Если mpv.exe нет в bin\ — установите: winget install shinchiro.mpv
и скопируйте mpv.exe в папку bin\

Firewall (если телефон не подключается):
  netsh advfirewall firewall add rule name="Music Box" dir=in action=allow protocol=TCP localport=3000
