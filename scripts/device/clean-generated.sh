#!/usr/bin/env bash
set -euo pipefail

demo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$#" -ne 0 ]]; then
  echo "usage: clean-generated.sh" >&2
  exit 2
fi

generated_targets=(
  "$demo_root/apps/mobile/android/app/.cxx"
  "$demo_root/packages/offline-router/android/.cxx"
  "$demo_root/apps/mobile/android/app/debug.keystore"
)

for generated in "${generated_targets[@]}"; do
  if [[ -e "$generated" ]]; then
    rm -rf -- "$generated" || {
      sleep 1
      rm -rf -- "$generated"
    }
    echo "Removed generated output: $generated"
  fi
done
