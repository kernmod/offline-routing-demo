#!/usr/bin/env bash
set -euo pipefail

serial="${ANDROID_SERIAL:?Set ANDROID_SERIAL to the explicitly named test device.}"
output_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/docs/evidence"
mkdir -p "$output_dir"

adb -s "$serial" get-state >/dev/null
adb -s "$serial" shell settings get global airplane_mode_on | grep -qx '1' || {
  echo "Refusing smoke route: enable airplane mode first." >&2
  exit 2
}

timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
route_url="$(node -e 'console.log("offlineroutingdemo://route?origin=-33.8688%2C151.2093&destination=-33.8695%2C151.2102")')"
adb -s "$serial" logcat -c
adb -s "$serial" shell "am start -W -a android.intent.action.VIEW -d '$route_url' -n dev.offlinerouting.demo/.MainActivity" >/dev/null
sleep 5
adb -s "$serial" logcat -d -v raw ReactNativeJS:I '*:S' > "$output_dir/$timestamp-smoke.log"
grep -F 'OfflineRoutingRoute {' "$output_dir/$timestamp-smoke.log" | tail -1 | sed 's/^.*OfflineRoutingRoute //' > "$output_dir/$timestamp-smoke.json"
adb -s "$serial" exec-out screencap -p > "$output_dir/$timestamp-smoke.png"
test -s "$output_dir/$timestamp-smoke.json"
test -s "$output_dir/$timestamp-smoke.png"
echo "Recorded $output_dir/$timestamp-smoke.json and .png"
