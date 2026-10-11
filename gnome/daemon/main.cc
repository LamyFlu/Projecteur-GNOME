#include "spotlight.h"

#include <KLocalizedString>

#include <QCommandLineParser>
#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusError>
#include <QDebug>
#include <cmath>

namespace {
constexpr auto serviceName = "org.projecteur.Gnome";
constexpr auto objectPath = "/org/projecteur/Gnome/Pointer";
}

class PointerBridge final : public QObject
{
  Q_OBJECT
  Q_CLASSINFO("D-Bus Interface", "org.projecteur.Gnome.Pointer")
  Q_PROPERTY(bool Active READ active NOTIFY ActiveChanged)
  Q_PROPERTY(bool DeviceConnected READ deviceConnected NOTIFY DeviceConnectedChanged)
  Q_PROPERTY(double LingerSeconds READ lingerSeconds)
  Q_PROPERTY(bool PointerClicksEnabled READ pointerClicksEnabled)

public:
  explicit PointerBridge(Spotlight* spotlight, QObject* parent = nullptr)
    : QObject(parent), m_spotlight(spotlight)
  {
    connect(m_spotlight, &Spotlight::spotActiveChanged,
            this, &PointerBridge::setActive);
    connect(m_spotlight, &Spotlight::pointerMotion,
            this, &PointerBridge::Motion);
    connect(m_spotlight, &Spotlight::anySpotlightDeviceConnectedChanged,
            this, &PointerBridge::setDeviceConnected);
    connect(m_spotlight, &Spotlight::slideNavigationPressed,
            this, &PointerBridge::SlideNavigationPressed);
    connect(m_spotlight, &Spotlight::pointerDoubleClicked,
            this, &PointerBridge::PointerDoubleClicked);
    connect(m_spotlight, &Spotlight::pointerButtonPressed,
            this, &PointerBridge::PointerButtonPressed);
    m_deviceConnected = m_spotlight->anySpotlightDeviceConnected();
  }

  bool active() const { return m_active; }
  bool deviceConnected() const { return m_deviceConnected; }
  bool pointerClicksEnabled() const { return m_spotlight->pointerClicksEnabled(); }
  double lingerSeconds() const { return m_lingerSeconds; }

public slots:
  QString Ping() const { return QStringLiteral("projecteur-gnome-daemon"); }

  bool SetLingerSeconds(double seconds)
  {
    if (!std::isfinite(seconds) || seconds < 0.1 || seconds > 30.0) {
      return false;
    }
    m_lingerSeconds = seconds;
    m_spotlight->setActiveTimeoutMs(static_cast<int>(std::lround(seconds * 1000)));
    return true;
  }

  void SetPointerCenterEnabled(bool enabled) { m_spotlight->setPointerCenterEnabled(enabled); }

  void SetPointerClicksEnabled(bool enabled)
  {
    m_spotlight->setPointerClicksEnabled(enabled);
  }

  void SetPointerDoubleClickEnabled(bool enabled)
  {
    m_doubleClickEnabled = enabled;
    m_spotlight->setPointerDoubleClickEnabled(enabled);
  }

  void DoubleClickForTesting()
  {
    if (m_doubleClickEnabled) { emit PointerDoubleClicked(); }
  }

  void PressForTesting() { emit PointerButtonPressed(); }

  void SetActiveForTesting(bool active)
  {
    m_spotlight->setSpotActive(active);
  }

  void MoveForTesting(int deltaX, int deltaY)
  {
    if (!m_spotlight->spotActive()) {
      m_spotlight->setSpotActive(true);
    }
    emit Motion(deltaX, deltaY);
    m_spotlight->restartActiveTimeout();
  }

signals:
  void ActiveChanged(bool active);
  void Motion(int deltaX, int deltaY);
  void DeviceConnectedChanged(bool connected);
  void SlideNavigationPressed();
  void PointerDoubleClicked();
  void PointerButtonPressed();

private slots:
  void setActive(bool active)
  {
    if (m_active == active) { return; }
    m_active = active;
    emit ActiveChanged(active);
  }

  void setDeviceConnected(bool connected)
  {
    if (m_deviceConnected == connected) { return; }
    m_deviceConnected = connected;
    emit DeviceConnectedChanged(connected);
  }

private:
  Spotlight* const m_spotlight;
  bool m_active = false;
  bool m_doubleClickEnabled = false;
  bool m_deviceConnected = false;
  double m_lingerSeconds = 3.0;
};

int main(int argc, char** argv)
{
  QCoreApplication app(argc, argv);
  QCoreApplication::setApplicationName(QStringLiteral("projecteur-gnome-daemon"));
  QCoreApplication::setApplicationVersion(QStringLiteral("0.2.0"));
  KLocalizedString::setApplicationDomain("projecteur");

  QCommandLineParser parser;
  parser.setApplicationDescription(
    QStringLiteral("Logitech Spotlight bridge for GNOME Shell on Wayland"));
  parser.addHelpOption();
  parser.addVersionOption();
  QCommandLineOption disableUInputOption(
    QStringList{QStringLiteral("disable-uinput")},
    QStringLiteral("Do not create virtual mouse and keyboard devices."));
  parser.addOption(disableUInputOption);
  QCommandLineOption noDeviceScanOption(QStringLiteral("no-device-scan"),
    QStringLiteral("Do not open hardware devices (isolated automated tests)."));
  parser.addOption(noDeviceScanOption);
  parser.process(app);

  const bool enableUInput = !parser.isSet(disableUInputOption);
  constexpr int pointerLingerMs = 3000;
  Spotlight spotlight(
    &app, Spotlight::Options{enableUInput, {}, pointerLingerMs, !parser.isSet(noDeviceScanOption), false}, nullptr);
  PointerBridge bridge(&spotlight);

  auto bus = QDBusConnection::sessionBus();
  if (!bus.isConnected()) {
    qCritical() << "Could not connect to the session D-Bus";
    return 1;
  }
  if (!bus.registerService(QString::fromLatin1(serviceName))) {
    qCritical().noquote() << "Could not register D-Bus service:"
                          << bus.lastError().message();
    return 2;
  }
  if (!bus.registerObject(QString::fromLatin1(objectPath), &bridge,
                          QDBusConnection::ExportAllSlots
                          | QDBusConnection::ExportAllSignals
                          | QDBusConnection::ExportAllProperties)) {
    qCritical().noquote() << "Could not register D-Bus object:"
                          << bus.lastError().message();
    return 3;
  }

  qInfo() << "Projecteur GNOME bridge is ready on" << serviceName << objectPath;
  return app.exec();
}

#include "main.moc"
