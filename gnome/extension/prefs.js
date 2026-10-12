import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {readPresets, savePreset, applyPreset, deletePreset, exportPresets, importPresets, readPresetFile} from './presets.js';
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
            description: _('Choose the effect shown by the presenter.')});
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
            modeRow.subtitle = available.length ? '' : _('Enable at least one effect first.');
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
        const addChoice = (group, key, title, choices, subtitle = '') => {
            const row = new Adw.ComboRow({title: _(title), subtitle: _(subtitle),
                model: Gtk.StringList.new(choices.map(([, label]) => _(label)))});
            let syncing = false;
            const sync = () => { syncing = true; row.selected = Math.max(0, choices.findIndex(([value]) => value === settings.get_string(key))); syncing = false; };
            sync();
            row.connect('notify::selected', () => { if (!syncing && choices[row.selected]) settings.set_string(key, choices[row.selected][0]); });
            const changed = settings.connect(`changed::${key}`, sync);
            window.connect('close-request', () => { settings.disconnect(changed); return false; });
            group.add(row);
        };
        const addColor = (group, key, title) => {
            const row = new Adw.ActionRow({title: _(title)});
            const button = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({title: _(title), with_alpha: false}), valign: Gtk.Align.CENTER});
            const sync = () => {
                const color = new Gdk.RGBA();
                if (!color.parse(settings.get_string(key))) color.parse(settings.get_default_value(key).deepUnpack());
                button.rgba = color;
            };
            sync();
            button.connect('notify::rgba', () => settings.set_string(key, button.rgba.to_string()));
            const changed = settings.connect(`changed::${key}`, sync);
            window.connect('close-request', () => { settings.disconnect(changed); return false; });
            row.add_suffix(button); row.activatable_widget = button; group.add(row);
        };

        const preview = new Adw.PreferencesGroup({title: _('Preview effects'),
            description: _('Follow the mouse for 5 seconds without changing effect enablement. Stop restores normal behavior.')});
        page.add(preview);
        const previewRow = new Adw.ActionRow({title: _('Preview')});
        const effectsCall = (method, params, report = true) => Gio.DBus.session.call(
            'org.projecteur.Gnome.Effects', '/org/projecteur/Gnome/Effects', 'org.projecteur.Gnome.Effects',
            method, params, null, Gio.DBusCallFlags.NONE, 3000, null, (connection, result) => {
                try {
                    const values = connection.call_finish(result).deepUnpack();
                    if (report) previewRow.subtitle = values[0] === false ? _('Unable to preview.') : _('Preview follows the mouse.');
                } catch (_) { if (report) previewRow.subtitle = _('Extension unavailable. Log out and back in after updating.'); }
            });
        for (const [mode, label] of [['laser', 'Laser dot'], ['spotlight', 'Spotlight'], ['magnifier', 'Magnifier']]) {
            const button = new Gtk.Button({label: _(label), valign: Gtk.Align.CENTER});
            button.connect('clicked', () => effectsCall('Preview', new GLib.Variant('(si)', [mode, 5])));
            previewRow.add_suffix(button);
        }
        preview.add(previewRow);
        const stopRow = new Adw.ActionRow({title: _('Stop preview')});
        const stopButton = new Gtk.Button({label: _('Stop'), valign: Gtk.Align.CENTER});
        stopButton.connect('clicked', () => effectsCall('StopPreview', null, false));
        stopRow.add_suffix(stopButton);
        preview.add(stopRow);
        window.connect('close-request', () => { effectsCall('StopPreview', null, false); return false; });

        const controls = new Adw.PreferencesGroup({
            title: _('Presenter controls'),
            description: _('Configure optional actions for the presenter pointer button.'),
        });
        page.add(controls);
        addSwitch(controls, 'double-click-switch', 'Double-click to switch effects',
            'Original Logitech Spotlight only. Off by default; cycle enabled effects: laser dot, spotlight, magnifier.');
        addSwitch(controls, 'pointer-clicks-enabled', 'Allow presenter mouse clicks',
            'Off by default. Forward pointer-button clicks at the system cursor; double-click switching takes priority.');

        const mappings = new Adw.PreferencesGroup({title: _('Button actions'),
            description: _('Default preserves slide navigation. Change mappings while the presenter is idle. Hold gestures require compatible Logitech reports.')});
        page.add(mappings);
        const tapChoices = [['default', 'Default'], ['key', 'Keyboard sequence'], ['next-preset', 'Next preset'],
            ['previous-preset', 'Previous preset'], ['next-effect', 'Next effect'], ['toggle-effect', 'Toggle persistent effect'],
            ['timer-start', 'Start timer'], ['timer-reset', 'Reset timer'], ['scroll-up', 'Scroll up'], ['scroll-down', 'Scroll down'],
            ['scroll-left', 'Scroll left'], ['scroll-right', 'Scroll right'], ['volume-up', 'Volume up'], ['volume-down', 'Volume down']];
        const moveChoices = [['default', 'Default'], ['scroll-vertical', 'Vertical scrolling'],
            ['scroll-horizontal', 'Horizontal scrolling'], ['volume', 'Volume control']];
        let draft;
        try { draft = JSON.parse(settings.get_string('button-mappings')); }
        catch (_) { draft = {}; }
        if (!draft || typeof draft !== 'object' || Array.isArray(draft)) draft = {};
        const inputs = [['next', 'Next button'], ['back', 'Back button'], ['next-hold', 'Next long press'],
            ['back-hold', 'Back long press'], ['next-move', 'Next hold and move'], ['back-move', 'Back hold and move']];
        const mapRows = [];
        for (const [key, label] of inputs) {
            const choices = key.endsWith('-move') ? moveChoices : tapChoices;
            const stored = typeof draft[key] === 'string' ? draft[key] : 'default';
            const row = new Adw.ComboRow({title: _(label), model: Gtk.StringList.new(choices.map(([, label]) => _(label)))});
            row.selected = Math.max(0, choices.findIndex(([value]) => value === (stored.startsWith('key:') ? 'key' : stored)));
            mappings.add(row);
            const entry = new Adw.EntryRow({title: _('Keyboard sequence'), text: stored.startsWith('key:') ? stored.slice(4) : '',
                tooltip_text: _('Examples: Ctrl+L, F5, Esc. Up to four combinations separated by commas. Uses US physical key positions.')});
            entry.visible = choices[row.selected][0] === 'key';
            row.connect('notify::selected', () => { entry.visible = choices[row.selected]?.[0] === 'key'; });
            mappings.add(entry);
            mapRows.push({key, choices, row, entry});
        }
        const applyMappings = new Adw.ActionRow({title: _('Apply button actions'),
            subtitle: _('Choose either long press or hold-and-move for each button, not both.')});
        const applyMapButton = new Gtk.Button({label: _('Apply'), valign: Gtk.Align.CENTER});
        applyMapButton.connect('clicked', () => {
            const values = Object.fromEntries(mapRows.map(({key, choices, row, entry}) => [key,
                choices[row.selected][0] === 'key' ? 'key:' + entry.text.trim() : choices[row.selected][0]]));
            const json = JSON.stringify(values);
            Gio.DBus.session.call('org.projecteur.Gnome', '/org/projecteur/Gnome/Pointer', 'org.projecteur.Gnome.Pointer',
                'SetButtonMappings', new GLib.Variant('(s)', [json]), null, Gio.DBusCallFlags.NONE, 3000, null, (connection, result) => {
                    try {
                        const [accepted] = connection.call_finish(result).deepUnpack();
                        if (accepted) { settings.set_string('button-mappings', json); applyMappings.subtitle = _('Done'); }
                        else applyMappings.subtitle = _('Invalid mapping or conflicting hold gestures.');
                    } catch (_) { applyMappings.subtitle = _('Service unavailable'); }
                });
        });
        applyMappings.add_suffix(applyMapButton);
        mappings.add(applyMappings);
        const resetMap = new Adw.ActionRow({title: _('Restore default buttons')});
        const resetMapButton = new Gtk.Button({label: _('Reset'), valign: Gtk.Align.CENTER});
        resetMapButton.connect('clicked', () => {
            settings.set_string('button-mappings', '{}');
            for (const {row, entry} of mapRows) { row.selected = 0; entry.text = ''; }
            applyMappings.subtitle = _('Done');
        });
        resetMap.add_suffix(resetMapButton);
        mappings.add(resetMap);

        const visibility = new Adw.PreferencesGroup({
            title: _('Display behavior'),
            description: _('Choose when and where the current effect appears, and whether the mouse cursor remains visible.'),
        });
        page.add(visibility);
        addSwitch(visibility, 'always-visible', 'Always show the pointer effect',
            'Keep the selected effect visible until this switch is turned off.');
        const lingerRow = new Adw.SpinRow({
            title: _('Stay visible after movement (seconds)'),
            subtitle: _('Used when persistent display is off. After this time, hide the effect and restore the mouse cursor.'),
            adjustment: new Gtk.Adjustment({
                lower: 0.1, upper: 30, step_increment: 0.1, page_increment: 1,
            }),
            digits: 1,
        });
        settings.bind('linger-seconds', lingerRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('always-visible', lingerRow, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        visibility.add(lingerRow);
        const cursorRow = new Adw.SwitchRow({
            title: _('Hide the mouse cursor while an effect is visible'),
            subtitle: _('The mouse cursor returns when the effect disappears.'),
        });
        settings.bind('hide-system-cursor', cursorRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        visibility.add(cursorRow);
        addSwitch(visibility, 'start-at-monitor-center',
            'Center on the remembered monitor each time the pointer button is pressed',
            'On each reported pointer-button press, center the effect and mouse cursor on the last-used monitor, even while the effect remains visible.');

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
        addChoice(spotlight, 'spotlight-shape', 'Shape', [['circle', 'Circle'], ['square', 'Square'], ['diamond', 'Diamond']]);
        addNumber(spotlight, 'spotlight-rotation', 'Rotation (degrees)', 0, 359, 1, 0);
        addColor(spotlight, 'spotlight-color', 'Shade color');
        addColor(spotlight, 'spotlight-border-color', 'Border color');
        addNumber(spotlight, 'spotlight-border-width', 'Border width', 0, 12, 1, 0, '0 disables the border; maximum 12 pixels.');
        addReset(spotlight, 'Reset spotlight appearance', ['spotlight-size', 'spotlight-dim', 'spotlight-shape',
            'spotlight-rotation', 'spotlight-color', 'spotlight-border-color', 'spotlight-border-width']);
        const magnifier = new Adw.PreferencesGroup({title: _('Magnifier')});
        page.add(magnifier);
        addSwitch(magnifier, 'magnifier-enabled', 'Enable magnifier',
            'Disabled effects are skipped when selecting or switching modes.');
        addNumber(magnifier, 'magnifier-size', 'Magnifier diameter', 80, 1200, 10, 0,
            '80–1200 logical pixels; limited to the current monitor.');
        addNumber(magnifier, 'magnifier-factor', 'Magnification', 1.1, 8, 0.1, 1,
            '1.1–8.0 times. Does not change GNOME accessibility zoom.');
        addChoice(magnifier, 'magnifier-quality', 'Magnifier quality', [['smooth', 'Smooth'], ['text', 'Text and UI'], ['pixel', 'Pixel grid']],
            'Text enhances edges. Pixel grid may differ from original source pixels.');
        addReset(magnifier, 'Reset magnifier appearance', ['magnifier-size', 'magnifier-factor', 'magnifier-quality']);
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

        addSwitch(group, 'trail-enabled', 'Fading pointer trail', 'Off by default. Applies to all three effects.');
        addNumber(group, 'trail-seconds', 'Trail lifetime (seconds)', 0.1, 2.0, 0.1, 1);

        const resetRow = new Adw.ActionRow({title: _('Reset appearance')});
        const resetButton = new Gtk.Button({
            label: _('Reset'), valign: Gtk.Align.CENTER,
        });
        resetButton.connect('clicked', () => {
            settings.reset('dot-color');
            settings.reset('dot-size');
            settings.reset('trail-enabled');
            settings.reset('trail-seconds');
        });
        resetRow.add_suffix(resetButton);
        resetRow.activatable_widget = resetButton;
        group.add(resetRow);

        const timer = new Adw.PreferencesGroup({title: _('Presentation timer'),
            description: _('Start immediately or wait for the next presenter action. Use the top-panel menu to see the countdown.')});
        page.add(timer);
        addNumber(timer, 'timer-minutes', 'Duration (minutes)', 1, 1440, 1, 0);
        addSwitch(timer, 'timer-vibration', 'Vibrate when time is up',
            'Off by default. Requires a compatible connected presenter.');
        addNumber(timer, 'vibration-intensity', 'Vibration intensity', 1, 255, 1, 0,
            '1–255; higher values request stronger vibration. Default: 128.');
        addNumber(timer, 'vibration-length', 'Vibration duration', 1, 10, 1, 0,
            '1–10 device units, not seconds. Default: 1; actual duration varies by presenter.');
        const call = (method, params, row) => {
            Gio.DBus.session.call('org.projecteur.Gnome', '/org/projecteur/Gnome/Pointer',
                'org.projecteur.Gnome.Pointer', method, params, null, Gio.DBusCallFlags.NONE,
                3000, null, (connection, result) => {
                    try {
                        const values = connection.call_finish(result).deepUnpack();
                        row.subtitle = values[0] === false ? _('No compatible presenter connected.') :
                            method === 'Vibrate' ? _('Vibration request sent; confirm feedback on the presenter.') : _('Done');
                    } catch (_error) { row.subtitle = _('Service unavailable'); }
                });
        };
        const commandRow = (title, commands) => {
            const row = new Adw.ActionRow({title: _(title)});
            for (const [label, method, params] of commands) {
                const button = new Gtk.Button({label: _(label), valign: Gtk.Align.CENTER});
                button.connect('clicked', () => call(method, params?.() ?? null, row));
                row.add_suffix(button);
            }
            timer.add(row);
        };
        const startParams = arm => new GLib.Variant('(ib)', [settings.get_int('timer-minutes') * 60, arm]);
        commandRow('Start timer', [['Start', 'StartPresentationTimer', () => startParams(false)]]);
        commandRow('Start on next presenter action', [['Arm', 'StartPresentationTimer', () => startParams(true)]]);
        commandRow('Timer controls', [['Pause', 'PausePresentationTimer'],
            ['Resume', 'ResumePresentationTimer'], ['Reset', 'ResetPresentationTimer']]);
        commandRow('Test vibration', [['Test', 'Vibrate', () => new GLib.Variant('(ii)', [
            settings.get_int('vibration-intensity'), settings.get_int('vibration-length')])]]);

        const presets = new Adw.PreferencesGroup({title: _('Effect presets'),
            description: _('Save appearance and enabled effects. Timer and presenter controls are preserved.')});
        page.add(presets);
        const nameRow = new Adw.EntryRow({title: _('Preset name')});
        presets.add(nameRow);
        const presetRow = new Adw.ComboRow({title: _('Saved presets')});
        presets.add(presetRow);
        const manage = new Adw.ActionRow({title: _('Manage presets')});
        let names = [];
        const save = new Gtk.Button({label: _('Save'), valign: Gtk.Align.CENTER});
        const apply = new Gtk.Button({label: _('Apply'), valign: Gtk.Align.CENTER});
        const remove = new Gtk.Button({label: _('Delete'), valign: Gtk.Align.CENTER});
        for (const button of [save, apply, remove]) manage.add_suffix(button);
        presets.add(manage);
        const refreshPresets = () => {
            const previous = names[presetRow.selected];
            names = readPresets(settings).map(item => item.name);
            presetRow.model = Gtk.StringList.new(names.length ? names : [_('No saved presets')]);
            presetRow.selected = Math.max(0, names.indexOf(previous));
            presetRow.sensitive = names.length > 0;
            apply.sensitive = remove.sensitive = names.length > 0;
        };
        const perform = callback => {
            try { callback(); manage.subtitle = _('Done'); }
            catch (error) { manage.subtitle = _(error.message); }
        };
        save.connect('clicked', () => perform(() => savePreset(settings, nameRow.text)));
        apply.connect('clicked', () => perform(() => applyPreset(settings, names[presetRow.selected])));
        remove.connect('clicked', () => perform(() => deletePreset(settings, names[presetRow.selected])));
        const transfer = new Adw.ActionRow({title: _('Transfer presets'),
            subtitle: _('JSON contains appearance presets only. Import merges by name; matching names are replaced.')});
        presets.add(transfer);
        const filter = new Gtk.FileFilter({name: _('JSON preset files')});
        filter.add_pattern('*.json');
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        filters.append(filter);
        for (const exporting of [true, false]) {
            const button = new Gtk.Button({label: exporting ? _('Export all') : _('Import'), valign: Gtk.Align.CENTER});
            transfer.add_suffix(button);
            button.connect('clicked', () => {
                const dialog = new Gtk.FileDialog({title: exporting ? _('Export presets') : _('Import presets'),
                    filters, default_filter: filter, initial_name: exporting ? 'projecteur-effects.json' : null});
                const finish = (chooser, result) => {
                    let file;
                    try { file = exporting ? chooser.save_finish(result) : chooser.open_finish(result); }
                    catch (error) { if (!error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) transfer.subtitle = _('Unable to transfer presets.'); return; }
                    if (exporting) {
                        let bytes;
                        try { bytes = new TextEncoder().encode(exportPresets(settings)); }
                        catch (error) { transfer.subtitle = _(error.message); return; }
                        file.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION,
                            null, (target, res) => {
                                try { target.replace_contents_finish(res); transfer.subtitle = _('Export complete.'); }
                                catch (_) { transfer.subtitle = _('Unable to transfer presets.'); }
                            });
                    } else {
                        readPresetFile(file).then(text => {
                            try { importPresets(settings, text); transfer.subtitle = _('Import complete.'); }
                            catch (error) { transfer.subtitle = _(error.message); }
                        }).catch(() => transfer.subtitle = _('Invalid preset file.'));
                    }
                };
                if (exporting) dialog.save(window, null, finish);
                else dialog.open(window, null, finish);
            });
        }
        const presetsChanged = settings.connect('changed::effect-presets', refreshPresets);
        window.connect('close-request', () => { settings.disconnect(presetsChanged); return false; });
        refreshPresets();

    }
}
