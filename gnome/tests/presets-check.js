import Gio from 'gi://Gio';
import {readPresets, savePreset, applyPreset, deletePreset, exportPresets, importPresets, readPresetFile} from '../extension/presets.js';
const source = Gio.SettingsSchemaSource.new_from_directory(ARGV[0], Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.projecteur-pointer', false)});
function assert(value, message) { if (!value) throw new Error(message); }
settings.set_boolean('pointer-clicks-enabled', true);
settings.set_boolean('start-at-monitor-center', true);
savePreset(settings, 'Slides');
const size = settings.get_int('dot-size');
settings.set_int('dot-size', 48);
applyPreset(settings, 'Slides');
assert(settings.get_int('dot-size') === size, 'Appearance not restored');
assert(settings.get_string('last-applied-preset') === 'Slides', 'Preset navigation does not track explicit application');
assert(settings.get_boolean('pointer-clicks-enabled') && settings.get_boolean('start-at-monitor-center'), 'Device preferences overwritten');
settings.set_int('dot-size', 50);
const second = new Gio.Settings({settings_schema: settings.settings_schema, backend: settings.backend});
assert(second.get_int('dot-size') === 50, 'Shared settings left in delayed mode');
const corrupt = readPresets(settings);
corrupt[0].values['magnifier-factor'] = 99;
settings.set_string('effect-presets', JSON.stringify(corrupt));
let rejected = false;
try { applyPreset(settings, 'Slides'); } catch (_) { rejected = true; }
assert(rejected && settings.get_int('dot-size') === 50, 'Invalid preset partially applied');
savePreset(settings, 'Slides');
assert(readPresets(settings).length === 1, 'Duplicate overwrite');
deletePreset(settings, 'Slides');
assert(readPresets(settings).length === 0, 'Delete failed');
settings.set_string('effect-presets', '{broken');
assert(readPresets(settings).length === 0, 'Corrupt JSON not handled');
print('PASS: presets restore appearance, preserve controls, reject invalid values atomically');

settings.set_string('effect-presets', '[]');
settings.set_string('spotlight-shape', 'diamond');
savePreset(settings, 'Demo');
const exported = exportPresets(settings);
assert(!exported.includes('pointer-clicks') && !exported.includes('button-mappings'), 'Controls leaked to export');
settings.set_string('effect-presets', '[]');
assert(importPresets(settings, exported) === 1, 'Round-trip import failed');
settings.set_string('spotlight-shape', 'circle');
applyPreset(settings, 'Demo');
assert(settings.get_string('spotlight-shape') === 'diamond', 'Advanced appearance lost');
const before = settings.get_string('effect-presets');
for (const change of [data => data.presets[0].values['button-mappings'] = '{}',
    data => data.presets[0].values['spotlight-rotation'] = 360,
    data => data.presets.push(data.presets[0]), data => data.version = 99]) {
    const data = JSON.parse(exported); change(data);
    let rejected = false;
    try { importPresets(settings, JSON.stringify(data)); } catch (_) { rejected = true; }
    assert(rejected && settings.get_string('effect-presets') === before, 'Invalid file partially imported');
}
const legacy = JSON.parse(exported);
for (const key of Object.keys(legacy.presets[0].values).slice(10)) delete legacy.presets[0].values[key];
importPresets(settings, JSON.stringify(legacy));
applyPreset(settings, 'Demo');
assert(settings.get_string('spotlight-shape') === 'circle', 'Legacy defaults not supplied');
const file = Gio.File.new_for_path(ARGV[0] + '/presets.json');
file.replace_contents(new TextEncoder().encode(exported), null, false, Gio.FileCreateFlags.NONE, null);
assert(await readPresetFile(file) === exported, 'File read failed');
file.replace_contents(new Uint8Array(262145), null, false, Gio.FileCreateFlags.NONE, null);
let oversized = false;
try { await readPresetFile(file); } catch (_) { oversized = true; }
assert(oversized, 'Oversized file not rejected');
print('PASS: preset file round trip, legacy upgrade, atomic validation, bounded file reads');
