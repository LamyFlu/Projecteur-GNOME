#!/usr/bin/env python3
"""Check every inherited extra-device ID is compiled and has scoped udev access."""
from pathlib import Path
import re
import sys
root = Path(__file__).resolve().parents[2]
build = Path(sys.argv[1])
compiled = (build / 'extra-devices.cc').read_text().lower()
rules = (build / '55-projecteur.rules').read_text()
count = 0
for line in (root / 'devices.conf').read_text().splitlines():
    match = re.match(r'\s*0x([0-9a-f]+),\s*0x([0-9a-f]+),\s*(usb|bt),\s*(.*)', line, re.I)
    if not match:
        continue
    vendor, product, bus, name = match.groups()
    vendor, product = vendor.lower(), product.lower()
    assert f'0x{vendor}, 0x{product}' in compiled, name
    if bus == 'usb':
        assert f'ATTRS{{idVendor}}=="{vendor}"' in rules and f'ATTRS{{idProduct}}=="{product}"' in rules, name
    else:
        assert f'5/{int(vendor,16):x}/{int(product,16):x}*' in rules, name
    count += 1
assert count == 13, f'Unexpected device table size: {count}'
print(f'PASS: {count} extra-device entries compiled with scoped udev rules; hardware remains unverified')
