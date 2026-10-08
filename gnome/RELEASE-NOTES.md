# Projecteur GNOME v0.1.0-beta.1

First public preview of the GNOME / Wayland adaptation of Projecteur.

## Included

- Logitech Spotlight-controlled laser dot with configurable color and diameter.
- System cursor hiding while the dot is active, with automatic restoration.
- Configurable idle duration from 0.1 to 30 seconds (default 3 seconds).
- Previous/next slide forwarding and fullscreen presentation overlay support.
- Traditional Chinese preferences on Chinese locales, English on other locales.
- One-command Ubuntu installation and removal, with preferences preserved.
- AI assistant installation and configuration instructions in `AGENTS.md`.

## Tested environment

Ubuntu 26.04, GNOME Shell 50.1, Wayland, Logitech Spotlight USB receiver
(`046d:c53e`), and OnlyOffice fullscreen presentations. Existing pointer,
cursor-hiding, slide-navigation, and idle-time features have been confirmed
locally by the user. Other GNOME versions, distributions, and presenter models
have not been validated for this adaptation.

## Installation

Download and extract the source archive, open a terminal in the extracted
folder, and run `./install.sh` as your desktop user. Reconnect the presenter,
then log out and back in. The extension enables automatically on the next login.
The installer may need administrator access for missing packages or device
permission rules. See `README.md` or `README.zh-TW.md` for details.

## Limits

The idle duration is measured from the last movement, not the physical button
release. Fullscreen direct scanout is paused while the dot is visible. GTK's
built-in dialog controls follow system translations. This preview provides
the GNOME laser-dot workflow; the upstream Plasma spotlight and magnifier are
not part of this GNOME implementation.

## Attribution

Based on Projecteur by Jahn Fuchs, maintained upstream by Guillaume Binet and
contributors. The original MIT license and copyright notice are retained.
