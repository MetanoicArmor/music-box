#pragma once

#include <functional>

#include <QByteArray>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QObject>
#include <QTcpSocket>
#include <QUrl>

class ApiClient : public QObject {
  Q_OBJECT
public:
  explicit ApiClient(QObject *parent = nullptr);

  void setBase(const QUrl &httpBase);
  void login(const QString &password);
  void connectSocket();
  void disconnectSocket();

  void pause();
  void resume();
  void skip();
  void previous();
  void stopPlayback();
  void seekAbsolute(double seconds);
  void deleteTrack(const QString &id);
  void deleteArtist(const QString &artist);
  void clearQueue();
  void clearHistory();
  void setEventMode(bool enabled);
  void banIp(const QString &ip);
  void unbanIp(const QString &ip);
  void addInput(const QString &input);
  void addSuggestion(const QJsonObject &suggestion);
  void readdTrack(const QString &id);
  void uploadFile(const QString &filePath);
  void downloadTrack(const QString &id, const QString &targetPath);
  void fetchImage(const QUrl &url);
  void search(const QString &query);
  void loadLibrary(const QString &query);
  void searchHistory(const QString &query);
  void refreshPlayback();
  void refreshLog();
  void refreshInfo();
  void refreshState();
  QUrl streamUrl(const QString &id) const;

signals:
  void ready();
  void failed(const QString &message);
  void playerFailed(const QString &message);
  void addFailed(const QString &message);
  void historyFailed(const QString &message);
  void stateReceived(const QJsonObject &state);
  void socketLost();
  void playbackReceived(double time, double duration, bool paused, bool hasTrack);
  void logReceived(const QJsonArray &entries);
  void infoReceived(const QString &url, const QString &lanIp, int port);
  void searchReceived(const QString &query, const QJsonObject &results);
  void libraryReceived(const QString &query, const QJsonArray &tracks, int total);
  void historySearchReceived(const QString &query, const QJsonArray &tracks);
  void imageReceived(const QUrl &url, const QImage &image);
  void notice(const QString &message);
  void trackAdded(const QString &message);
  void uploaded(const QString &message);
  void trackReadded(const QString &title);
  void libraryChanged();

private:
  using ErrorHandler = std::function<void(const QString &)>;
  void request(const QString &method, const QString &path, const QByteArray &body,
               const std::function<void(const QJsonDocument &)> &ok, const ErrorHandler &fail = {});
  void playerRequest(const QString &path, const QByteArray &body = "{}");
  static QString errorText(QNetworkReply *reply, const QByteArray &raw, const QString &fallback);
  QByteArray cookieHeader() const;
  void onSocketReadyRead();
  void parseFrames();
  void sendFrame(quint8 opcode, const QByteArray &payload);

  QNetworkAccessManager net_;
  QTcpSocket socket_;
  QUrl base_;
  QByteArray buffer_;
  QByteArray message_;
  bool upgraded_ = false;
  bool closing_ = false;
};
