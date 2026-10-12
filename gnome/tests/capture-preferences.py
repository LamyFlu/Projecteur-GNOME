#!/usr/bin/env python3
"""Capture documentation images from native GTK preferences on a private bus.

Uses temporary settings and a headless GNOME session, never the user's Shell.
The capture-only D-Bus helper is injected into a temporary copy of prefs.js.
"""
import ast
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
UUID = 'projecteur-pointer-ubuntu26@projecteur.github.io'
HELPER = '''
        window.set_default_size(640, 850);
        const walk = function*(widget) {
            yield widget;
            for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) yield* walk(child);
        };
        const captureBus = Gio.DBusExportedObject.wrapJSObject(
            '<node><interface name="org.projecteur.Test.Preferences"><method name="ScrollTo"><arg type="s" direction="in"/><arg type="b" direction="out"/></method></interface></node>', {
                ScrollTo: title => {
                    const target = [...walk(window)].find(widget => widget instanceof Adw.PreferencesGroup && widget.get_title() === title);
                    if (!target) return false;
                    let scroll = target.get_parent();
                    while (scroll && !(scroll instanceof Gtk.ScrolledWindow)) scroll = scroll.get_parent();
                    if (!scroll) return false;
                    let content = scroll.get_child();
                    if (content instanceof Gtk.Viewport) content = content.get_child();
                    const [ok, bounds] = target.compute_bounds(content);
                    if (!ok) return false;
                    const adjustment = scroll.get_vadjustment();
                    adjustment.set_value(Math.max(0, Math.min(bounds.get_y() - 12,
                        adjustment.get_upper() - adjustment.get_page_size())));
                    return true;
                },
            });
        captureBus.export(Gio.DBus.session, '/org/projecteur/Test/Preferences');
        const captureName = Gio.bus_own_name_on_connection(Gio.DBus.session,
            'org.projecteur.Test.Preferences', Gio.BusNameOwnerFlags.NONE, null, null);
        window.connect('close-request', () => { captureBus.unexport(); Gio.bus_unown_name(captureName); return false; });
'''


def call(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()


def evaluate(code):
    output = call('gdbus', 'call', '--session', '--dest', 'org.gnome.Shell',
        '--object-path', '/org/gnome/Shell', '--method', 'org.gnome.Shell.Eval', code)
    ok, value = ast.literal_eval(output.replace('(true,', '(True,', 1).replace('(false,', '(False,', 1))
    if not ok: raise RuntimeError(value)
    return json.loads(value) if value else None


def session(scratch, destination, locale):
    call('gsettings', 'set', 'org.gnome.shell', 'enabled-extensions', f'["{UUID}","projecteur-docs@local"]')
    call('gsettings', 'set', 'org.gnome.shell', 'disable-user-extensions', 'false')
    with (scratch / 'capture.log').open('w') as log:
        shell = subprocess.Popen(['gnome-shell', '--headless', '--wayland', '--no-x11',
            '--virtual-monitor=1024x1000', '--wayland-display=projecteur-docs'], stdout=log, stderr=subprocess.STDOUT)
        daemon = subprocess.Popen([str(ROOT / 'build/gnome/projecteur-gnome-daemon'), '--disable-uinput', '--no-device-scan'], stdout=log, stderr=subprocess.STDOUT)
        try:
            for attempt in range(100):
                try:
                    if evaluate(f'Main.extensionManager.lookup("{UUID}")?.state') == 1: break
                except (subprocess.CalledProcessError, RuntimeError): pass
                time.sleep(.2)
            else: raise RuntimeError('Extension did not load')
            # Hide only the isolated session's notification banner, which can
            # otherwise overlap the documentation window's title bar.
            evaluate('Main.messageTray._notification?.destroy(); Main.messageTray._bannerBin.hide(); true')
            call('gnome-extensions', 'prefs', UUID)
            for attempt in range(100):
                try:
                    result = call('gdbus', 'call', '--session', '--dest', 'org.projecteur.Test.Preferences',
                        '--object-path', '/org/projecteur/Test/Preferences', '--method', 'org.projecteur.Test.Preferences.ScrollTo',
                        '預覽效果' if locale == 'zh-TW' else 'Preview effects')
                    if 'true' in result: break
                except subprocess.CalledProcessError: pass
                time.sleep(.2)
            else: raise RuntimeError('Preferences capture helper not ready')
            groups = [('preferences', 'Presenter effects', '簡報指示效果'),
                ('buttons', 'Button actions', '按鍵自訂'), ('display', 'Display behavior', '顯示行為'),
                ('spotlight', 'Spotlight', '聚光'), ('magnifier', 'Magnifier', '放大'),
                ('laser', 'Laser dot appearance', '雷射紅點外觀'), ('timer', 'Presentation timer', '簡報倒數'),
                ('presets', 'Effect presets', '效果設定組合')]
            destination.mkdir(parents=True, exist_ok=True)
            for name, english, chinese in groups:
                result = call('gdbus', 'call', '--session', '--dest', 'org.projecteur.Test.Preferences',
                    '--object-path', '/org/projecteur/Test/Preferences', '--method', 'org.projecteur.Test.Preferences.ScrollTo',
                    chinese if locale == 'zh-TW' else english)
                if 'true' not in result: raise RuntimeError('Group unavailable: ' + english)
                evaluate('Main.messageTray._bannerBin.hide(); true')
                time.sleep(.35)
                bounds = evaluate('(() => { const w=global.get_window_actors().map(a=>a.meta_window).find(w=>w.get_title()?.includes("Projecteur Pointer")); '
                    'if(!w) return null; Main.overview.hide(); w.activate(global.get_current_time()); '
                    'const r=w.get_frame_rect(); return [r.x,r.y,r.width,r.height]; })()')
                if not bounds or not bounds[2] or not bounds[3]: raise RuntimeError('Window unavailable')
                path = destination / f'gnome-pointer-{name}.{locale}.png'
                call('gdbus', 'call', '--session', '--dest', 'org.gnome.Shell', '--object-path', '/org/gnome/Shell/Screenshot',
                    '--method', 'org.gnome.Shell.Screenshot.ScreenshotArea', *map(str, bounds), 'false', str(path))
                if path.stat().st_size < 1000: raise RuntimeError('Empty screenshot')
            print(f'Captured {len(groups)} native preferences images: {locale}')
        finally:
            daemon.terminate(); shell.terminate()
            for process in [daemon, shell]:
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--session':
        session(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4])
    else:
        locale = sys.argv[1] if len(sys.argv) > 1 else 'zh-TW'
        if locale not in ['zh-TW', 'en']: raise SystemExit('Use zh-TW or en')
        destination = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ROOT / 'build/gnome/documentation-images'
        with tempfile.TemporaryDirectory(prefix='projecteur-docs-', ignore_cleanup_errors=True) as folder:
            scratch = Path(folder)
            extension = scratch / 'data/gnome-shell/extensions' / UUID
            shutil.copytree(ROOT / 'gnome/extension', extension)
            prefs = extension / 'prefs.js'
            text = prefs.read_text()
            ending = text.rfind('\n    }\n}')
            prefs.write_text(text[:ending] + '\n' + HELPER + text[ending:])
            subprocess.run(['glib-compile-schemas', str(extension / 'schemas')], check=True)
            control = extension.parent / 'projecteur-docs@local'; control.mkdir()
            (control / 'metadata.json').write_text(json.dumps({'uuid':'projecteur-docs@local', 'name':'Private capture control', 'description':'Documentation capture', 'shell-version':['50']}))
            (control / 'extension.js').write_text("import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'; export default class Control extends Extension { enable(){global.context.unsafe_mode=true;} disable(){global.context.unsafe_mode=false;} }")
            env = dict(os.environ, GDK_BACKEND='wayland', GSK_RENDERER='gl', WAYLAND_DISPLAY='projecteur-docs', DISPLAY='',
                XDG_DATA_HOME=str(scratch / 'data'), XDG_CONFIG_HOME=str(scratch / 'config'), XDG_CACHE_HOME=str(scratch / 'cache'),
                LANGUAGE='zh_TW' if locale == 'zh-TW' else 'en', LC_ALL='C.UTF-8')
            subprocess.run(['dbus-run-session', '--', sys.executable, str(Path(__file__).resolve()), '--session', folder, str(destination), locale], env=env, check=True)
