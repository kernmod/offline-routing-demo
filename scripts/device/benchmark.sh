#!/usr/bin/env bash
set -euo pipefail

serial="${ANDROID_SERIAL:?Set ANDROID_SERIAL to the explicitly named test device.}"
device_name="${BENCHMARK_DEVICE_NAME:?Set BENCHMARK_DEVICE_NAME, e.g. redroid14-x86_64 (AX102).}"
output_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/docs/benchmarks"
mkdir -p "$output_dir"

adb -s "$serial" get-state >/dev/null
adb -s "$serial" shell settings get global airplane_mode_on | grep -qx '1' || {
  echo "Refusing benchmark: enable airplane mode first." >&2
  exit 2
}

timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
adb -s "$serial" logcat -c
encoded_device="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$device_name")"
adb -s "$serial" shell "am start -W -a android.intent.action.VIEW -d 'offlineroutingdemo://benchmark?device=${encoded_device}' -n dev.offlinerouting.demo/.MainActivity" >/dev/null
sleep 5
adb -s "$serial" logcat -d -v raw ReactNativeJS:I '*:S' > "$output_dir/$timestamp.log"
grep -F 'OfflineRoutingBenchmark {' "$output_dir/$timestamp.log" | tail -1 | sed 's/^.*OfflineRoutingBenchmark //' > "$output_dir/$timestamp.json"
test -s "$output_dir/$timestamp.json"
echo "Recorded $output_dir/$timestamp.json for $device_name"
