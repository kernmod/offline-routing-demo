#!/usr/bin/env bash
set -euo pipefail

serial="${ANDROID_SERIAL:?Set ANDROID_SERIAL to the explicitly named test device.}"
apk="${1:?Usage: verify-release.sh /absolute/path/to/app.apk}"
demo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
output_dir="$demo_root/docs/evidence"
aapt_bin="${ANDROID_HOME:-/opt/android-sdk}/build-tools/36.0.0/aapt"
package="dev.offlinerouting.demo"
activity="$package/.MainActivity"

test -f "$apk"
test -x "$aapt_bin"
adb -s "$serial" get-state >/dev/null
adb -s "$serial" shell settings get global airplane_mode_on | grep -qx '1' || {
  echo "Refusing release verification: enable airplane mode first." >&2
  exit 2
}

permissions="$("$aapt_bin" dump permissions "$apk")"
grep -Fq "android.permission.INTERNET" <<<"$permissions"
for forbidden in \
  android.permission.ACCESS_FINE_LOCATION \
  android.permission.ACCESS_COARSE_LOCATION \
  android.permission.READ_EXTERNAL_STORAGE \
  android.permission.WRITE_EXTERNAL_STORAGE; do
  if grep -Fq "$forbidden" <<<"$permissions"; then
    echo "Release APK unexpectedly requests $forbidden" >&2
    exit 1
  fi
done

wait_for_log() {
  local marker="$1"
  for _ in $(seq 1 30); do
    if adb -s "$serial" logcat -d -v raw ReactNativeJS:I AndroidRuntime:E '*:S' | grep -Fq "$marker"; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $marker" >&2
  return 1
}

adb -s "$serial" install -r "$apk" >/dev/null
adb -s "$serial" shell am force-stop "$package"
adb -s "$serial" logcat -c
adb -s "$serial" shell am start -W -n "$activity" >/dev/null
wait_for_log "OfflineRoutingMapReady"

adb -s "$serial" shell input keyevent KEYCODE_BACK
sleep 1
back_log="$(adb -s "$serial" logcat -d -v raw AndroidRuntime:E '*:S')"
if grep -Fq "FATAL EXCEPTION" <<<"$back_log"; then
  echo "Android back handling crashed the release app." >&2
  exit 1
fi

route_url="offlineroutingdemo://route?origin=-33.8688%2C151.2093&destination=-33.8695%2C151.2102"
adb -s "$serial" logcat -c
adb -s "$serial" shell "am start -W -a android.intent.action.VIEW -d '$route_url' -n '$activity'" >/dev/null
wait_for_log "OfflineRoutingRoute"

timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p "$output_dir"
{
  echo "device=$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
  echo "android=$(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r')"
  echo "abi=$(adb -s "$serial" shell getprop ro.product.cpu.abi | tr -d '\r')"
  echo "airplane_mode=1"
  echo "startup=pass"
  echo "back=pass"
  echo "route=local_native"
  sha256sum "$apk"
} > "$output_dir/$timestamp-release-device.txt"
adb -s "$serial" exec-out screencap -p > "$output_dir/$timestamp-release-device.png"
echo "Release device gate passed: $output_dir/$timestamp-release-device.txt"
