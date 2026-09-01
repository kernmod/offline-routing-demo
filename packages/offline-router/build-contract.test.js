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
  assert.match(cmake, /generated-cmake/);
  assert.match(cmake, /configure_file\(\.\.\/nitrogen\/generated\/android\/OfflineRouterOnLoad\.cpp/);
  assert.match(cmake, /configure_file\(\.\.\/nitrogen\/generated\/shared\/c\+\+\/HybridOfflineRouterNativeSpec\.cpp/);
  assert.match(cmake, /IMPORTED_NO_SONAME TRUE/);
  assert.doesNotMatch(cmake, /src\/main\/jniLibs/);
  assert.match(gradle, /buildRustJniLibs/);
  assert.match(gradle, /reactNativeArchitectures/);
  assert.match(gradle, /abiFilters\.addAll\(selectedArchitectures\)/);
  assert.match(gradle, /preBuild\.dependsOn/);
  assert.match(gradle, /buildCMakeRelWithDebInfo.*dependsOn\(tasks\.named\("buildRustJniLibs"\)\)/s);
  assert.match(gradle, /configureCMakeRelWithDebInfo.*dependsOn\(tasks\.named\("buildRustJniLibs"\)\)/s);
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
  assert.match(bridge, /~RoutingBufferGuard\(\) \{ routing_buffer_free\(&buffer_\); \}/);
  assert.doesNotMatch(header, /struct RoutingCoordinate \{/);
});

test("Nitro exposes bounded multipoint routing through the owned C ABI", () => {
  const spec = read("src/specs/offline-router.nitro.ts");
  const header = read("cpp/HybridOfflineRouterNative.hpp");
  const bridge = read("cpp/HybridOfflineRouterNative.cpp");
  const cAbi = read("../../crates/cch-routing-lite-ffi/include/cch_routing_lite.h");

  assert.match(spec, /routeMany\(controls: Coordinate\[\], closedLoop: boolean\): string/);
  assert.match(header, /routeMany\(const std::vector<Coordinate>& controls, bool closedLoop\)/);
  assert.match(bridge, /routing_router_route_many/);
  assert.match(bridge, /controls\.size\(\) < 2 \|\| controls\.size\(\) > 16/);
  assert.match(bridge, /RoutingBufferGuard/);
  assert.match(cAbi, /const RoutingCoordinate \*controls_ptr/);
  assert.match(cAbi, /size_t control_count/);
  assert.match(cAbi, /bool closed_loop/);
});
