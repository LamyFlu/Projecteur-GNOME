import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {readPresets, applyPreset} from './presets.js';
import {createTranslator} from './i18n.js';
import {enabledModes, resolveMode} from './pointer-state.js';

export const PointerIndicator = GObject.registerClass(
class PointerIndicator extends PanelMenu.Button {
    _init(extension, settings) {
        const _ = createTranslator();
        super._init(0.0, _('Presenter effects'));
        this._settings = settings;
        this._extension = extension;
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this.add_child(box);
        box.add_child(new St.Icon({
            gicon: new Gio.FileIcon({file: extension.dir.get_child('icons')
                .get_child('projecteur-target-symbolic.svg')}),
            style_class: 'system-status-icon',
        }));
        this._countdown = new St.Label({visible: false, y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._countdown);

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
        this._devicesMenu = new PopupMenu.PopupSubMenuMenuItem(_('Connected presenters'));
        this.menu.addMenuItem(this._devicesMenu);
        this._timerMenu = new PopupMenu.PopupSubMenuMenuItem(_('Presentation timer'));
        this.menu.addMenuItem(this._timerMenu);
        this._timerState = new PopupMenu.PopupMenuItem(_('Not running'), {reactive: false, can_focus: false});
        this._timerMenu.menu.addMenuItem(this._timerState);
        const action = (label, method, params = () => null) => this._timerMenu.menu.addAction(_(label), () => {
            extension.callService(method, params()).then(() => extension._pollStatus())
                .catch(() => { if (this._extension) this._timerState.label.text = _('Service unavailable'); });
        });
        const startParams = arm => new GLib.Variant('(ib)', [settings.get_int('timer-minutes') * 60, arm]);
        this._startTimer = action('Start timer', 'StartPresentationTimer', () => startParams(false));
        this._armTimer = action('Start on next presenter action', 'StartPresentationTimer', () => startParams(true));
        this._pauseTimer = action('Pause timer', 'PausePresentationTimer');
        this._resumeTimer = action('Resume timer', 'ResumePresentationTimer');
        this._resetTimer = action('Reset timer', 'ResetPresentationTimer');
        this._presetsMenu = new PopupMenu.PopupSubMenuMenuItem(_('Effect presets'));
        this.menu.addMenuItem(this._presetsMenu);
        this._refreshPresets();
        this.updateStatus(null);
        this.menu.addAction(_('Open preferences'), () => extension.openPreferences());

        this._changed = settings.connect('changed', (_settings, key) => {
            this._sync();
            if (key === 'effect-presets') this._refreshPresets();
        });
        this.connect('destroy', () => {
            settings.disconnect(this._changed);
            this._settings = null;
            this._extension = null;
        });
        this._sync();
    }

    _refreshPresets() {
        const _ = createTranslator();
        this._presetsMenu.label.text = _('Effect presets');
        this._presetsMenu.menu.removeAll();
        const presets = readPresets(this._settings);
        this._presetsMenu.setSensitive(presets.length > 0);
        for (const preset of presets) {
            this._presetsMenu.menu.addAction(preset.name, () => {
                try { applyPreset(this._settings, preset.name); }
                catch (_error) { this._presetsMenu.label.text = _('Unable to apply preset.'); }
            });
        }
    }

    updateStatus(status) {
        const _ = createTranslator();
        const state = status?.timerState ?? 'idle';
        const seconds = status?.remainingSeconds ?? 0;
        const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        const labels = {idle: _('Not running'), armed: _('Waiting for presenter action'),
            running: _('Running'), paused: _('Paused'), expired: _('Time is up')};
        this._countdown.visible = ['running', 'paused', 'armed'].includes(state);
        this._countdown.text = time;
        this._timerState.label.text = status ? `${labels[state] ?? labels.idle} · ${time}` : _('Service unavailable');
        this._pauseTimer.setSensitive(state === 'running');
        this._resumeTimer.setSensitive(state === 'paused');
        this._startTimer.setSensitive(Boolean(status));
        this._armTimer.setSensitive(Boolean(status));
        this._resetTimer.setSensitive(Boolean(status));
        const json = JSON.stringify(status?.devices ?? null);
        if (json === this._devicesJson) return;
        this._devicesJson = json;
        this._devicesMenu.menu.removeAll();
        if (!status?.devices.length) {
            this._devicesMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                status ? _('No presenter connected') : _('Service unavailable'), {reactive: false, can_focus: false}));
        }
        for (const device of status?.devices ?? []) {
            const battery = device.battery >= 0 ? `${device.battery}%` : _('Battery unavailable');
            this._devicesMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                `${device.name} · ${battery}${device.charging ? ' · ' + _('Charging') : ''}`,
                {reactive: false, can_focus: false}));
        }
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
