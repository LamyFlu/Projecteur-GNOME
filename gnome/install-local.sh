#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
build_dir="$project_root/build/gnome"
extension_uuid=projecteur-pointer-ubuntu26@projecteur.github.io
legacy_extension_uuid=projecteur-pointer@projecteur.github.io
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$extension_uuid"
user_bin_dir="$HOME/.local/bin"
user_service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
daemon_path="$user_bin_dir/projecteur-gnome-daemon"
no_system_changes=false

message() {
  local language="${LANGUAGE:-${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}}"
  case "$language" in
    zh*) printf '%s\n' "$2" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

case "${1:-}" in
  --help|-h)
    echo "Usage: ./install.sh [--no-system-changes]"
    echo "Build and install Projecteur GNOME for the current user."
    echo "By default, install missing Ubuntu dependencies and device permissions using sudo."
    echo "--no-system-changes: require dependencies to be installed; skip udev setup."
    exit 0 ;;
  --no-system-changes) no_system_changes=true ;;
  '') ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac
if (( $# > 1 )); then echo "Too many arguments." >&2; exit 2; fi
if (( EUID == 0 )); then
  message "Run this installer as your desktop user, without sudo." \
    "請以桌面使用者執行安裝程式，不要在指令前加 sudo。" >&2
  exit 1
fi
if ! command -v gnome-shell >/dev/null || [[ "$(gnome-shell --version)" != 'GNOME Shell 50.'* ]]; then
  message "GNOME Shell 50 is required." "需要 GNOME Shell 50。" >&2
  exit 1
fi
if [[ "${XDG_SESSION_TYPE:-}" != wayland ]]; then
  message "Run this installer from a GNOME Wayland desktop session." \
    "請在 GNOME Wayland 桌面工作階段執行安裝。" >&2
  exit 1
fi
desktop="${XDG_CURRENT_DESKTOP:-}"
if [[ "${desktop^^}" != *GNOME* ]]; then
  message "Run this installer from your GNOME desktop session." \
    "請在 GNOME 桌面工作階段執行安裝。" >&2
  exit 1
fi
# This installer targets Ubuntu 26.04. Other environments can use the manual build.
. /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 26.04 ]]; then
  message "This installer supports Ubuntu 26.04. See gnome/README.md for manual builds." \
    "此安裝程式支援 Ubuntu 26.04；其他系統請參考 gnome/README.md 手動建置。" >&2
  exit 1
fi

packages=(build-essential cmake extra-cmake-modules qt6-base-dev
          libkf6coreaddons-dev libkf6i18n-dev libglib2.0-bin gjs python3)
missing=()
for package in "${packages[@]}"; do
  if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" != 'install ok installed' ]]; then
    missing+=("$package")
  fi
done
if (( ${#missing[@]} )); then
  printf 'Required packages: %s\n' "${missing[*]}"
  if $no_system_changes; then
    echo "Install the packages above, then rerun the installer." >&2
    exit 1
  fi
  sudo apt-get install -y "${missing[@]}"
fi

message "Building Projecteur GNOME…" "正在建置 Projecteur GNOME…"
cmake -S "$script_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build_dir" --parallel 4

if ! $no_system_changes; then
  if ! cmp -s "$build_dir/55-projecteur.rules" /etc/udev/rules.d/55-projecteur.rules; then
    message "Installing presenter device permissions (administrator password may be required)…" \
      "正在安裝簡報器裝置權限（可能需要管理員密碼）…"
    sudo install -m 0644 "$build_dir/55-projecteur.rules" /etc/udev/rules.d/55-projecteur.rules
    sudo udevadm control --reload-rules
    sudo udevadm trigger
  fi
else
  message "Device permission setup skipped; existing udev permissions are required." \
    "已略過裝置權限設定；需要事先安裝 udev 規則。"
fi

# Build first; stop the existing service only when the replacement is ready.
if systemctl --user is-active --quiet projecteur-gnome-daemon.service; then
  systemctl --user stop projecteur-gnome-daemon.service
fi
install -D -m 0755 "$build_dir/projecteur-gnome-daemon" "$daemon_path"
# Preserve effective toggle values on upgrades before changing schema defaults.
# First installs have no old schema and receive laser-only defaults.
if [[ -f "$extension_dir/schemas/gschemas.compiled" ]]; then
  gjs -c '
const {Gio} = imports.gi;
const source = Gio.SettingsSchemaSource.new_from_directory(ARGV[0],
    Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup("org.gnome.shell.extensions.projecteur-pointer", false);
if (schema) {
    const settings = new Gio.Settings({settings_schema: schema});
    for (const key of ["spotlight-enabled", "magnifier-enabled"]) {
        if (schema.has_key(key) && settings.get_user_value(key) === null)
            settings.set_boolean(key, settings.get_boolean(key));
    }
    Gio.Settings.sync();
}' "$extension_dir/schemas"
fi
install -d "$extension_dir" "$extension_dir/schemas" "$extension_dir/icons"
for file in metadata.json extension.js prefs.js i18n.js pointer-effects.js pointer-state.js panel-indicator.js stylesheet.css; do
  install -m 0644 "$script_dir/extension/$file" "$extension_dir/$file"
done
install -m 0644 "$script_dir/extension/schemas/"*.gschema.xml "$extension_dir/schemas/"
install -m 0644 "$script_dir/extension/icons/projecteur-target-symbolic.svg" "$extension_dir/icons/"
glib-compile-schemas --strict "$extension_dir/schemas"

install -d "$user_service_dir"
python3 - "$script_dir/projecteur-gnome-daemon.service.in" \
  "$user_service_dir/projecteur-gnome-daemon.service" "$daemon_path" <<'SERVICE'
from pathlib import Path
import sys
# Quote paths for systemd ExecStart, including paths containing spaces.
quoted = '"' + sys.argv[3].replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
Path(sys.argv[2]).write_text(Path(sys.argv[1]).read_text().replace('@DAEMON_PATH@', quoted))
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now projecteur-gnome-daemon.service
# Persist enablement even before Shell discovers a new extension. The next
# login loads it automatically, without requiring another terminal command.
gjs -c '
const settings = new imports.gi.Gio.Settings({schema_id: "org.gnome.shell"});
const uuid = "projecteur-pointer-ubuntu26@projecteur.github.io";
const legacy = "projecteur-pointer@projecteur.github.io";
const enabled = settings.get_strv("enabled-extensions").filter(item => item !== legacy);
if (!enabled.includes(uuid)) enabled.push(uuid);
settings.set_strv("enabled-extensions", enabled);
imports.gi.Gio.Settings.sync();'
gnome-extensions enable "$extension_uuid" 2>/dev/null || true
gnome-extensions disable "$legacy_extension_uuid" 2>/dev/null || true

message "Installation complete. Reconnect the presenter, then log out and back in. The extension will enable automatically." \
  "安裝完成。請重新連接簡報器，再登出並登入；擴充功能會自動啟用。"
message "Preferences: GNOME Extensions → Projecteur Pointer for Ubuntu 26.04 → Settings" \
  "設定：擴充功能 → Projecteur Pointer for Ubuntu 26.04 → 設定"
