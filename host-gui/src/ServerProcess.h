#pragma once

#include <QObject>
#include <QProcess>
#include <QString>

class ServerProcess : public QObject {
  Q_OBJECT
public:
  explicit ServerProcess(QObject *parent = nullptr);
  ~ServerProcess() override;
  void start(const QString &root);
  void stop();
  bool isRunning() const;
  QString root() const { return root_; }

signals:
  void logLine(const QString &line);
  void started();
  void stopped();

private:
  QString nodeProgram(const QString &root) const;
  void killTree();

  QProcess process_;
  QString root_;
  qint64 pid_ = 0;
#ifdef Q_OS_WIN
  void *job_ = nullptr;
#endif
};
