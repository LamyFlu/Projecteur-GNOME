// This file is part of Projecteur - https://github.com/jahnf/projecteur
// - See LICENSE.md and README.md
#pragma once

#include <QObject>
#include <QElapsedTimer>

#include <map>
#include <memory>
#include <vector>

#include "asynchronous.h"
#include "devicescan.h"
#include "deviceinput.h"

class QTimer;
class Settings;
class VirtualDevice;
class DeviceConnection;
class SubEventConnection;
class SubHidppConnection;

struct HoldButtonStatus;

/// Class handling spotlight device connections and indicating if a device is sending
/// sending mouse move events.
class Spotlight : public QObject, public async::Async<Spotlight>
{
  Q_OBJECT

public:
  struct Options {
    bool enableUInput = true; // enable virtual uinput device
    std::vector<SupportedDevice> additionalDevices;
    int activeTimeoutMs = 600;
    bool enableDeviceScan = true;
    bool enablePointerClicks = true;
  };

  explicit Spotlight(QObject* parent, Options options, Settings* settings);
  virtual ~Spotlight();

  bool spotActive() const { return m_spotActive; }
  void setSpotActive(bool active);
  void setActiveTimeoutMs(int timeoutMs);
  void restartActiveTimeout();
  void setPointerDoubleClickEnabled(bool enabled);
  void setPointerCenterEnabled(bool enabled);
  void setPointerClicksEnabled(bool enabled);
  void setInputMapConfiguration(const InputMapConfig& config);
  void emitMappedScroll(bool horizontal, int amount);
  void emitMappedVolume(int amount);
  bool pointerClicksEnabled() const { return m_pointerClicksEnabled; }

  struct ConnectedDeviceInfo {
    DeviceId id;
    QString name;
  };

  bool anySpotlightDeviceConnected() const;
  uint32_t connectedDeviceCount() const;
  std::vector<ConnectedDeviceInfo> connectedDevices() const;
  std::shared_ptr<DeviceConnection> deviceConnection(const DeviceId& deviceId);

signals:
  void deviceConnected(const DeviceId& id, const QString& name);
  void deviceDisconnected(const DeviceId& id, const QString& name);
  void subDeviceConnected(const DeviceId& id, const QString& name, const QString& path);
  void subDeviceDisconnected(const DeviceId& id, const QString& name, const QString& path);
  void deviceAccessError(const QString& name, const QString& path);
  void anySpotlightDeviceConnectedChanged(bool connected);
  void spotActiveChanged(bool isActive);
  void pointerMotion(int deltaX, int deltaY);
  void slideNavigationPressed();
  void pointerDoubleClicked();
  void pointerButtonPressed();
  void mappedAction(std::shared_ptr<Action> action);

private:
  enum class ConnectionResult { CouldNotOpen, NotASpotlightDevice, Connected };
  ConnectionResult connectSpotlightDevice(const QString& devicePath, bool verbose = false);

  bool addInputEventHandler(std::shared_ptr<SubEventConnection> connection);
  void registerForNotifications(SubHidppConnection* connection);
  void configurePointerCenter(SubHidppConnection* connection);
  void configurePointerDoubleClick(SubHidppConnection* connection);

  bool setupDevEventInotify();
  int connectDevices();
  void removeDeviceConnection(const QString& devicePath);
  void onEventDataAvailable(int fd, SubEventConnection& connection);

  InputMapConfig m_inputMapConfiguration;
  const Options m_options;
  std::map<DeviceId, std::shared_ptr<DeviceConnection>> m_deviceConnections;
  std::vector<DeviceId> m_activeDeviceIds;

  QTimer* m_activeTimer = nullptr;
  int m_activeTimeoutMs = 600;
  QElapsedTimer m_pointerActivityTimer;
  QTimer* m_connectionTimer = nullptr;
  QTimer* m_holdMoveEventTimer = nullptr;
  bool m_spotActive = false;
  bool m_pointerCenterEnabled = false;
  bool m_pointerDoubleClickEnabled = false;
  bool m_pointerClicksEnabled = true;
  std::map<QString, bool> m_forwardedPointerPresses;
  std::shared_ptr<VirtualDevice> m_virtualMouseDevice;
  std::shared_ptr<VirtualDevice> m_virtualKeyDevice;
  Settings* m_settings = nullptr;
  std::unique_ptr<HoldButtonStatus> m_holdButtonStatus;
};
