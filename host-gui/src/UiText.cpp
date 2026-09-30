#include "UiText.h"

#include <QCoreApplication>
#include <QLocale>
#include <QSettings>

namespace {

struct Row {
  const char *key;
  const char *ru;
  const char *en;
};

const Row kRows[] = {
  {"nav.host", "Хост", "Host"},
  {"nav.add", "Добавить", "Add"},
  {"host.settings", "Настройки", "Settings"},
  {"host.language", "Язык", "Language"},
  {"host.openSite", "Открыть сайт", "Open site"},
  {"host.stopServer", "Остановить", "Stop"},
  {"host.open", "Открыть", "Open"},
  {"host.quit", "Выход", "Quit"},
  {"host.save", "Сохранить", "Save"},
  {"host.running", "Хост работает", "Host is running"},
  {"host.stopped", "Сервер остановлен", "Server stopped"},
  {"host.starting", "Запуск сервера…", "Starting the server…"},
  {"host.restarting", "Перезапуск сервера…", "Restarting the server…"},
  {"host.settingsSaved", "Настройки сохранены", "Settings saved"},
  {"host.reconnecting", "Нет связи с сервером — переподключаюсь…", "Server connection lost — reconnecting…"},
  {"host.noDist", "Нет dist/server/index.js — сначала npm run build", "dist/server/index.js is missing — run npm run build first"},
  {"host.settingsHint", "Порт и пароль применяются после перезапуска сервера. Пороги голосов — сразу.",
   "Port and password apply after the server restarts. Vote thresholds apply immediately."},
  {"host.eventVoteOnly", "Event mode — только голосование", "Event mode — voting only"},
  {"host.port", "Порт", "Port"},
  {"host.kick", "Кик из очереди", "Kick from queue"},
  {"host.playingKick", "Дизлайков до skip", "Dislikes before skip"},
  {"host.voteLimit", "Лимит голосов", "Vote limit"},
  {"host.voteWindow", "Окно лимита, сек", "Limit window, sec"},
  {"host.maxUpload", "Макс. загрузка, МБ", "Max upload, MB"},
  {"host.maxMinutes", "Макс. длина, мин", "Max length, min"},
  {"host.ipPlaceholder", "192.168.1.x — или выберите трек", "192.168.1.x — or pick a track"},
  {"host.historySearch", "Поиск по истории: название или исполнитель", "Search history: title or artist"},
  {"host.deleteFromHistory", "Удалить из истории", "Remove from history"},
  {"host.alreadyQueued", "Уже в очереди", "Already in the queue"},
  {"host.rightClick", "Правый клик — действия", "Right-click for actions"},
  {"host.ipBanned", "IP {ip} забанен", "Banned IP {ip}"},
  {"host.ipUnbanned", "IP {ip} разбанен", "Unbanned IP {ip}"},
  {"host.savedFile", "Сохранено: {name}", "Saved: {name}"},
  {"host.writeFailed", "Не удалось записать {path}", "Could not write {path}"},
  {"host.openFailed", "Не удалось открыть {path}", "Could not open {path}"},
  {"host.readFailed", "Не удалось прочитать {path}", "Could not read {path}"},
  {"host.configBroken", "config.json повреждён", "config.json is damaged"},
  {"host.wsRejected", "WebSocket: сервер не принял /ws", "WebSocket: the server rejected /ws"},
  {"host.uploadTitle", "Загрузить трек", "Upload a track"},
  {"host.audio", "Аудио", "Audio"},
  {"host.dropHint", "Перетащите сюда или нажмите. mp3, m4a, flac, wav, ogg и другие аудио",
   "Drop a file here or click. mp3, m4a, flac, wav, ogg and other audio"},
  {"host.uploadOff", "Event mode — загрузка отключена", "Event mode — uploads are off"},
  {"host.uploading", "Загружаю «{name}»…", "Uploading “{name}”…"},
  {"host.uploadingMany", "Загружаю файлов: {count}…", "Uploading {count} files…"},
  {"admin.qrTitle", "Подключиться к Music Box", "Join Music Box"},
  {"admin.qrHint", "Телефон и ПК — в одной Wi‑Fi.", "Phone and PC must be on the same Wi‑Fi."},
  {"admin.nowPlaying", "Сейчас играет", "Now playing"},
  {"admin.player", "Плеер", "Player"},
  {"admin.idle", "Ничего не играет", "Nothing is playing"},
  {"admin.playerError", "Ошибка плеера", "Player error"},
  {"admin.prev", "Предыдущий", "Previous"},
  {"admin.play", "Играть", "Play"},
  {"admin.pause", "Пауза", "Pause"},
  {"admin.next", "Следующий", "Next"},
  {"admin.stop", "Стоп", "Stop"},
  {"admin.password", "Пароль администратора", "Admin password"},
  {"admin.clearQueue", "Очистить очередь", "Clear queue"},
  {"admin.clearHistory", "Очистить историю", "Clear history"},
  {"admin.confirmClearHistory", "Очистить историю проигранных треков?", "Clear played-track history?"},
  {"admin.confirmDeleteArtist", "Удалить все треки «{artist}» из очереди?", "Remove all “{artist}” tracks from the queue?"},
  {"admin.eventMode", "Event mode", "Event mode"},
  {"admin.eventOn", "ВКЛ", "ON"},
  {"admin.eventOff", "ВЫКЛ", "OFF"},
  {"admin.eventHelp",
   "Режим тусовки: гости могут только голосовать за треки в очереди. Добавление песен и загрузка файлов отключены. Включай, когда очередь уже набрана или кто-то спамит запросами.",
   "Party mode: guests can only vote on queued tracks. Adding songs and uploads are disabled. Turn it on when the queue is ready or someone is spamming requests."},
  {"admin.banIp", "Забанить IP", "Ban IP"},
  {"admin.sectionQueue", "Очередь", "Queue"},
  {"admin.sectionHistory", "История", "History"},
  {"admin.sectionLog", "Журнал", "Log"},
  {"admin.empty", "Пусто", "Empty"},
  {"admin.log.login", "Вход", "Login"},
  {"admin.log.logout", "Выход", "Logout"},
  {"admin.log.skip", "Пропуск", "Skip"},
  {"admin.log.previous", "Предыдущий", "Previous"},
  {"admin.log.stop", "Стоп", "Stop"},
  {"admin.log.pause", "Пауза", "Pause"},
  {"admin.log.resume", "Продолжить", "Resume"},
  {"admin.log.seek", "Перемотка", "Seek"},
  {"admin.log.clear_queue", "Очистка очереди", "Clear queue"},
  {"admin.log.clear_history", "Очистка истории", "Clear history"},
  {"admin.log.event_mode", "Event mode", "Event mode"},
  {"admin.log.remove_track", "Удаление трека", "Remove track"},
  {"admin.log.remove_artist", "Удаление артиста", "Remove artist"},
  {"admin.log.ban_session", "Бан сессии", "Ban session"},
  {"admin.log.ban_ip", "Бан IP", "Ban IP"},
  {"admin.log.unban_session", "Разбан сессии", "Unban session"},
  {"admin.log.unban_ip", "Разбан IP", "Unban IP"},
  {"add.eventOff", "Добавление треков отключено", "Adding tracks is disabled"},
  {"add.eventOffSub", "Event mode — только голосование, добавление отключено", "Event mode — voting only, adding is off"},
  {"add.linkOrSearch", "Ссылка или поиск", "Link or search"},
  {"add.searchPlaceholder", "YouTube / Spotify URL или название трека", "YouTube / Spotify URL or track name"},
  {"add.searching", "Ищу…", "Searching…"},
  {"add.local", "Локально", "Local"},
  {"add.youtube", "YouTube", "YouTube"},
  {"add.notFound", "Ничего не найдено", "Nothing found"},
  {"add.adding", "Добавляю...", "Adding..."},
  {"add.addToQueue", "Добавить в очередь", "Add to queue"},
  {"add.or", "или", "or"},
  {"add.library", "Локальная библиотека", "Local library"},
  {"add.libraryPlaceholder", "Название или исполнитель из библиотеки", "Title or artist from the library"},
  {"add.inQueue", "В очереди", "In queue"},
  {"add.libraryEmpty", "Библиотека пуста — загрузите файл или скопируйте аудио в папку музыки хоста",
   "Library is empty — upload a file or copy audio into the host music folder"},
  {"add.upload", "Загрузить файл", "Upload a file"},
  {"add.queuedDownloading", "Трек добавлен в очередь и скачивается", "Track added to the queue and is downloading"},
  {"add.queuedTitle", "«{title}» добавлен в очередь", "“{title}” added to the queue"},
  {"add.uploadedTitle", "«{title}» добавлен!", "“{title}” added!"},
  {"add.error", "Ошибка", "Error"},
  {"add.uploadError", "Ошибка загрузки", "Upload failed"},
  {"history.empty", "История пуста", "History is empty"},
  {"history.emptySub", "Здесь появятся уже сыгранные треки", "Played tracks will show up here"},
  {"history.notFound", "Ничего не найдено", "Nothing found"},
  {"history.notFoundSub", "Попробуйте другое название", "Try a different title"},
  {"history.added", "Добавлено", "Added"},
  {"history.adding", "Добавляю…", "Adding…"},
  {"history.toQueue", "В очередь", "Queue"},
  {"history.readded", "«{title}» снова в очереди", "“{title}” is back in the queue"},
  {"history.addFailed", "Не удалось добавить", "Could not add"},
  {"listen.playHere", "Проиграть у себя", "Play on this device"},
  {"listen.download", "Скачать себе", "Download"},
  {"track.pending", "ожидает", "pending"},
  {"track.downloading", "скачивается", "downloading"},
  {"track.failed", "ошибка", "error"},
  {"track.deleteTrack", "Удалить трек", "Delete track"},
  {"track.deleteArtist", "Удалить артиста", "Delete artist"},
  {"track.ban", "Ban", "Ban"},
  {"track.unban", "Unban", "Unban"},
  {"errors.requestFailed", "Ошибка запроса", "Request failed"},
  {"errors.downloadFailed", "ошибка скачивания", "download failed"},
};

const Row *findRow(const char *key) {
  for (const Row &row : kRows)
    if (qstrcmp(row.key, key) == 0) return &row;
  return nullptr;
}

}

UiText::UiText(QObject *parent) : QObject(parent) {
  const QString stored = QSettings().value("lang").toString();
  if (stored == "en" || stored == "ru") code_ = stored;
  else code_ = QLocale::system().language() == QLocale::English ? "en" : "ru";
  QLocale::setDefault(code_ == "en" ? QLocale(QLocale::English) : QLocale(QLocale::Russian));
}

UiText *UiText::instance() {
  static auto *locale = new UiText(qApp);
  return locale;
}

QString UiText::code() { return instance()->code_; }

QString UiText::text(const char *key) {
  const Row *row = findRow(key);
  if (!row) return QString::fromUtf8(key);
  return QString::fromUtf8(instance()->code_ == "en" ? row->en : row->ru);
}

bool UiText::contains(const char *key) { return findRow(key) != nullptr; }

void UiText::setCode(const QString &code) {
  if (code != "en" && code != "ru") return;
  if (code_ == code) return;
  code_ = code;
  QSettings().setValue("lang", code_);
  QLocale::setDefault(code_ == "en" ? QLocale(QLocale::English) : QLocale(QLocale::Russian));
  emit changed();
}
