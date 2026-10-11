import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {createTranslator} from './i18n.js';
import {enabledModes, resolveMode} from './pointer-state.js';

export const PointerIndicator = GObject.registerClass(
class PointerIndicator extends PanelMenu.Button {
    _init(extension, settings) {
        const _ = createTranslator();
        super._init(0.0, _('Presenter effects'));
        this._settings = settings;
        this.add_child(new St.Icon({
            gicon: new Gio.FileIcon({file: extension.dir.get_child('icons')
                .get_child('projecteur-target-symbolic.svg')}),
            style_class: 'system-status-icon',
        }));

        this._selector = new PopupMenu.PopupSubMenuMenuItem(_('Current effect'));
        this.menu.addMenuItem(this._selector);
        this._modeItems = new Map();
        for (const [mode, label] of [['laser', 'Laser dot'], ['spotlight', 'Spotlight'],
            ['magnifier', 'Magnifier']]) {
            const item = new PopupMenu.PopupMenuItem(_(label));
            item.connect('activate', () => {
                if (settings.get_boolean(`${mode}-enabled`))
                    settings.set_string('pointer-mode', mode);
            });
            this._selector.menu.addMenuItem(item);
            this._modeItems.set(mode, item);
        }
        this._empty = new PopupMenu.PopupMenuItem(_('Enable at least one effect first.'),
            {reactive: false, can_focus: false});
        this._empty.setSensitive(false);
        this.menu.addMenuItem(this._empty);

        this._switches = new Map();
        // Match the controls and display-behavior groups, then provide effect toggles.
        for (const [key, label] of [
            ['double-click-switch', 'Double-click to switch effects'],
            ['pointer-clicks-enabled', 'Allow presenter mouse clicks'],
            ['always-visible', 'Always show the pointer effect'],
            ['hide-system-cursor', 'Hide the mouse cursor while an effect is visible'],
            ['start-at-monitor-center', 'Center on the remembered monitor each time the pointer button is pressed'],
        ]) this._addSwitch(key, _(label));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const [key, label] of [
            ['laser-enabled', 'Enable laser dot'],
            ['spotlight-enabled', 'Enable spotlight'],
            ['magnifier-enabled', 'Enable magnifier'],
        ]) this._addSwitch(key, _(label));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Open preferences'), () => extension.openPreferences());

        this._changed = settings.connect('changed', () => this._sync());
        this.connect('destroy', () => {
            settings.disconnect(this._changed);
            this._settings = null;
        });
        this._sync();
    }

    _addSwitch(key, label) {
        const item = new PopupMenu.PopupSwitchMenuItem(label, this._settings.get_boolean(key));
        item.connect('toggled', (_item, value) => {
            // Programmatic updates also emit toggled; avoid writing back while syncing.
            if (!this._syncing) this._settings.set_boolean(key, value);
        });
        this.menu.addMenuItem(item);
        this._switches.set(key, item);
    }

    _sync() {
        this._syncing = true;
        try {
            const modes = enabledModes(this._settings.get_boolean('laser-enabled'),
                this._settings.get_boolean('spotlight-enabled'),
                this._settings.get_boolean('magnifier-enabled'));
            const mode = resolveMode(this._settings.get_string('pointer-mode'), modes);
            this._selector.setSensitive(mode !== null);
            this._empty.visible = mode === null;
            for (const [value, item] of this._modeItems) {
                item.visible = modes.includes(value);
                item.setOrnament(value === mode ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
            }
            const _ = createTranslator();
            this._selector.label.text = mode === null ? _('Current effect') :
                `${_('Current effect')}: ${this._modeItems.get(mode).label.text}`;
            for (const [key, item] of this._switches)
                item.setToggleState(this._settings.get_boolean(key));
        } finally {
            this._syncing = false;
        }
    }
});
