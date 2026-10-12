import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Presets change appearance and enabled effects, never device commands,
// cursor positioning, persistence, timer state, or click forwarding.
export const PRESET_KEYS = ['pointer-mode', 'laser-enabled', 'spotlight-enabled',
    'magnifier-enabled', 'dot-color', 'dot-size', 'spotlight-size', 'spotlight-dim',
    'magnifier-size', 'magnifier-factor', 'spotlight-shape', 'spotlight-rotation',
    'spotlight-color', 'spotlight-border-color', 'spotlight-border-width',
    'magnifier-quality', 'trail-enabled', 'trail-seconds'];

export function readPresets(settings) {
    try {
        const presets = JSON.parse(settings.get_string('effect-presets'));
        if (!Array.isArray(presets) || presets.length > 30) return [];
        return presets.filter(item => typeof item?.name === 'string' &&
            item.name.trim().length > 0 && item.name.length <= 48 &&
            item.values && typeof item.values === 'object').sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) { return []; }
}

export function savePreset(settings, name) {
    name = name.trim();
    if (!name || name.length > 48) throw new Error('Use a name with 1–48 characters.');
    const presets = readPresets(settings).filter(item => item.name !== name);
    if (presets.length >= 30) throw new Error('A maximum of 30 presets can be saved.');
    const values = Object.fromEntries(PRESET_KEYS.map(key => [key, settings.get_value(key).deepUnpack()]));
    presets.push({name, values});
    settings.set_string('effect-presets', JSON.stringify(presets));
}

export function deletePreset(settings, name) {
    settings.set_string('effect-presets', JSON.stringify(readPresets(settings).filter(item => item.name !== name)));
}

export function applyPreset(settings, name) {
    const preset = readPresets(settings).find(item => item.name === name);
    if (!preset) throw new Error('Preset not found.');
    const values = validateValues(settings, preset.values, true);
    const transaction = new Gio.Settings({settings_schema: settings.settings_schema, backend: settings.backend});
    transaction.delay();
    try {
        for (const [key, value] of values) {
            if (!transaction.set_value(key, value)) throw new Error('Unable to apply preset.');
        }
        if (!transaction.set_string('last-applied-preset', name)) throw new Error('Unable to apply preset.');
        transaction.apply();
    } catch (error) {
        transaction.revert();
        throw error;
    }
}

function validateValues(settings, input, allowLegacy = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Invalid preset values.');
    if (Object.keys(input).some(key => !PRESET_KEYS.includes(key)))
        throw new Error('Invalid preset values.');
    return PRESET_KEYS.map(key => {
        const schemaKey = settings.settings_schema.get_key(key);
        const type = schemaKey.get_value_type().dup_string();
        // Older locally saved/exported presets predate the advanced controls.
        // New appearance keys use schema defaults, never arbitrary current values.
        const original = PRESET_KEYS.indexOf(key) < 10;
        const raw = Object.hasOwn(input, key) ? input[key] :
            allowLegacy && !original ? settings.get_default_value(key).deepUnpack() : undefined;
        if ((type === 'b' && typeof raw !== 'boolean') ||
            (type === 's' && typeof raw !== 'string') ||
            (['i', 'd'].includes(type) && (typeof raw !== 'number' || !Number.isFinite(raw))) ||
            (type === 'i' && !Number.isInteger(raw))) throw new Error('Invalid preset values.');
        if (type === 's' && raw.length > 256) throw new Error('Invalid preset values.');
        const value = new GLib.Variant(type, raw);
        if (!schemaKey.range_check(value)) throw new Error('Invalid preset values.');
        return [key, value];
    });
}

export function exportPresets(settings) {
    const presets = readPresets(settings).map(preset => ({name: preset.name,
        values: Object.fromEntries(validateValues(settings, preset.values, true)
            .map(([key, value]) => [key, value.deepUnpack()]))}));
    return JSON.stringify({format: 'projecteur-gnome-presets', version: 1, presets}, null, 2) + '\n';
}

export function importPresets(settings, text) {
    // Bound content before parsing; validate the complete file before writing.
    if (text.length > 262144) throw new Error('Invalid preset file.');
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('Invalid preset file.'); }
    if (data?.format !== 'projecteur-gnome-presets' || data.version !== 1 ||
        !Array.isArray(data.presets) || data.presets.length > 30)
        throw new Error('Invalid preset file.');
    const names = new Set();
    const imported = data.presets.map(item => {
        if (typeof item?.name !== 'string' || !item.name.trim() || item.name.length > 48 || names.has(item.name))
            throw new Error('Invalid preset file.');
        names.add(item.name);
        return {name: item.name, values: Object.fromEntries(validateValues(settings, item.values, true)
            .map(([key, value]) => [key, value.deepUnpack()]))};
    });
    const merged = readPresets(settings).filter(item => !names.has(item.name)).concat(imported);
    if (merged.length > 30) throw new Error('A maximum of 30 presets can be saved.');
    settings.set_string('effect-presets', JSON.stringify(merged));
    return imported.length;
}

export async function readPresetFile(file) {
    const stream = await new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_DEFAULT, null,
        (source, result) => { try { resolve(source.read_finish(result)); } catch (error) { reject(error); } }));
    try {
        const chunks = [];
        let length = 0;
        while (true) {
            const bytes = await new Promise((resolve, reject) => stream.read_bytes_async(
                Math.min(65536, 262145 - length), GLib.PRIORITY_DEFAULT, null, (source, result) => {
                    try { resolve(source.read_bytes_finish(result).get_data()); } catch (error) { reject(error); }
                }));
            if (!bytes.length) break;
            length += bytes.length;
            if (length > 262144) throw new Error('Invalid preset file.');
            chunks.push(bytes);
        }
        const data = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        return new TextDecoder('utf-8', {fatal: true}).decode(data);
    } finally {
        await new Promise(resolve => stream.close_async(GLib.PRIORITY_DEFAULT, null,
            (source, result) => { try { source.close_finish(result); } catch (_) {} resolve(); }));
    }
}
