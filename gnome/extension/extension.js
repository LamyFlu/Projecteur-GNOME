import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const BUS_NAME = 'org.projecteur.Gnome';
const OBJECT_PATH = '/org/projecteur/Gnome/Pointer';
const INTERFACE = 'org.projecteur.Gnome.Pointer';

export default class ProjecteurPointerExtension extends Extension {
    enable() {
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
        this._settingsChanged = this._settings.connect('changed', (_settings, key) => {
            this._updateAppearance();
            this._updateCursorVisibility();
            if (key === 'linger-seconds') this._syncLingerSeconds();
        });
        this._updateAppearance();

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

        this._nameWatch = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => {
                this._syncLingerSeconds();
                this._syncActiveProperty();
            },
            () => this._setActive(false));
    }

    disable() {
        this._setActive(false);
        this._cursorTracker = null;
        this._seat = null;

        if (this._settingsChanged) {
            this._settings.disconnect(this._settingsChanged);
            this._settingsChanged = 0;
        }
        this._settings = null;

        if (this._activeSubscription) {
            Gio.DBus.session.signal_unsubscribe(this._activeSubscription);
            this._activeSubscription = 0;
        }
        if (this._motionSubscription) {
            Gio.DBus.session.signal_unsubscribe(this._motionSubscription);
            this._motionSubscription = 0;
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

    _setActive(active) {
        if (!this._dot) return;

        this._dot.visible = active;
        this._updateCursorVisibility();
        if (active) {
            this._disableUnredirect();
            this._syncSystemPointer(true);
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
            if (this._positionTimer) {
                GLib.source_remove(this._positionTimer);
                this._positionTimer = 0;
            }
            this._restoreUnredirect();
        }
    }

    _updateCursorVisibility() {
        const hide = this._dot?.visible &&
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
        if (!this._dot?.visible) return;

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
        if (!this._dot?.visible) return;

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
        if (!this._dot?.visible) return;

        const size = this._dotSize;
        this._pointerX = Math.max(0, Math.min(global.stage.width, this._pointerX));
        this._pointerY = Math.max(0, Math.min(global.stage.height, this._pointerY));
        this._dot.set_position(
            Math.round(this._pointerX - size / 2),
            Math.round(this._pointerY - size / 2));
        global.stage.set_child_above_sibling(this._dot, null);
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
