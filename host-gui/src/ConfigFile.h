#pragma once

#include <QString>
#include <QJsonObject>

class ConfigFile {
public:
  explicit ConfigFile(QString path);

  QString path() const { return path_; }
  bool load();
  QString error() const { return error_; }

  int port() const;
  QString adminPassword() const;
  int kickThreshold() const;
  int playingKickDislikes() const;
  int voteRateLimit() const;
  int voteRateWindowSec() const;
  int maxUploadMb() const;
  int maxTrackMinutes() const;
  bool eventMode() const;

  bool save(int port, const QString &password, int kickThreshold, int playingKickDislikes,
            int voteRateLimit, int voteRateWindowSec, int maxUploadMb, int maxTrackMinutes, bool eventMode);

  bool setEventMode(bool enabled);

private:
  QJsonObject readObject() const;
  static QString stripComments(const QString &text);
  static bool replaceNumber(QString &text, const QString &key, int value);
  static bool replaceBool(QString &text, const QString &key, bool value);
  static bool replaceString(QString &text, const QString &key, const QString &value);

  QString path_;
  QString error_;
  QJsonObject obj_;
};
