# GNOME development and troubleshooting

User installation: [English](../README.md) / [繁體中文](../README.zh-TW.md).
AI assistant instructions: [AGENTS.md](../AGENTS.md).

## Architecture

`projecteur-gnome-daemon` reuses Projecteur's device scanning, HID++, evdev,
input forwarding, and uinput code. The Shell extension renders a non-interactive
laser dot above fullscreen windows. The service uses:

```text
Service:   org.projecteur.Gnome
Object:    /org/projecteur/Gnome/Pointer
Interface: org.projecteur.Gnome.Pointer
```

Signals include `ActiveChanged`, `Motion`, `DeviceConnectedChanged`, and
`SlideNavigationPressed`. `SetLingerSeconds(double)` adjusts the device timeout
and rejects values outside 0.1–30 seconds. Preferences sync on connection and
when changed, so a daemon restart restores the saved duration.

The dot pauses fullscreen unredirect while active. Cursor hiding acquires one
pointer-focus claim before inhibiting visibility, and releases both claims
when the dot disappears or the extension is disabled. This allows Mutter 50
to update the cursor renderer even while hiding the cursor.

Some fullscreen programs lock the system pointer. The overlay normally uses
Mutter's pointer position, and falls back to relative presenter motion when
that position does not move.

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
dbus-run-session -- gnome/tests/dbus-smoke.sh ./build/gnome/projecteur-gnome-daemon
dbus-run-session -- python3 gnome/tests/linger-smoke.py ./build/gnome/projecteur-gnome-daemon
```

Leave a connected presenter idle during the private-bus tests; they disable
virtual input but still scan hardware. Automated tests do not replace a visual
check in the user's desktop session. GNOME CI builds in an Ubuntu 26.04 container
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
