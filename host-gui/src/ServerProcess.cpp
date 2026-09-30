#include "ServerProcess.h"

#include <QDir>
#include <QFileInfo>
#include <QProcessEnvironment>

#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

#ifdef Q_OS_UNIX
#include <signal.h>
#include <sys/types.h>
#endif

ServerProcess::ServerProcess(QObject *parent) : QObject(parent) {
#ifdef Q_OS_WIN
  job_ = CreateJobObjectW(nullptr, nullptr);
  if (job_) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job_, JobObjectExtendedLimitInformation, &info, sizeof(info));
  }
#endif
  process_.setProcessChannelMode(QProcess::MergedChannels);
  connect(&process_, &QProcess::readyRead, this, [this] {
    const QString text = QString::fromLocal8Bit(process_.readAll());
    for (const QString &line : text.split('\n', Qt::SkipEmptyParts))
      emit logLine(line.trimmed());
  });
  connect(&process_, &QProcess::started, this, [this] {
    pid_ = process_.processId();
#ifdef Q_OS_WIN
    if (job_ && pid_ > 0) {
      HANDLE process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, static_cast<DWORD>(pid_));
      if (process) {
        AssignProcessToJobObject(job_, process);
        CloseHandle(process);
      }
    }
#endif
    emit started();
  });
  connect(&process_, &QProcess::finished, this, [this] {
    pid_ = 0;
    emit stopped();
  });
}

QString ServerProcess::nodeProgram(const QString &root) const {
#ifdef Q_OS_WIN
  const QString bundled = QDir(root).filePath("runtime/node.exe");
#else
  const QString bundled = QDir(root).filePath("runtime/node");
#endif
  if (QFileInfo::exists(bundled)) return bundled;
  return QStringLiteral("node");
}

void ServerProcess::start(const QString &installRoot, const QString &dataHome) {
  if (isRunning()) return;
  const QString home = dataHome.isEmpty() ? installRoot : dataHome;
  root_ = installRoot;
  QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
  env.insert(QStringLiteral("MUSICBOX_ROOT"), installRoot);
  env.insert(QStringLiteral("MUSICBOX_HOME"), home);
  process_.setProcessEnvironment(env);
  process_.setWorkingDirectory(home);
  process_.setProgram(nodeProgram(installRoot));
  process_.setArguments({QDir(installRoot).filePath(QStringLiteral("dist/server/index.js"))});
#ifdef Q_OS_UNIX
  QProcess::UnixProcessParameters params;
  params.flags = QProcess::UnixProcessFlag::CreateNewSession;
  process_.setUnixProcessParameters(params);
#endif
  process_.start();
}

bool ServerProcess::isRunning() const {
  return process_.state() != QProcess::NotRunning;
}

void ServerProcess::killTree() {
  if (pid_ <= 0) return;
#ifdef Q_OS_WIN
  QProcess::execute("taskkill.exe", {"/PID", QString::number(pid_), "/T", "/F"});
#elif defined(Q_OS_UNIX)
  const pid_t group = static_cast<pid_t>(pid_);
  ::kill(-group, SIGKILL);
#endif
}

void ServerProcess::stop() {
  if (!isRunning()) return;
  const qint64 pid = pid_ > 0 ? pid_ : process_.processId();
  pid_ = pid;
  killTree();
  if (process_.state() != QProcess::NotRunning) {
    process_.kill();
    process_.waitForFinished(3000);
  }
  pid_ = 0;
}

ServerProcess::~ServerProcess() {
  stop();
#ifdef Q_OS_WIN
  if (job_) CloseHandle(job_);
#endif
}
