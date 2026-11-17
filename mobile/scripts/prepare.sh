#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v xcodegen >/dev/null || { echo "Install XcodeGen: brew install xcodegen" >&2; exit 1; }
# Reuse the desktop icon, flattened on white for Apple's opaque iOS app icon.
swift scripts/icon.swift ../app/src-tauri/icons/source.png Switchyard/Assets.xcassets/AppIcon.appiconset/AppIcon.png
xcodegen generate
