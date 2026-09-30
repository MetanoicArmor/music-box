#include "ApiClient.h"
#include "UiText.h"

#include <QFile>
#include <QFileInfo>
#include <QHttpMultiPart>
#include <QHttpPart>
#include <QJsonObject>
#include <QNetworkCookie>
#include <QNetworkCookieJar>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRandomGenerator>
#include <QUrl>

ApiClient::ApiClient(QObject *parent) : QObject(parent) {
  connect(&socket_, &QTcpSocket::readyRead, this, &ApiClient::onSocketReadyRead);
  connect(&socket_, &QTcpSocket::connected, this, [this] {
    QByteArray key(16, 0);
    for (int i = 0; i < key.size(); ++i)
      key[i] = char(QRandomGenerator::global()->bounded(256));
    QByteArray request;
    request += "GET /ws HTTP/1.1\r\n";
    request += "Host: " + base_.host().toUtf8() + ":" + QByteArray::number(base_.port()) + "\r\n";
    request += "Upgrade: websocket\r\n";
    request += "Connection: Upgrade\r\n";
    request += "Sec-WebSocket-Key: " + key.toBase64() + "\r\n";
    request += "Sec-WebSocket-Version: 13\r\n";
    const QByteArray cookie = cookieHeader();
    if (!cookie.isEmpty()) request += "Cookie: " + cookie + "\r\n";
    request += "\r\n";
    socket_.write(request);
  });
  connect(&socket_, &QTcpSocket::errorOccurred, this, [this](QAbstractSocket::SocketError) {
    if (!closing_) emit socketLost();
  });
  connect(&socket_, &QTcpSocket::disconnected, this, [this] {
    if (!closing_) emit socketLost();
  });
}

void ApiClient::setBase(const QUrl &httpBase) { base_ = httpBase; }

QByteArray ApiClient::cookieHeader() const {
  const auto cookies = net_.cookieJar()->cookiesForUrl(base_);
  QStringList parts;
  for (const QNetworkCookie &cookie : cookies)
    parts << QString::fromUtf8(cookie.toRawForm(QNetworkCookie::NameAndValueOnly));
  return parts.join("; ").toUtf8();
}

QString ApiClient::errorText(QNetworkReply *reply, const QByteArray &raw, const QString &fallback) {
  const QJsonDocument doc = QJsonDocument::fromJson(raw);
  QString message = doc.isObject() ? doc.object().value("error").toString() : QString();
  if (message.isEmpty() && reply->error() == QNetworkReply::ConnectionRefusedError) message = ui("errors.requestFailed");
  if (message.isEmpty()) message = fallback.isEmpty() ? reply->errorString() : fallback;
  return message;
}

void ApiClient::request(const QString &method, const QString &path, const QByteArray &body,
                        const std::function<void(const QJsonDocument &)> &ok, const ErrorHandler &fail) {
  QNetworkRequest req(base_.resolved(QUrl(path)));
  req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
  req.setRawHeader("Accept-Language", UiText::code().toUtf8());
  QNetworkReply *reply = nullptr;
  if (method == "GET") reply = net_.get(req);
  else if (method == "DELETE") reply = net_.deleteResource(req);
  else reply = net_.sendCustomRequest(req, method.toUtf8(), body);

  connect(reply, &QNetworkReply::finished, this, [this, reply, ok, fail] {
    reply->deleteLater();
    const QByteArray raw = reply->readAll();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (reply->error() != QNetworkReply::NoError || status >= 400) {
      const QString message = errorText(reply, raw, {});
      if (fail) fail(message);
      else emit failed(message);
      return;
    }
    if (ok) ok(QJsonDocument::fromJson(raw));
  });
}

void ApiClient::playerRequest(const QString &path, const QByteArray &body) {
  request("POST", path, body, [this](const QJsonDocument &) { refreshPlayback(); },
          [this](const QString &message) { emit playerFailed(message.isEmpty() ? ui("admin.playerError") : message); });
}

QUrl ApiClient::streamUrl(const QString &id) const {
  return base_.resolved(QUrl("/api/stream/" + id));
}

void ApiClient::login(const QString &password) {
  request("GET", "/api/state", {}, [this, password](const QJsonDocument &) {
    const QJsonObject body{{"password", password}};
    request("POST", "/api/admin/login", QJsonDocument(body).toJson(QJsonDocument::Compact),
            [this](const QJsonDocument &) {
              connectSocket();
              emit ready();
              refreshState();
            });
  });
}

void ApiClient::refreshState() {
  request("GET", "/api/state", {}, [this](const QJsonDocument &doc) {
    if (doc.isObject()) emit stateReceived(doc.object());
  }, [](const QString &) {});
}

void ApiClient::connectSocket() {
  if (socket_.state() == QAbstractSocket::ConnectedState || socket_.state() == QAbstractSocket::ConnectingState)
    return;
  closing_ = false;
  upgraded_ = false;
  buffer_.clear();
  message_.clear();
  socket_.connectToHost(base_.host(), static_cast<quint16>(base_.port()));
}

void ApiClient::disconnectSocket() {
  closing_ = true;
  upgraded_ = false;
  buffer_.clear();
  message_.clear();
  socket_.abort();
}

void ApiClient::onSocketReadyRead() {
  buffer_.append(socket_.readAll());
  if (!upgraded_) {
    const int end = buffer_.indexOf("\r\n\r\n");
    if (end < 0) return;
    const QByteArray headers = buffer_.left(end);
    buffer_.remove(0, end + 4);
    if (!headers.contains(" 101 ")) {
      emit failed(ui("host.wsRejected"));
      disconnectSocket();
      return;
    }
    upgraded_ = true;
  }
  parseFrames();
}

void ApiClient::sendFrame(quint8 opcode, const QByteArray &payload) {
  QByteArray frame;
  frame.append(char(0x80 | opcode));
  const int n = payload.size();
  if (n < 126) frame.append(char(0x80 | n));
  else {
    frame.append(char(0x80 | 126));
    frame.append(char((n >> 8) & 0xff));
    frame.append(char(n & 0xff));
  }
  QByteArray mask(4, 0);
  for (int i = 0; i < 4; ++i) mask[i] = char(QRandomGenerator::global()->bounded(256));
  frame.append(mask);
  for (int i = 0; i < n; ++i) frame.append(char(payload.at(i) ^ mask.at(i % 4)));
  socket_.write(frame);
}

void ApiClient::parseFrames() {
  while (true) {
    if (buffer_.size() < 2) return;
    const quint8 b0 = quint8(buffer_.at(0));
    const quint8 b1 = quint8(buffer_.at(1));
    const bool fin = (b0 & 0x80) != 0;
    const quint8 opcode = b0 & 0x0f;
    const bool masked = (b1 & 0x80) != 0;
    quint64 len = b1 & 0x7f;
    int header = 2;
    if (len == 126) {
      if (buffer_.size() < 4) return;
      len = (quint64(quint8(buffer_.at(2))) << 8) | quint8(buffer_.at(3));
      header = 4;
    } else if (len == 127) {
      if (buffer_.size() < 10) return;
      len = 0;
      for (int i = 0; i < 8; ++i) len = (len << 8) | quint8(buffer_.at(2 + i));
      header = 10;
    }
    if (masked) header += 4;
    if (quint64(buffer_.size()) < quint64(header) + len) return;
    QByteArray payload = buffer_.mid(header, int(len));
    if (masked) {
      const QByteArray mask = buffer_.mid(header - 4, 4);
      for (int i = 0; i < payload.size(); ++i) payload[i] = char(payload.at(i) ^ mask.at(i % 4));
    }
    buffer_.remove(0, header + int(len));

    if (opcode == 0x8) {
      disconnectSocket();
      emit socketLost();
      return;
    }
    if (opcode == 0x9) {
      sendFrame(0xA, payload);
      continue;
    }
    if (opcode == 0x1) message_.clear();
    if (opcode == 0x1 || opcode == 0x0) {
      message_.append(payload);
      if (!fin) continue;
      const QJsonDocument doc = QJsonDocument::fromJson(message_);
      message_.clear();
      if (!doc.isObject()) continue;
      const QJsonObject obj = doc.object();
      if (obj.value("type").toString() == "state" && obj.value("payload").isObject())
        emit stateReceived(obj.value("payload").toObject());
    }
  }
}

void ApiClient::pause() { playerRequest("/api/admin/pause"); }
void ApiClient::resume() { playerRequest("/api/admin/resume"); }
void ApiClient::skip() { playerRequest("/api/admin/skip"); }
void ApiClient::previous() { playerRequest("/api/admin/previous"); }
void ApiClient::stopPlayback() { playerRequest("/api/admin/stop"); }

void ApiClient::seekAbsolute(double seconds) {
  const QJsonObject body{{"absolute", seconds}};
  playerRequest("/api/admin/seek", QJsonDocument(body).toJson(QJsonDocument::Compact));
}

void ApiClient::deleteTrack(const QString &id) {
  request("DELETE", "/api/admin/tracks/" + id, {}, [this](const QJsonDocument &) { refreshLog(); });
}

void ApiClient::deleteArtist(const QString &artist) {
  request("DELETE", "/api/admin/artists/" + QString::fromUtf8(QUrl::toPercentEncoding(artist)), {},
          [this](const QJsonDocument &) { refreshLog(); });
}

void ApiClient::clearQueue() { request("POST", "/api/admin/clear-queue", "{}", nullptr); }
void ApiClient::clearHistory() { request("POST", "/api/admin/clear-history", "{}", nullptr); }

void ApiClient::setEventMode(bool enabled) {
  const QJsonObject body{{"enabled", enabled}};
  request("POST", "/api/admin/event-mode", QJsonDocument(body).toJson(QJsonDocument::Compact), nullptr);
}

void ApiClient::banIp(const QString &ip) {
  const QJsonObject body{{"ip", ip}};
  request("POST", "/api/admin/ban", QJsonDocument(body).toJson(QJsonDocument::Compact), [this, ip](const QJsonDocument &) {
    emit notice(ui("host.ipBanned").replace("{ip}", ip));
    refreshLog();
  });
}

void ApiClient::unbanIp(const QString &ip) {
  const QJsonObject body{{"ip", ip}};
  request("POST", "/api/admin/unban", QJsonDocument(body).toJson(QJsonDocument::Compact), [this, ip](const QJsonDocument &) {
    emit notice(ui("host.ipUnbanned").replace("{ip}", ip));
    refreshLog();
  });
}

void ApiClient::addInput(const QString &input) {
  const QJsonObject body{{"input", input}};
  request("POST", "/api/tracks", QJsonDocument(body).toJson(QJsonDocument::Compact),
          [this](const QJsonDocument &) { emit trackAdded(ui("add.queuedDownloading")); },
          [this](const QString &message) { emit addFailed(message.isEmpty() ? ui("add.error") : message); });
}

void ApiClient::addSuggestion(const QJsonObject &suggestion) {
  const QString title = suggestion.value("title").toString();
  request("POST", "/api/tracks", QJsonDocument(suggestion).toJson(QJsonDocument::Compact),
          [this, title](const QJsonDocument &) { emit trackAdded(ui("add.queuedTitle").replace("{title}", title)); },
          [this](const QString &message) { emit addFailed(message.isEmpty() ? ui("add.error") : message); });
}

void ApiClient::readdTrack(const QString &id) {
  request("POST", "/api/tracks/" + id + "/readd", "{}",
          [this](const QJsonDocument &doc) { emit trackReadded(doc.object().value("title").toString()); },
          [this](const QString &message) { emit historyFailed(message.isEmpty() ? ui("history.addFailed") : message); });
}

void ApiClient::downloadTrack(const QString &id, const QString &targetPath) {
  auto *file = new QFile(targetPath + ".part");
  if (!file->open(QIODevice::WriteOnly)) {
    delete file;
    emit failed(ui("host.writeFailed").replace("{path}", targetPath));
    return;
  }
  QNetworkRequest req(base_.resolved(QUrl("/api/stream/" + id + "?download=1")));
  req.setRawHeader("Accept-Language", UiText::code().toUtf8());
  QNetworkReply *reply = net_.get(req);
  file->setParent(reply);
  connect(reply, &QNetworkReply::readyRead, this, [reply, file] {
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (status < 400) file->write(reply->readAll());
  });
  connect(reply, &QNetworkReply::finished, this, [this, reply, file, targetPath] {
    reply->deleteLater();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (reply->error() != QNetworkReply::NoError || status >= 400) {
      const QByteArray raw = reply->readAll();
      file->close();
      file->remove();
      emit failed(errorText(reply, raw, {}));
      return;
    }
    file->write(reply->readAll());
    file->close();
    QFile::remove(targetPath);
    if (!file->rename(targetPath)) {
      emit failed(ui("host.writeFailed").replace("{path}", targetPath));
      return;
    }
    emit notice(ui("host.savedFile").replace("{name}", QFileInfo(targetPath).fileName()));
  });
}

void ApiClient::fetchImage(const QUrl &url) {
  if (!url.isValid() || url.isEmpty()) return;
  QNetworkReply *reply = net_.get(QNetworkRequest(url));
  connect(reply, &QNetworkReply::finished, this, [this, reply, url] {
    reply->deleteLater();
    if (reply->error() != QNetworkReply::NoError) return;
    QImage image;
    if (image.loadFromData(reply->readAll())) emit imageReceived(url, image);
  });
}

void ApiClient::uploadFile(const QString &filePath) {
  auto *file = new QFile(filePath);
  if (!file->open(QIODevice::ReadOnly)) {
    delete file;
    emit addFailed(ui("host.openFailed").replace("{path}", filePath));
    return;
  }
  auto *multi = new QHttpMultiPart(QHttpMultiPart::FormDataType);
  QHttpPart part;
  part.setHeader(QNetworkRequest::ContentDispositionHeader,
                 QString("form-data; name=\"file\"; filename=\"%1\"").arg(QFileInfo(filePath).fileName()));
  file->setParent(multi);
  part.setBodyDevice(file);
  multi->append(part);

  QNetworkRequest req(base_.resolved(QUrl("/api/upload")));
  req.setRawHeader("Accept-Language", UiText::code().toUtf8());
  QNetworkReply *reply = net_.post(req, multi);
  multi->setParent(reply);
  connect(reply, &QNetworkReply::finished, this, [this, reply] {
    reply->deleteLater();
    const QByteArray raw = reply->readAll();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (reply->error() != QNetworkReply::NoError || status >= 400) {
      emit addFailed(errorText(reply, raw, ui("add.uploadError")));
      return;
    }
    const QJsonObject file = QJsonDocument::fromJson(raw).object();
    const QString title = file.value("title").toString();
    const QJsonObject body{
      {"title", file.value("title")},
      {"artist", file.value("artist")},
      {"filePath", file.value("filePath")},
    };
    request("POST", "/api/tracks", QJsonDocument(body).toJson(QJsonDocument::Compact),
            [this, title](const QJsonDocument &) {
              emit uploaded(ui("add.uploadedTitle").replace("{title}", title));
              emit libraryChanged();
            },
            [this](const QString &message) { emit addFailed(message.isEmpty() ? ui("add.uploadError") : message); });
  });
}

void ApiClient::search(const QString &query) {
  request("GET", "/api/search?q=" + QString::fromUtf8(QUrl::toPercentEncoding(query)), {},
          [this, query](const QJsonDocument &doc) { emit searchReceived(query, doc.object()); },
          [this, query](const QString &) { emit searchReceived(query, {}); });
}

void ApiClient::loadLibrary(const QString &query) {
  request("GET", "/api/library?q=" + QString::fromUtf8(QUrl::toPercentEncoding(query)), {},
          [this, query](const QJsonDocument &doc) {
            emit libraryReceived(query, doc.object().value("tracks").toArray(), doc.object().value("total").toInt());
          },
          [this, query](const QString &) { emit libraryReceived(query, {}, -1); });
}

void ApiClient::searchHistory(const QString &query) {
  request("GET", "/api/history/search?q=" + QString::fromUtf8(QUrl::toPercentEncoding(query)), {},
          [this, query](const QJsonDocument &doc) {
            emit historySearchReceived(query, doc.object().value("tracks").toArray());
          },
          [this, query](const QString &) { emit historySearchReceived(query, {}); });
}

void ApiClient::refreshPlayback() {
  request("GET", "/api/admin/playback", {}, [this](const QJsonDocument &doc) {
    if (!doc.isObject()) return;
    const QJsonObject status = doc.object().value("status").toObject();
    const bool has = !status.isEmpty();
    emit playbackReceived(status.value("time").toDouble(), status.value("duration").toDouble(),
                          status.value("paused").toBool(true), has);
  }, [](const QString &) {});
}

void ApiClient::refreshLog() {
  request("GET", "/api/admin/log", {}, [this](const QJsonDocument &doc) {
    if (doc.isArray()) emit logReceived(doc.array());
  }, [](const QString &) {});
}

void ApiClient::refreshInfo() {
  request("GET", "/api/info", {}, [this](const QJsonDocument &doc) {
    if (!doc.isObject()) return;
    const QJsonObject obj = doc.object();
    emit infoReceived(obj.value("url").toString(), obj.value("lanIp").toString(), obj.value("port").toInt());
  });
}
