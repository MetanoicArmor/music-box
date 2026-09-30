#pragma once

#include <QObject>
#include <QString>

class UiText : public QObject {
  Q_OBJECT
public:
  static UiText *instance();
  static QString code();
  static QString text(const char *key);
  static bool contains(const char *key);
  void setCode(const QString &code);

signals:
  void changed();

private:
  explicit UiText(QObject *parent = nullptr);
  QString code_ = "ru";
};

inline QString ui(const char *key) { return UiText::text(key); }
