#include "DropZone.h"
#include "UiText.h"

#include <QDragEnterEvent>
#include <QDropEvent>
#include <QFileDialog>
#include <QFileInfo>
#include <QLabel>
#include <QMimeData>
#include <QMouseEvent>
#include <QStyle>
#include <QUrl>
#include <QVBoxLayout>

DropZone::DropZone(QWidget *parent) : QFrame(parent) {
  setObjectName("dropZone");
  setAcceptDrops(true);
  setCursor(Qt::PointingHandCursor);
  setMinimumHeight(120);
  setProperty("active", false);
  setStyleSheet(
    "#dropZone { background: #17171a; border: 2px dashed #3d3d44; border-radius: 16px; }"
    "#dropZone:hover { border-color: #6b6b75; background: #1c1c20; }"
    "#dropZone[active=\"true\"] { border-color: #7dd3c0; background: #16241f; }"
    "#dropZone:disabled { border-color: #2a2a2e; background: #141416; }"
    "#dropZone QLabel { background: transparent; border: none; }");

  auto *layout = new QVBoxLayout(this);
  layout->setContentsMargins(20, 18, 20, 18);
  layout->setSpacing(6);
  auto *icon = new QLabel("♪");
  icon->setAlignment(Qt::AlignCenter);
  icon->setStyleSheet("font-size: 26px; color: #7dd3c0;");
  title_ = new QLabel;
  title_->setAlignment(Qt::AlignCenter);
  title_->setStyleSheet("font-size: 15px; font-weight: 600;");
  hint_ = new QLabel;
  hint_->setAlignment(Qt::AlignCenter);
  hint_->setWordWrap(true);
  hint_->setStyleSheet("color: #999; font-size: 12px;");
  layout->addStretch();
  layout->addWidget(icon);
  layout->addWidget(title_);
  layout->addWidget(hint_);
  layout->addStretch();
  retranslate();
}

void DropZone::retranslate() {
  title_->setText(ui("add.upload"));
  hint_->setText(isEnabled() ? ui("host.dropHint") : ui("host.uploadOff"));
}

QStringList DropZone::audioExtensions() {
  return {"mp3", "mp4", "m4a", "aac", "ogg", "oga", "wav", "flac", "webm", "opus",
          "m4b", "wma", "aiff", "aif", "ape", "wv", "mpga"};
}

QString DropZone::dialogFilter() {
  QStringList masks;
  for (const QString &ext : audioExtensions()) masks << "*." + ext;
  return QString("%1 (%2)").arg(ui("host.audio"), masks.join(' '));
}

QStringList DropZone::audioPaths(const QMimeData *mime) const {
  QStringList paths;
  if (!mime || !mime->hasUrls()) return paths;
  const QStringList allowed = audioExtensions();
  for (const QUrl &url : mime->urls()) {
    if (!url.isLocalFile()) continue;
    const QFileInfo info(url.toLocalFile());
    if (info.isFile() && allowed.contains(info.suffix().toLower())) paths << info.absoluteFilePath();
  }
  return paths;
}

void DropZone::setActive(bool active) {
  setProperty("active", active);
  style()->unpolish(this);
  style()->polish(this);
}

void DropZone::dragEnterEvent(QDragEnterEvent *event) {
  if (!isEnabled() || audioPaths(event->mimeData()).isEmpty()) {
    event->ignore();
    return;
  }
  setActive(true);
  event->acceptProposedAction();
}

void DropZone::dragLeaveEvent(QDragLeaveEvent *event) {
  setActive(false);
  QFrame::dragLeaveEvent(event);
}

void DropZone::dropEvent(QDropEvent *event) {
  setActive(false);
  const QStringList paths = audioPaths(event->mimeData());
  if (paths.isEmpty()) {
    event->ignore();
    return;
  }
  event->acceptProposedAction();
  emit filesChosen(paths);
}

void DropZone::mouseReleaseEvent(QMouseEvent *event) {
  if (event->button() != Qt::LeftButton || !isEnabled()) return;
  const QStringList paths = QFileDialog::getOpenFileNames(this, ui("host.uploadTitle"), QString(), dialogFilter());
  if (!paths.isEmpty()) emit filesChosen(paths);
}

void DropZone::changeEvent(QEvent *event) {
  if (event->type() == QEvent::EnabledChange) retranslate();
  QFrame::changeEvent(event);
}
