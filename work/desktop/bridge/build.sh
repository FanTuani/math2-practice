#!/bin/bash
set -euo pipefail

bridge_source="$(cd "$(dirname "$0")" && pwd)"
build_dir="$(dirname "$bridge_source")/.build"
bridge_env="$build_dir/bridge-env"
mkdir -p "$build_dir"
if [[ ! -x "$bridge_env/bin/python" ]]; then
  "${BRIDGE_PYTHON:-python3.11}" -m venv "$bridge_env"
fi
"$bridge_env/bin/python" -m pip --disable-pip-version-check install 'pyinstaller==6.22.3'
"$bridge_env/bin/python" -m PyInstaller --noconfirm \
  --distpath "$build_dir" --workpath "$build_dir/pyi-work" "$bridge_source/bridge.spec"
