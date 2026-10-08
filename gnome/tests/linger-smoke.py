#!/usr/bin/env python3
"""Run with dbus-run-session -- python3 linger-smoke.py PATH_TO_DAEMON."""
import subprocess
import sys
import time

DEST = 'org.projecteur.Gnome'
PATH = '/org/projecteur/Gnome/Pointer'
INTERFACE = 'org.projecteur.Gnome.Pointer'


def call(method, *args):
    return subprocess.check_output([
        'gdbus', 'call', '--session', '--dest', DEST, '--object-path', PATH,
        '--method', method, '--', *map(str, args),
    ], text=True, stderr=subprocess.DEVNULL).strip()


def active():
    return 'true' in call('org.freedesktop.DBus.Properties.Get', INTERFACE, 'Active')


def linger(seconds):
    return 'true' in call(f'{INTERFACE}.SetLingerSeconds', seconds)


def move():
    call(f'{INTERFACE}.MoveForTesting', 3, -2)


daemon = subprocess.Popen([sys.argv[1], '--disable-uinput'])
try:
    for attempt in range(100):
        try:
            call(f'{INTERFACE}.Ping')
            break
        except subprocess.CalledProcessError:
            if attempt == 99:
                raise
            time.sleep(0.05)

    assert not linger(0) and not linger(31), 'Invalid durations accepted'
    assert linger(0.1) and linger(30), 'Valid limits rejected'
    assert linger(0.5)
    move()
    time.sleep(0.3)
    assert active(), 'Dot expired too soon'
    move()
    time.sleep(0.3)
    assert active(), 'Movement did not renew timeout'
    time.sleep(0.3)
    assert not active(), 'Dot did not expire'

    assert linger(1)
    move()
    time.sleep(0.3)
    assert linger(0.1)
    time.sleep(0.1)
    assert not active(), 'Shorter setting did not apply to active idle period'

    assert linger(0.5)
    move()
    time.sleep(0.2)
    assert linger(1)
    time.sleep(0.4)
    assert active(), 'Longer setting did not extend current idle period'
    time.sleep(0.5)
    assert not active(), 'Extended timeout did not expire'
    print('PASS: bounds, idle expiry, motion renewal and live timeout changes')
finally:
    daemon.terminate()
    daemon.wait(timeout=5)
