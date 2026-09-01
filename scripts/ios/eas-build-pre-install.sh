#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace_root="$(cd "${script_dir}/../.." && pwd)"
platform="${EAS_BUILD_PLATFORM:-}"

if [[ -z "${platform}" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    platform="ios"
  else
    platform="other"
  fi
fi

if [[ "${platform}" != "ios" ]]; then
  printf 'EAS pre-install: platform %s does not need the Apple Rust build.\n' "${platform}"
  exit 0
fi

export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-16.4}"

if ! command -v cargo >/dev/null 2>&1; then
  printf 'EAS pre-install: installing Rust with the official rustup bootstrap.\n'
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
    --retry 5 --retry-delay 3 --retry-all-errors \
    https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal
fi

if [[ -f "${HOME}/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.cargo/env"
fi
export PATH="${HOME}/.cargo/bin:${PATH}"

command -v rustup >/dev/null 2>&1 || {
  printf 'error: rustup is required for the Apple targets.\n' >&2
  exit 69
}

rustup toolchain install 1.94.1 --profile minimal
rustup target add \
  --toolchain 1.94.1 \
  aarch64-apple-ios \
  aarch64-apple-ios-sim \
  x86_64-apple-ios
rustup component add --toolchain 1.94.1 llvm-tools-preview

for required in \
  "${workspace_root}/apps/mobile/assets/routing.pack" \
  "${workspace_root}/apps/mobile/assets/tiles.pmtiles" \
  "${workspace_root}/packages/offline-router/nitrogen/generated/ios/OfflineRouter+autolinking.rb"; do
  [[ -f "${required}" ]] || {
    printf 'error: required public iOS input is missing: %s\n' "${required}" >&2
    exit 1
  }
done

exec "${workspace_root}/packages/offline-router/scripts/build-ios-rust-xcframework.sh"
