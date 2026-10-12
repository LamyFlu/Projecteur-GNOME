# Upstream feature comparison

Reviewed on 2026-10-11 against the upstream
[Projecteur user guide](https://github.com/gbin/Projecteur/blob/develop/doc/USER-GUIDE.md)
on `develop`. The GNOME implementation is independent of the upstream Plasma
UI. An implemented feature is not a claim of hardware verification.

The user-tested GNOME baseline was published as `585bb4a` before starting this
batch. Local additions now include timer/status/presets, button actions, advanced appearance,
preview and preset transfer; the owner reported successful testing on the
original Spotlight USB on 2026-10-12. Global shortcuts are
explicitly deferred at the user's request.

| Upstream feature | GNOME status |
| --- | --- |
| Laser/highlight/live local zoom | Implemented; laser, circular spotlight and magnifier |
| Saved appearance presets | Added in this batch; preferences management and panel selection |
| Presentation timer, arming, haptic expiry | Added in this batch; pause/resume/reset and notifications; owner reported this batch working on original Spotlight USB; other models unverified |
| Connected presenters and battery notifications | Added in this batch; capability-dependent battery/charging and low-battery notification; original USB batch owner-tested; other models unverified |
| Optional native double-click switching | Implemented for original Spotlight, not all upstream models |
| Keyboard sequence/scroll/volume/button remapping | Added: next/back actions with validated keyboard sequences, scrolling, volume, presets, effect and timer actions; defaults preserve navigation |
| Next/Back long press and hold-and-move mappings | Added using upstream special input sequences; owner-tested original USB batch; other models unverified |
| Global keyboard shortcuts and hardware-free pointer | Deferred by the user |
| Shapes, rotation, separate border/shade colors, fading trails | Added circle/square/diamond spotlight, rotation, shade/border controls and fading trail; defaults preserve previous appearance |
| Smooth/text-and-UI/pixel-perfect zoom modes | Added smooth/text enhancement/pixel-grid sampling; pixel grid does not guarantee upstream source-pixel accuracy |
| Command-line controller and property reference | Added projecteur-gnome CLI for status, effects, preview, presets, timer and vibration |
| Distribution packaging and desktops beyond GNOME 50 | Automatic installation remains Ubuntu 26.04/GNOME 50/Wayland |

Global shortcuts remain deferred. Broader packaging and additional desktops still
need independently verified compatibility; this batch does not broaden support.
Original Spotlight control reprogramming must never be sent to other models
merely because their names appear in upstream's device list.

## Suggestions specific to this GNOME fork

These are local recommendations, not claims about features missing upstream:

| Suggested improvement | Purpose |
| --- | --- |
| Device capability and sleep status in preferences | Distinguish an asleep presenter from one lacking haptics or battery reporting |
| JSON preset import/export with full validation (implemented locally) | Move appearance settings between computers without sharing personal logs |
| Optional advance timer warning and notification toggle | Provide time to wrap up before expiry and control presentation interruptions |
| Preview of effects from preferences (implemented locally) | Inspect sizes and colors without holding the presenter button |

Next, improve capability/status clarity. Global shortcuts stay behind the remaining work as
requested. Haptic feedback and gestures on other models require owner reports.
