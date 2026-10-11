#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  --help|-h)
    echo "Usage: ./uninstall.sh"
    echo "Remove Projecteur GNOME user files; keep preferences and system udev rules."
    exit 0 ;;
  '') ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac
if (( $# > 1 )); then echo "Too many arguments." >&2; exit 2; fi

if (( EUID == 0 )); then
  echo "Run this uninstaller as your desktop user, without sudo." >&2
  exit 1
fi

extension_uuid=projecteur-pointer-ubuntu26@projecteur.github.io
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$extension_uuid"
user_service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

gnome-extensions disable "$extension_uuid" 2>/dev/null || true
if command -v gjs >/dev/null; then
  gjs -c '
const settings = new imports.gi.Gio.Settings({schema_id: "org.gnome.shell"});
settings.set_strv("enabled-extensions", settings.get_strv("enabled-extensions")
    .filter(uuid => uuid !== "projecteur-pointer-ubuntu26@projecteur.github.io"));
imports.gi.Gio.Settings.sync();'
fi
# Restore the hardware double-click mapping before stopping a new daemon.
# Older installed versions do not have this method.
gdbus call --session --dest org.projecteur.Gnome \
  --object-path /org/projecteur/Gnome/Pointer \
  --method org.projecteur.Gnome.Pointer.SetPointerDoubleClickEnabled false >/dev/null 2>&1 || true
systemctl --user disable --now projecteur-gnome-daemon.service 2>/dev/null || true

for path in \
  "$HOME/.local/bin/projecteur-gnome-daemon" \
  "$user_service_dir/projecteur-gnome-daemon.service"; do
  if [[ -e "$path" ]]; then
    rm -f -- "$path"
  fi
done

if [[ -d "$extension_dir" ]]; then
  rm -rf -- "$extension_dir"
fi

systemctl --user daemon-reload
case "${LANGUAGE:-${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}}" in
  zh*) echo "已移除 Projecteur GNOME 使用者檔案；偏好設定及系統 udev 規則會保留。" ;;
  *) echo "Projecteur GNOME user files removed. Saved preferences and system udev rules were retained." ;;
esac
