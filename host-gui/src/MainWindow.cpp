#include "MainWindow.h"

#include "DropZone.h"
#include "UiText.h"
#include "qrcodegen.hpp"

#include <QAction>
#include <QButtonGroup>

#include <QApplication>
#include <QCheckBox>
#include <QCloseEvent>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QFileDialog>
#include <QJsonArray>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QHash>
#include <QLabel>
#include <QLineEdit>
#include <QLocale>
#include <QListWidget>
#include <QMenu>
#include <QMessageBox>
#include <QPainter>
#include <QPainterPath>
#include <QPlainTextEdit>
#include <QProxyStyle>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QPushButton>
#include <QSlider>
#include <QSpinBox>
#include <QSplitter>
#include <QStyle>
#include <QSystemTrayIcon>
#include <QTabWidget>
#include <QUrl>
#include <QVBoxLayout>
#include <QtMath>

static QPixmap qrPixmap(const QString &text, int pixels) {
  const qrcodegen::QrCode qr = qrcodegen::QrCode::encodeText(text.toUtf8().constData(), qrcodegen::QrCode::Ecc::MEDIUM);
  const int n = qr.getSize();
  const int scale = qMax(1, pixels / n);
  QImage image(n * scale, n * scale, QImage::Format_RGB32);
  image.fill(Qt::white);
  for (int y = 0; y < n; ++y) {
    for (int x = 0; x < n; ++x) {
      if (!qr.getModule(x, y)) continue;
      for (int dy = 0; dy < scale; ++dy)
        for (int dx = 0; dx < scale; ++dx)
          image.setPixel(x * scale + dx, y * scale + dy, qRgb(0, 0, 0));
    }
  }
  return QPixmap::fromImage(image);
}

enum TrackRole { RoleId = Qt::UserRole, RoleArtist, RoleIp, RolePayload, RoleQueued, RoleThumb };

static QString formatDuration(const QJsonValue &value) {
  const double sec = value.toDouble();
  if (!(sec > 0)) return {};
  const int total = qRound(sec);
  const int h = total / 3600;
  const int m = (total % 3600) / 60;
  const int s = total % 60;
  if (h > 0) return QString("%1:%2:%3").arg(h).arg(m, 2, 10, QChar('0')).arg(s, 2, 10, QChar('0'));
  return QString("%1:%2").arg(m).arg(s, 2, 10, QChar('0'));
}

static QString displayArtist(const QString &title, const QString &artist) {
  const QString name = artist.trimmed();
  if (name.isEmpty() || name == "Unknown" || title.contains(name)) return {};
  return name;
}

enum {
  BannerStopped = 0,
  BannerStarting,
  BannerRunning,
  BannerRestarting,
  BannerSaved,
  BannerReconnecting,
  BannerMissing,
  BannerMessage
};

static void setStatus(QLabel *label, const char *tone, const QString &text) {
  label->setProperty("tone", tone);
  label->style()->unpolish(label);
  label->style()->polish(label);
  label->setText(text);
}

static bool isDirectUrl(const QString &value) {
  return value.contains("youtube.com", Qt::CaseInsensitive) || value.contains("youtu.be", Qt::CaseInsensitive) ||
         value.contains("spotify.com", Qt::CaseInsensitive);
}

static QString normalizedPath(const QString &path) {
  return QDir::cleanPath(QDir::fromNativeSeparators(path.trimmed())).toLower();
}

static QString downloadBadge(const QJsonObject &track) {
  if (track.value("source").toString() == "local") return {};
  const QString status = track.value("download_status").toString();
  if (status == "pending") return ui("track.pending");
  if (status == "downloading") return ui("track.downloading");
  if (status == "failed") return ui("track.failed");
  return {};
}

static QString trackLine(const QJsonObject &track, const QString &prefix) {
  const QString title = track.value("title").toString();
  const QString artist = displayArtist(title, track.value("artist").toString());
  QStringList meta;
  const QString emoji = track.value("sessionEmoji").toString();
  if (!emoji.isEmpty()) meta << emoji;
  const QString duration = formatDuration(track.value("duration_sec"));
  if (!duration.isEmpty()) meta << duration;
  const int score = track.value("vote_score").toInt();
  if (score != 0) meta << (score > 0 ? QString("+%1").arg(score) : QString::number(score));
  const QString badge = downloadBadge(track);
  if (!badge.isEmpty()) meta << badge;
  const QString ip = track.value("addedByIp").toString();
  if (!ip.isEmpty()) meta << ip;
  QString line = prefix + title + (artist.isEmpty() ? QString() : " — " + artist);
  if (!meta.isEmpty()) line += "   ·  " + meta.join("  ·  ");
  return line;
}

static QIcon colorDot(const QString &color) {
  QPixmap pixmap(14, 14);
  pixmap.fill(Qt::transparent);
  if (QColor(color).isValid()) {
    QPainter painter(&pixmap);
    painter.setRenderHint(QPainter::Antialiasing, true);
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(color));
    painter.drawEllipse(QRectF(2, 2, 10, 10));
  }
  return QIcon(pixmap);
}

static QIcon noteIcon() {
  QPixmap pixmap(48, 36);
  pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap);
  painter.setRenderHint(QPainter::Antialiasing, true);
  painter.setPen(Qt::NoPen);
  painter.setBrush(QColor("#232326"));
  painter.drawRoundedRect(QRectF(6, 0, 36, 36), 8, 8);
  painter.setPen(QColor("#7dd3c0"));
  QFont font = painter.font();
  font.setPixelSize(20);
  painter.setFont(font);
  painter.drawText(QRectF(6, 0, 36, 36), Qt::AlignCenter, QString::fromUtf8("♪"));
  return QIcon(pixmap);
}

static bool canListen(const QJsonObject &track) {
  if (track.value("status").toString() == "removed") return false;
  const QString download = track.value("download_status").toString();
  if (download == "pending" || download == "downloading" || download == "failed") return false;
  return !track.value("file_path").toString().isEmpty();
}

static void storeTrack(QListWidgetItem *item, const QJsonObject &track) {
  item->setData(RoleId, track.value("id").toString());
  item->setData(RoleArtist, track.value("artist").toString());
  item->setData(RoleIp, track.value("addedByIp").toString());
  item->setData(RolePayload, QJsonDocument(track).toJson(QJsonDocument::Compact));
  item->setIcon(colorDot(track.value("sessionColor").toString()));
  QStringList tip;
  tip << track.value("title").toString();
  const QString artist = track.value("artist").toString().trimmed();
  if (!artist.isEmpty() && artist != "Unknown") tip << artist;
  if (track.value("download_status").toString() == "failed" && track.value("source").toString() != "local")
    tip << ui("errors.downloadFailed");
  tip << ui("host.rightClick");
  item->setToolTip(tip.join("\n"));
}

static QJsonObject payloadOf(const QListWidgetItem *item) {
  return item ? QJsonDocument::fromJson(item->data(RolePayload).toByteArray()).object() : QJsonObject();
}

class JumpSliderStyle : public QProxyStyle {
public:
  int styleHint(StyleHint hint, const QStyleOption *option, const QWidget *widget,
                QStyleHintReturn *returnData) const override {
    if (hint == QStyle::SH_Slider_AbsoluteSetButtons) return Qt::LeftButton;
    return QProxyStyle::styleHint(hint, option, widget, returnData);
  }
};

enum class MediaGlyph { Previous, Play, Pause, Next, Stop };

static QPixmap mediaPixmap(MediaGlyph glyph, const QColor &color, int size);

static QIcon mediaIcon(MediaGlyph glyph, const QColor &color = QColor("#f5f5f7"), int size = 44) {
  QIcon icon(mediaPixmap(glyph, color, size));
  icon.addPixmap(mediaPixmap(glyph, QColor("#4a4a50"), size), QIcon::Disabled);
  return icon;
}

static QPixmap mediaPixmap(MediaGlyph glyph, const QColor &color, int size) {
  QPixmap pixmap(size, size);
  pixmap.fill(Qt::transparent);
  QPainter painter(&pixmap);
  painter.setRenderHint(QPainter::Antialiasing, true);
  painter.setPen(Qt::NoPen);
  painter.setBrush(color);
  const qreal s = size;
  switch (glyph) {
    case MediaGlyph::Play: {
      QPainterPath path;
      path.moveTo(s * 0.34, s * 0.22);
      path.lineTo(s * 0.78, s * 0.50);
      path.lineTo(s * 0.34, s * 0.78);
      path.closeSubpath();
      painter.drawPath(path);
      break;
    }
    case MediaGlyph::Pause: {
      const qreal w = s * 0.14;
      const qreal h = s * 0.48;
      const qreal y = (s - h) / 2.0;
      painter.drawRoundedRect(QRectF(s * 0.30, y, w, h), 2.5, 2.5);
      painter.drawRoundedRect(QRectF(s * 0.56, y, w, h), 2.5, 2.5);
      break;
    }
    case MediaGlyph::Stop: {
      const qreal side = s * 0.38;
      painter.drawRoundedRect(QRectF((s - side) / 2.0, (s - side) / 2.0, side, side), 3.0, 3.0);
      break;
    }
    case MediaGlyph::Previous: {
      QPainterPath bar;
      bar.addRoundedRect(QRectF(s * 0.24, s * 0.24, s * 0.10, s * 0.52), 2.0, 2.0);
      painter.drawPath(bar);
      QPainterPath tri;
      tri.moveTo(s * 0.78, s * 0.22);
      tri.lineTo(s * 0.38, s * 0.50);
      tri.lineTo(s * 0.78, s * 0.78);
      tri.closeSubpath();
      painter.drawPath(tri);
      break;
    }
    case MediaGlyph::Next: {
      QPainterPath tri;
      tri.moveTo(s * 0.22, s * 0.22);
      tri.lineTo(s * 0.62, s * 0.50);
      tri.lineTo(s * 0.22, s * 0.78);
      tri.closeSubpath();
      painter.drawPath(tri);
      QPainterPath bar;
      bar.addRoundedRect(QRectF(s * 0.66, s * 0.24, s * 0.10, s * 0.52), 2.0, 2.0);
      painter.drawPath(bar);
      break;
    }
  }
  return pixmap;
}

static QPushButton *makeTransportButton(QWidget *parent, const QIcon &icon, const QString &tip, bool primary = false) {
  auto *button = new QPushButton(parent);
  button->setIcon(icon);
  button->setIconSize(QSize(primary ? 28 : 22, primary ? 28 : 22));
  button->setFixedSize(primary ? 56 : 44, primary ? 56 : 44);
  button->setCursor(Qt::PointingHandCursor);
  button->setToolTip(tip);
  button->setProperty("transport", true);
  button->setProperty("primaryTransport", primary);
  button->setFlat(true);
  return button;
}

MainWindow::MainWindow(QString installRoot, QString dataHome, QWidget *parent)
    : QMainWindow(parent),
      root_(std::move(installRoot)),
      dataHome_(dataHome.isEmpty() ? root_ : std::move(dataHome)),
      config_(dataHome_ + "/config.json") {
  const auto bindButton = [this](QPushButton *widget, const char *key) {
    widget->setText(ui(key));
    phrases_.append(Phrase{widget, key, Phrase::Button, -1});
  };
  const auto bindLabel = [this](QLabel *widget, const char *key) {
    widget->setText(ui(key));
    phrases_.append(Phrase{widget, key, Phrase::Label, -1});
  };
  const auto bindCheck = [this](QCheckBox *widget, const char *key) {
    widget->setText(ui(key));
    phrases_.append(Phrase{widget, key, Phrase::Check, -1});
  };
  const auto bindPlaceholder = [this](QLineEdit *widget, const char *key) {
    widget->setPlaceholderText(ui(key));
    phrases_.append(Phrase{widget, key, Phrase::Placeholder, -1});
  };
  const auto bindTip = [this](QWidget *widget, const char *key) {
    widget->setToolTip(ui(key));
    phrases_.append(Phrase{widget, key, Phrase::Tip, -1});
  };
  const auto bindTab = [this](QTabWidget *tabs, int index, const char *key) {
    tabs->setTabText(index, ui(key));
    phrases_.append(Phrase{tabs, key, Phrase::Tab, index});
  };
  const auto bindAction = [this](QAction *action, const char *key) {
    action->setText(ui(key));
    phrases_.append(Phrase{action, key, Phrase::Action, -1});
  };

  setWindowTitle("Music Box");
  resize(980, 680);
  setStyleSheet(
    "QMainWindow, QWidget { background: #111; color: #f2f2f2; }"
    "QLineEdit, QSpinBox, QListWidget, QPlainTextEdit { background: #1c1c1e; color: #f2f2f2; border: 1px solid #333; border-radius: 6px; padding: 4px; }"
    "QPushButton { background: #2a2a2c; color: #f2f2f2; border: none; border-radius: 8px; padding: 8px 12px; }"
    "QPushButton:hover { background: #3a3a3c; }"
    "QPushButton[transport=\"true\"] { background: #232326; border: 1px solid #3a3a3e; border-radius: 22px; padding: 0; }"
    "QPushButton[transport=\"true\"]:hover { background: #323236; border-color: #555; }"
    "QPushButton[transport=\"true\"]:pressed { background: #1a1a1c; }"
    "QPushButton[primaryTransport=\"true\"] { background: #f2f2f2; border: none; border-radius: 28px; }"
    "QPushButton[primaryTransport=\"true\"]:hover { background: #ffffff; }"
    "QPushButton[primaryTransport=\"true\"]:pressed { background: #d8d8d8; }"
    "QSlider::groove:horizontal { height: 6px; background: #2a2a2e; border-radius: 3px; }"
    "QSlider::sub-page:horizontal { background: #7dd3c0; border-radius: 3px; }"
    "QSlider::handle:horizontal { width: 16px; height: 16px; margin: -5px 0; background: #f2f2f2; border-radius: 8px; }"
    "QTabWidget::pane { border: 0; }"
    "QTabBar::tab { background: #1c1c1e; padding: 8px 14px; }"
    "QTabBar::tab:selected { background: #333; }"
    "QPushButton:disabled, QLineEdit:disabled, QListWidget:disabled { color: #666; }"
    "QPushButton[danger=\"true\"] { background: #3a1d20; color: #ffb4b4; }"
    "QPushButton[danger=\"true\"]:hover { background: #4d2428; }"
    "QPushButton[eventOn=\"true\"] { background: #4a3a14; color: #f2d98a; }"
    "QPushButton[transport=\"true\"]:disabled { background: #19191b; border-color: #26262a; }"
    "QPushButton[primaryTransport=\"true\"]:disabled { background: #555; }"
    "QLabel[tone=\"error\"] { color: #ff8a8a; background: #2a1618; border: 1px solid #5a2a2e; border-radius: 8px; padding: 8px 10px; }"
    "QLabel[tone=\"success\"] { color: #9ee6c8; background: #14261f; border: 1px solid #2a5a48; border-radius: 8px; padding: 8px 10px; }"
    "#eventBanner { background: #1d1a12; border: 1px solid #5a4a22; border-radius: 12px; padding: 14px; color: #f2d98a; }"
    "QPushButton[lang=\"true\"] { min-width: 42px; padding: 6px 12px; }"
    "QPushButton[lang=\"true\"]:checked { background: #f2f2f2; color: #111; }");

  auto *central = new QWidget(this);
  auto *rootLayout = new QVBoxLayout(central);
  auto *top = new QHBoxLayout();
  status_ = new QLabel;
  setBanner(BannerStopped);
  online_ = new QLabel("0 online");
  url_ = new QLabel;
  url_->setTextInteractionFlags(Qt::TextSelectableByMouse);
  auto *openBtn = new QPushButton;
  bindButton(openBtn, "host.openSite");
  auto *stopBtn = new QPushButton;
  bindButton(stopBtn, "host.stopServer");
  top->addWidget(status_, 1);
  top->addWidget(online_);
  top->addWidget(url_);
  top->addWidget(openBtn);
  top->addWidget(stopBtn);
  rootLayout->addLayout(top);

  auto *tabs = new QTabWidget;
  auto *hostPage = new QWidget;
  auto *hostLayout = new QHBoxLayout(hostPage);

  auto *now = new QVBoxLayout;
  nowLabel_ = new QLabel(ui("admin.player").toUpper());
  nowLabel_->setAlignment(Qt::AlignHCenter);
  nowLabel_->setStyleSheet("color: #7dd3c0; font-size: 11px; font-weight: 700; letter-spacing: 1.5px;");
  playerError_ = new QLabel;
  playerError_->setWordWrap(true);
  playerError_->setAlignment(Qt::AlignHCenter);
  playerError_->setVisible(false);
  title_ = new QLabel(ui("admin.idle"));
  title_->setWordWrap(true);
  title_->setStyleSheet("font-size: 20px; font-weight: 700;");
  artist_ = new QLabel;
  artist_->setStyleSheet("color: #aaa;");
  auto *timeRow = new QHBoxLayout;
  time_ = new QLabel("0:00 / 0:00");
  time_->setMinimumWidth(92);
  time_->setStyleSheet("color: #aaa; font-variant-numeric: tabular-nums;");
  seek_ = new QSlider(Qt::Horizontal);
  seek_->setRange(0, 0);
  seek_->setCursor(Qt::PointingHandCursor);
  auto *jumpStyle = new JumpSliderStyle;
  jumpStyle->setParent(seek_);
  seek_->setStyle(jumpStyle);
  timeRow->addWidget(time_);
  timeRow->addWidget(seek_, 1);
  auto *buttons = new QHBoxLayout;
  buttons->setSpacing(10);
  buttons->setAlignment(Qt::AlignCenter);
  playIcon_ = mediaIcon(MediaGlyph::Play, QColor("#111111"), 56);
  pauseIcon_ = mediaIcon(MediaGlyph::Pause, QColor("#111111"), 56);
  auto *prev = prevBtn_ = makeTransportButton(this, mediaIcon(MediaGlyph::Previous), ui("admin.prev"));
  bindTip(prevBtn_, "admin.prev");
  playBtn_ = makeTransportButton(this, playIcon_, ui("admin.play"), true);
  auto *next = nextBtn_ = makeTransportButton(this, mediaIcon(MediaGlyph::Next), ui("admin.next"));
  bindTip(nextBtn_, "admin.next");
  auto *stopPlay = stopPlayBtn_ = makeTransportButton(this, mediaIcon(MediaGlyph::Stop), ui("admin.stop"));
  bindTip(stopPlayBtn_, "admin.stop");
  buttons->addStretch();
  buttons->addWidget(prev);
  buttons->addWidget(playBtn_);
  buttons->addWidget(next);
  buttons->addWidget(stopPlay);
  buttons->addStretch();

  auto *qrCard = new QWidget;
  qrCard->setObjectName("qrCard");
  qrCard->setStyleSheet(
    "#qrCard { background: #1a1a1d; border: 1px solid #2e2e32; border-radius: 18px; }"
    "#qrCard QLabel { background: transparent; border: none; }");
  auto *qrLayout = new QVBoxLayout(qrCard);
  qrLayout->setContentsMargins(18, 16, 18, 16);
  qrLayout->setSpacing(10);
  auto *qrCaption = new QLabel;
  bindLabel(qrCaption, "admin.qrTitle");
  qrCaption->setAlignment(Qt::AlignCenter);
  qrCaption->setStyleSheet("color: #ddd; font-size: 13px; font-weight: 600; letter-spacing: 0.3px;");
  auto *qrHint = new QLabel;
  bindLabel(qrHint, "admin.qrHint");
  qrHint->setAlignment(Qt::AlignCenter);
  qrHint->setStyleSheet("color: #888; font-size: 11px;");
  qr_ = new QLabel;
  qr_->setFixedSize(188, 188);
  qr_->setAlignment(Qt::AlignCenter);
  qr_->setStyleSheet("background: #fff; border-radius: 14px; padding: 10px;");
  qrUrl_ = new QLabel;
  qrUrl_->setAlignment(Qt::AlignCenter);
  qrUrl_->setTextInteractionFlags(Qt::TextSelectableByMouse);
  qrUrl_->setWordWrap(true);
  qrUrl_->setStyleSheet("color: #9ad8c8; font-size: 12px;");
  qrLayout->addWidget(qrCaption);
  qrLayout->addWidget(qr_, 0, Qt::AlignHCenter);
  qrLayout->addWidget(qrUrl_);
  qrLayout->addWidget(qrHint);

  title_->setAlignment(Qt::AlignHCenter);
  artist_->setAlignment(Qt::AlignHCenter);
  now->setSpacing(10);
  now->addWidget(nowLabel_);
  now->addWidget(title_);
  now->addWidget(artist_);
  now->addWidget(playerError_);
  now->addSpacing(4);
  now->addLayout(timeRow);
  now->addSpacing(6);
  now->addLayout(buttons);
  now->addStretch(1);
  now->addWidget(qrCard, 0, Qt::AlignHCenter | Qt::AlignBottom);
  now->addSpacing(8);
  hostLayout->addLayout(now, 2);

  auto *side = new QVBoxLayout;
  queue_ = new QListWidget;
  history_ = new QListWidget;
  auto *queueButtons = new QHBoxLayout;
  auto *del = new QPushButton;
  bindButton(del, "track.deleteTrack");
  auto *delArtist = new QPushButton;
  bindButton(delArtist, "track.deleteArtist");
  auto *clearQ = new QPushButton;
  bindButton(clearQ, "admin.clearQueue");
  clearQ->setProperty("danger", true);
  queueButtons->addWidget(del);
  queueButtons->addWidget(delArtist);
  queueButtons->addStretch();
  auto *historyButtons = new QHBoxLayout;
  readdBtn_ = new QPushButton(ui("history.toQueue"));
  auto *readd = readdBtn_;
  historySearch_ = new QLineEdit;
  bindPlaceholder(historySearch_, "host.historySearch");
  historySearch_->setClearButtonEnabled(true);
  historyStatus_ = new QLabel;
  historyStatus_->setWordWrap(true);
  historyStatus_->setVisible(false);
  auto *delHistory = new QPushButton;
  bindButton(delHistory, "host.deleteFromHistory");
  auto *clearH = new QPushButton;
  bindButton(clearH, "admin.clearHistory");
  clearH->setProperty("danger", true);
  historyButtons->addWidget(readd);
  historyButtons->addWidget(delHistory);
  historyButtons->addStretch();
  eventBtn_ = new QPushButton;
  bindTip(eventBtn_, "admin.eventHelp");
  auto *controls = new QHBoxLayout;
  controls->addWidget(clearQ);
  controls->addWidget(clearH);
  controls->addWidget(eventBtn_);
  controls->addStretch();
  auto *banRow = new QHBoxLayout;
  banIp_ = new QLineEdit;
  bindPlaceholder(banIp_, "host.ipPlaceholder");
  auto *ban = new QPushButton;
  bindButton(ban, "track.ban");
  ban->setProperty("danger", true);
  auto *unban = new QPushButton;
  bindButton(unban, "track.unban");
  auto *banLabel = new QLabel;
  bindLabel(banLabel, "admin.banIp");
  banRow->addWidget(banLabel);
  banRow->addWidget(banIp_, 1);
  banRow->addWidget(ban);
  banRow->addWidget(unban);
  queueLabel_ = new QLabel(ui("admin.sectionQueue") + " (0)");
  historyLabel_ = new QLabel(ui("admin.sectionHistory") + " (0)");
  for (QLabel *label : {queueLabel_, historyLabel_}) label->setStyleSheet("font-weight: 700; font-size: 14px;");
  side->addLayout(controls);
  side->addLayout(banRow);
  side->addWidget(queueLabel_);
  side->addWidget(queue_, 3);
  side->addLayout(queueButtons);
  side->addWidget(historyLabel_);
  side->addWidget(historySearch_);
  side->addWidget(historyStatus_);
  side->addWidget(history_, 2);
  side->addLayout(historyButtons);
  for (QListWidget *list : {queue_, history_}) list->setContextMenuPolicy(Qt::CustomContextMenu);
  hostLayout->addLayout(side, 3);
  tabs->addTab(hostPage, QString());
  bindTab(tabs, 0, "nav.host");

  auto *addPage = new QWidget;
  auto *addLayout = new QVBoxLayout(addPage);
  addLayout->setSpacing(8);
  addDisabled_ = new QLabel;
  addDisabled_->setObjectName("eventBanner");
  addDisabled_->setWordWrap(true);
  addDisabled_->setAlignment(Qt::AlignCenter);
  addDisabled_->setVisible(false);
  addStatus_ = new QLabel;
  addStatus_->setWordWrap(true);
  addForm_ = new QWidget;
  auto *formLayout = new QVBoxLayout(addForm_);
  formLayout->setContentsMargins(0, 0, 0, 0);
  formLayout->setSpacing(8);
  addInput_ = new QLineEdit;
  bindPlaceholder(addInput_, "add.searchPlaceholder");
  addInput_->setClearButtonEnabled(true);
  auto *addBtn = addBtn_ = new QPushButton;
  addBtn->setEnabled(false);
  auto *inputRow = new QHBoxLayout;
  inputRow->addWidget(addInput_, 1);
  inputRow->addWidget(addBtn);
  searchStatus_ = new QLabel;
  searchStatus_->setStyleSheet("color: #999;");
  searchStatus_->setVisible(false);
  searchList_ = new QListWidget;
  searchList_->setIconSize(QSize(48, 36));
  libraryLabel_ = new QLabel(ui("add.library"));
  libraryInput_ = new QLineEdit;
  bindPlaceholder(libraryInput_, "add.libraryPlaceholder");
  libraryInput_->setClearButtonEnabled(true);
  libraryStatus_ = new QLabel(ui("add.searching"));
  libraryStatus_->setStyleSheet("color: #999;");
  libraryStatus_->setVisible(false);
  libraryList_ = new QListWidget;
  auto *linkLabel = new QLabel;
  bindLabel(linkLabel, "add.linkOrSearch");
  formLayout->addWidget(linkLabel);
  formLayout->addLayout(inputRow);
  formLayout->addWidget(searchStatus_);
  formLayout->addWidget(searchList_, 1);
  const auto divider = [this, bindLabel] {
    auto *label = new QLabel;
    bindLabel(label, "add.or");
    label->setAlignment(Qt::AlignCenter);
    label->setStyleSheet("color: #777;");
    return label;
  };
  formLayout->addWidget(divider());
  formLayout->addWidget(libraryLabel_);
  formLayout->addWidget(libraryInput_);
  formLayout->addWidget(libraryStatus_);
  formLayout->addWidget(libraryList_, 1);
  formLayout->addWidget(divider());
  dropZone_ = new DropZone;
  addLayout->addWidget(addDisabled_);
  addLayout->addWidget(addStatus_);
  addLayout->addWidget(addForm_, 1);
  addLayout->addWidget(dropZone_);
  tabs->addTab(addPage, QString());
  bindTab(tabs, 1, "nav.add");

  auto *settings = new QWidget;
  auto *form = new QFormLayout(settings);
  password_ = new QLineEdit;
  portBox_ = new QSpinBox; portBox_->setRange(1, 65535);
  kick_ = new QSpinBox; kick_->setRange(-100, 100);
  playingKick_ = new QSpinBox; playingKick_->setRange(1, 100);
  voteLimit_ = new QSpinBox; voteLimit_->setRange(1, 1000);
  voteWindow_ = new QSpinBox; voteWindow_->setRange(1, 3600);
  maxUpload_ = new QSpinBox; maxUpload_->setRange(1, 2000);
  maxMinutes_ = new QSpinBox; maxMinutes_->setRange(0, 180);
  eventMode_ = new QCheckBox;
  bindCheck(eventMode_, "host.eventVoteOnly");
  bindTip(eventMode_, "admin.eventHelp");
  langRu_ = new QPushButton("Ru");
  langEn_ = new QPushButton("En");
  for (QPushButton *button : {langRu_, langEn_}) {
    button->setCheckable(true);
    button->setProperty("lang", true);
    button->setCursor(Qt::PointingHandCursor);
  }
  auto *langGroup = new QButtonGroup(this);
  langGroup->setExclusive(true);
  langGroup->addButton(langRu_);
  langGroup->addButton(langEn_);
  (UiText::code() == "en" ? langEn_ : langRu_)->setChecked(true);
  auto *langBox = new QWidget;
  auto *langLay = new QHBoxLayout(langBox);
  langLay->setContentsMargins(0, 0, 0, 0);
  auto *langSep = new QLabel("|");
  langSep->setStyleSheet("color: #666;");
  langLay->addWidget(langRu_);
  langLay->addWidget(langSep);
  langLay->addWidget(langEn_);
  langLay->addStretch();
  auto *langLabel = new QLabel;
  bindLabel(langLabel, "host.language");
  form->addRow(langLabel, langBox);
  const auto addField = [&](const char *key, QWidget *field) {
    auto *label = new QLabel;
    bindLabel(label, key);
    form->addRow(label, field);
  };
  addField("admin.password", password_);
  addField("host.port", portBox_);
  addField("host.kick", kick_);
  addField("host.playingKick", playingKick_);
  addField("host.voteLimit", voteLimit_);
  addField("host.voteWindow", voteWindow_);
  addField("host.maxUpload", maxUpload_);
  addField("host.maxMinutes", maxMinutes_);
  form->addRow(eventMode_);
  auto *save = new QPushButton;
  bindButton(save, "host.save");
  form->addRow(save);
  auto *settingsHint = new QLabel;
  settingsHint->setWordWrap(true);
  bindLabel(settingsHint, "host.settingsHint");
  form->addRow(settingsHint);
  tabs->addTab(settings, QString());
  bindTab(tabs, 2, "host.settings");
  connect(langRu_, &QPushButton::clicked, this, [] { UiText::instance()->setCode("ru"); });
  connect(langEn_, &QPushButton::clicked, this, [] { UiText::instance()->setCode("en"); });

  auto *logs = new QSplitter(Qt::Vertical);
  log_ = new QPlainTextEdit; log_->setReadOnly(true);
  serverLog_ = new QPlainTextEdit; serverLog_->setReadOnly(true);
  logs->addWidget(log_);
  logs->addWidget(serverLog_);
  tabs->addTab(logs, QString());
  bindTab(tabs, 3, "admin.sectionLog");
  rootLayout->addWidget(tabs, 1);
  setCentralWidget(central);

  tray_ = new QSystemTrayIcon(QApplication::windowIcon(), this);
  auto *menu = new QMenu(this);
  bindAction(menu->addAction(QString(), this, [this] {
    showNormal();
    raise();
    activateWindow();
  }), "host.open");
  bindAction(menu->addAction(QString(), this, &MainWindow::quitApp), "host.quit");
  tray_->setContextMenu(menu);
  tray_->show();
  connect(tray_, &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason) {
    if (reason == QSystemTrayIcon::DoubleClick || reason == QSystemTrayIcon::Trigger) {
      showNormal();
      raise();
      activateWindow();
    }
  });
  connect(qApp, &QCoreApplication::aboutToQuit, this, [this] { stopServer(); });

  connect(openBtn, &QPushButton::clicked, this, [this] {
    QDesktopServices::openUrl(QUrl(QString("http://127.0.0.1:%1").arg(port_)));
  });
  connect(stopBtn, &QPushButton::clicked, this, &MainWindow::stopServer);
  const auto clearPlayerError = [this] { playerError_->setVisible(false); };
  connect(playBtn_, &QPushButton::clicked, this, [this, clearPlayerError] {
    clearPlayerError();
    if (paused_) api_.resume();
    else api_.pause();
  });
  connect(prev, &QPushButton::clicked, this, [this, clearPlayerError] { clearPlayerError(); api_.previous(); });
  connect(next, &QPushButton::clicked, this, [this, clearPlayerError] { clearPlayerError(); api_.skip(); });
  connect(stopPlay, &QPushButton::clicked, this, [this, clearPlayerError] { clearPlayerError(); api_.stopPlayback(); });
  connect(&api_, &ApiClient::playerFailed, this, [this](const QString &message) {
    setStatus(playerError_, "error", message);
    playerError_->setVisible(true);
  });
  connect(del, &QPushButton::clicked, this, [this] {
    auto *item = queue_->currentItem();
    if (item && !item->data(RoleId).toString().isEmpty()) api_.deleteTrack(item->data(RoleId).toString());
  });
  connect(delArtist, &QPushButton::clicked, this, [this] {
    auto *item = queue_->currentItem();
    if (!item || item->data(RoleId).toString().isEmpty()) return;
    const QString artist = item->data(RoleArtist).toString();
    if (QMessageBox::question(this, "Music Box", ui("admin.confirmDeleteArtist").replace("{artist}", artist)) != QMessageBox::Yes)
      return;
    api_.deleteArtist(artist);
  });
  connect(clearQ, &QPushButton::clicked, &api_, &ApiClient::clearQueue);
  connect(eventBtn_, &QPushButton::clicked, this, [this] {
    const bool on = !eventModeOn_;
    config_.setEventMode(on);
    if (server_.isRunning()) api_.setEventMode(on);
  });
  connect(readd, &QPushButton::clicked, this, [this] {
    auto *item = history_->currentItem();
    if (!item || eventModeOn_ || item->data(RoleQueued).toBool() || item->data(RoleId).toString().isEmpty()) return;
    historyStatus_->setVisible(false);
    readding_ = true;
    readdBtn_->setEnabled(false);
    readdBtn_->setText(ui("history.adding"));
    api_.readdTrack(item->data(RoleId).toString());
  });
  connect(&api_, &ApiClient::trackReadded, this, [this](const QString &title) {
    readding_ = false;
    readdBtn_->setText(ui("history.toQueue"));
    setStatus(historyStatus_, "success", ui("history.readded").replace("{title}", title));
    historyStatus_->setVisible(true);
  });
  connect(&api_, &ApiClient::historyFailed, this, [this](const QString &message) {
    readding_ = false;
    readdBtn_->setText(ui("history.toQueue"));
    setStatus(historyStatus_, "error", message);
    historyStatus_->setVisible(true);
    auto *item = history_->currentItem();
    readdBtn_->setEnabled(!eventModeOn_ && item && !item->data(RoleQueued).toBool());
  });
  connect(queue_, &QListWidget::customContextMenuRequested, this, [this](const QPoint &pos) { showTrackMenu(queue_, pos); });
  connect(history_, &QListWidget::customContextMenuRequested, this, [this](const QPoint &pos) { showTrackMenu(history_, pos); });
  connect(history_, &QListWidget::itemActivated, readd, &QPushButton::click);
  connect(delHistory, &QPushButton::clicked, this, [this] {
    auto *item = history_->currentItem();
    if (item && !item->data(RoleId).toString().isEmpty()) api_.deleteTrack(item->data(RoleId).toString());
  });
  auto *historyTimer = new QTimer(this);
  historyTimer->setSingleShot(true);
  historyTimer->setInterval(250);
  connect(historySearch_, &QLineEdit::textChanged, this, [this, historyTimer](const QString &text) {
    historyRemoteActive_ = false;
    renderHistory();
    if (text.trimmed().size() < 2) historyTimer->stop();
    else historyTimer->start();
  });
  connect(historyTimer, &QTimer::timeout, this, [this] {
    const QString query = historySearch_->text().trimmed();
    if (query.size() >= 2 && loggedIn_) api_.searchHistory(query);
  });
  connect(&api_, &ApiClient::historySearchReceived, this, [this](const QString &query, const QJsonArray &tracks) {
    if (historySearch_->text().trimmed() != query) return;
    historyRemote_ = tracks;
    historyRemoteActive_ = true;
    renderHistory();
  });
  connect(clearH, &QPushButton::clicked, this, [this] {
    if (QMessageBox::question(this, "Music Box", ui("admin.confirmClearHistory")) != QMessageBox::Yes) return;
    api_.clearHistory();
  });
  connect(ban, &QPushButton::clicked, this, [this] {
    const QString ip = banIp_->text().trimmed();
    if (ip.isEmpty()) return;
    api_.banIp(ip);
    banIp_->clear();
  });
  connect(unban, &QPushButton::clicked, this, [this] {
    const QString ip = banIp_->text().trimmed();
    if (ip.isEmpty()) return;
    api_.unbanIp(ip);
    banIp_->clear();
  });
  connect(banIp_, &QLineEdit::returnPressed, ban, &QPushButton::click);
  connect(queue_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem *current, QListWidgetItem *) {
    if (current && !current->data(RoleIp).toString().isEmpty()) banIp_->setText(current->data(RoleIp).toString());
  });
  connect(history_, &QListWidget::currentItemChanged, this, [this](QListWidgetItem *current, QListWidgetItem *) {
    if (current && !current->data(RoleIp).toString().isEmpty()) banIp_->setText(current->data(RoleIp).toString());
    const bool queued = current && current->data(RoleQueued).toBool();
    readdBtn_->setText(queued ? ui("history.added") : ui("history.toQueue"));
    readdBtn_->setEnabled(!eventModeOn_ && current && !queued && !current->data(RoleId).toString().isEmpty());
  });

  auto *searchTimer = new QTimer(this);
  searchTimer->setSingleShot(true);
  searchTimer->setInterval(350);
  connect(addInput_, &QLineEdit::textChanged, this, [this, searchTimer](const QString &text) {
    const QString query = text.trimmed();
    addBtn_->setEnabled(!addBusy_ && !query.isEmpty());
    if (query.size() < 2 || isDirectUrl(query)) {
      searchTimer->stop();
      searchList_->clear();
      searchStatus_->setVisible(false);
      return;
    }
    searchStatus_->setText(ui("add.searching"));
    searchStatus_->setVisible(true);
    searchTimer->start();
  });
  connect(searchTimer, &QTimer::timeout, this, [this] { api_.search(addInput_->text().trimmed()); });
  connect(addBtn, &QPushButton::clicked, this, [this] {
    const QString query = addInput_->text().trimmed();
    if (query.isEmpty() || eventModeOn_ || addBusy_) return;
    setAddBusy(true);
    api_.addInput(query);
  });
  connect(addInput_, &QLineEdit::returnPressed, addBtn, &QPushButton::click);
  connect(searchList_, &QListWidget::itemActivated, this, [this](QListWidgetItem *item) {
    if (item->data(RolePayload).isNull() || eventModeOn_ || addBusy_) return;
    setAddBusy(true);
    api_.addSuggestion(payloadOf(item));
  });
  connect(&api_, &ApiClient::uploaded, this, [this](const QString &message) {
    setAddBusy(false);
    setStatus(addStatus_, "success", message);
  });
  connect(&api_, &ApiClient::trackAdded, this, [this](const QString &message) {
    setAddBusy(false);
    setStatus(addStatus_, "success", message);
    addInput_->clear();
    searchList_->clear();
    searchStatus_->setVisible(false);
    if (pendingLibraryAdd_) {
      pendingLibraryAdd_ = false;
      libraryInput_->clear();
    }
  });
  connect(&api_, &ApiClient::addFailed, this, [this](const QString &message) {
    setAddBusy(false);
    pendingLibraryAdd_ = false;
    setStatus(addStatus_, "error", message);
  });
  connect(&api_, &ApiClient::imageReceived, this, [this](const QUrl &url, const QImage &image) {
    const QIcon icon(QPixmap::fromImage(image.scaled(48, 36, Qt::KeepAspectRatioByExpanding, Qt::SmoothTransformation)));
    thumbs_.insert(url.toString(), icon);
    for (int i = 0; i < searchList_->count(); ++i) {
      QListWidgetItem *row = searchList_->item(i);
      if (row->data(RoleThumb).toString() == url.toString()) row->setIcon(icon);
    }
  });
  auto *libraryTimer = new QTimer(this);
  libraryTimer->setSingleShot(true);
  libraryTimer->setInterval(250);
  connect(libraryInput_, &QLineEdit::textChanged, this, [this, libraryTimer] {
    libraryStatus_->setVisible(true);
    libraryTimer->start();
  });
  connect(libraryTimer, &QTimer::timeout, this, [this] { api_.loadLibrary(libraryInput_->text().trimmed()); });
  connect(libraryList_, &QListWidget::itemActivated, this, [this](QListWidgetItem *item) {
    if (item->data(RolePayload).isNull() || item->data(RoleQueued).toBool() || eventModeOn_ || addBusy_) return;
    pendingLibraryAdd_ = true;
    setAddBusy(true);
    api_.addSuggestion(payloadOf(item));
  });
  connect(&api_, &ApiClient::libraryChanged, this, [this] {
    api_.loadLibrary(libraryInput_->text().trimmed());
    if (!libraryInput_->text().trimmed().isEmpty()) api_.loadLibrary({});
  });
  connect(dropZone_, &DropZone::filesChosen, this, [this](const QStringList &paths) {
    if (eventModeOn_ || addBusy_) return;
    setAddBusy(true);
    setStatus(addStatus_, "", paths.size() == 1 ? ui("host.uploading").replace("{name}", QFileInfo(paths.first()).fileName())
                                                : ui("host.uploadingMany").replace("{count}", QString::number(paths.size())));
    for (const QString &path : paths) api_.uploadFile(path);
  });
  connect(save, &QPushButton::clicked, this, &MainWindow::saveSettings);
  connect(eventMode_, &QCheckBox::toggled, this, [this](bool on) {
    config_.setEventMode(on);
    if (server_.isRunning()) api_.setEventMode(on);
  });
  connect(seek_, &QSlider::sliderPressed, this, [this] { sliderHeld_ = true; });
  connect(seek_, &QSlider::sliderMoved, this, [this](int value) {
    time_->setText(QString("%1 / %2").arg(formatTime(value), formatTime(duration_)));
  });
  connect(seek_, &QSlider::sliderReleased, this, [this] {
    sliderHeld_ = false;
    playerError_->setVisible(false);
    api_.seekAbsolute(seek_->value());
  });
  connect(seek_, &QSlider::actionTriggered, this, [this](int action) {
    if (action == QAbstractSlider::SliderMove || action == QAbstractSlider::SliderNoAction) return;
    QTimer::singleShot(0, this, [this] {
      if (sliderHeld_) return;
      playerError_->setVisible(false);
      api_.seekAbsolute(seek_->sliderPosition());
    });
  });

  connect(&server_, &ServerProcess::logLine, this, [this](const QString &line) {
    serverLog_->appendPlainText(line);
  });
  connect(&server_, &ServerProcess::stopped, this, [this] {
    playback_.stop();
    probe_.stop();
    api_.disconnectSocket();
    setBanner(BannerStopped);
    playBtn_->setIcon(playIcon_);
    playBtn_->setToolTip(ui("admin.play"));
    hasPlayback_ = false;
    hasCurrent_ = hasQueue_ = hasHistory_ = false;
    duration_ = 0;
    updateTransport();
  });
  connect(&api_, &ApiClient::ready, this, [this] {
    loggedIn_ = true;
    awaitingLogin_ = false;
    probe_.stop();
    setBanner(BannerRunning);
    api_.refreshInfo();
    api_.refreshLog();
    api_.loadLibrary({});
    playback_.start();
  });
  connect(&api_, &ApiClient::failed, this, [this](const QString &message) {
    setBanner(BannerMessage, message);
    if (awaitingLogin_) awaitingLogin_ = false;
  });
  connect(&api_, &ApiClient::notice, this, [this](const QString &message) { setBanner(BannerMessage, message); });
  connect(&api_, &ApiClient::searchReceived, this, [this](const QString &query, const QJsonObject &results) {
    if (addInput_->text().trimmed() != query) return;
    searchStatus_->setVisible(false);
    searchList_->clear();
    const auto addGroup = [this](const QString &title, const QJsonArray &items, bool youtube) {
      if (items.isEmpty()) return;
      auto *header = new QListWidgetItem(title.toUpper());
      header->setFlags(Qt::NoItemFlags);
      QFont font = header->font();
      font.setBold(true);
      font.setPointSizeF(font.pointSizeF() * 0.85);
      header->setFont(font);
      header->setForeground(QColor("#7dd3c0"));
      searchList_->addItem(header);
      for (const QJsonValue &value : items) {
        const QJsonObject item = value.toObject();
        QStringList meta;
        meta << item.value("artist").toString();
        if (!youtube) {
          meta << item.value("source").toString();
          const QString duration = formatDuration(item.value("duration_sec"));
          if (!duration.isEmpty()) meta << duration;
        }
        auto *row = new QListWidgetItem(item.value("title").toString() + "\n" + meta.join(" · "));
        if (youtube) {
          const QString thumb = item.value("thumbnail").toString();
          if (!thumb.isEmpty()) {
            row->setData(RoleThumb, thumb);
            if (thumbs_.contains(thumb)) row->setIcon(thumbs_.value(thumb));
            else api_.fetchImage(QUrl(thumb));
          }
        } else {
          row->setIcon(noteIcon());
        }
        QJsonObject payload{
          {"title", item.value("title")},
          {"artist", item.value("artist")},
          {"source", item.value("source")},
          {"sourceRef", item.value("sourceRef")},
        };
        if (item.contains("duration_sec")) payload.insert("duration_sec", item.value("duration_sec"));
        row->setData(RolePayload, QJsonDocument(payload).toJson(QJsonDocument::Compact));
        searchList_->addItem(row);
      }
    };
    addGroup(ui("add.local"), results.value("local").toArray(), false);
    addGroup(ui("add.youtube"), results.value("youtube").toArray(), true);
    if (searchList_->count() == 0) {
      auto *empty = new QListWidgetItem(ui("add.notFound"));
      empty->setFlags(Qt::NoItemFlags);
      searchList_->addItem(empty);
    }
  });
  connect(&api_, &ApiClient::libraryReceived, this, [this](const QString &query, const QJsonArray &tracks, int total) {
    if (query.isEmpty() && total >= 0) libraryTotal_ = total;
    if (libraryInput_->text().trimmed() != query) {
      renderLibrary();
      return;
    }
    libraryStatus_->setVisible(false);
    library_ = tracks;
    renderLibrary();
  });
  connect(&api_, &ApiClient::stateReceived, this, &MainWindow::applyState);
  auto *reconnect = new QTimer(this);
  reconnect->setSingleShot(true);
  reconnect->setInterval(2000);
  connect(&api_, &ApiClient::socketLost, this, [this, reconnect] {
    if (quitting_ || !loggedIn_ || !server_.isRunning()) return;
    reconnecting_ = true;
    setBanner(BannerReconnecting);
    if (!reconnect->isActive()) reconnect->start();
  });
  connect(reconnect, &QTimer::timeout, this, [this] {
    if (quitting_ || !loggedIn_ || !server_.isRunning()) return;
    api_.connectSocket();
    api_.refreshState();
  });
  connect(&api_, &ApiClient::infoReceived, this, [this](const QString &url, const QString &, int) {
    url_->setText(url);
    if (qrUrl_) qrUrl_->setText(url);
    setQr(url);
  });
  connect(&api_, &ApiClient::playbackReceived, this, [this](double time, double duration, bool paused, bool has) {
    hasPlayback_ = has;
    duration_ = has ? duration : 0;
    paused_ = paused || !has;
    playBtn_->setIcon(paused_ ? playIcon_ : pauseIcon_);
    playBtn_->setToolTip(paused_ ? ui("admin.play") : ui("admin.pause"));
    if (!sliderHeld_) {
      seek_->blockSignals(true);
      seek_->setRange(0, qMax(0, int(duration_)));
      seek_->setValue(has ? int(qMin(time, duration_)) : 0);
      seek_->blockSignals(false);
      time_->setText(QString("%1 / %2").arg(formatTime(has ? time : 0), formatTime(duration_)));
    }
    updateTransport();
  });
  connect(&api_, &ApiClient::logReceived, this, &MainWindow::renderLog);

  playback_.setInterval(1000);
  connect(&playback_, &QTimer::timeout, this, [this] {
    api_.refreshPlayback();
  });
  probe_.setInterval(500);
  connect(&probe_, &QTimer::timeout, this, [this] { connectApi(); });

  connect(UiText::instance(), &UiText::changed, this, &MainWindow::retranslate);
  retranslate();
  loadSettings();
  startServer();
}

MainWindow::~MainWindow() {
  stopServer();
}

void MainWindow::closeEvent(QCloseEvent *event) {
  if (!quitting_) {
    event->ignore();
    quitApp();
    return;
  }
  event->accept();
}

void MainWindow::quitApp() {
  if (quitting_) return;
  quitting_ = true;
  tray_->hide();
  stopServer();
  QApplication::quit();
}

void MainWindow::loadSettings() {
  if (!config_.load() && !QFile::exists(config_.path())) {
    QDir().mkpath(dataHome_);
    QFile::copy(root_ + "/config.example.json", config_.path());
    config_.load();
  }
  port_ = config_.port();
  password_->setText(config_.adminPassword());
  portBox_->setValue(port_);
  kick_->setValue(config_.kickThreshold());
  playingKick_->setValue(config_.playingKickDislikes());
  voteLimit_->setValue(config_.voteRateLimit());
  voteWindow_->setValue(config_.voteRateWindowSec());
  maxUpload_->setValue(config_.maxUploadMb());
  maxMinutes_->setValue(config_.maxTrackMinutes());
  eventMode_->blockSignals(true);
  eventMode_->setChecked(config_.eventMode());
  eventMode_->blockSignals(false);
}

void MainWindow::saveSettings() {
  const int oldPort = port_;
  const QString oldPassword = config_.adminPassword();
  if (!config_.save(portBox_->value(), password_->text(), kick_->value(), playingKick_->value(),
                    voteLimit_->value(), voteWindow_->value(), maxUpload_->value(), maxMinutes_->value(),
                    eventMode_->isChecked())) {
    QMessageBox::warning(this, "Music Box", config_.error());
    return;
  }
  const bool restart = portBox_->value() != oldPort || password_->text() != oldPassword;
  port_ = portBox_->value();
  setBanner(restart ? BannerRestarting : BannerSaved);
  if (restart) {
    stopServer();
    startServer();
  }
}

void MainWindow::startServer() {
  if (!QFile::exists(root_ + "/dist/server/index.js")) {
    setBanner(BannerMissing);
    return;
  }
  loggedIn_ = false;
  awaitingLogin_ = false;
  loadSettings();
  setBanner(BannerStarting);
  server_.start(root_, dataHome_);
  api_.setBase(QUrl(QString("http://127.0.0.1:%1").arg(port_)));
  probe_.start();
}

void MainWindow::stopServer() {
  probe_.stop();
  playback_.stop();
  loggedIn_ = false;
  awaitingLogin_ = false;
  api_.disconnectSocket();
  server_.stop();
}

void MainWindow::connectApi() {
  if (loggedIn_ || awaitingLogin_) return;
  awaitingLogin_ = true;
  api_.login(config_.adminPassword());
}

void MainWindow::applyState(const QJsonObject &state) {
  probe_.stop();
  lastState_ = state;
  if (reconnecting_) {
    reconnecting_ = false;
    setBanner(BannerRunning);
  }
  const QJsonObject current = state.value("current").toObject();
  if (current.isEmpty()) {
    nowLabel_->setText(ui("admin.player").toUpper());
    title_->setText(ui("admin.idle"));
    artist_->clear();
  } else {
    nowLabel_->setText(ui("admin.nowPlaying").toUpper());
    const QString title = current.value("title").toString();
    title_->setText(title);
    QStringList parts;
    const QString artist = displayArtist(title, current.value("artist").toString());
    if (!artist.isEmpty()) parts << artist;
    const QString emoji = current.value("sessionEmoji").toString();
    if (!emoji.isEmpty()) parts << emoji;
    const int score = current.value("vote_score").toInt();
    parts << (score > 0 ? QString("+%1").arg(score) : QString::number(score));
    const QString source = current.value("source").toString();
    if (!source.isEmpty() && source != "local") parts << source;
    const QString badge = downloadBadge(current);
    if (!badge.isEmpty()) parts << badge;
    artist_->setText(parts.join("  ·  "));
  }
  hasCurrent_ = !current.isEmpty();
  hasQueue_ = !state.value("queue").toArray().isEmpty();
  hasHistory_ = !state.value("history").toArray().isEmpty();
  queueLabel_->setText(QString("%1 (%2)").arg(ui("admin.sectionQueue")).arg(state.value("queue").toArray().size() + (hasCurrent_ ? 1 : 0)));
  historyLabel_->setText(QString("%1 (%2)").arg(ui("admin.sectionHistory")).arg(state.value("history").toArray().size()));
  updateTransport();
  online_->setText(QString("%1 online").arg(state.value("activeUsers").toInt()));
  eventMode_->blockSignals(true);
  eventMode_->setChecked(state.value("eventMode").toBool());
  eventMode_->blockSignals(false);
  applyEventMode(state.value("eventMode").toBool());

  live_ = QJsonArray();
  if (!current.isEmpty()) live_.append(current);
  for (const QJsonValue &value : state.value("queue").toArray()) live_.append(value);
  historyState_ = state.value("history").toArray();

  const QString selectedQueue = queue_->currentItem() ? queue_->currentItem()->data(RoleId).toString() : QString();
  queue_->clear();
  if (!current.isEmpty()) {
    auto *item = new QListWidgetItem(trackLine(current, "▶ "));
    storeTrack(item, current);
    queue_->addItem(item);
    if (current.value("id").toString() == selectedQueue) queue_->setCurrentItem(item);
  }
  int index = 1;
  for (const QJsonValue &value : state.value("queue").toArray()) {
    const QJsonObject track = value.toObject();
    auto *item = new QListWidgetItem(trackLine(track, QString("%1. ").arg(index++)));
    storeTrack(item, track);
    queue_->addItem(item);
    if (track.value("id").toString() == selectedQueue) queue_->setCurrentItem(item);
  }
  if (queue_->count() == 0) {
    auto *empty = new QListWidgetItem(ui("admin.empty"));
    empty->setFlags(Qt::NoItemFlags);
    queue_->addItem(empty);
  }
  renderHistory();
  renderLibrary();
  api_.refreshLog();
}

bool MainWindow::isLivePath(const QString &path) const {
  if (path.isEmpty()) return false;
  const QString wanted = normalizedPath(path);
  for (const QJsonValue &value : live_) {
    const QString file = value.toObject().value("file_path").toString();
    if (!file.isEmpty() && normalizedPath(file) == wanted) return true;
  }
  return false;
}

bool MainWindow::isLive(const QJsonObject &track) const {
  if (isLivePath(track.value("file_path").toString())) return true;
  const QString source = track.value("source").toString();
  const QString ref = track.value("source_ref").toString();
  if (ref.isEmpty()) return false;
  for (const QJsonValue &value : live_) {
    const QJsonObject other = value.toObject();
    if (other.value("source").toString() == source && other.value("source_ref").toString() == ref) return true;
  }
  return false;
}

void MainWindow::renderHistory() {
  const QString selected = history_->currentItem() ? history_->currentItem()->data(RoleId).toString() : QString();
  const QString query = historySearch_->text().trimmed().toLower().replace(QChar(0x0451), QChar(0x0435));
  const QJsonArray source = historyRemoteActive_ ? historyRemote_ : historyState_;
  history_->clear();
  for (const QJsonValue &value : source) {
    const QJsonObject track = value.toObject();
    if (!historyRemoteActive_ && query.size() >= 2) {
      const QString haystack = (track.value("title").toString() + ' ' + track.value("artist").toString())
                                 .toLower().replace(QChar(0x0451), QChar(0x0435));
      if (!haystack.contains(query)) continue;
    }
    const bool queued = isLive(track);
    auto *item = new QListWidgetItem(trackLine(track, queued ? "✓ " : QString()));
    storeTrack(item, track);
    item->setData(RoleQueued, queued);
    if (queued) {
      item->setForeground(QColor("#7dd3c0"));
      item->setToolTip(ui("host.alreadyQueued"));
    }
    history_->addItem(item);
    if (track.value("id").toString() == selected) history_->setCurrentItem(item);
  }
  if (history_->count() == 0) {
    auto *empty = new QListWidgetItem(query.size() >= 2 ? ui("history.notFound") + " — " + ui("history.notFoundSub")
                                                        : ui("history.empty") + " — " + ui("history.emptySub"));
    empty->setFlags(Qt::NoItemFlags);
    history_->addItem(empty);
  }
  auto *item = history_->currentItem();
  const bool queued = item && item->data(RoleQueued).toBool();
  if (!readding_) readdBtn_->setText(queued ? ui("history.added") : ui("history.toQueue"));
  readdBtn_->setEnabled(!eventModeOn_ && item && !queued && !item->data(RoleId).toString().isEmpty());
  readdBtn_->setVisible(!eventModeOn_);
}

void MainWindow::updateTransport() {
  const bool canTransport = hasCurrent_ && hasPlayback_;
  prevBtn_->setEnabled(hasHistory_);
  playBtn_->setEnabled(canTransport);
  nextBtn_->setEnabled(hasCurrent_ || hasQueue_);
  stopPlayBtn_->setEnabled(hasCurrent_);
  seek_->setEnabled(canTransport && duration_ > 0);
}

void MainWindow::setAddBusy(bool busy) {
  addBusy_ = busy;
  addInput_->setEnabled(!busy);
  libraryInput_->setEnabled(!busy);
  searchList_->setEnabled(!busy);
  libraryList_->setEnabled(!busy);
  addBtn_->setText(busy ? ui("add.adding") : ui("add.addToQueue"));
  addBtn_->setEnabled(!busy && !addInput_->text().trimmed().isEmpty());
  if (busy) setStatus(addStatus_, "", QString());
}

void MainWindow::saveTrackCopy(const QJsonObject &track) {
  const QString path = track.value("file_path").toString();
  const QString ext = QFileInfo(path).suffix();
  QString name = track.value("title").toString();
  const QString artist = displayArtist(name, track.value("artist").toString());
  if (!artist.isEmpty()) name = artist + " - " + name;
  name.replace(QRegularExpression(R"([\\/:*?"<>|]+)"), "_");
  const QString dir = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
  const QString target = QFileDialog::getSaveFileName(this, ui("listen.download"), dir + "/" + name + (ext.isEmpty() ? "" : "." + ext),
                                                      ext.isEmpty() ? QString() : QString("*.%1").arg(ext));
  if (target.isEmpty()) return;
  api_.downloadTrack(track.value("id").toString(), target);
}

void MainWindow::showTrackMenu(QListWidget *list, const QPoint &pos) {
  QListWidgetItem *item = list->itemAt(pos);
  if (!item || item->data(RoleId).toString().isEmpty()) return;
  list->setCurrentItem(item);
  const QJsonObject track = payloadOf(item);
  const QString id = track.value("id").toString();
  const QString ip = track.value("addedByIp").toString();
  const bool isQueue = list == queue_;
  QMenu menu(this);
  if (canListen(track)) {
    menu.addAction(ui("listen.playHere"), this, [this, id] { QDesktopServices::openUrl(api_.streamUrl(id)); });
    menu.addAction(ui("listen.download"), this, [this, track] { saveTrackCopy(track); });
    menu.addSeparator();
  }
  if (!isQueue && !eventModeOn_) {
    QAction *readd = menu.addAction(item->data(RoleQueued).toBool() ? ui("history.added") : ui("history.toQueue"), readdBtn_, &QPushButton::click);
    readd->setEnabled(!item->data(RoleQueued).toBool());
  }
  menu.addAction(isQueue ? ui("track.deleteTrack") : ui("host.deleteFromHistory"), this, [this, id] { api_.deleteTrack(id); });
  if (isQueue) {
    const QString artist = track.value("artist").toString();
    menu.addAction(ui("track.deleteArtist"), this, [this, artist] {
      if (QMessageBox::question(this, "Music Box", ui("admin.confirmDeleteArtist").replace("{artist}", artist)) != QMessageBox::Yes)
        return;
      api_.deleteArtist(artist);
    });
  }
  if (!ip.isEmpty()) {
    menu.addSeparator();
    menu.addAction(QString("Ban %1").arg(ip), this, [this, ip] { api_.banIp(ip); });
    menu.addAction(QString("Unban %1").arg(ip), this, [this, ip] { api_.unbanIp(ip); });
  }
  menu.exec(list->viewport()->mapToGlobal(pos));
}

void MainWindow::renderLibrary() {
  libraryList_->clear();
  for (const QJsonValue &value : library_) {
    const QJsonObject track = value.toObject();
    const QString sourceRef = track.value("sourceRef").toString();
    const bool queued = isLivePath(sourceRef);
    QStringList meta;
    for (const char *key : {"artist", "album"}) {
      const QString part = track.value(key).toString().trimmed();
      if (!part.isEmpty() && part != "Unknown") meta << part;
    }
    if (meta.isEmpty()) meta << track.value("filename").toString();
    const QString duration = formatDuration(track.value("duration_sec"));
    if (!duration.isEmpty()) meta << duration;
    auto *row = new QListWidgetItem(QString("♪  %1   ·  %2%3")
                                      .arg(track.value("title").toString(), meta.join(" · "),
                                           queued ? "   ·  " + ui("add.inQueue") : ""));
    QJsonObject payload{
      {"title", track.value("title")},
      {"artist", track.value("artist")},
      {"source", "local"},
      {"sourceRef", sourceRef},
    };
    if (track.contains("duration_sec")) payload.insert("duration_sec", track.value("duration_sec"));
    row->setData(RolePayload, QJsonDocument(payload).toJson(QJsonDocument::Compact));
    if (queued) {
      row->setFlags(Qt::ItemIsEnabled);
      row->setForeground(QColor("#7dd3c0"));
      row->setData(RoleQueued, true);
    }
    libraryList_->addItem(row);
  }
  if (library_.isEmpty()) {
    auto *empty = new QListWidgetItem(libraryInput_->text().trimmed().isEmpty() ? ui("add.libraryEmpty") : ui("add.notFound"));
    empty->setFlags(Qt::NoItemFlags);
    libraryList_->addItem(empty);
  }
  libraryLabel_->setText(libraryTotal_ > 0 ? QString("%1 (%2)").arg(ui("add.library")).arg(libraryTotal_) : ui("add.library"));
}

void MainWindow::applyEventMode(bool enabled) {
  eventModeOn_ = enabled;
  eventBtn_->setText(QString("%1: %2").arg(ui("admin.eventMode"), enabled ? ui("admin.eventOn") : ui("admin.eventOff")));
  eventBtn_->setProperty("eventOn", enabled);
  eventBtn_->style()->unpolish(eventBtn_);
  eventBtn_->style()->polish(eventBtn_);
  readdBtn_->setVisible(!enabled);
  addForm_->setEnabled(!enabled);
  dropZone_->setEnabled(!enabled);
  addDisabled_->setVisible(enabled);
  if (readdBtn_) {
    auto *item = history_->currentItem();
    readdBtn_->setEnabled(!enabled && item && !item->data(RoleQueued).toBool());
  }
}

QString MainWindow::logAction(const QString &action) {
  const QByteArray key = QByteArray("admin.log.") + action.toUtf8();
  return UiText::contains(key.constData()) ? UiText::text(key.constData()) : action;
}

void MainWindow::renderLog(const QJsonArray &entries) {
  lastLog_ = entries;
  log_->clear();
  for (const QJsonValue &value : entries) {
    const QJsonObject entry = value.toObject();
    const QDateTime when = QDateTime::fromMSecsSinceEpoch(entry.value("created_at").toVariant().toLongLong());
    QString line = QLocale().toString(when.time(), QLocale::ShortFormat) + " — " + logAction(entry.value("action").toString());
    const QString details = entry.value("details").toString();
    if (!details.isEmpty()) line += ": " + details;
    log_->appendPlainText(line);
  }
}

void MainWindow::setBanner(int banner, const QString &message) {
  banner_ = banner;
  if (banner == BannerMessage) bannerMessage_ = message;
  switch (banner_) {
    case BannerStarting: status_->setText(ui("host.starting")); break;
    case BannerRunning: status_->setText(ui("host.running")); break;
    case BannerRestarting: status_->setText(ui("host.restarting")); break;
    case BannerSaved: status_->setText(ui("host.settingsSaved")); break;
    case BannerReconnecting: status_->setText(ui("host.reconnecting")); break;
    case BannerMissing: status_->setText(ui("host.noDist")); break;
    case BannerMessage: status_->setText(bannerMessage_); break;
    default: status_->setText(ui("host.stopped")); break;
  }
}

void MainWindow::retranslate() {
  for (const Phrase &phrase : phrases_) {
    const QString text = ui(phrase.key);
    switch (phrase.kind) {
      case Phrase::Button: static_cast<QPushButton *>(phrase.object)->setText(text); break;
      case Phrase::Label: static_cast<QLabel *>(phrase.object)->setText(text); break;
      case Phrase::Check: static_cast<QCheckBox *>(phrase.object)->setText(text); break;
      case Phrase::Placeholder: static_cast<QLineEdit *>(phrase.object)->setPlaceholderText(text); break;
      case Phrase::Tip: static_cast<QWidget *>(phrase.object)->setToolTip(text); break;
      case Phrase::Tab: static_cast<QTabWidget *>(phrase.object)->setTabText(phrase.index, text); break;
      case Phrase::Action: static_cast<QAction *>(phrase.object)->setText(text); break;
    }
  }
  dropZone_->retranslate();
  addDisabled_->setText(QString("<b>%1</b><br><span style='color:#999'>%2</span>")
                          .arg(ui("add.eventOff").toHtmlEscaped(), ui("add.eventOffSub").toHtmlEscaped()));
  playBtn_->setToolTip(paused_ ? ui("admin.play") : ui("admin.pause"));
  setBanner(banner_);
  addBtn_->setText(addBusy_ ? ui("add.adding") : ui("add.addToQueue"));
  applyEventMode(eventModeOn_);
  if (langRu_) langRu_->setChecked(UiText::code() == "ru");
  if (langEn_) langEn_->setChecked(UiText::code() == "en");
  if (!lastState_.isEmpty()) applyState(lastState_);
  else {
    nowLabel_->setText(ui("admin.player").toUpper());
    title_->setText(ui("admin.idle"));
    queueLabel_->setText(ui("admin.sectionQueue") + " (0)");
    historyLabel_->setText(ui("admin.sectionHistory") + " (0)");
    renderHistory();
    renderLibrary();
  }
  renderLog(lastLog_);
  if (searchStatus_->isVisible()) searchStatus_->setText(ui("add.searching"));
  if (libraryStatus_->isVisible()) libraryStatus_->setText(ui("add.searching"));
  const QString query = addInput_->text().trimmed();
  if (loggedIn_ && query.size() >= 2 && !isDirectUrl(query)) api_.search(query);
}

void MainWindow::setQr(const QString &text) {
  if (text.isEmpty()) return;
  qr_->setPixmap(qrPixmap(text, 168));
}

QString MainWindow::formatTime(double seconds) const {
  if (seconds < 0 || !qIsFinite(seconds)) seconds = 0;
  const int total = int(seconds);
  return QString("%1:%2").arg(total / 60).arg(total % 60, 2, 10, QChar('0'));
}
