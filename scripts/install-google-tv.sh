#!/usr/bin/env bash
set -euo pipefail
# The device must already be explicitly paired/authorized. Never scan or reset data.
opentv_apk="${1:-artifacts/android/open-tv-google-tv-preview.apk}"
opentv_serial="${2:-}"
if ! command -v adb >/dev/null; then
  echo 'Install Android SDK Platform Tools and put adb on PATH.' >&2; exit 1
fi
if [[ ! -f "$opentv_apk" ]]; then echo 'APK not found. Run npm run android:debug or download the built preview APK.' >&2; exit 1; fi
if [[ -z "$opentv_serial" ]]; then
  echo 'Usage: scripts/install-google-tv.sh path/to/preview.apk DEVICE_SERIAL_OR_IP:PORT' >&2
  echo 'Pair/authorize your TV first, then use its exact serial from adb devices.' >&2; exit 1
fi
if [[ "$(adb -s "$opentv_serial" get-state)" != device ]]; then echo 'This TV is not connected and authorized.' >&2; exit 1; fi
adb -s "$opentv_serial" install -r "$opentv_apk"
adb -s "$opentv_serial" shell am start -n com.builtbysai.opentv.debug/com.builtbysai.opentv.MainActivity
