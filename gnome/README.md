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
bash gnome/tests/presets-check.sh
c++ -std=c++17 -Wall -Wextra -Werror -I src gnome/tests/pointer-frame-check.cc -o /tmp/projecteur-pointer-frame-check
/tmp/projecteur-pointer-frame-check
python3 gnome/tests/device-table-check.py build/gnome
./build/gnome/projecteur-gnome-mapping-check
dbus-run-session -- gnome/tests/dbus-smoke.sh ./build/gnome/projecteur-gnome-daemon
dbus-run-session -- python3 gnome/tests/linger-smoke.py ./build/gnome/projecteur-gnome-daemon
dbus-run-session -- python3 gnome/tests/timer-smoke.py ./build/gnome/projecteur-gnome-daemon
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

## Presentation timer, presets and device status

The top-panel menu exposes connected presenter names and reported battery levels,
and timer start/arm/pause/resume/reset actions. Duration is 1–1440 minutes (default
15). Arming waits for a reported pointer press, slide-navigation press, native
double click or presenter movement. Shell notifications announce expiry and
battery levels at or below 15% (once per low-battery episode; 20% clears it).
Battery polling is every 30 seconds on HID++ connections reporting that ability;
unknown levels remain unavailable rather than being displayed as zero.

Optional expiry vibration is off by default. It uses the existing upstream
capability-gated HID++ implementation, not original-model control remapping on
other devices. Intensity is 1–255 (default 128); duration is 1–10 protocol units
(default 1), whose physical
length depends on the model. Preferences includes an explicit Test button.
A successful request means queued, not physically confirmed. The owner reported this GNOME batch working on original Spotlight USB on
2026-10-12; other models remain hardware-unverified.

`GetPresentationStatus()` returns JSON with timer state, remaining seconds and
device status. `StartPresentationTimer(int seconds, bool arm)` accepts 1–86400;
`PausePresentationTimer()`, `ResumePresentationTimer()` and
`ResetPresentationTimer()` are idempotent outside applicable states.
`SetTimerFeedback(bool enabled, int intensity, int length)` configures feedback;
`Vibrate(int intensity, int length)` requests it only on capable connections.
Timer state lives in the daemon and resets when it restarts. Duration, feedback
preferences and appearance presets are saved in GSettings.

Presets save only appearance, mode and effect enablement, leaving timer and
presenter controls intact. Up to 30 names (1–48 characters) can be saved; saving
an existing name replaces it. Values are validated before any application, then
applied as one settings transaction. The preferences window saves/applies/deletes
presets; the panel applies them.

See [upstream feature comparison](UPSTREAM-PARITY.md) for implemented and remaining features.

## Advanced appearance and safe preview

Spotlight adds circle, square and diamond cutouts, rotation (0–359 degrees),
shade/border colors and a 0–12 pixel border (0 is off). Spotlight reset restores
these appearance settings and preserves enablement and mode. The optional
fading trail is off by default; its lifetime is 0.1–2 seconds with bounded point
history. It follows all effects and is cleaned up when the effect disappears.

Magnifier quality is smooth, text-and-UI (bounded edge enhancement), or pixel
grid. Pixel grid samples blocks from GNOME's already composited/scaled live
clone, so it is not a guarantee of exact source pixels as in upstream KPipeWire
capture. The magnifier reset includes the quality selection.

Preferences has three preview buttons and Stop. A preview follows the mouse for
5 seconds, can temporarily display a disabled effect, and does not modify effect
enablement, selected mode, presenter state or the presentation timer. It restores
normal persistent/device behavior afterward and on closing preferences.
The extension owns `org.projecteur.Gnome.Effects` at `/org/projecteur/Gnome/Effects`;
its `Preview(string mode, int seconds)` accepts 1–30 seconds and `StopPreview()`
ends it. The interface also selects enabled effects, applies/cycles presets and
opens preferences; it is removed when the extension is disabled.

## Preset transfer

Export all writes a versioned UTF-8 JSON file containing named appearance
presets only. Import merges by name, replacing matching names; it does not
immediately apply a preset. The complete file is validated before changing saved
presets. Files are limited to 256 KiB, 30 presets and 48-character names. Unknown
settings, invalid values, duplicate names and unsupported versions are rejected.
Older presets receive schema defaults for newly added appearance keys.
Device mappings, timer settings, monitor identities and private logs are excluded.

## Optional presenter button mappings

Default button actions remain unchanged. In preferences, choose actions for
Next/Back taps, long presses or hold-and-move, then Apply while the presenter is
idle. Restore default buttons clears only mappings. Configurations are validated
before use; a rejected configuration preserves the last accepted one.

Tap/hold actions can send up to four keyboard combinations (PortableText, e.g.
`Ctrl+L, F5`), switch effects/presets, toggle persistent display, control the timer,
scroll or adjust volume. Supported keyboard keys include letters/digits, F1–F12,
arrows/navigation, Space, Tab, Enter, Esc, Backspace, and common punctuation;
Ctrl/Alt/Shift/Meta use US physical key positions, not text input or shell commands.
Unmapped input is forwarded through the existing uinput devices.

Hold-and-move can control vertical/horizontal scroll or volume through upstream
special sequences. A button cannot have both a non-default hold action and
hold-and-move action. Model-specific reports remain required; other models are
not hardware-verified. No new original-Spotlight command is sent to other models.
`SetButtonMappings(string json)` uses inputs `next`, `back`, `next-hold`,
`back-hold`, `next-move`, `back-move`; `{}` restores forwarding.
`GetButtonMappings()` returns the last accepted configuration.
Mappings are held in daemon memory and synchronized from GSettings by Shell;
disabling the extension restores the empty mapping.

## Command-line control

The installer includes `~/.local/bin/projecteur-gnome` (Python 3 and gdbus only):

```sh
projecteur-gnome status
projecteur-gnome preview spotlight --seconds 5
projecteur-gnome stop-preview
projecteur-gnome effect laser
projecteur-gnome preset "Demo"
projecteur-gnome preset-next
projecteur-gnome timer start --minutes 15 --arm
projecteur-gnome timer pause
projecteur-gnome timer resume
projecteur-gnome timer reset
projecteur-gnome preferences
projecteur-gnome vibrate --intensity 128 --length 1
```

Run `projecteur-gnome --help` for commands and command-specific help. Effect and
preset commands require the enabled, updated extension; timer/status commands
require the daemon. Vibration reports a queued request, not physical success.
Global shortcuts remain deferred; no bindings are installed by this batch.

## Refresh documentation screenshots

Native GTK preferences screenshots can be captured with default temporary
settings in an isolated headless GNOME session:

```sh
python3 gnome/tests/capture-preferences.py zh-TW
python3 gnome/tests/capture-preferences.py en
```

Results stay under ignored `build/gnome/documentation-images` for review. Copy
only the intended preferences-window PNGs into `doc/` after inspecting them. The
capture helper is injected into a temporary extension copy and is never installed
in the user's extension. No personal settings, logs or desktop captures are
part of the documentation images.
