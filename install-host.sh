#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "${project_dir}/native-host/ytmusic_discord_rpc.py"
python3 - "${project_dir}/native-host/ytmusic_discord_rpc.json" "${project_dir}/native-host/ytmusic_discord_rpc.py" <<'PY'
import json
import pathlib
import sys
manifest_path = pathlib.Path(sys.argv[1])
script_path = pathlib.Path(sys.argv[2]).resolve()
data = json.loads(manifest_path.read_text())
data["path"] = str(script_path)
manifest_path.write_text(json.dumps(data, indent=2) + "\n")
PY
install_manifest() {
  local host_dir="$1"
  mkdir -p "${host_dir}"
  cp "${project_dir}/native-host/ytmusic_discord_rpc.json" "${host_dir}/ytmusic_discord_rpc.json"
  echo "Host instalado em ${host_dir}/ytmusic_discord_rpc.json"
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  install_manifest "${HOME}/Library/Application Support/Mozilla/NativeMessagingHosts"
else
  install_manifest "${HOME}/.mozilla/native-messaging-hosts"
fi

# Firefox installed through Flatpak looks inside its private home directory.
if [[ -d "${HOME}/.var/app/org.mozilla.firefox" ]]; then
  install_manifest "${HOME}/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts"
fi
