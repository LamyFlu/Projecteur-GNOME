#!/usr/bin/env bash
set -euo pipefail

daemon="${1:?usage: dbus-smoke.sh PATH_TO_PROJECTEUR_GNOME_DAEMON}"
service=org.projecteur.Gnome
object=/org/projecteur/Gnome/Pointer
interface=org.projecteur.Gnome.Pointer

"$daemon" --disable-uinput --no-device-scan &
daemon_pid=$!
trap 'kill "$daemon_pid" 2>/dev/null || true; wait "$daemon_pid" 2>/dev/null || true' EXIT

for _ in {1..50}; do
  if gdbus call --session --dest "$service" --object-path "$object" \
      --method "$interface.Ping" >/tmp/projecteur-gnome-ping.txt 2>/dev/null; then
    break
  fi
  sleep 0.05
done

grep -q projecteur-gnome-daemon /tmp/projecteur-gnome-ping.txt
gdbus call --session --dest "$service" --object-path "$object" \
  --method "$interface.SetActiveForTesting" true >/dev/null

active="$(gdbus call --session --dest "$service" --object-path "$object" \
  --method org.freedesktop.DBus.Properties.Get "$interface" Active)"
grep -q true <<<"$active"

gdbus call --session --dest "$service" --object-path "$object" \
  --method "$interface.MoveForTesting" -- 3 -2 >/dev/null
gdbus call --session --dest "$service" --object-path "$object" \
  --method "$interface.SetActiveForTesting" false >/dev/null

active="$(gdbus call --session --dest "$service" --object-path "$object" \
  --method org.freedesktop.DBus.Properties.Get "$interface" Active)"
grep -q false <<<"$active"

clicks="$(gdbus call --session --dest "$service" --object-path "$object" \
  --method org.freedesktop.DBus.Properties.Get "$interface" PointerClicksEnabled)"
grep -q false <<<"$clicks"
gdbus call --session --dest "$service" --object-path "$object" \
  --method "$interface.SetPointerClicksEnabled" true >/dev/null
clicks="$(gdbus call --session --dest "$service" --object-path "$object" \
  --method org.freedesktop.DBus.Properties.Get "$interface" PointerClicksEnabled)"
grep -q true <<<"$clicks"
gdbus call --session --dest "$service" --object-path "$object" \
  --method "$interface.SetPointerClicksEnabled" false >/dev/null

echo "D-Bus smoke test passed"
