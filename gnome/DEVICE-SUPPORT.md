# Presenter compatibility

The GNOME daemon shares Projecteur's device scanner, evdev forwarding, and
HID++ implementation. The extra-device table matches the upstream
[develop device list](https://github.com/gbin/Projecteur/blob/develop/devices.conf)
checked on 2026-10-11. Upstream's
[master list](https://github.com/gbin/Projecteur/blob/master/devices.conf)
contains fewer devices. Device IDs are allowlisted; ordinary mice and keyboards
are not opened as a workaround.

Only the original Logitech Spotlight USB receiver (`046d:c53e`) has been
verified on this GNOME fork. The user confirmed the three effects, native
double-click switching, optional mouse clicks, effect toggles, and reset
controls on the original USB device on 2026-10-11. The user also confirmed
repeated-press monitor centering on the original USB device on the same date. A device-table test proves inclusion in the scanner
and permissions rules, not working hardware.

| Presenter | USB ID | Bluetooth ID | GNOME hardware verification |
| --- | --- | --- | --- |
| Logitech Spotlight | `046d:c53e` | `046d:b503` | Original USB effects and controls user-tested; Bluetooth unverified |
| Logitech Spotlight 2 | `046d:c548` | `046d:b506` | Unverified; inherited device handling |
| AVATTO H100 / August WP200 | `0c45:8101` | — | Unverified; inherited upstream entry |
| August LP315 | `2312:863d` | — | Unverified; inherited upstream entry |
| AVATTO i10 Pro | `2571:4109` | — | Unverified; inherited upstream entry |
| Lenovo ThinkPad X1 Presenter Mouse | `17ef:60d9` | `17ef:60db` | Unverified; inherited upstream entries |
| August LP310 | `69a7:9803` | — | Unverified; inherited upstream entry |
| Norwii Wireless Presenter | `3243:0122` | — | Unverified; inherited upstream entry |
| Norwii N95s BLE Presenter | `3243:0382` | `3243:03a2` | Unverified; inherited upstream entries |
| Kensington PowerPointer | `1ea7:0002` | — | Unverified; inherited upstream entry |
| Microsoft Presenter+ | — | `045e:0851` | Unverified; inherited upstream entry |
| Norwii N97s BLE Presenter | `3243:0342` | `3243:0352` | Unverified; inherited upstream entries |

## What can be shared

The three visual effects are independent of the presenter model. Devices that
send relative mouse movement (`REL_X` / `REL_Y`) can use the same overlay and
idle timeout. Mixed frames containing scan codes, movement, and buttons are
split so movement and key forwarding are both preserved. Devices using only
absolute coordinates, proprietary reports, or different pointer behavior need
hardware traces before compatibility can be claimed.

Effect selection is always available in preferences. Native pointer-button
double-click switching is currently implemented only for original Logitech
Spotlight USB/Bluetooth devices, with the `ReprogramControlsV4` feature present.
It uses documented HID++ control `0xdf`; it does not infer double clicks from
movement or idle expiry. Turning the option off restores that control's normal
mapping. Previous/next controls are unchanged. Left mouse click forwarding has a
separate opt-in setting, disabled by default.
Spotlight 2 and other devices do not receive the original model's double-click
reprogramming command. Their generic mouse double clicks reach applications only when mouse click
forwarding is enabled, and do not switch effects.

## Reports from owners

For an unverified presenter, report its model, USB/Bluetooth connection, device
ID, Ubuntu/GNOME versions, whether pointer movement and slide navigation work,
and whether all three effects work in a fullscreen presentation. Include only
relevant, redacted daemon log lines; do not publish complete system logs.
Never change global input permissions or run the daemon as root to make a
device appear supported.

## Centering on every pointer press

Original Spotlight USB/Bluetooth can enable transient `0xd8` long-press and
raw XY reports while the center option is enabled. Motion is forwarded through
the virtual mouse. Turning the option off restores native movement; no persistent
mapping is written. The control is not sent to Spotlight 2 or other models.
Other presenters use reported `BTN_LEFT` presses when available. Multi-monitor
centering and repeated presses are verified in isolated GNOME tests; the newly
added original Spotlight USB long-press path was confirmed by the user on
2026-10-11. Bluetooth and other models remain hardware-unverified.

## Timer haptics and battery status

The GNOME timer uses upstream capability-gated vibration for devices exposing
that feature; battery polling likewise requires ReportBattery. Listing a model
or capability does not verify physical feedback or battery accuracy.
The owner reported successful testing of the new GNOME batch on original
Spotlight USB on 2026-10-12; Bluetooth and other models remain unverified.

## Optional button mappings and gestures

Next/Back aliases and upstream hold/hold-move sequences can now be mapped in
GNOME preferences. Default mappings are empty; navigation is preserved.
The owner reported this newly exposed GNOME batch working on original
Spotlight USB on 2026-10-12; gesture behavior on other models remains unverified.
Enabling a UI action does
not prove that a device emits the corresponding upstream sequence. Existing
capability-gated hold initialization is reused; no additional original-model
control command is sent to other presenters.
