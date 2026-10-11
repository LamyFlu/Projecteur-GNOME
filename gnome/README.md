# GNOME development and troubleshooting

User installation: [English](../README.md) / [繁體中文](../README.zh-TW.md).
AI assistant instructions: [AGENTS.md](../AGENTS.md).

## Architecture

`projecteur-gnome-daemon` reuses Projecteur's device scanning, HID++, evdev,
input forwarding, and uinput code. The Shell extension renders a non-interactive
laser dot, circular spotlight, or circular live magnifier above fullscreen
windows. The service uses:

```text
Service:   org.projecteur.Gnome
Object:    /org/projecteur/Gnome/Pointer
Interface: org.projecteur.Gnome.Pointer
```

Signals include `ActiveChanged`, `Motion`, `DeviceConnectedChanged`,
`SlideNavigationPressed`, and `PointerDoubleClicked`.
`SetLingerSeconds(double)` adjusts the device timeout
and rejects values outside 0.1–30 seconds. Preferences sync on connection and
when changed, so a daemon restart restores the saved duration.

The dot pauses fullscreen unredirect while active. Cursor hiding acquires one
pointer-focus claim before inhibiting visibility, and releases both claims
when the dot disappears or the extension is disabled. This allows Mutter 50
to update the cursor renderer even while hiding the cursor.

Some fullscreen programs lock the system pointer. The overlay normally uses
Mutter's pointer position, and falls back to relative presenter motion when
that position does not move.

The spotlight uses a Cairo even-odd mask. The magnifier clones `Main.uiGroup`
into a circular shader mask outside that group, avoiding recursive feedback.
It does not modify `Main.magnifier` or accessibility settings. Mode choices,
per-effect enablement, spotlight diameter/dimming, lens diameter/zoom, and
optional double-click switching live in the extension schema. Native double
clicks use original Spotlight's documented HID++ `0xdf` control; the option
restores normal device mapping when turned off. No model-specific command is
sent to Spotlight 2 or other presenters. See [device status](DEVICE-SUPPORT.md).

`SetPointerClicksEnabled(bool)` controls presenter `BTN_LEFT` forwarding,
which defaults to disabled in GNOME. Disabling it releases any forwarded press
so the virtual left button cannot remain held. Releases without a forwarded
press are suppressed. Keyboard/slide events and pointer motion are unaffected.
Upstream KDE builds retain their existing forwarding path.
Spotlight/magnifier reset buttons reset only their appearance keys.

Optional monitor-center startup stores the physical connector for the monitor
last occupied by the effect. Each `PointerButtonPressed` signal warps both the Shell
effect and system cursor to that monitor's center, keeping optional presenter
click forwarding aligned. Missing connectors fall back to the monitor containing
the current system pointer. Original Spotlight uses transient HID++ control
`0xd8` long-press diversion with raw XY forwarding while centering is enabled;
`SetPointerCenterEnabled(false)` restores native long-press movement. This command
is restricted to original Spotlight USB/Bluetooth IDs. Other models require a
reported `BTN_LEFT` press; otherwise they retain activation-only centering.
`PressForTesting()` exercises the press signal without hardware.

`SetPointerDoubleClickEnabled(bool)` configures that control;
`DoubleClickForTesting()` emits a double-click signal only while the option is
on. `--no-device-scan --disable-uinput` isolates synthetic tests from hardware.

## Manual build

```sh
sudo apt install build-essential cmake extra-cmake-modules \
  qt6-base-dev libkf6coreaddons-dev libkf6i18n-dev libglib2.0-bin gjs python3
cmake -S gnome -B build/gnome -DCMAKE_BUILD_TYPE=Release
cmake --build build/gnome --parallel 4
```

Qt 6.10+ and KF6 CoreAddons/I18n 6.6+ are needed. This path does not require
Plasma or the KDE overlay build dependencies. Use `./install.sh` for the normal
Ubuntu 26.04 desktop installation; it also installs device permission rules.

## Tests

```sh
bash -n install.sh uninstall.sh gnome/install-local.sh gnome/uninstall-local.sh
glib-compile-schemas --strict --dry-run gnome/extension/schemas
gjs -m gnome/tests/i18n-check.js
gjs -m gnome/tests/pointer-state-check.js
c++ -std=c++17 -Wall -Wextra -Werror -I src gnome/tests/pointer-frame-check.cc -o /tmp/projecteur-pointer-frame-check
/tmp/projecteur-pointer-frame-check
python3 gnome/tests/device-table-check.py build/gnome
dbus-run-session -- gnome/tests/dbus-smoke.sh ./build/gnome/projecteur-gnome-daemon
dbus-run-session -- python3 gnome/tests/linger-smoke.py ./build/gnome/projecteur-gnome-daemon
```

The private-bus tests disable virtual input and hardware scanning. Automated
tests do not replace a visual check in the user's desktop session.
An optional integration test uses a separate headless GNOME Shell session,
temporary settings and a private D-Bus, so it does not restart or enable unsafe
mode on the user's running Shell:

```sh
python3 gnome/tests/shell-effects-smoke.py build/gnome/projecteur-gnome-daemon
```

It requires GNOME 50 and a working EGL renderer; it is not run in the minimal
CI container. It checks real effect rendering, D-Bus switching, disabled effects,
cursor/focus cleanup, top-panel actions and settings synchronization, indicator
cleanup on disable, persistent visibility across idle expiry, and opening the native
GTK preferences from the panel. To retain local screenshots for review, set `PROJECTEUR_TEST_ARTIFACTS` to an ignored directory
such as `build/gnome/visual-check`. GNOME CI builds in an Ubuntu 26.04 container
and runs these checks; the inherited Plasma workflows run only in the upstream
repository.

## Localization

`extension/i18n.js` uses GLib's preferred message locale (including LANGUAGE).
Chinese locales share the Traditional Chinese strings; all others use the
English source strings. There is no Simplified Chinese translation.
GTK's built-in dialog controls use system translations. No compilation step
is required for the extension's translation table.

## Preferences and device diagnostics

```sh
gnome-extensions prefs projecteur-pointer-ubuntu26@projecteur.github.io
systemctl --user status projecteur-gnome-daemon.service
journalctl --user -b -u projecteur-gnome-daemon.service --no-pager
busctl --user get-property org.projecteur.Gnome /org/projecteur/Gnome/Pointer \
  org.projecteur.Gnome.Pointer DeviceConnected
```

Preferences use the schema `org.gnome.shell.extensions.projecteur-pointer`.
For manual extension copies, include every file under `gnome/extension` and run
`glib-compile-schemas` on the installed `schemas/` directory. GNOME 50 caches
extension modules; log out and back in after installing or updating.

The daemon needs presenter evdev/hidraw access and `/dev/uinput`. The installer
uses the generated `55-projecteur.rules` and reloads udev when the rule changes.
Reconnect the receiver or Bluetooth presenter afterward. Uninstalling leaves
system rules and saved preferences intact.

## Temporary visual test

```sh
gdbus call --session --dest org.projecteur.Gnome \
  --object-path /org/projecteur/Gnome/Pointer \
  --method org.projecteur.Gnome.Pointer.SetActiveForTesting true
# Always hide the temporary dot afterward:
gdbus call --session --dest org.projecteur.Gnome \
  --object-path /org/projecteur/Gnome/Pointer \
  --method org.projecteur.Gnome.Pointer.SetActiveForTesting false
```
