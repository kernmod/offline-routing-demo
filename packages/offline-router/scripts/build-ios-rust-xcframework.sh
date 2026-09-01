#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${PACKAGE_ROOT}/../.." && pwd)"
RUST_TARGET_DIR="${CARGO_TARGET_DIR:-${WORKSPACE_ROOT}/target}"
BUILD_DIR="${PACKAGE_ROOT}/ios/build"
XCFRAMEWORK="${PACKAGE_ROOT}/ios/OfflineRouterCore.xcframework"
HEADER_DIR="${PACKAGE_ROOT}/ios/include"
CRATE_NAME="offline-routing-mobile-core"
LIBRARY_NAME="liboffline_routing_mobile_core.a"
DEVICE_TARGET="aarch64-apple-ios"
SIMULATOR_ARM_TARGET="aarch64-apple-ios-sim"
SIMULATOR_X86_TARGET="x86_64-apple-ios"
REQUIRED_SYMBOLS=(
  offline_routing_mobile_core_symbol_anchor
  routing_router_load
  routing_router_route
  offline_tiles_start
  routing_router_route_many
  routing_router_benchmark
  routing_router_free
  routing_buffer_free
  offline_tiles_last_error
  offline_tiles_stop
)

print_plan() {
  printf '%s\n' \
    "one Rust staticlib: ${CRATE_NAME}" \
    "Apple targets: ${DEVICE_TARGET}, ${SIMULATOR_ARM_TARGET}, ${SIMULATOR_X86_TARGET}" \
    "required symbols: ${REQUIRED_SYMBOLS[*]}" \
    "output: ${XCFRAMEWORK}"
}

if [[ "${1:-}" == "--print-plan" ]]; then
  print_plan
  exit 0
fi

if [[ $# -ne 0 ]]; then
  printf 'usage: %s [--print-plan]\n' "$0" >&2
  exit 64
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'error: the iOS XCFramework builder requires macOS; use --print-plan for a portable audit.\n' >&2
  exit 69
fi

for command in cargo rustc rustup lipo xcodebuild; do
  command -v "${command}" >/dev/null 2>&1 || {
    printf 'error: required command is unavailable: %s\n' "${command}" >&2
    exit 69
  }
done

export CARGO_TARGET_DIR="${RUST_TARGET_DIR}"
# Keep Rust, C dependencies built by cc-rs, CocoaPods and the application on
# the same minimum iOS version. Without this, the current SDK can compile zstd
# for the host SDK while rustc links the cdylib compatibility target as iOS 10.
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-16.4}"

rustup target add "${DEVICE_TARGET}" "${SIMULATOR_ARM_TARGET}" "${SIMULATOR_X86_TARGET}"
rustup component add llvm-tools-preview

RUST_HOST="$(rustc -vV | sed -n 's/^host: //p')"
LLVM_NM="$(rustc --print sysroot)/lib/rustlib/${RUST_HOST}/bin/llvm-nm"
test -x "${LLVM_NM}" || {
  printf 'error: llvm-nm is missing after installing llvm-tools-preview: %s\n' "${LLVM_NM}" >&2
  exit 69
}

build_target() {
  local target="$1"
  cargo build \
    --locked \
    --manifest-path "${WORKSPACE_ROOT}/Cargo.toml" \
    --package "${CRATE_NAME}" \
    --release \
    --target "${target}"
}

verify_symbols() {
  local library="$1"
  local symbol
  local symbols
  local symbol_names
  # Apple's nm in Xcode 16 cannot decode LLVM 21 object attributes emitted by
  # Rust 1.94. Use the matching Rust toolchain's llvm-nm for deterministic
  # symbol inspection across all three Apple archives.
  symbols="$("${LLVM_NM}" --defined-only --extern-only "${library}")"
  symbol_names="$(awk '{print $NF}' <<<"${symbols}" | sed 's/^_//')"
  for symbol in "${REQUIRED_SYMBOLS[@]}"; do
    if ! grep -Fxq "${symbol}" <<<"${symbol_names}"; then
      printf 'error: %s does not define required symbol %s\n' "${library}" "${symbol}" >&2
      exit 1
    fi
  done
}

build_target "${DEVICE_TARGET}"
build_target "${SIMULATOR_ARM_TARGET}"
build_target "${SIMULATOR_X86_TARGET}"

DEVICE_LIBRARY="${RUST_TARGET_DIR}/${DEVICE_TARGET}/release/${LIBRARY_NAME}"
SIMULATOR_ARM_LIBRARY="${RUST_TARGET_DIR}/${SIMULATOR_ARM_TARGET}/release/${LIBRARY_NAME}"
SIMULATOR_X86_LIBRARY="${RUST_TARGET_DIR}/${SIMULATOR_X86_TARGET}/release/${LIBRARY_NAME}"

for library in "${DEVICE_LIBRARY}" "${SIMULATOR_ARM_LIBRARY}" "${SIMULATOR_X86_LIBRARY}"; do
  test -f "${library}" || {
    printf 'error: expected Rust static library is missing: %s\n' "${library}" >&2
    exit 1
  }
  verify_symbols "${library}"
done

mkdir -p "${BUILD_DIR}"
SIMULATOR_LIBRARY="${BUILD_DIR}/${LIBRARY_NAME}"
lipo -create \
  "${SIMULATOR_ARM_LIBRARY}" \
  "${SIMULATOR_X86_LIBRARY}" \
  -output "${SIMULATOR_LIBRARY}"
verify_symbols "${SIMULATOR_LIBRARY}"

rm -rf "${XCFRAMEWORK}"
xcodebuild -create-xcframework \
  -library "${DEVICE_LIBRARY}" -headers "${HEADER_DIR}" \
  -library "${SIMULATOR_LIBRARY}" -headers "${HEADER_DIR}" \
  -output "${XCFRAMEWORK}"

test -f "${XCFRAMEWORK}/Info.plist" || {
  printf 'error: xcodebuild did not produce a valid XCFramework.\n' >&2
  exit 1
}

printf 'built %s\n' "${XCFRAMEWORK}"
