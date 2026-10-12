import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {readPresets, applyPreset} from './presets.js';
import {createTranslator} from './i18n.js';
import {PointerIndicator} from './panel-indicator.js';
import {PointerEffects} from './pointer-effects.js';
import {enabledModes, resolveMode, nextMode} from './pointer-state.js';

const BUS_NAME = 'org.projecteur.Gnome';
const OBJECT_PATH = '/org/projecteur/Gnome/Pointer';
const INTERFACE = 'org.projecteur.Gnome.Pointer';
const EFFECTS_XML = `<node><interface name="org.projecteur.Gnome.Effects">
<method name="Preview"><arg type="s" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="StopPreview"/>
<method name="SelectEffect"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="ApplyPreset"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="CyclePreset"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="OpenPreferences"/>
</interface></node>`;

export default class ProjecteurPointerExtension extends Extension {
    enable() {
        this._previewMode = null;
        this._previewTimer = 0;
        this._active = false;
        this._daemonActive = false;
        this._effects = new PointerEffects();
        this._unredirectDisabled = false;
        this._cursorTracker = global.backend.get_cursor_tracker();
        this._seat = Clutter.get_default_backend().get_default_seat();
        this._cursorFocusInhibited = false;
        this._cursorVisibilityInhibited = false;
        this._dot = new St.Widget({
            style_class: 'projecteur-pointer-dot',
            reactive: false,
            can_focus: false,
            track_hover: false,
            visible: false,
        });
        // Keep the pointer above fullscreen presentation windows. GNOME's
        // regular chrome is either below them or deliberately hidden by the
        // fullscreen tracking code.
        global.stage.add_child(this._dot);
        global.stage.set_child_above_sibling(this._dot, null);

        this._settings = this.getSettings();
        this._indicator = new PointerIndicator(this, this._settings);
        Main.panel.addToStatusArea('projecteur-pointer', this._indicator);
        this._settingsChanged = this._settings.connect('changed', (_settings, key) => {
            this._updateAppearance();
            this._updateCursorVisibility();
            if (['pointer-mode', 'laser-enabled', 'spotlight-enabled', 'magnifier-enabled', 'always-visible'].includes(key))
                this._setActive(this._daemonActive);
            if (['timer-vibration', 'vibration-intensity', 'vibration-length'].includes(key)) this._syncTimerFeedback();
            if (key === 'linger-seconds') this._syncLingerSeconds();
            if (key === 'double-click-switch') this._syncDoubleClick();
            if (key === 'start-at-monitor-center') this._syncPointerCenter();
            if (key === 'pointer-clicks-enabled') this._syncPointerClicks();
            if (key === 'button-mappings') this._syncButtonMappings();
        });
        this._updateAppearance();
        this._monitorChanged = Main.layoutManager.connect('monitors-changed', () => this._updatePosition());

        const [x, y] = global.get_pointer();
        this._pointerX = x;
        this._pointerY = y;
        this._systemPointerX = x;
        this._systemPointerY = y;

        this._activeSubscription = Gio.DBus.session.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'ActiveChanged',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                const [active] = parameters.deepUnpack();
                this._setActive(active);
            });

        this._motionSubscription = Gio.DBus.session.signal_subscribe(
            BUS_NAME,
            INTERFACE,
            'Motion',
            OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                const [deltaX, deltaY] = parameters.deepUnpack();
                this._handleMotion(deltaX, deltaY);
            });

        this._pressSubscription = Gio.DBus.session.signal_subscribe(
            BUS_NAME, INTERFACE, 'PointerButtonPressed', OBJECT_PATH, null,
            Gio.DBusSignalFlags.NONE, () => {
                if (this._settings?.get_boolean('start-at-monitor-center') && this._mode() !== null) {
                    this._centerOnRememberedMonitor();
                    this._updatePosition();
                }
            });

        this._actionSubscription = Gio.DBus.session.signal_subscribe(BUS_NAME, INTERFACE,
            'PresenterAction', OBJECT_PATH, null, Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, params) => {
                const [action] = params.deepUnpack();
                if (action === 'next-preset') this._cyclePreset(1);
                else if (action === 'previous-preset') this._cyclePreset(-1);
                else if (action === 'toggle-effect') this._settings.set_boolean('always-visible', !this._settings.get_boolean('always-visible'));
                else if (action === 'next-effect') {
                    const mode = nextMode(this._mode(), this._modes());
                    if (mode) this._settings.set_string('pointer-mode', mode);
                } else if (action === 'timer-start') this.callService('StartPresentationTimer',
                    new GLib.Variant('(ib)', [this._settings.get_int('timer-minutes') * 60, false])).catch(() => {});
                else if (action === 'timer-reset') this.callService('ResetPresentationTimer').catch(() => {});
            });

        this._doubleClickSubscription = Gio.DBus.session.signal_subscribe(
            BUS_NAME, INTERFACE, 'PointerDoubleClicked', OBJECT_PATH, null,
            Gio.DBusSignalFlags.NONE, () => {
                if (!this._settings?.get_boolean('double-click-switch')) return;
                const mode = nextMode(this._mode(), this._modes());
                if (mode) this._settings.set_string('pointer-mode', mode);
            });

        this._nameWatch = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => {
                this._syncButtonMappings();
                this._syncLingerSeconds();
                this._syncTimerFeedback();
                this._syncDoubleClick();
                this._syncPointerClicks();
                this._syncPointerCenter();
                this._syncActiveProperty();
            },
            () => this._setActive(false));
        this._setActive(false);
        this._effectsBus = Gio.DBusExportedObject.wrapJSObject(EFFECTS_XML, {
            Preview: (mode, seconds) => this.preview(mode, seconds),
            StopPreview: () => this.stopPreview(),
            SelectEffect: mode => {
                if (!this._modes().includes(mode)) return false;
                this._settings.set_string('pointer-mode', mode);
                return true;
            },
            ApplyPreset: name => { try { applyPreset(this._settings, name); return true; } catch (_) { return false; } },
            CyclePreset: direction => this._cyclePreset(direction),
            OpenPreferences: () => this.openPreferences(),
        });
        this._effectsBus.export(Gio.DBus.session, '/org/projecteur/Gnome/Effects');
        this._effectsName = Gio.bus_own_name_on_connection(Gio.DBus.session,
            'org.projecteur.Gnome.Effects', Gio.BusNameOwnerFlags.NONE, null, null);
        this._statusEpoch = (this._statusEpoch ?? 0) + 1;
        this._lowBattery = new Set();
        this._lastTimerState = null;
        this._pollStatus();
        this._statusTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._pollStatus();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._previewTimer) GLib.source_remove(this._previewTimer);
        this._previewTimer = 0;
        this._previewMode = null;
        this._effectsBus?.unexport();
        this._effectsBus = null;
        if (this._effectsName) Gio.bus_unown_name(this._effectsName);
        this._effectsName = 0;
        this._statusEpoch++;
        if (this._statusTimer) GLib.source_remove(this._statusTimer);
        this._statusTimer = 0;
        this._setActive(false, true);
        if (this._monitorChanged) {
            Main.layoutManager.disconnect(this._monitorChanged);
            this._monitorChanged = 0;
        }
        this.callService('SetButtonMappings', new GLib.Variant('(s)', ['{}'])).catch(() => {});
        if (this._actionSubscription) Gio.DBus.session.signal_unsubscribe(this._actionSubscription);
        this._actionSubscription = 0;
        this._syncDoubleClick(false);
        this._syncPointerClicks(false);
        this._syncPointerCenter(false);
        this._effects?.destroy();
        this._effects = null;
        this._cursorTracker = null;
        this._seat = null;

        if (this._settingsChanged) {
            this._settings.disconnect(this._settingsChanged);
            this._settingsChanged = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;

        if (this._activeSubscription) {
            Gio.DBus.session.signal_unsubscribe(this._activeSubscription);
            this._activeSubscription = 0;
        }
        if (this._motionSubscription) {
            Gio.DBus.session.signal_unsubscribe(this._motionSubscription);
            this._motionSubscription = 0;
        }
        if (this._pressSubscription) {
            Gio.DBus.session.signal_unsubscribe(this._pressSubscription);
            this._pressSubscription = 0;
        }
        if (this._doubleClickSubscription) {
            Gio.DBus.session.signal_unsubscribe(this._doubleClickSubscription);
            this._doubleClickSubscription = 0;
        }
        if (this._nameWatch) {
            Gio.bus_unwatch_name(this._nameWatch);
            this._nameWatch = 0;
        }
        if (this._dot) {
            this._dot.destroy();
            this._dot = null;
        }
    }

    _updateAppearance() {
        const size = this._settings.get_int('dot-size');
        const [valid, color] = Cogl.Color.from_string(
            this._settings.get_string('dot-color'));
        // Parse the stored value instead of interpolating arbitrary CSS.
        const red = valid ? color.red : 255;
        const green = valid ? color.green : 24;
        const blue = valid ? color.blue : 24;
        this._dotSize = size;
        this._dot.set_size(size, size);
        this._dot.set_style(`
            width: ${size}px; height: ${size}px;
            background-color: rgba(${red}, ${green}, ${blue}, 0.96);
            border-color: rgba(${Math.round(red * 0.15 + 255 * 0.85)},
                ${Math.round(green * 0.15 + 255 * 0.85)},
                ${Math.round(blue * 0.15 + 255 * 0.85)}, 0.95);
            box-shadow: 0 0 8px 4px rgba(${red}, ${green}, ${blue}, 0.75);
        `);
        this._updatePosition();
    }

    _setActive(active, forceHide = false) {
        if (!this._dot) return;

        const wasActive = this._active;
        this._daemonActive = active;
        active = !forceHide && (active || this._previewMode !== null || this._settings.get_boolean('always-visible'));
        this._active = active;
        const centered = active && !wasActive && !this._previewMode && this._mode() !== null &&
            this._settings.get_boolean('start-at-monitor-center') &&
            this._centerOnRememberedMonitor();
        this._dot.visible = active && this._mode() === 'laser';
        this._updatePosition();
        this._updateCursorVisibility();
        if (active && this._mode() !== null) {
            this._disableUnredirect();
            if (!centered) this._syncSystemPointer(true);
            global.stage.set_child_above_sibling(this._dot, null);
            if (!this._positionTimer) {
                this._positionTimer = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    16,
                    () => {
                        this._syncSystemPointer(false);
                        return GLib.SOURCE_CONTINUE;
                    });
            }
        } else {
            this._effects.update(false, 'laser', 0, 0, this._settings);
            if (this._positionTimer) {
                GLib.source_remove(this._positionTimer);
                this._positionTimer = 0;
            }
            this._restoreUnredirect();
        }
    }

    preview(mode, seconds = 5) {
        if (!['laser', 'spotlight', 'magnifier'].includes(mode) || !Number.isInteger(seconds) || seconds < 1 || seconds > 30)
            return false;
        if (this._previewTimer) GLib.source_remove(this._previewTimer);
        this._previewMode = mode;
        this._setActive(this._daemonActive);
        this._previewTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._previewTimer = 0;
            this.stopPreview();
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    stopPreview() {
        if (this._previewTimer) GLib.source_remove(this._previewTimer);
        this._previewTimer = 0;
        this._previewMode = null;
        if (this._settings) this._setActive(this._daemonActive);
    }

    _cyclePreset(direction) {
        if (![1, -1].includes(direction)) return false;
        const presets = readPresets(this._settings);
        if (!presets.length) return false;
        const current = presets.findIndex(preset => preset.name === this._settings.get_string('last-applied-preset'));
        const index = current < 0 ? (direction > 0 ? 0 : presets.length - 1) :
            (current + direction + presets.length) % presets.length;
        try { applyPreset(this._settings, presets[index].name); return true; }
        catch (_) { return false; }
    }

    _monitorConnector(index) {
        try {
            const manager = global.backend.get_monitor_manager();
            const logical = manager.get_logical_monitors()
                .find(monitor => monitor.get_number() === index);
            const connectors = logical?.get_monitors()
                .map(monitor => monitor.get_connector())
                .filter(Boolean)
                .sort();
            if (connectors?.length) return connectors.join('|');
        } catch (_error) {
            // Geometry/index fallback keeps the feature usable if Mutter's
            // monitor identity API is unavailable on an unexpected build.
        }
        return `index:${index}`;
    }

    _rememberMonitorAt(x, y) {
        const monitor = Main.layoutManager.findMonitorForPoint(x, y);
        if (!monitor) return;

        const connector = this._monitorConnector(monitor.index);
        if (this._settings.get_string('last-monitor-connector') !== connector)
            this._settings.set_string('last-monitor-connector', connector);
    }

    _centerOnRememberedMonitor() {
        const monitors = Main.layoutManager.monitors;
        if (!monitors.length) return false;

        const connector = this._settings.get_string('last-monitor-connector');
        let monitor = monitors.find(item => this._monitorConnector(item.index) === connector);
        if (!monitor) {
            const [x, y] = global.get_pointer();
            monitor = Main.layoutManager.findMonitorForPoint(x, y) ??
                Main.layoutManager.primaryMonitor ?? monitors[0];
        }
        const x = Math.round(monitor.x + monitor.width / 2);
        const y = Math.round(monitor.y + monitor.height / 2);
        this._seat.warp_pointer(x, y);
        this._pointerX = x;
        this._pointerY = y;
        this._systemPointerX = x;
        this._systemPointerY = y;
        this._rememberMonitorAt(x, y);
        return true;
    }

    _updateCursorVisibility() {
        const hide = this._active && this._mode() !== null &&
            this._settings.get_boolean('hide-system-cursor');
        // Mutter counts visibility inhibitors. Acquire once and release only
        // our own inhibitor so other extensions keep control of theirs.
        if (hide && !this._cursorVisibilityInhibited) {
            // Hiding the cursor normally releases pointer focus. Mutter 50
            // skips updating the cursor renderer when the sprite has no
            // focused actor, leaving the previous arrow on screen. Retain
            // focus until visibility is restored, balancing our own claim.
            this._seat.inhibit_unfocus();
            this._cursorFocusInhibited = true;
            this._cursorTracker.inhibit_cursor_visibility();
            this._cursorVisibilityInhibited = true;
        } else if (!hide && this._cursorVisibilityInhibited) {
            this._cursorTracker.uninhibit_cursor_visibility();
            this._cursorVisibilityInhibited = false;
        }
        if (!hide && this._cursorFocusInhibited) {
            this._seat.uninhibit_unfocus();
            this._cursorFocusInhibited = false;
        }
    }

    _disableUnredirect() {
        if (this._unredirectDisabled) return;

        if (Meta.disable_unredirect_for_display !== undefined)
            Meta.disable_unredirect_for_display(global.display);
        else if (global.compositor.disable_unredirect !== undefined)
            global.compositor.disable_unredirect();
        this._unredirectDisabled = true;
    }

    _restoreUnredirect() {
        if (!this._unredirectDisabled) return;

        if (Meta.enable_unredirect_for_display !== undefined)
            Meta.enable_unredirect_for_display(global.display);
        else if (global.compositor.enable_unredirect !== undefined)
            global.compositor.enable_unredirect();
        this._unredirectDisabled = false;
    }

    _handleMotion(deltaX, deltaY) {
        if (!this._active || !this._settings) return;

        const [systemX, systemY] = global.get_pointer();
        if (systemX !== this._systemPointerX || systemY !== this._systemPointerY) {
            // Normal desktop path: Mutter has already processed the uinput
            // movement, including its pointer acceleration.
            this._pointerX = systemX;
            this._pointerY = systemY;
        } else {
            // Some fullscreen presentation programs lock the system pointer.
            // Continue the laser dot with the raw relative device movement.
            this._pointerX += deltaX;
            this._pointerY += deltaY;
        }
        this._systemPointerX = systemX;
        this._systemPointerY = systemY;
        this._updatePosition();
    }

    _syncSystemPointer(force) {
        if (!this._active || !this._settings) return;

        const [systemX, systemY] = global.get_pointer();
        if (force || systemX !== this._systemPointerX || systemY !== this._systemPointerY) {
            this._pointerX = systemX;
            this._pointerY = systemY;
            this._systemPointerX = systemX;
            this._systemPointerY = systemY;
            this._updatePosition();
        }
    }

    _updatePosition() {
        if (!this._active || !this._settings) return;

        this._dot.visible = this._mode() === 'laser';
        const size = this._dotSize;
        this._pointerX = Math.max(0, Math.min(global.stage.width - 1, this._pointerX));
        this._pointerY = Math.max(0, Math.min(global.stage.height - 1, this._pointerY));
        if (!this._previewMode) this._rememberMonitorAt(this._pointerX, this._pointerY);
        this._dot.set_position(
            Math.round(this._pointerX - size / 2),
            Math.round(this._pointerY - size / 2));
        global.stage.set_child_above_sibling(this._dot, null);
        this._effects.update(this._mode() !== null, this._mode(), this._pointerX, this._pointerY, this._settings);
    }

    _modes() {
        return enabledModes(this._settings.get_boolean('laser-enabled'),
            this._settings.get_boolean('spotlight-enabled'),
            this._settings.get_boolean('magnifier-enabled'));
    }

    _mode() {
        if (this._previewMode) return this._previewMode;
        return resolveMode(this._settings.get_string('pointer-mode'), this._modes());
    }

    callService(method, parameters = null) {
        return new Promise((resolve, reject) => {
            Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE, method, parameters,
                null, Gio.DBusCallFlags.NONE, 3000, null, (connection, result) => {
                    try { resolve(connection.call_finish(result).deepUnpack()); }
                    catch (error) { reject(error); }
                });
        });
    }

    _syncButtonMappings() {
        this.callService('SetButtonMappings', new GLib.Variant('(s)', [this._settings.get_string('button-mappings')]))
            .then(([accepted]) => { if (!accepted) console.warn('Projecteur rejected invalid button mappings.'); })
            .catch(error => console.warn(`Projecteur button mappings: ${error.message}`));
    }

    _syncTimerFeedback() {
        this.callService('SetTimerFeedback', new GLib.Variant('(bii)', [
            this._settings.get_boolean('timer-vibration'),
            this._settings.get_int('vibration-intensity'),
            this._settings.get_int('vibration-length'),
        ])).catch(error => console.warn(`Projecteur timer feedback: ${error.message}`));
    }

    async _pollStatus() {
        if (this._statusPending) return;
        const epoch = this._statusEpoch;
        this._statusPending = true;
        try {
            const [json] = await this.callService('GetPresentationStatus');
            if (epoch !== this._statusEpoch || !this._indicator) return;
            const status = JSON.parse(json);
            const _ = createTranslator();
            this._indicator.updateStatus(status);
            if (status.timerState === 'expired' && this._lastTimerState !== 'expired')
                Main.notify(_('Presentation timer'), _('Presentation time is up.'));
            this._lastTimerState = status.timerState;
            const connected = new Set(status.devices.map(device => device.name));
            for (const name of this._lowBattery) {
                if (!connected.has(name)) this._lowBattery.delete(name);
            }
            for (const device of status.devices) {
                if (device.battery >= 0 && device.battery <= 15 && !device.charging && !this._lowBattery.has(device.name)) {
                    this._lowBattery.add(device.name);
                    Main.notify(_('Presenter battery is low'), `${device.name}: ${device.battery}%`);
                } else if (device.battery >= 20) this._lowBattery.delete(device.name);
            }
        } catch (_error) {
            if (epoch === this._statusEpoch) this._indicator?.updateStatus(null);
        } finally { this._statusPending = false; }
    }

    _syncPointerCenter(enabled = this._settings.get_boolean('start-at-monitor-center')) {
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE,
            'SetPointerCenterEnabled', new GLib.Variant('(b)', [enabled]),
            null, Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                try { connection.call_finish(result); }
                catch (error) { console.warn(`Projecteur pointer press: ${error.message}`); }
            });
    }

    _syncPointerClicks(enabled = this._settings.get_boolean('pointer-clicks-enabled')) {
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE,
            'SetPointerClicksEnabled', new GLib.Variant('(b)', [enabled]),
            null, Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                try { connection.call_finish(result); }
                catch (error) { console.warn(`Projecteur pointer clicks: ${error.message}`); }
            });
    }

    _syncDoubleClick(enabled = this._settings.get_boolean('double-click-switch')) {
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE,
            'SetPointerDoubleClickEnabled', new GLib.Variant('(b)', [enabled]),
            null, Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                try { connection.call_finish(result); }
                catch (error) { console.warn(`Projecteur double click: ${error.message}`); }
            });
    }

    _syncLingerSeconds() {
        Gio.DBus.session.call(
            BUS_NAME, OBJECT_PATH, INTERFACE, 'SetLingerSeconds',
            new GLib.Variant('(d)', [this._settings.get_double('linger-seconds')]),
            new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, -1, null,
            (connection, result) => {
                try {
                    const [accepted] = connection.call_finish(result).deepUnpack();
                    if (!accepted) console.warn('Projecteur Pointer: invalid linger time');
                } catch (error) {
                    console.warn(`Projecteur Pointer linger time: ${error.message}`);
                }
            });
    }

    _syncActiveProperty() {
        Gio.DBus.session.call(
            BUS_NAME,
            OBJECT_PATH,
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', [INTERFACE, 'Active']),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    const [value] = connection.call_finish(result).deepUnpack();
                    this._setActive(value.deepUnpack());
                } catch (error) {
                    console.warn(`Projecteur Pointer: ${error.message}`);
                    this._setActive(false);
                }
            });
    }
}
