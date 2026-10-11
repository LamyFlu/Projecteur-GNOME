// Pure state/geometry helpers shared by the overlay and its tests.
export const MODES = ['laser', 'spotlight', 'magnifier'];

export function enabledModes(laser, spotlight, magnifier) {
    return MODES.filter(mode => (mode === 'laser' && laser) ||
        (mode === 'spotlight' && spotlight) || (mode === 'magnifier' && magnifier));
}

export function resolveMode(requested, modes) {
    return modes.includes(requested) ? requested : modes[0] ?? null;
}

export function nextMode(current, modes) {
    if (!modes.length) return null;
    return modes[(modes.indexOf(resolveMode(current, modes)) + 1) % modes.length];
}

export function lensGeometry(x, y, diameter, factor, monitor) {
    const size = Math.min(diameter, monitor.width, monitor.height);
    const left = Math.max(monitor.x, Math.min(monitor.x + monitor.width - size, x - size / 2));
    const top = Math.max(monitor.y, Math.min(monitor.y + monitor.height - size, y - size / 2));
    return {size, left, top, sourceX: size / 2 - x * factor,
        sourceY: size / 2 - y * factor};
}
