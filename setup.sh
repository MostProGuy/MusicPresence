#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Install it and run this script again."
  exit 1
fi
"${project_dir}/install-host.sh"
echo
echo "Setup complete. Next steps:"
echo "1. Open Firefox: about:debugging#/runtime/this-firefox"
echo "2. Click 'Load Temporary Add-on' and select: ${project_dir}/manifest.json"
echo "3. Open the extension settings and paste your Discord Application ID."
echo "4. Start Discord, open music.youtube.com, and play a song."
