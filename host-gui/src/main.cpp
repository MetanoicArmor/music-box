#include "MainWindow.h"

#include <QApplication>
#include <QDir>
#include <QFileInfo>
#include <QIcon>
#include <QMessageBox>

static QString findRoot() {
  QDir dir(QCoreApplication::applicationDirPath());
  for (int i = 0; i < 8; ++i) {
    if (QFileInfo::exists(dir.filePath("dist/server/index.js")) ||
        (QFileInfo::exists(dir.filePath("package.json")) && QDir(dir.filePath("server")).exists()))
      return dir.absolutePath();
    if (!dir.cdUp()) break;
  }
  return QCoreApplication::applicationDirPath();
}

int main(int argc, char *argv[]) {
  QApplication app(argc, argv);
  QApplication::setOrganizationName("MetanoicArmor");
  QApplication::setApplicationName("Music Box");
  QApplication::setApplicationDisplayName("Music Box");
  QApplication::setWindowIcon(QIcon(":/assets/app-icon.png"));
  QApplication::setQuitOnLastWindowClosed(false);
  MainWindow window(findRoot());
  window.show();
  return app.exec();
}
