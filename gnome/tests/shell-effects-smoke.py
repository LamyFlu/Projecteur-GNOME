#!/usr/bin/env python3
"""Exercise the real overlay in a separate headless GNOME 50 session.

Optional local integration test; requires gnome-shell and a working EGL backend.
It never enables unsafe mode on the user's Shell, opens input devices, or
changes the user's settings. Temporary screenshots/logs are removed on exit.
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

UUID = 'projecteur-pointer-ubuntu26@projecteur.github.io'
ROOT = Path(__file__).resolve().parents[2]


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()


def evaluate(code):
    output = command('gdbus', 'call', '--session', '--dest', 'org.gnome.Shell',
                     '--object-path', '/org/gnome/Shell', '--method', 'org.gnome.Shell.Eval', code)
    success, value = ast.literal_eval(output.replace('(true,', '(True,', 1).replace('(false,', '(False,', 1))
    if not success:
        raise RuntimeError(value)
    return json.loads(value) if value else None


def bridge(method, *args):
    return command('gdbus', 'call', '--session', '--dest', 'org.projecteur.Gnome',
                   '--object-path', '/org/projecteur/Gnome/Pointer', '--method',
                   f'org.projecteur.Gnome.Pointer.{method}', '--', *map(str, args))


def session(daemon_path, scratch):
    command('gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
            f'["{UUID}", "projecteur-test@local"]')
    command('gsettings', 'set', 'org.gnome.shell', 'disable-user-extensions', 'false')
    with (scratch / 'shell.log').open('w') as shell_log, (scratch / 'daemon.log').open('w') as daemon_log:
        shell = subprocess.Popen(['gnome-shell', '--headless', '--wayland', '--no-x11',
                                  '--virtual-monitor=1280x720', '--wayland-display=projecteur-test'],
                                 stdout=shell_log, stderr=subprocess.STDOUT)
        daemon = subprocess.Popen([daemon_path, '--disable-uinput', '--no-device-scan'],
                                  stdout=daemon_log, stderr=subprocess.STDOUT)
        try:
            for attempt in range(80):
                try:
                    if evaluate(f'Main.extensionManager.lookup("{UUID}")?.state') == 1:
                        break
                except (subprocess.CalledProcessError, RuntimeError):
                    pass
                time.sleep(0.25)
            else:
                raise RuntimeError('Extension failed to enable')
            assert evaluate(f'(() => {{const s=Main.extensionManager.lookup("{UUID}").stateObj._settings; '
                            'return [s.get_boolean("laser-enabled"),s.get_boolean("spotlight-enabled"),'
                            's.get_boolean("magnifier-enabled")];})()') == [True, False, False]
            evaluate(f'global.pe = Main.extensionManager.lookup("{UUID}").stateObj; '
                     'global.pe._settings.set_boolean("spotlight-enabled",true); '
                     'global.pe._settings.set_boolean("magnifier-enabled",true); '
                     'global.pe._settings.set_double("linger-seconds",30); '
                     'global.pe._settings.set_boolean("hide-system-cursor",true); true')
            bridge('SetActiveForTesting', 'true')
            time.sleep(0.2)
            for mode in ['laser', 'spotlight', 'magnifier']:
                result = evaluate(f'global.pe._settings.set_string("pointer-mode","{mode}"); '
                                  'global.pe._pointerX=640; global.pe._pointerY=360; global.pe._updatePosition(); '
                                  '({active:global.pe._active, mode:global.pe._mode(), '
                                  'dot:global.pe._dot.visible, shade:global.pe._effects._shade.visible, '
                                  'lens:global.pe._effects._lens.visible, cursor:global.pe._cursorVisibilityInhibited})')
                assert result == dict(active=True, mode=mode, dot=mode == 'laser',
                                      shade=mode == 'spotlight', lens=mode == 'magnifier', cursor=True), result
                time.sleep(0.2)
                command('gdbus', 'call', '--session', '--dest', 'org.gnome.Shell',
                        '--object-path', '/org/gnome/Shell/Screenshot', '--method',
                        'org.gnome.Shell.Screenshot.Screenshot', 'false', 'false', str(scratch / f'{mode}.png'))
                assert (scratch / f'{mode}.png').stat().st_size > 1000
            def clicks_enabled():
                return 'true' in command('gdbus', 'call', '--session', '--dest', 'org.projecteur.Gnome',
                    '--object-path', '/org/projecteur/Gnome/Pointer', '--method',
                    'org.freedesktop.DBus.Properties.Get', 'org.projecteur.Gnome.Pointer', 'PointerClicksEnabled')
            assert not clicks_enabled(), 'Mouse clicks must default to disabled'
            evaluate('global.pe._settings.set_boolean("pointer-clicks-enabled",true); true')
            time.sleep(0.2)
            assert clicks_enabled(), 'Preference did not enable forwarding'
            evaluate('global.pe._settings.set_boolean("pointer-clicks-enabled",false); true')
            time.sleep(0.2)
            assert not clicks_enabled(), 'Preference did not disable forwarding'
            # Test a disabled mode, then real D-Bus switching and its opt-out.
            evaluate('global.pe._settings.set_boolean("magnifier-enabled",false); true')
            assert evaluate('global.pe._mode()') == 'laser'
            evaluate('global.pe._settings.set_string("pointer-mode","laser"); '
                     'global.pe._settings.set_boolean("double-click-switch",true); true')
            time.sleep(0.2)
            bridge('DoubleClickForTesting')
            time.sleep(0.2)
            assert evaluate('global.pe._mode()') == 'spotlight'
            bridge('DoubleClickForTesting')
            time.sleep(0.2)
            assert evaluate('global.pe._mode()') == 'laser'
            evaluate('global.pe._settings.set_boolean("double-click-switch",false); true')
            time.sleep(0.2)
            bridge('DoubleClickForTesting')
            time.sleep(0.2)
            assert evaluate('global.pe._mode()') == 'laser'
            evaluate('global.pe._settings.set_boolean("laser-enabled",false); '
                     'global.pe._settings.set_boolean("spotlight-enabled",false); '
                     'global.pe._settings.set_boolean("magnifier-enabled",false); true')
            assert evaluate('global.pe._mode()') is None
            assert evaluate('({effects:global.pe._effects.actor.visible,dot:global.pe._dot.visible,'
                            'cursor:global.pe._cursorVisibilityInhibited,focus:global.pe._cursorFocusInhibited,'
                            'unredirect:global.pe._unredirectDisabled})') == dict(
                                effects=False, dot=False, cursor=False, focus=False, unredirect=False)
            evaluate('global.pe._settings.set_boolean("double-click-switch",true); true')
            time.sleep(0.2)
            bridge('DoubleClickForTesting')
            time.sleep(0.2)
            assert evaluate('global.pe._mode()') is None
            bridge('SetActiveForTesting', 'false')
            time.sleep(0.2)
            assert evaluate('({effects:global.pe._effects.actor.visible,dot:global.pe._dot.visible,'
                            'cursor:global.pe._cursorVisibilityInhibited,focus:global.pe._cursorFocusInhibited,'
                            'unredirect:global.pe._unredirectDisabled})') == dict(
                                effects=False, dot=False, cursor=False, focus=False, unredirect=False)
            # GTK preferences must load the new schema/module without errors.
            prefs_env = dict(os.environ, WAYLAND_DISPLAY='projecteur-test')
            subprocess.run(['gnome-extensions', 'prefs', UUID], env=prefs_env, check=True,
                           stdout=shell_log, stderr=shell_log)
            for attempt in range(40):
                bounds = evaluate('(() => { const w = global.get_window_actors().map(a => a.meta_window)'
                                  '.find(w => w.get_title()?.includes("Projecteur Pointer")); '
                                  'if (!w) return null; Main.overview.hide(); '
                                  'w.activate(global.get_current_time()); const r=w.get_frame_rect(); '
                                  'return [r.x,r.y,r.width,r.height]; })()')
                if bounds and bounds[2] > 0 and bounds[3] > 0:
                    break
                time.sleep(0.25)
            assert bounds and bounds[2] > 0 and bounds[3] > 0, 'Preferences window did not open'
            time.sleep(0.5)
            command('gdbus', 'call', '--session', '--dest', 'org.gnome.Shell',
                    '--object-path', '/org/gnome/Shell/Screenshot', '--method',
                    'org.gnome.Shell.Screenshot.ScreenshotArea', *map(str, bounds),
                    'false', str(scratch / 'preferences.png'))
            assert (scratch / 'preferences.png').stat().st_size > 1000, 'Preferences were not rendered'
            artifacts = os.environ.get('PROJECTEUR_TEST_ARTIFACTS')
            if artifacts:
                destination = Path(artifacts)
                destination.mkdir(parents=True, exist_ok=True)
                for image in scratch.glob('*.png'):
                    shutil.copyfile(image, destination / image.name)
            evaluate('global.pe.disable(); true')
            time.sleep(0.2)
            text = (scratch / 'shell.log').read_text()
            for marker in ['JS ERROR', 'Clutter-CRITICAL', 'Failed to compile', 'TypeError:', 'ReferenceError:']:
                assert marker not in text, text
            print('PASS: real GNOME rendering, cursor cleanup, D-Bus cycling, disabled modes, preferences')
        except Exception:
            print((scratch / 'shell.log').read_text(), file=sys.stderr)
            raise
        finally:
            # Private bus only, and always clean up temporary visual activation.
            try:
                bridge('SetActiveForTesting', 'false')
                bridge('SetPointerDoubleClickEnabled', 'false')
            except subprocess.CalledProcessError:
                pass
            daemon.terminate()
            shell.terminate()
            for process in [daemon, shell]:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--session':
        session(sys.argv[2], Path(sys.argv[3]))
    else:
        daemon_path = str(Path(sys.argv[1]).resolve())
        with tempfile.TemporaryDirectory(prefix='projecteur-gnome-test-') as folder:
            scratch = Path(folder)
            env = dict(os.environ, GDK_BACKEND='wayland', GSK_RENDERER='gl', WAYLAND_DISPLAY='projecteur-test', DISPLAY='', XDG_DATA_HOME=str(scratch / 'data'),
                       XDG_CONFIG_HOME=str(scratch / 'config'), XDG_CACHE_HOME=str(scratch / 'cache'))
            extension_dir = scratch / 'data/gnome-shell/extensions' / UUID
            shutil.copytree(ROOT / 'gnome/extension', extension_dir)
            subprocess.run(['glib-compile-schemas', str(extension_dir / 'schemas')], check=True)
            control = extension_dir.parent / 'projecteur-test@local'
            control.mkdir()
            (control / 'metadata.json').write_text(json.dumps(dict(uuid='projecteur-test@local',
                name='Isolated test control', description='Private test only', **{'shell-version': ['50']})))
            (control / 'extension.js').write_text('''
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class TestControl extends Extension {
    enable() { global.context.unsafe_mode = true; }
    disable() { global.context.unsafe_mode = false; }
}
''')
            subprocess.run(['dbus-run-session', '--', sys.executable, str(Path(__file__).resolve()),
                            '--session', daemon_path, folder], env=env, check=True)
