#!/usr/bin/env bash
set -euo pipefail

demo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
abis="${ANDROID_ABIS:-arm64-v8a,x86_64}"
release_dir="${HOME}/.offline-routing-demo/releases"
release_intermediates_sourcemap_dir="$demo_root/apps/mobile/android/app/build/intermediates/sourcemaps/react/release"
release_generated_sourcemap_dir="$demo_root/apps/mobile/android/app/build/generated/sourcemaps/react/release"
release_dex_merge_dir="$demo_root/apps/mobile/android/app/build/intermediates/dex/release/mergeDexRelease"
release_rust_jni_dir="$demo_root/packages/offline-router/android/build/rustJniLibs"

clean_release_transients() {
  local generated
  for generated in \
    "$release_intermediates_sourcemap_dir" \
    "$release_generated_sourcemap_dir" \
    "$release_dex_merge_dir" \
    "$release_rust_jni_dir"; do
    if [[ -e "$generated" ]]; then
      rm -rf -- "$generated"
      echo "Removed release build transient: $generated"
    fi
  done
}

pnpm --dir "$demo_root" --filter react-native-offline-router exec nitrogen
pnpm --dir "$demo_root" --filter @offline-routing/mobile prepare:assets
"$demo_root/scripts/device/clean-generated.sh"
clean_release_transients

keystore_dir="${HOME}/.offline-routing-demo/android"
keystore="${keystore_dir}/debug.keystore"
if [[ ! -f "$keystore" ]]; then
  mkdir -p "$keystore_dir"
  keytool -genkeypair -keystore "$keystore" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null
fi

cd "$demo_root/apps/mobile/android"
NODE_ENV=production ./gradlew --no-daemon --max-workers=1 "-PreactNativeArchitectures=$abis" clean assembleRelease --rerun-tasks
apk_source="$demo_root/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
mkdir -p "$release_dir"
apk_target="$release_dir/offline-routing-demo-route-studio.apk"
cp "$apk_source" "$apk_target"
apk_name="$(basename "$apk_target")"
(cd "$release_dir" && sha256sum "$apk_name" > "$apk_name.sha256")
"$demo_root/scripts/device/clean-generated.sh"
clean_release_transients
echo "Demo APK copied to: $apk_target"
echo "SHA256 recorded in: $apk_target.sha256"
echo "It is signed with a generated demo keystore under \$HOME only; no keystore is versioned."
