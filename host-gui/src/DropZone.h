#pragma once

#include <QFrame>
#include <QStringList>

class QLabel;
class QMimeData;

class DropZone : public QFrame {
  Q_OBJECT
public:
  explicit DropZone(QWidget *parent = nullptr);
  void retranslate();

  static QStringList audioExtensions();
  static QString dialogFilter();

signals:
  void filesChosen(const QStringList &paths);

protected:
  void dragEnterEvent(QDragEnterEvent *event) override;
  void dragLeaveEvent(QDragLeaveEvent *event) override;
  void dropEvent(QDropEvent *event) override;
  void mouseReleaseEvent(QMouseEvent *event) override;
  void changeEvent(QEvent *event) override;

private:
  QStringList audioPaths(const QMimeData *mime) const;
  void setActive(bool active);

  QLabel *title_ = nullptr;
  QLabel *hint_ = nullptr;
};
