#pragma once

#include "ApiClient.h"
#include "ConfigFile.h"
#include "ServerProcess.h"

#include <QHash>
#include <QIcon>
#include <QVector>
#include <QJsonArray>
#include <QJsonObject>
#include <QMainWindow>
#include <QTimer>

class QCloseEvent;
class DropZone;
class QPushButton;
class QWidget;

class QLabel;
class QListWidget;
class QPlainTextEdit;
class QPushButton;
class QSlider;
class QLineEdit;
class QSpinBox;
class QCheckBox;
class QSystemTrayIcon;

class MainWindow : public QMainWindow {
  Q_OBJECT
public:
  explicit MainWindow(QString root, QWidget *parent = nullptr);
  ~MainWindow() override;

protected:
  void closeEvent(QCloseEvent *event) override;

private:
  void startServer();
  void stopServer();
  void quitApp();
  void connectApi();
  void applyState(const QJsonObject &state);
  void setQr(const QString &text);
  void loadSettings();
  void saveSettings();
  void renderLibrary();
  void renderHistory();
  void applyEventMode(bool enabled);
  void updateTransport();
  void setAddBusy(bool busy);
  void showTrackMenu(QListWidget *list, const QPoint &pos);
  void saveTrackCopy(const QJsonObject &track);
  void retranslate();
  void setBanner(int banner, const QString &message = {});
  void renderLog(const QJsonArray &entries);
  bool isLive(const QJsonObject &track) const;
  bool isLivePath(const QString &path) const;
  QString formatTime(double seconds) const;
  static QString logAction(const QString &action);

  QString root_;
  ConfigFile config_;
  ServerProcess server_;
  ApiClient api_;
  QTimer probe_;
  QTimer playback_;
  bool sliderHeld_ = false;
  bool quitting_ = false;
  bool loggedIn_ = false;
  bool awaitingLogin_ = false;
  int port_ = 3000;

  QLabel *status_ = nullptr;
  QLabel *title_ = nullptr;
  QLabel *artist_ = nullptr;
  QLabel *online_ = nullptr;
  QLabel *url_ = nullptr;
  QLabel *qr_ = nullptr;
  QLabel *qrUrl_ = nullptr;
  QSlider *seek_ = nullptr;
  QLabel *time_ = nullptr;
  QPushButton *playBtn_ = nullptr;
  QListWidget *queue_ = nullptr;
  QListWidget *history_ = nullptr;
  QListWidget *searchList_ = nullptr;
  QListWidget *libraryList_ = nullptr;
  QLineEdit *addInput_ = nullptr;
  QLineEdit *libraryInput_ = nullptr;
  QLabel *addStatus_ = nullptr;
  QLabel *searchStatus_ = nullptr;
  QLabel *libraryLabel_ = nullptr;
  QLabel *libraryStatus_ = nullptr;
  QLabel *addDisabled_ = nullptr;
  QWidget *addForm_ = nullptr;
  DropZone *dropZone_ = nullptr;
  QLineEdit *historySearch_ = nullptr;
  QPushButton *readdBtn_ = nullptr;
  QPushButton *addBtn_ = nullptr;
  QPushButton *prevBtn_ = nullptr;
  QPushButton *nextBtn_ = nullptr;
  QPushButton *stopPlayBtn_ = nullptr;
  QPushButton *eventBtn_ = nullptr;
  QLabel *nowLabel_ = nullptr;
  QLabel *playerError_ = nullptr;
  QLabel *queueLabel_ = nullptr;
  QLabel *historyLabel_ = nullptr;
  QLabel *historyStatus_ = nullptr;
  QHash<QString, QIcon> thumbs_;
  bool addBusy_ = false;
  bool pendingLibraryAdd_ = false;
  bool hasCurrent_ = false;
  bool hasQueue_ = false;
  bool hasHistory_ = false;
  bool hasPlayback_ = false;
  double duration_ = 0;
  QJsonArray live_;
  QJsonArray historyState_;
  QJsonArray historyRemote_;
  bool historyRemoteActive_ = false;
  QJsonArray library_;
  int libraryTotal_ = 0;
  bool eventModeOn_ = false;
  QPlainTextEdit *log_ = nullptr;
  QPlainTextEdit *serverLog_ = nullptr;
  QLineEdit *banIp_ = nullptr;
  QLineEdit *password_ = nullptr;
  QSpinBox *portBox_ = nullptr;
  QSpinBox *kick_ = nullptr;
  QSpinBox *playingKick_ = nullptr;
  QSpinBox *voteLimit_ = nullptr;
  QSpinBox *voteWindow_ = nullptr;
  QSpinBox *maxUpload_ = nullptr;
  QSpinBox *maxMinutes_ = nullptr;
  QCheckBox *eventMode_ = nullptr;
  QPushButton *langRu_ = nullptr;
  QPushButton *langEn_ = nullptr;
  struct Phrase {
    enum Kind { Button, Label, Check, Placeholder, Tip, Tab, Action };
    QObject *object = nullptr;
    const char *key = nullptr;
    Kind kind = Label;
    int index = -1;
  };
  QVector<Phrase> phrases_;
  QJsonObject lastState_;
  QJsonArray lastLog_;
  QString bannerMessage_;
  int banner_ = 0;
  bool readding_ = false;
  bool reconnecting_ = false;
  QIcon playIcon_;
  QIcon pauseIcon_;
  QSystemTrayIcon *tray_ = nullptr;
  bool paused_ = true;
};
