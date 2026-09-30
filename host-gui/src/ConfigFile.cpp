#include "ConfigFile.h"
#include "UiText.h"

#include <QFile>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QRegularExpression>

ConfigFile::ConfigFile(QString path) : path_(std::move(path)) {}

QString ConfigFile::stripComments(const QString &text) {
  QString out;
  bool inString = false;
  bool escape = false;
  bool line = false;
  bool block = false;
  for (int i = 0; i < text.size(); ++i) {
    const QChar c = text.at(i);
    if (line) {
      if (c == '\n') {
        line = false;
        out += c;
      }
      continue;
    }
    if (block) {
      if (c == '*' && i + 1 < text.size() && text.at(i + 1) == '/') {
        block = false;
        ++i;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c == '\\') escape = true;
      else if (c == '"') inString = false;
      continue;
    }
    if (c == '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c == '/' && i + 1 < text.size() && text.at(i + 1) == '/') {
      line = true;
      ++i;
      continue;
    }
    if (c == '/' && i + 1 < text.size() && text.at(i + 1) == '*') {
      block = true;
      ++i;
      continue;
    }
    out += c;
  }
  return out;
}

bool ConfigFile::load() {
  error_.clear();
  QFile file(path_);
  if (!file.open(QIODevice::ReadOnly)) {
    error_ = ui("host.openFailed").replace("{path}", path_);
    obj_ = QJsonObject();
    return false;
  }
  const QString text = stripComments(QString::fromUtf8(file.readAll()));
  QJsonParseError err;
  const QJsonDocument doc = QJsonDocument::fromJson(text.toUtf8(), &err);
  if (err.error != QJsonParseError::NoError || !doc.isObject()) {
    error_ = err.errorString();
    obj_ = QJsonObject();
    return false;
  }
  obj_ = doc.object();
  return true;
}

int ConfigFile::port() const { return obj_.value("port").toInt(3000); }
QString ConfigFile::adminPassword() const { return obj_.value("adminPassword").toString("changeme"); }
int ConfigFile::kickThreshold() const { return obj_.value("kickThreshold").toInt(-2); }
int ConfigFile::playingKickDislikes() const { return obj_.value("playingKickDislikes").toInt(3); }
int ConfigFile::voteRateLimit() const { return obj_.value("voteRateLimit").toInt(10); }
int ConfigFile::voteRateWindowSec() const { return obj_.value("voteRateWindowSec").toInt(30); }
int ConfigFile::maxUploadMb() const { return obj_.value("maxUploadMb").toInt(100); }
int ConfigFile::maxTrackMinutes() const { return obj_.value("maxTrackMinutes").toInt(10); }
bool ConfigFile::eventMode() const { return obj_.value("eventMode").toBool(false); }

bool ConfigFile::replaceNumber(QString &text, const QString &key, int value) {
  QRegularExpression re(QString("(\"%1\"\\s*:\\s*)(-?\\d+)").arg(QRegularExpression::escape(key)));
  if (!re.match(text).hasMatch()) return false;
  text.replace(re, QString("\\1%1").arg(value));
  return true;
}

bool ConfigFile::replaceBool(QString &text, const QString &key, bool value) {
  QRegularExpression re(QString("(\"%1\"\\s*:\\s*)(true|false)").arg(QRegularExpression::escape(key)));
  if (!re.match(text).hasMatch()) return false;
  text.replace(re, QString("\\1%1").arg(value ? "true" : "false"));
  return true;
}

bool ConfigFile::replaceString(QString &text, const QString &key, const QString &value) {
  QString escaped = value;
  escaped.replace("\\", "\\\\").replace("\"", "\\\"");
  QRegularExpression re(QString("(\"%1\"\\s*:\\s*\")(?:\\\\.|[^\"\\\\])*(\")").arg(QRegularExpression::escape(key)));
  if (!re.match(text).hasMatch()) return false;
  text.replace(re, QString("\\1%1\\2").arg(escaped));
  return true;
}

bool ConfigFile::save(int port, const QString &password, int kickThreshold, int playingKickDislikes,
                      int voteRateLimit, int voteRateWindowSec, int maxUploadMb, int maxTrackMinutes, bool eventMode) {
  QFile file(path_);
  if (!file.open(QIODevice::ReadOnly)) {
    error_ = ui("host.readFailed").replace("{path}", path_);
    return false;
  }
  QString text = QString::fromUtf8(file.readAll());
  file.close();

  struct Item {
    QString key;
    enum Kind { Num, Bool, Str } kind;
    int num = 0;
    bool b = false;
    QString str;
  };
  const Item items[] = {
    {"port", Item::Num, port, false, {}},
    {"kickThreshold", Item::Num, kickThreshold, false, {}},
    {"playingKickDislikes", Item::Num, playingKickDislikes, false, {}},
    {"voteRateLimit", Item::Num, voteRateLimit, false, {}},
    {"voteRateWindowSec", Item::Num, voteRateWindowSec, false, {}},
    {"maxUploadMb", Item::Num, maxUploadMb, false, {}},
    {"maxTrackMinutes", Item::Num, maxTrackMinutes, false, {}},
    {"eventMode", Item::Bool, 0, eventMode, {}},
    {"adminPassword", Item::Str, 0, false, password},
  };

  QStringList missing;
  for (const Item &item : items) {
    bool ok = false;
    if (item.kind == Item::Num) ok = replaceNumber(text, item.key, item.num);
    else if (item.kind == Item::Bool) ok = replaceBool(text, item.key, item.b);
    else ok = replaceString(text, item.key, item.str);
    if (!ok) {
      if (item.kind == Item::Num) missing << QString("  \"%1\": %2").arg(item.key).arg(item.num);
      else if (item.kind == Item::Bool) missing << QString("  \"%1\": %2").arg(item.key, item.b ? "true" : "false");
      else {
        QString escaped = item.str;
        escaped.replace("\\", "\\\\").replace("\"", "\\\"");
        missing << QString("  \"%1\": \"%2\"").arg(item.key, escaped);
      }
    }
  }
  if (!missing.isEmpty()) {
    const int close = text.lastIndexOf('}');
    if (close < 0) {
      error_ = ui("host.configBroken");
      return false;
    }
    QString insert = ",\n" + missing.join(",\n") + "\n";
    text.insert(close, insert);
  }

  if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
    error_ = ui("host.writeFailed").replace("{path}", path_);
    return false;
  }
  file.write(text.toUtf8());
  return load();
}

bool ConfigFile::setEventMode(bool enabled) {
  return save(port(), adminPassword(), kickThreshold(), playingKickDislikes(), voteRateLimit(),
              voteRateWindowSec(), maxUploadMb(), maxTrackMinutes(), enabled);
}
