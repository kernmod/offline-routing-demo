#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: verify-ios-simulator.sh --app /absolute/path/mobile.app [--evidence-dir /absolute/path]

Boots an available iPhone simulator, installs the unsigned Release application,
opens the deterministic Sydney route deep link, and records proof that Rust routed
locally without a routing-network attempt.
USAGE
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
demo_root="$(cd "$script_dir/../../.." && pwd)"
app_path="${IOS_SIMULATOR_APP:-}"
evidence_dir="${IOS_SIMULATOR_EVIDENCE_DIR:-$demo_root/artifacts/ios-simulator-evidence}"
timeout_seconds="${IOS_SIMULATOR_TIMEOUT_SECONDS:-180}"
requested_name="${IOS_SIMULATOR_DEVICE_NAME:-}"
route_url="offlineroutingdemo://route?origin=-33.8688%2C151.2093&destination=-33.8695%2C151.2102"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      app_path="$2"
      shift 2
      ;;
    --evidence-dir)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      evidence_dir="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || {
  echo "iOS simulator verification requires macOS and Xcode." >&2
  exit 2
}
[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo "IOS_SIMULATOR_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
}
[[ -n "$app_path" && -d "$app_path" ]] || {
  echo "Release simulator application not found: ${app_path:-<missing --app>}" >&2
  exit 2
}
[[ -f "$app_path/Info.plist" ]] || {
  echo "Application Info.plist is missing: $app_path/Info.plist" >&2
  exit 2
}
command -v xcrun >/dev/null || { echo "xcrun is required." >&2; exit 2; }
command -v node >/dev/null || { echo "Node.js is required to write structured evidence." >&2; exit 2; }

mkdir -p "$evidence_dir"
device_list="$evidence_dir/available-simulators.json"
runtime_log="$evidence_dir/runtime.log"
launch_log="$evidence_dir/launch.log"
selection_file="$evidence_dir/simulator-selection.txt"
xcrun simctl list devices available -j > "$device_list"

selection="$(SIMULATOR_DEVICE_LIST="$device_list" SIMULATOR_DEVICE_NAME="$requested_name" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const inventory = JSON.parse(readFileSync(process.env.SIMULATOR_DEVICE_LIST, "utf8"));
const requestedName = process.env.SIMULATOR_DEVICE_NAME?.trim();
const available = Object.entries(inventory.devices ?? {})
  .filter(([runtime]) => runtime.includes(".iOS-"))
  .flatMap(([runtime, devices]) => devices.map((device) => ({ ...device, runtime })))
  .filter((device) => device.isAvailable !== false && device.deviceTypeIdentifier?.includes("iPhone"));
const candidates = available
  .filter((device) => !requestedName || device.name === requestedName)
  .sort((left, right) => {
    const leftVersion = left.runtime.match(/iOS-(\d+)-(\d+)/)?.slice(1).map(Number) ?? [0, 0];
    const rightVersion = right.runtime.match(/iOS-(\d+)-(\d+)/)?.slice(1).map(Number) ?? [0, 0];
    const versionOrder = rightVersion[0] - leftVersion[0] || rightVersion[1] - leftVersion[1];
    if (versionOrder !== 0) return versionOrder;
    const preferred = (value) => value.name === "iPhone 16 Pro" ? 0 : value.name.includes("Pro") ? 1 : 2;
    return preferred(left) - preferred(right) || left.name.localeCompare(right.name);
  });

if (candidates.length === 0) process.exit(3);
const selected = candidates[0];
process.stdout.write([selected.udid, selected.name, selected.runtime, selected.state].join("\n"));
NODE
)" || {
  echo "No available iPhone simulator matched: ${requested_name:-<any iPhone>}." >&2
  exit 3
}

device_udid="$(printf '%s\n' "$selection" | sed -n '1p')"
device_name="$(printf '%s\n' "$selection" | sed -n '2p')"
device_runtime="$(printf '%s\n' "$selection" | sed -n '3p')"
device_state="$(printf '%s\n' "$selection" | sed -n '4p')"
[[ -n "$device_udid" && -n "$device_name" && -n "$device_runtime" ]] || {
  echo "The simulator inventory returned an incomplete device record." >&2
  exit 3
}

printf 'name=%s\nruntime=%s\nudid=%s\ninitial_state=%s\n' \
  "$device_name" "$device_runtime" "$device_udid" "$device_state" > "$selection_file"
echo "Selected simulator: $device_name ($device_runtime)"

log_pid=""
booted_by_script=0
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n "$log_pid" ]] && kill -0 "$log_pid" 2>/dev/null; then
    kill "$log_pid" 2>/dev/null || true
    wait "$log_pid" 2>/dev/null || true
  fi
  if [[ -n "${device_udid:-}" ]]; then
    xcrun simctl io "$device_udid" screenshot "$evidence_dir/final-screen.png" >/dev/null 2>&1 || true
  fi
  if [[ "$booted_by_script" -eq 1 ]]; then
    xcrun simctl shutdown "$device_udid" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

if [[ "$device_state" != "Booted" ]]; then
  xcrun simctl boot "$device_udid"
  booted_by_script=1
fi
xcrun simctl bootstatus "$device_udid" -b

bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$app_path/Info.plist")"
executable_name="$(plutil -extract CFBundleExecutable raw -o - "$app_path/Info.plist")"
[[ -n "$bundle_id" && -n "$executable_name" && -x "$app_path/$executable_name" ]] || {
  echo "The built application does not expose an executable bundle." >&2
  exit 4
}
file "$app_path/$executable_name" > "$evidence_dir/app-binary.txt"

xcrun simctl install "$device_udid" "$app_path"
: > "$runtime_log"
xcrun simctl spawn "$device_udid" log stream \
  --style compact \
  --level debug \
  --predicate 'process == "mobile" OR eventMessage CONTAINS "OfflineRouting"' \
  > "$runtime_log" 2>&1 &
log_pid=$!
sleep 2

xcrun simctl launch --terminate-running-process "$device_udid" "$bundle_id" > "$launch_log" 2>&1

wait_for_log() {
  marker="$1"
  deadline=$((SECONDS + timeout_seconds))
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    if grep -Fq "$marker" "$runtime_log"; then
      return 0
    fi
    if ! kill -0 "$log_pid" 2>/dev/null; then
      echo "The simulator log stream stopped before $marker was observed." >&2
      tail -200 "$runtime_log" >&2 || true
      return 1
    fi
    sleep 2
  done
  echo "Timed out after ${timeout_seconds}s waiting for $marker on $device_name." >&2
  tail -200 "$runtime_log" >&2 || true
  return 1
}

wait_for_log "OfflineRoutingMapReady"
xcrun simctl openurl "$device_udid" "$route_url"
wait_for_log "OfflineRoutingRoute"

route_line="$(grep -F "OfflineRoutingRoute" "$runtime_log" | tail -1)"
if ! printf '%s\n' "$route_line" | grep -Eq 'routeSource["\\ ]*:[[:space:]]*"local_native"'; then
  echo "The iOS route did not report routeSource=local_native." >&2
  printf '%s\n' "$route_line" >&2
  exit 5
fi
if ! printf '%s\n' "$route_line" | grep -Eq 'networkAttempts["\\ ]*:[[:space:]]*0([^0-9]|$)'; then
  echo "The iOS route attempted to use the network or omitted its network proof." >&2
  printf '%s\n' "$route_line" >&2
  exit 5
fi

printf '%s\n' "$route_line" > "$evidence_dir/route-signal.log"
xcrun simctl io "$device_udid" screenshot "$evidence_dir/route-screen.png" >/dev/null

export IOS_EVIDENCE_PATH="$evidence_dir/ios-simulator-evidence.json"
export IOS_DEVICE_NAME="$device_name"
export IOS_DEVICE_RUNTIME="$device_runtime"
export IOS_DEVICE_UDID="$device_udid"
export IOS_BUNDLE_ID="$bundle_id"
export IOS_ROUTE_URL="$route_url"
export IOS_APP_EXECUTABLE="$app_path/$executable_name"
node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const executable = readFileSync(process.env.IOS_APP_EXECUTABLE);
const evidence = {
  schemaVersion: 1,
  platform: "ios-simulator",
  simulator: {
    name: process.env.IOS_DEVICE_NAME,
    runtime: process.env.IOS_DEVICE_RUNTIME,
    udid: process.env.IOS_DEVICE_UDID
  },
  bundleId: process.env.IOS_BUNDLE_ID,
  routeUrl: process.env.IOS_ROUTE_URL,
  routeSource: "local_native",
  networkAttempts: 0,
  executableSha256: createHash("sha256").update(executable).digest("hex"),
  recordedAt: new Date().toISOString()
};
writeFileSync(process.env.IOS_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
NODE

echo "iOS simulator gate passed on $device_name ($device_runtime)."
echo "Evidence: $evidence_dir/ios-simulator-evidence.json"
