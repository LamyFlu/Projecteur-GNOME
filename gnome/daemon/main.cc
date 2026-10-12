#include "spotlight.h"
#include "device-hidpp.h"
#include "button-mappings.h"

#include <KLocalizedString>

#include <QCommandLineParser>
#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusError>
#include <QDebug>
#include <cmath>
#include <QTimer>
#include <QElapsedTimer>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonDocument>

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
    m_timer.setInterval(100);
    connect(&m_timer, &QTimer::timeout, this, [this]() {
      if (timerRemaining() > 0) return;
      expireTimer();
    });
    const auto trigger = [this]() {
      if (m_timerState == QStringLiteral("armed")) runTimer();
    };
    connect(this, &PointerBridge::PointerButtonPressed, this, trigger);
    connect(this, &PointerBridge::SlideNavigationPressed, this, trigger);
    connect(this, &PointerBridge::PointerDoubleClicked, this, trigger);
    connect(this, &PointerBridge::Motion, this, trigger);
    m_batteryTimer.setInterval(30000);
    connect(&m_batteryTimer, &QTimer::timeout, this, [this]() {
      for (const auto& device : m_spotlight->connectedDevices()) {
        const auto connection = m_spotlight->deviceConnection(device.id);
        if (!connection) continue;
        for (const auto& sub : connection->subDevices()) {
          auto hid = qobject_cast<SubHidppConnection*>(sub.second.get());
          if (hid && hid->hasFlags(DeviceFlag::ReportBattery)) hid->triggerBattyerInfoUpdate();
        }
      }
    });
    m_batteryTimer.start();
    connect(m_spotlight, &Spotlight::mappedAction, this, [this](const std::shared_ptr<Action>& action) {
      if (const auto shell = dynamic_cast<GnomeMappings::ShellAction*>(action.get())) { emit PresenterAction(shell->name); }
      else if (action->type() == Action::Type::ScrollHorizontal) m_spotlight->emitMappedScroll(true, static_cast<ScrollHorizontalAction*>(action.get())->param);
      else if (action->type() == Action::Type::ScrollVertical) m_spotlight->emitMappedScroll(false, static_cast<ScrollVerticalAction*>(action.get())->param);
      else if (action->type() == Action::Type::VolumeControl) m_spotlight->emitMappedVolume(static_cast<VolumeControlAction*>(action.get())->param);
    });
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

  bool SetButtonMappings(const QString& json)
  {
    InputMapConfig config;
    if (!GnomeMappings::parse(json, config)) return false;
    m_spotlight->setInputMapConfiguration(config);
    m_buttonMappings = json;
    return true;
  }

  QString GetButtonMappings() const { return m_buttonMappings; }

  QString GetPresentationStatus() const
  {
    QJsonArray devices;
    for (const auto& device : m_spotlight->connectedDevices()) {
      QJsonObject item{{"name", device.name}, {"battery", -1}, {"vibration", false}};
      const auto connection = m_spotlight->deviceConnection(device.id);
      if (connection) for (const auto& sub : connection->subDevices()) {
        auto hid = qobject_cast<SubHidppConnection*>(sub.second.get());
        if (!hid) continue;
        if (hid->hasFlags(DeviceFlag::Vibrate)) item["vibration"] = true;
        const auto& battery = hid->batteryInfo();
        if (battery.status != HIDPP::BatteryStatus::Uninitialized
            && battery.status != HIDPP::BatteryStatus::InvalidBattery
            && battery.currentLevel <= 100) {
          item["battery"] = int(battery.currentLevel);
          item["charging"] = battery.status == HIDPP::BatteryStatus::Charging
            || battery.status == HIDPP::BatteryStatus::SlowCharging
            || battery.status == HIDPP::BatteryStatus::AlmostFull;
        }
      }
      devices.append(item);
    }
    return QString::fromUtf8(QJsonDocument(QJsonObject{{"timerState", m_timerState},
      {"remainingSeconds", timerRemaining()}, {"devices", devices}}).toJson(QJsonDocument::Compact));
  }

  bool StartPresentationTimer(int seconds, bool arm)
  {
    if (seconds < 1 || seconds > 86400) return false;
    m_timer.stop();
    m_remainingMs = qint64(seconds) * 1000;
    m_timerState = arm ? QStringLiteral("armed") : QStringLiteral("running");
    if (!arm) runTimer();
    return true;
  }

  void PausePresentationTimer()
  {
    if (m_timerState != QStringLiteral("running")) return;
    m_remainingMs = std::max<qint64>(0, m_remainingMs - m_timerElapsed.elapsed());
    m_timer.stop();
    if (m_remainingMs == 0) { expireTimer(); return; }
    m_timerState = QStringLiteral("paused");
  }

  void ResumePresentationTimer()
  {
    if (m_timerState == QStringLiteral("paused") && m_remainingMs > 0) runTimer();
  }

  void ResetPresentationTimer()
  {
    m_timer.stop();
    m_remainingMs = 0;
    m_timerState = QStringLiteral("idle");
  }

  bool SetTimerFeedback(bool enabled, int intensity, int length)
  {
    if (intensity < 1 || intensity > 255 || length < 1 || length > 10) return false;
    m_timerVibration = enabled;
    m_vibrationIntensity = intensity;
    m_vibrationLength = length;
    return true;
  }

  bool Vibrate(int intensity, int length)
  {
    if (intensity < 1 || intensity > 255 || length < 1 || length > 10) return false;
    bool sent = false;
    for (const auto& device : m_spotlight->connectedDevices()) {
      const auto connection = m_spotlight->deviceConnection(device.id);
      if (!connection) continue;
      for (const auto& sub : connection->subDevices()) {
        auto hid = qobject_cast<SubHidppConnection*>(sub.second.get());
        if (!hid || !hid->hasFlags(DeviceFlag::Vibrate)) continue;
        hid->sendVibrateCommand(intensity, length,
          [](HidppConnectionInterface::MsgResult result, HIDPP::Message&&) {
            if (result != HidppConnectionInterface::MsgResult::Ok)
              qWarning() << "Presenter vibration request failed:" << int(result);
          });
        sent = true;
        break;
      }
    }
    return sent; // Request queued, not a guarantee of physical feedback.
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
  void TimerExpired();
  void PresenterAction(const QString& action);

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
  int timerRemaining() const
  {
    const qint64 elapsed = m_timerState == QStringLiteral("running") ? m_timerElapsed.elapsed() : 0;
    return int((std::max<qint64>(0, m_remainingMs - elapsed) + 999) / 1000);
  }
  void expireTimer()
  {
    m_timer.stop();
    m_timerState = QStringLiteral("expired");
    m_remainingMs = 0;
    emit TimerExpired();
    if (m_timerVibration) Vibrate(m_vibrationIntensity, m_vibrationLength);
  }
  void runTimer()
  {
    m_timerState = QStringLiteral("running");
    m_timerElapsed.start();
    m_timer.start();
  }
  QTimer m_timer;
  QTimer m_batteryTimer;
  QElapsedTimer m_timerElapsed;
  qint64 m_remainingMs = 0;
  QString m_timerState = QStringLiteral("idle");
  QString m_buttonMappings = QStringLiteral("{}");
  bool m_timerVibration = false;
  int m_vibrationIntensity = 128;
  int m_vibrationLength = 1;
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
  QCoreApplication::setApplicationVersion(QStringLiteral("0.4.0"));
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
