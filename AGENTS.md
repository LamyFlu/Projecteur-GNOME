# Instructions for AI assistants

This fork adds a Logitech Spotlight laser dot to Ubuntu 26.04 / GNOME Shell 50
on Wayland. The user-facing entry points are `install.sh`, `uninstall.sh`,
`README.md`, and `README.zh-TW.md`. The GNOME implementation lives in `gnome/`.

## Helping a user install and configure

1. Read the README and check `/etc/os-release`, `gnome-shell --version`,
   `XDG_SESSION_TYPE`, and `XDG_CURRENT_DESKTOP`. The supported automatic install
   target is Ubuntu 26.04 with GNOME 50 on Wayland. Do not replace the user's
   desktop environment or silently bypass compatibility checks.
2. Run `./install.sh` as the desktop user, never `sudo ./install.sh`. The script
   builds the daemon, installs missing build dependencies when needed, installs
   device access rules when needed, installs user files, and enables the user
   service and extension for the next login. Use the environment's normal
   permission mechanism if administrator access is needed; never ask for or
   collect the user's password. `--no-system-changes` skips dependencies and
   udev modifications when those have already been provided.
3. Keep existing pointer preferences. Do not reset settings or remove other
   extensions. Do not log the user out, restart GNOME Shell, or reboot. Explain
   that the user must log out and back in to load a new or updated extension.
4. After the user logs in, check:
   - `gnome-extensions info projecteur-pointer-ubuntu26@projecteur.github.io`
   - `systemctl --user is-active projecteur-gnome-daemon.service`
   - `journalctl --user -b -u projecteur-gnome-daemon.service --no-pager`
5. Open preferences with `gnome-extensions prefs
   projecteur-pointer-ubuntu26@projecteur.github.io`. Offer color, diameter
   (6–96 logical pixels), system-cursor hiding, and linger time (0.1–30 seconds).
   Also offer laser/spotlight/magnifier selection, per-effect enablement,
   spotlight diameter/dimming, lens diameter/zoom, and optional native double
   click switching (off by default, original Spotlight only). Presenter left
   mouse click forwarding is separately optional and off by default. Spotlight
   and magnifier each have an appearance reset that preserves mode/enablement.
   Fresh installs enable only the laser dot; upgrades preserve toggle values.
   All effects can be disabled; show a disabled selector prompt and restore
   the cursor when none are enabled.
   The timeout starts at the last presenter movement, not the physical button
   release. Chinese locales use Traditional Chinese; other locales use English.
6. Ask the user to test all three effects, optional double-click switching,
   pointer movement, previous/next slide, fullscreen
   visibility, cursor restoration, and their preferred linger time. A service
   check or automated test cannot prove the visual behavior on their display.

## Troubleshooting

- Reconnect the USB receiver or Bluetooth presenter after installing udev rules.
- Verify access to the presenter's input/hidraw nodes and `/dev/uinput`.
- Never use blanket `chmod 666` on input devices, grant access to all input
  devices, or run the daemon as root as a shortcut.
- Test only one copy of the daemon on the normal session bus. Use
  `dbus-run-session` with `--disable-uinput --no-device-scan` for synthetic
  automated tests. On a connected device, ask the user
  to leave the presenter idle during automated device tests.
- To show a temporary test dot, use `SetActiveForTesting true` on
  `org.projecteur.Gnome.Pointer`, then always call it with `false` afterward.
- Removing user files with `./uninstall.sh` intentionally keeps system udev
  rules and saved preferences. Explain this when helping uninstall.

## Development and validation

- Preserve upstream attribution and the MIT notice in `LICENSE.md`.
- Keep GNOME changes scoped to `gnome/` and the required shared device code.
  Do not claim that the fork supports untested desktop or presenter versions.
- Keep the compatibility table in `gnome/DEVICE-SUPPORT.md` accurate. An
  allowlisted or upstream-listed model is not hardware-verified on this fork.
  Never send original Spotlight control `0xdf` reprogramming to other models.
- Build: `cmake -S gnome -B build/gnome -DCMAKE_BUILD_TYPE=Release`, then
  `cmake --build build/gnome --parallel 4`.
- Validate shell scripts with `bash -n`, schemas with
  `glib-compile-schemas --strict --dry-run gnome/extension/schemas`, and run
  the test commands in `gnome/README.md`.
- Keep generated build outputs, private logs, credentials, personal installers,
  and review/export artifacts out of Git. Do not commit `gschemas.compiled`.
- Publishing, pushing, creating a public repository, or uploading a release
  requires the user's explicit instruction. Prepare reviewable changes first.
