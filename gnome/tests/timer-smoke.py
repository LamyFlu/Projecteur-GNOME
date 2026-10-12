#!/usr/bin/env python3
"""Private-bus timer state transitions without hardware access."""
import ast
import json
import subprocess
import sys
import time

def call(method, *args):
    return subprocess.check_output(['gdbus', 'call', '--session', '--dest', 'org.projecteur.Gnome',
        '--object-path', '/org/projecteur/Gnome/Pointer', '--method',
        'org.projecteur.Gnome.Pointer.' + method, '--', *map(str, args)],
        text=True, stderr=subprocess.DEVNULL).strip()
def status():
    return json.loads(ast.literal_eval(call('GetPresentationStatus'))[0])
def accepted(method, *args):
    return call(method, *args) == '(true,)'

daemon = subprocess.Popen([sys.argv[1], '--disable-uinput', '--no-device-scan'])
try:
    for attempt in range(100):
        try:
            call('Ping')
            break
        except subprocess.CalledProcessError:
            if attempt == 99: raise
            time.sleep(.05)
    assert status() == {'timerState': 'idle', 'remainingSeconds': 0, 'devices': []}
    assert not accepted('StartPresentationTimer', 0, 'false')
    assert not accepted('StartPresentationTimer', 86401, 'false')
    assert accepted('StartPresentationTimer', 1, 'true')
    time.sleep(1.2)
    assert status()['timerState'] == 'armed' and status()['remainingSeconds'] == 1
    call('PressForTesting')
    assert status()['timerState'] == 'running'
    call('PausePresentationTimer')
    time.sleep(1.2)
    assert status()['timerState'] == 'paused' and status()['remainingSeconds'] == 1
    call('ResumePresentationTimer')
    time.sleep(1.3)
    assert status()['timerState'] == 'expired' and status()['remainingSeconds'] == 0
    call('ResumePresentationTimer')
    assert status()['timerState'] == 'expired'
    assert accepted('StartPresentationTimer', 86400, 'false')
    assert status()['remainingSeconds'] == 86400
    call('ResetPresentationTimer')
    assert status()['timerState'] == 'idle'
    assert accepted('StartPresentationTimer', 1, 'true')
    call('MoveForTesting', 1, 1)
    assert status()['timerState'] == 'running'
    call('ResetPresentationTimer')
    time.sleep(1.2)
    assert status()['timerState'] == 'idle'
    assert accepted('SetTimerFeedback', 'false', 1, 1)
    assert accepted('SetTimerFeedback', 'false', 255, 10)
    assert not accepted('SetTimerFeedback', 'true', 256, 3)
    assert not accepted('SetTimerFeedback', 'true', 128, 11)
    assert not accepted('Vibrate', 128, 3), 'No hardware must mean no vibration request'
    for mapping in ['{}', '{"next":"key:Ctrl+L"}', '{"back":"previous-preset"}',
        '{"next-hold":"timer-start","back-move":"volume"}', '{"next":"scroll-down"}']:
        assert accepted('SetButtonMappings', mapping), mapping
        assert ast.literal_eval(call('GetButtonMappings'))[0] == mapping
    saved = ast.literal_eval(call('GetButtonMappings'))[0]
    for mapping in ['[]', '{bad', '{"other":"next-preset"}', '{"next":"key:UnknownKey"}',
        '{"next-hold":"next-preset","next-move":"volume"}', '{"next-move":"key:A"}', '{"next":1}']:
        assert not accepted('SetButtonMappings', mapping), mapping
        assert ast.literal_eval(call('GetButtonMappings'))[0] == saved, 'Rejected map changed previous configuration'
    assert accepted('SetButtonMappings', '{}')
    cli = __import__('pathlib').Path(__file__).resolve().parents[1] / 'projecteur-gnome'
    result = subprocess.check_output([str(cli), 'status'], text=True)
    assert json.loads(result)['timerState'] == 'idle'
    subprocess.run([str(cli), 'timer', 'start', '--minutes', '1', '--arm'], check=True)
    assert status()['timerState'] == 'armed'
    subprocess.run([str(cli), 'timer', 'reset'], check=True)
    assert status()['timerState'] == 'idle'
    print('PASS: button mapping validation, rejected-map preservation, CLI status/timer')
    print('PASS: timer bounds, arming, pause/resume, expiry, reset and isolated feedback')
finally:
    daemon.terminate()
    daemon.wait(timeout=5)
