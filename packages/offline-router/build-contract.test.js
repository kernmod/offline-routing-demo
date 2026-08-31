import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const packageRoot = new URL(".", import.meta.url).pathname;
const read = (relative) => readFileSync(resolve(packageRoot, relative), "utf8");

test("android packaging builds Rust shared objects into a generated build directory", () => {
  const cmake = read("android/CMakeLists.txt");
  const gradle = read("android/build.gradle");
  const appGradle = read("../../apps/mobile/android/app/build.gradle");
  const rootAndroidGradle = read("../../apps/mobile/android/build.gradle");
  const buildScript = read("../../scripts/build-apk.sh");
  const kotlin = read("android/src/main/java/com/offlinerouter/OfflineRouterPackage.kt");

  assert.match(cmake, /build\/rustJniLibs\/\$\{ANDROID_ABI\}/);
  assert.match(cmake, /IMPORTED_NO_SONAME TRUE/);
  assert.doesNotMatch(cmake, /src\/main\/jniLibs/);
  assert.match(gradle, /buildRustJniLibs/);
  assert.match(gradle, /reactNativeArchitectures/);
  assert.match(gradle, /abiFilters\.addAll\(selectedArchitectures\)/);
  assert.match(gradle, /preBuild\.dependsOn/);
  assert.match(appGradle, /intermediates\/sourcemaps\/react\/release/);
  assert.match(appGradle, /generated\/sourcemaps\/react\/release/);
  assert.match(appGradle, /intermediates\/dex\/release\/mergeDexRelease/);
  assert.match(rootAndroidGradle, /doNotTrackState/);
  assert.match(rootAndroidGradle, /endsWith\("NativeLibs"\)/);
  assert.match(rootAndroidGradle, /buildCMake|CmakeBuildTask/);
  assert.match(gradle, /\.\.\/\.\.\/Cargo\.toml/);
  assert.doesNotMatch(gradle, /file\("\.\.\/\.\.\/Cargo\.toml"\)/);
  assert.match(buildScript, /ANDROID_ABIS:-arm64-v8a,x86_64/);
  assert.match(buildScript, /clean-generated\.sh/);
  assert.match(buildScript, /\.offline-routing-demo\/releases/);
  assert.match(buildScript, /generated\/sourcemaps\/react\/release/);
  assert.match(buildScript, /intermediates\/sourcemaps\/react\/release/);
  assert.match(buildScript, /intermediates\/dex\/release\/mergeDexRelease/);
  assert.match(appGradle, /buildCMakeRelWithDebInfo/);
  assert.match(appGradle, /generateAutolinkingNewArchitectureFiles/);
  assert.match(buildScript, /NODE_ENV=production/);
  assert.ok(buildScript.indexOf("exec nitrogen") < buildScript.indexOf("./gradlew"));
  assert.match(kotlin, /System\.loadLibrary\("cch_routing_lite_ffi"\)/);
  assert.match(kotlin, /System\.loadLibrary\("tile_server_lite"\)/);
  assert.match(kotlin, /OfflineRouterOnLoad\.initializeNative\(\)/);
});

test("the C++ bridge consumes the checked C ABI and frees failure buffers", () => {
  const header = read("cpp/routing_ffi.h");
  const bridge = read("cpp/HybridOfflineRouterNative.cpp");

  assert.match(header, /cch-routing-lite-ffi\/include\/cch_routing_lite\.h/);
  assert.match(bridge, /if \(buffer\.ptr != nullptr\) routing_buffer_free\(&buffer\);/);
  assert.doesNotMatch(header, /struct RoutingCoordinate \{/);
});
