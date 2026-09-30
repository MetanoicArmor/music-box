#include "MainWindow.h"

#include <QApplication>
#include <QDir>
#include <QFileInfo>
#include <QIcon>
#include <QMessageBox>
#include <QStandardPaths>

static bool looksLikeInstall(const QDir &dir) {
  return QFileInfo::exists(dir.filePath("dist/server/index.js")) ||
         (QFileInfo::exists(dir.filePath("package.json")) && QDir(dir.filePath("server")).exists());
}

static QString findInstallRoot() {
  QDir dir(QCoreApplication::applicationDirPath());
#ifdef Q_OS_MACOS
  const QDir resources(dir.filePath("../Resources"));
  if (looksLikeInstall(resources)) return resources.absolutePath();
#endif
  for (int i = 0; i < 8; ++i) {
    if (looksLikeInstall(dir)) return dir.absolutePath();
    if (!dir.cdUp()) break;
  }
  return QCoreApplication::applicationDirPath();
}

static QString findDataHome(const QString &install) {
#ifdef Q_OS_MACOS
  if (install.contains(QStringLiteral(".app/Contents/Resources"))) {
    const QString home = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(home);
    return home;
  }
#else
  Q_UNUSED(install);
#endif
  return install;
}

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);
  QApplication::setOrganizationName("MetanoicArmor");
  QApplication::setApplicationName("Music Box");
  QApplication::setApplicationDisplayName("Music Box");
  QApplication::setWindowIcon(QIcon(":/assets/app-icon.png"));
  QApplication::setQuitOnLastWindowClosed(false);
  const QString install = findInstallRoot();
  MainWindow window(install, findDataHome(install));
  window.show();
  return app.exec();
}
