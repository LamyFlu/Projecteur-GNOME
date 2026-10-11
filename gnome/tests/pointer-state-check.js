import {enabledModes, resolveMode, nextMode, lensGeometry} from '../extension/pointer-state.js';
function check(condition, message) { if (!condition) throw new Error(message); }
const all = enabledModes(true, true, true);
check(nextMode('laser', all) === 'spotlight', 'Laser must cycle to spotlight');
check(nextMode('spotlight', all) === 'magnifier', 'Spotlight must cycle to magnifier');
check(nextMode('magnifier', all) === 'laser', 'Cycle must wrap');
check(nextMode('laser', enabledModes(true, false, true)) === 'magnifier', 'Disabled spotlight must be skipped');
check(nextMode('laser', enabledModes(true, false, false)) === 'laser', 'Laser-only cycle');
check(resolveMode('magnifier', enabledModes(true, true, false)) === 'laser', 'Disabled selection must fall back');
check(enabledModes(false, false, false).length === 0, 'All modes must be switchable off');
check(resolveMode('laser', []) === null && nextMode('laser', []) === null, 'Empty mode list must be safe');
check(nextMode('spotlight', enabledModes(false, true, true)) === 'magnifier', 'Disabled laser must be skipped');
check(nextMode('magnifier', enabledModes(false, true, true)) === 'spotlight', 'Disabled laser must be skipped on wrap');
for (const monitor of [{x: 0, y: 0, width: 1920, height: 1080},
    {x: 1920, y: 0, width: 1280, height: 720}, {x: -1280, y: -720, width: 1280, height: 720}]) {
    for (const [x, y] of [[monitor.x, monitor.y],
        [monitor.x + monitor.width - 1, monitor.y + monitor.height - 1]]) {
        const g = lensGeometry(x, y, 1200, 8, monitor);
        check(g.left >= monitor.x && g.top >= monitor.y, 'Lens exceeds monitor origin');
        check(g.left + g.size <= monitor.x + monitor.width &&
            g.top + g.size <= monitor.y + monitor.height, 'Lens exceeds monitor bounds');
        check(g.sourceX + x * 8 === g.size / 2 &&
            g.sourceY + y * 8 === g.size / 2, 'Wrong magnifier focal point');
    }
}
print('PASS: mode cycling, disabled modes, monitor edges, magnifier focal point');
