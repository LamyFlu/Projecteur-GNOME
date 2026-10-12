#!/usr/bin/env bash
set -euo pipefail
schema_dir=$(mktemp -d)
trap 'rm -rf "$schema_dir"' EXIT
cp gnome/extension/schemas/*.xml "$schema_dir/"
glib-compile-schemas --strict "$schema_dir"
GSETTINGS_BACKEND=memory gjs -m gnome/tests/presets-check.js "$schema_dir"
