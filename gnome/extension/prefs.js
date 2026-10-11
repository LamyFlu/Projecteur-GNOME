import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {enabledModes, resolveMode} from './pointer-state.js';
import {createTranslator} from './i18n.js';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ProjecteurPointerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = createTranslator();
        const settings = this.getSettings();
        window._settings = settings;
        const page = new Adw.PreferencesPage({
            title: _('Laser pointer'), icon_name: 'input-mouse-symbolic',
        });
        const modes = new Adw.PreferencesGroup({title: _('Presenter effects'),
            description: _('Choose an effect or switch enabled effects with a pointer-button double click.')});
        page.add(modes);
        const modeLabels = {laser: _('Laser dot'), spotlight: _('Spotlight'), magnifier: _('Magnifier')};
        const modeRow = new Adw.ComboRow({title: _('Current effect')});
        let syncingMode = false;
        let available = [];
        const syncModes = () => {
            syncingMode = true;
            available = enabledModes(settings.get_boolean('laser-enabled'),
                settings.get_boolean('spotlight-enabled'), settings.get_boolean('magnifier-enabled'));
            modeRow.model = Gtk.StringList.new(available.length
                ? available.map(mode => modeLabels[mode])
                : [_('Enable at least one effect first.')]);
            modeRow.sensitive = available.length > 0;
            modeRow.selected = Math.max(0, available.indexOf(
                resolveMode(settings.get_string('pointer-mode'), available)));
            syncingMode = false;
        };
        syncModes();
        modeRow.connect('notify::selected', () => {
            if (!syncingMode && available[modeRow.selected])
                settings.set_string('pointer-mode', available[modeRow.selected]);
        });
        const modeChanged = settings.connect('changed', (_settings, key) => {
            if (['pointer-mode', 'laser-enabled', 'spotlight-enabled', 'magnifier-enabled'].includes(key))
                syncModes();
        });
        window.connect('close-request', () => { settings.disconnect(modeChanged); return false; });
        modes.add(modeRow);
        const addSwitch = (group, key, title, subtitle) => {
            const row = new Adw.SwitchRow({title: _(title), subtitle: _(subtitle)});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };
        const addNumber = (group, key, title, low, high, step, digits, subtitle = '') => {
            const row = new Adw.SpinRow({title: _(title), subtitle: _(subtitle), digits,
                adjustment: new Gtk.Adjustment({lower: low, upper: high,
                    step_increment: step, page_increment: step * 10})});
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };
        addSwitch(modes, 'double-click-switch', 'Double-click to switch effects',
            'Original Logitech Spotlight only. Off by default; cycle enabled effects: laser dot, spotlight, magnifier.');
        const cursorRow = new Adw.SwitchRow({
            title: _('Hide the mouse cursor while an effect is visible'),
            subtitle: _('The mouse cursor returns when the effect disappears.'),
        });
        settings.bind('hide-system-cursor', cursorRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        modes.add(cursorRow);

        addSwitch(modes, 'pointer-clicks-enabled', 'Allow presenter mouse clicks',
            'Off by default. Forward pointer-button clicks at the system cursor; double-click switching takes priority.');
        const addReset = (group, title, keys) => {
            const row = new Adw.ActionRow({title: _(title)});
            const button = new Gtk.Button({label: _('Reset'), valign: Gtk.Align.CENTER});
            button.connect('clicked', () => {
                for (const key of keys) settings.reset(key);
            });
            row.add_suffix(button);
            row.activatable_widget = button;
            group.add(row);
        };
        const spotlight = new Adw.PreferencesGroup({title: _('Spotlight')});
        page.add(spotlight);
        addSwitch(spotlight, 'spotlight-enabled', 'Enable spotlight',
            'Disabled effects are skipped when selecting or switching modes.');
        addNumber(spotlight, 'spotlight-size', 'Spotlight diameter', 80, 1200, 10, 0,
            '80–1200 logical pixels.');
        addNumber(spotlight, 'spotlight-dim', 'Background dimming', 0.1, 0.9, 0.05, 2,
            '0.10–0.90; larger values make the surrounding area darker.');
        addReset(spotlight, 'Reset spotlight appearance', ['spotlight-size', 'spotlight-dim']);
        const magnifier = new Adw.PreferencesGroup({title: _('Magnifier')});
        page.add(magnifier);
        addSwitch(magnifier, 'magnifier-enabled', 'Enable magnifier',
            'Disabled effects are skipped when selecting or switching modes.');
        addNumber(magnifier, 'magnifier-size', 'Magnifier diameter', 80, 1200, 10, 0,
            '80–1200 logical pixels; limited to the current monitor.');
        addNumber(magnifier, 'magnifier-factor', 'Magnification', 1.1, 8, 0.1, 1,
            '1.1–8.0 times. Does not change GNOME accessibility zoom.');
        addReset(magnifier, 'Reset magnifier appearance', ['magnifier-size', 'magnifier-factor']);
        const group = new Adw.PreferencesGroup({
            title: _('Laser dot appearance'),
            description: _('Settings are saved automatically and applied immediately.'),
        });
        page.add(group);
        window.add(page);
        addSwitch(group, 'laser-enabled', 'Enable laser dot',
            'Disabled effects are skipped when selecting or switching modes.');

        const colorRow = new Adw.ActionRow({title: _('Color')});
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({title: _('Choose pointer color'), with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        const syncColor = () => {
            const color = new Gdk.RGBA();
            if (!color.parse(settings.get_string('dot-color')))
                color.parse('rgb(255,24,24)');
            colorButton.rgba = color;
        };
        syncColor();
        colorButton.connect('notify::rgba', () => {
            settings.set_string('dot-color', colorButton.rgba.to_string());
        });
        const colorChanged = settings.connect('changed::dot-color', syncColor);
        window.connect('close-request', () => {
            settings.disconnect(colorChanged);
            return false;
        });
        colorRow.add_suffix(colorButton);
        colorRow.activatable_widget = colorButton;
        group.add(colorRow);

        const sizeRow = new Adw.SpinRow({
            title: _('Size'),
            subtitle: _('Diameter: 6–96 pixels (adjusted for display scaling).'),
            adjustment: new Gtk.Adjustment({
                lower: 6, upper: 96, step_increment: 1, page_increment: 6,
            }),
            digits: 0,
        });
        settings.bind('dot-size', sizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(sizeRow);


        const lingerRow = new Adw.SpinRow({
            title: _('Stay visible after movement (seconds)'),
            subtitle: _('0.1–30 seconds; then hide the effect and restore the mouse cursor.'),
            adjustment: new Gtk.Adjustment({
                lower: 0.1, upper: 30, step_increment: 0.1, page_increment: 1,
            }),
            digits: 1,
        });
        settings.bind('linger-seconds', lingerRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(lingerRow);

        const resetRow = new Adw.ActionRow({title: _('Reset appearance')});
        const resetButton = new Gtk.Button({
            label: _('Reset'), valign: Gtk.Align.CENTER,
        });
        resetButton.connect('clicked', () => {
            settings.reset('dot-color');
            settings.reset('dot-size');
        });
        resetRow.add_suffix(resetButton);
        resetRow.activatable_widget = resetButton;
        group.add(resetRow);
    }
}
