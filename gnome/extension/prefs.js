import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

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
        const group = new Adw.PreferencesGroup({
            title: _('Pointer appearance'),
            description: _('Settings are saved automatically and applied immediately.'),
        });
        page.add(group);
        window.add(page);

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

        const cursorRow = new Adw.SwitchRow({
            title: _('Hide the mouse cursor while the dot is visible'),
            subtitle: _('The mouse cursor returns when the dot disappears.'),
        });
        settings.bind('hide-system-cursor', cursorRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(cursorRow);

        const lingerRow = new Adw.SpinRow({
            title: _('Stay visible after movement (seconds)'),
            subtitle: _('0.1–30 seconds; then hide the dot and restore the mouse cursor.'),
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
