import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const mobileRoot = new URL(".", import.meta.url).pathname;
const read = (relative) => readFileSync(resolve(mobileRoot, relative), "utf8");

test("mobile is pinned to Expo 54, RN 0.81 and MapLibre RN v11", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.match(manifest.dependencies.expo, /^~54\./);
  assert.match(manifest.dependencies["react-native"], /^0\.81\./);
  assert.match(manifest.dependencies["@maplibre/maplibre-react-native"], /^\^11\./);
  assert.equal(manifest.dependencies["react-native-nitro-modules"], "0.32.1");
  assert.equal(manifest.dependencies["react-native-svg"], "15.12.1");
});

test("the screen uses MapLibre data sources and has no rectangle-map or JS routing fallback", () => {
  const source = read("App.tsx");
  const viewModel = read("src/studioViewModel.ts");
  assert.match(source, /Map as MapView/);
  assert.match(source, /<MapView/);
  assert.match(source, /GeoJSONSource/);
  assert.match(source, /<Layer/);
  assert.match(source, /data=\{routeFeature as never\}/);
  assert.match(viewModel, /FeatureCollection/);
  assert.doesNotMatch(source, /routeSegments|projectPoint|unprojectPress|createFixtureRouter|shortestPath/);
});

test("route studio exposes multipoint editing, elevation trim, draft lifecycle and confirmed v2 publication", () => {
  const screen = read("App.tsx");
  const controller = read("app.js");
  const controls = read("src/components/StudioControls.tsx");
  assert.match(screen, /control-point-source/);
  assert.match(screen, /selected-route-source/);
  assert.match(screen, /ElevationProfile/);
  assert.match(screen, /PublishConfirmation/);
  assert.match(controls, /Undo/);
  assert.match(controls, /Redo/);
  assert.match(controls, /Close loop/);
  assert.match(controls, /Move/);
  assert.match(controls, /Delete/);
  assert.match(controls, /Selection start/);
  assert.match(controls, /Selection end/);
  assert.match(controller, /buildPublishPayload/);
  assert.match(controller, /pendingPublishKey/);
  assert.match(controller, /publishStatus: "confirming"/);
  assert.match(controller, /publishStatus: "publishing"/);
  assert.match(controller, /publishStatus: "published"/);
  assert.match(controller, /publishStatus: "failed"/);
  assert.match(read("src/networkApi.ts"), /\/v2\/segments/);
  assert.match(read("src/networkApi.ts"), /idempotency-key/);
});

test("mobile elevation cut mirrors the web profile with direct handles on Android and iOS", () => {
  const screen = read("App.tsx");
  const controls = read("src/components/StudioControls.tsx");
  const viewModel = read("src/studioViewModel.ts");
  assert.match(controls, /from "react-native-svg"/);
  assert.match(controls, /<Circle[^>]+fill=\{colors\.ochre\}/);
  assert.match(controls, /<Circle[^>]+fill=\{colors\.sage\}/);
  assert.match(controls, /PanResponder\.create/);
  assert.match(controls, /onPanResponderGrant/);
  assert.match(controls, /onPanResponderMove/);
  assert.match(controls, /selectionFromProfileGesture/);
  assert.match(controls, /xToProfileDistance/);
  assert.match(controls, /startHandleResponder\.panHandlers/);
  assert.match(controls, /endHandleResponder\.panHandlers/);
  assert.match(controls, /<View\s+accessible\s+accessibilityRole="adjustable"\s+accessibilityLabel="Selection start"/);
  assert.match(controls, /<View\s+accessible\s+accessibilityRole="adjustable"\s+accessibilityLabel="Selection end"/);
  assert.match(controls, /width: 44/);
  assert.match(controls, /accessibilityLabel="Profile position"/);
  assert.match(controls, /accessibilityLabel="Selection start"/);
  assert.match(controls, /accessibilityLabel="Selection end"/);
  assert.match(controls, /accessibilityActions/);
  assert.match(controls, /onAccessibilityAction/);
  assert.match(screen, /trimPreview/);
  assert.match(screen, /onTrimPreview/);
  assert.match(screen, /onTrimCommit/);
  assert.match(screen, /getGeometryForRange/);
  assert.match(screen, /getMetricsForRange/);
  assert.doesNotMatch(screen, /trimDraft/);
  assert.match(controls, /gestureMovedRef/);
  assert.doesNotMatch(screen, /profileMode|setProfileMode/);
  assert.doesNotMatch(controls, /modeRow|onMode|Inspect profile|ProfileMode/);
  assert.doesNotMatch(viewModel, /Platform\.OS|android|ios/i);
});

test("private drafts persist only in the application document sandbox", () => {
  const source = read("src/mobileDraftStore.ts");
  assert.match(source, /documentDirectory/);
  assert.match(source, /createDraftStore/);
  assert.doesNotMatch(source, /fetch\(|https?:\/\//);
});

test("offline assets and styles contain no remote URL or CDN fallback", () => {
  const manifest = read("assets/fixture-manifest.json");
  const style = read("assets/style.json");
  const mobileStyle = JSON.parse(style);
  const fixtureStyle = JSON.parse(read("../../fixtures/sydney/style.json"));
  const metro = read("metro.config.cjs");
  assert.match(manifest, /map\.pmtiles/);
  assert.match(manifest, /routing\.pack/);
  assert.match(style, /127\.0\.0\.1/);
  assert.doesNotMatch(style.replaceAll("http://127.0.0.1", ""), /https?:\/\//i);
  assert.doesNotMatch(style, /cdn|r2|cloudflare/i);
  assert.match(metro, /assetExts\.push\('pmtiles', 'pack', 'mapstyle'\)/);
  assert.match(read("src/offlineBoot.ts"), /style\.mapstyle/);
  assert.match(manifest, /"schema_version": 2/);
  assert.match(manifest, /"pack_schema": "CCHP2"/);
  assert.match(manifest, /"elevation"/);
  assert.match(manifest, /"id": "sydney-cbd-cartography-v3"/);
  assert.match(style, /buildings-3d/);
  assert.match(style, /fill-extrusion/);
  assert.match(style, /render_height/);
  assert.match(style, /render_min_height/);
  const expectedMobileStyle = structuredClone(fixtureStyle);
  expectedMobileStyle.sources.offline = {
    ...fixtureStyle.sources.offline,
    tiles: ["http://127.0.0.1:$PORT/tiles/{z}/{x}/{y}.pbf"],
    minzoom: fixtureStyle.sources.offline.minzoom ?? 13,
    maxzoom: fixtureStyle.sources.offline.maxzoom ?? 16
  };
  delete expectedMobileStyle.sources.offline.url;
  assert.deepEqual(mobileStyle, expectedMobileStyle);
  const preparation = read("scripts/prepareAssets.mjs");
  assert.match(preparation, /resolve\(root, "fixtures\/sydney"\)/);
  assert.match(preparation, /resolve\(fixture, "manifest\.json"\)/);
  assert.match(preparation, /resolve\(fixture, "routing\.pack"\)/);
  assert.match(preparation, /resolve\(fixture, "map\.pmtiles"\)/);
  assert.match(preparation, /readFile\(resolve\(fixture, "style\.json"\)/);
  assert.match(preparation, /publicStyle\.sources\.offline/);
  assert.match(preparation, /delete publicStyle\.sources\.offline\.url/);
  assert.match(preparation, /127\.0\.0\.1:\$PORT/);
  assert.doesNotMatch(preparation, /copyFile\(resolve\(assets, "style\.json"/);
});

test("mobile map exposes a local 2D/3D cartography mode", () => {
  const source = read("App.tsx");
  assert.match(source, /mapMode/);
  assert.match(source, /setMapMode/);
  assert.match(source, /pitch:\s*mapMode === "3d"/);
  assert.match(source, /bearing:\s*mapMode === "3d"/);
  assert.match(source, /Switch map to 2D|Switch map to 3D/);
  assert.match(source, /androidView="texture"/);
});

test("mobile route overlays use a high-contrast layer stack over 3D buildings", () => {
  const source = read("App.tsx");
  assert.match(source, /id="route-shadow-line"/);
  assert.match(source, /id="route-casing-line"/);
  assert.match(source, /id="route-line"/);
  assert.match(source, /id="selected-route-shadow-line"/);
  assert.match(source, /id="selected-route-casing-line"/);
  assert.match(source, /id="selected-route-line"/);
  assert.match(source, /id="control-point-halo"/);
  assert.match(source, /id="profile-cursor-halo"/);
  assert.ok(source.indexOf('id="route-shadow-line"') < source.indexOf('id="route-casing-line"'));
  assert.ok(source.indexOf('id="route-casing-line"') < source.indexOf('id="route-line"'));
  assert.ok(source.indexOf('id="selected-route-shadow-line"') < source.indexOf('id="selected-route-casing-line"'));
  assert.ok(source.indexOf('id="selected-route-casing-line"') < source.indexOf('id="selected-route-line"'));
  assert.match(source, /"line-color": "#111611"/);
  assert.match(source, /"line-color": "#f7ead0"/);
  assert.match(source, /"line-color": "#f2b36f"/);
  assert.match(source, /"line-color": "#c4663a"/);
  assert.match(source, /"line-blur": 1/);
  assert.match(source, /"line-width": 16/);
  assert.match(source, /"line-width": 13/);
  assert.match(source, /"line-width": 12/);
  assert.match(source, /"line-width": 10/);
  assert.match(source, /"line-width": 6/);
  assert.match(source, /"circle-radius": 11/);
  assert.match(source, /"circle-radius": 8/);
  assert.match(source, /"circle-radius": 5/);
});

test("network capability is quarantined behind the explicit publish and refresh actions", () => {
  const source = read("src/networkApi.ts");
  assert.match(source, /export async function publishSegment/);
  assert.match(source, /export async function listSegments/);
  assert.match(source, /networkDisabled/);
  assert.doesNotMatch(read("src/offlineBoot.ts"), /fetch\(/);
});

test("the native package exposes only router and local tile-server operations", () => {
  const source = read("../../packages/offline-router/src/specs/offline-router.nitro.ts");
  assert.match(source, /loadPack/);
  assert.match(source, /route/);
  assert.match(source, /benchmark/);
  assert.match(source, /startTileServer/);
  assert.doesNotMatch(source, /sensor|location|account|wallet|motion/i);
});

test("the native package exposes the same routing-only Nitro surface on iOS", () => {
  const podspec = read("../../packages/offline-router/OfflineRouter.podspec");
  const buildContract = read("../../packages/offline-router/build-contract.test.js");
  const infoPlist = read("ios/mobile/Info.plist");
  const appDelegate = read("ios/mobile/AppDelegate.swift");
  const podfile = read("ios/Podfile");
  const appConfig = JSON.parse(read("app.json"));
  assert.match(podspec, /ios\/OfflineRouterCore\.xcframework/);
  assert.match(podspec, /OfflineRouter\+autolinking\.rb/);
  assert.match(podspec, /-x objective-c\+\+/);
  assert.match(podspec, /Check OfflineRouterCore\.xcframework/);
  assert.match(buildContract, /build-ios-rust-xcframework\.sh/);
  assert.match(infoPlist, /CFBundleURLTypes/);
  assert.match(infoPlist, /offlineroutingdemo/);
  assert.match(infoPlist, /NSAllowsLocalNetworking/);
  assert.match(appDelegate, /^import Expo$/m);
  assert.doesNotMatch(appDelegate, /^internal import Expo$/m);
  assert.match(appDelegate, /bindReactNativeFactory\(factory\)/);
  assert.ok(appDelegate.indexOf("bindReactNativeFactory(factory)") < appDelegate.indexOf("factory.startReactNative("));
  assert.match(appDelegate, /#if targetEnvironment\(simulator\)/);
  assert.match(appDelegate, /--offline-routing-verification-route/);
  assert.match(appDelegate, /initialProperties: verificationInitialProperties\(\)/);
  assert.match(appDelegate, /let result = RCTLinkingManager\.application\(app, open: url, options: options\)/);
  assert.doesNotMatch(appDelegate, /return super\.application\(app, open: url, options: options\) \|\| RCTLinkingManager/);
  assert.match(podfile, /\$MLRN\.post_install\(installer\)/);
  assert.ok(appConfig.expo.plugins.includes("@maplibre/maplibre-react-native"));
});

test("the iOS simulator verifier injects its deterministic route without a system URL dialog", () => {
  const verifier = read("../../packages/offline-router/scripts/verify-ios-simulator.sh");
  const app = read("App.tsx");
  assert.match(verifier, /--offline-routing-verification-route/);
  assert.doesNotMatch(verifier, /simctl openurl/);
  assert.match(app, /verificationRouteUrl\?: string/);
  assert.match(app, /handleDeepLink\(verificationRouteUrl/);
});

test("no JavaScript graph or shortest-path implementation is shipped beside the native bridge", () => {
  const files = [read("App.tsx"), read("app.js"), read("../../packages/offline-router/index.js"), read("../../packages/offline-router/src/index.ts")].join("\n");
  assert.doesNotMatch(files, /dijkstra|a\*|shortestPath|createFixtureRouter|adjacency|graph\.json/i);
});

test("release signing uses a generated home debug keystore rather than a repo-local secret artifact", () => {
  const source = read("android/app/build.gradle");
  const buildScript = read("../../scripts/build-apk.sh");
  const cleanScript = read("../../scripts/device/clean-generated.sh");
  const prepareCxx = read("../../scripts/device/prepare-cxx-dirs.mjs");
  assert.match(source, /System\.getProperty\('user\.home'\)/);
  assert.match(source, /ensureDemoDebugKeystore/);
  assert.doesNotMatch(source, /storeFile file\('debug\.keystore'\)/);
  assert.match(buildScript, /scripts\/device\/clean-generated\.sh/);
  assert.match(buildScript, /node22_bin=/);
  assert.match(buildScript, /gradlew[\s\S]*clean/);
  assert.match(buildScript, /configureCMakeRelWithDebInfo\[arm64-v8a\]/);
  assert.match(buildScript, /configureCMakeRelWithDebInfo\[x86_64\]/);
  assert.match(buildScript, /scripts\/device\/prepare-cxx-dirs\.mjs/);
  assert.match(buildScript, /gradlew[\s\S]*assembleRelease --rerun-tasks/);
  assert.match(buildScript, /PATH=\"\$node22_bin:\$PATH\" NODE_ENV=production/);
  assert.match(buildScript, /assembleRelease --rerun-tasks/);
  assert.match(buildScript, /--max-workers=1/);
  assert.doesNotMatch(cleanScript, /apps\/mobile\/android\/build/);
  assert.doesNotMatch(cleanScript, /apps\/mobile\/android\/app\/build/);
  assert.doesNotMatch(cleanScript, /apps\/mobile\/android\/\.gradle/);
  assert.match(cleanScript, /packages\/offline-router\/android\/\.cxx/);
  assert.doesNotMatch(cleanScript, /packages\/offline-router\/android\/build/);
  assert.match(cleanScript, /apps\/mobile\/android\/app\/debug\.keystore/);
  assert.match(cleanScript, /\[\[ \"\$#\" -ne 0 \]\]/);
  assert.match(cleanScript, /usage: clean-generated\.sh/);
  assert.doesNotMatch(cleanScript, /generated_targets=\(\"\$@\"\)/);
  assert.match(prepareCxx, /usage: prepare-cxx-dirs\.mjs/);
  assert.match(prepareCxx, /-o/);
  assert.match(prepareCxx, /-MF/);
});

test("android release build disables lintVital so the public demo APK does not depend on transitive lint metadata", () => {
  const source = read("android/app/build.gradle");
  assert.match(source, /lint\s*\{/);
  assert.match(source, /checkReleaseBuilds false/);
});

test("android CMake tasks wait for generated autolinking headers before compiling native app glue", () => {
  const appGradle = read("android/app/build.gradle");
  const nativeGradle = read("../../packages/offline-router/android/build.gradle");
  const rootGradle = read("android/build.gradle");
  assert.match(appGradle, /generateAutolinkingNewArchitectureFiles/);
  assert.match(appGradle, /generateAutolinkingPackageList/);
  assert.match(nativeGradle, /buildCMakeRelWithDebInfo/);
  assert.match(nativeGradle, /configureCMakeRelWithDebInfo/);
  assert.match(appGradle, /generateAutolinkingPackageList/);
  assert.match(rootGradle, /buildCMake|configureCMake/);
  assert.match(rootGradle, /NativeLibs/);
  assert.doesNotMatch(rootGradle, /compileReleaseKotlin/);
  assert.match(rootGradle, /doNotTrackState/);
});

test("the release APK packages every Rust JNI dependency used by the Nitro bridge", () => {
  const nativeGradle = read("../../packages/offline-router/android/build.gradle");
  const nativePackage = read("../../packages/offline-router/android/src/main/java/com/offlinerouter/OfflineRouterPackage.kt");
  assert.match(nativeGradle, /jniLibs\.srcDirs\(rustLibOutputDir\)/);
  assert.match(nativePackage, /System\.loadLibrary\("cch_routing_lite_ffi"\)/);
  assert.match(nativePackage, /System\.loadLibrary\("tile_server_lite"\)/);
});

test("android release targets only the ABIs that the public native bridge builds", () => {
  const source = read("android/gradle.properties");
  assert.match(source, /^reactNativeArchitectures=arm64-v8a,x86_64$/m);
  assert.match(source, /^hermesEnabled=true$/m);
  assert.match(source, /^org\.gradle\.parallel=false$/m);
  assert.match(source, /^kotlin\.incremental=false$/m);
  assert.match(source, /^kotlin\.compiler\.execution\.strategy=in-process$/m);
});

test("android config blocks legacy storage permissions while keeping network access explicit", () => {
  const manifest = JSON.parse(read("app.json"));
  assert.equal(manifest.expo.scheme, "offlineroutingdemo");
  assert.deepEqual(manifest.expo.android.intentFilters, [
    {
      action: "VIEW",
      category: ["BROWSABLE", "DEFAULT"],
      data: [{ scheme: "offlineroutingdemo" }]
    }
  ]);
  assert.deepEqual(manifest.expo.android.blockedPermissions, [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE"
  ]);
  const androidManifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(androidManifest, /ACCESS_COARSE_LOCATION\" tools:node=\"remove\"/);
  assert.match(androidManifest, /ACCESS_FINE_LOCATION\" tools:node=\"remove\"/);
  assert.match(androidManifest, /android\.intent\.action\.VIEW/);
  assert.match(androidManifest, /android\.intent\.category\.DEFAULT/);
  assert.match(androidManifest, /android\.intent\.category\.BROWSABLE/);
  assert.match(androidManifest, /android:scheme="offlineroutingdemo"/);
  const networkSecurity = read("android/app/src/main/res/xml/network_security_config.xml");
  assert.match(androidManifest, /networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(networkSecurity, /cleartextTrafficPermitted="false"/);
  assert.match(networkSecurity, /cleartextTrafficPermitted="true"/);
  assert.match(networkSecurity, /127\.0\.0\.1/);
  assert.match(networkSecurity, />localhost</);
});

test("benchmark and route evidence stay observable through public app logs", () => {
  const source = read("App.tsx");
  const boot = read("src/offlineBoot.ts");
  const bench = read("src/benchmarkLink.ts");
  const benchmarkScript = read("../../scripts/device/benchmark.sh");
  const smokeScript = read("../../scripts/device/smoke-route.sh");
  assert.match(source, /Linking\.getInitialURL/);
  assert.match(source, /Linking\.addEventListener\("url"/);
  assert.match(source, /OfflineRoutingBenchmark/);
  assert.match(source, /OfflineRoutingRoute/);
  assert.match(source, /OfflineRoutingMapReady/);
  assert.match(boot, /OfflineRoutingBootReady/);
  assert.match(bench, /offlineroutingdemo:\/\/benchmark/);
  assert.match(benchmarkScript, /dev\.offlinerouting\.demo\/\.MainActivity/);
  assert.match(smokeScript, /dev\.offlinerouting\.demo\/\.MainActivity/);
});

test("the release-device gate executes Android startup, back handling, route, and permission checks", () => {
  const script = read("../../scripts/device/verify-release.sh");
  assert.match(script, /aapt.*dump permissions/);
  assert.match(script, /ACCESS_FINE_LOCATION/);
  assert.match(script, /KEYCODE_BACK/);
  assert.match(script, /OfflineRoutingMapReady/);
  assert.match(script, /OfflineRoutingRoute/);
});

test("release evidence records the APK digest without a builder filesystem path", () => {
  const script = read("../../scripts/device/verify-release.sh");

  assert.match(script, /apk_sha256="\$\(sha256sum "\$apk" \| awk '\{print \$1\}'\)"/);
  assert.match(script, /echo "apk_sha256=\$apk_sha256"/);
  assert.doesNotMatch(script, /^\s*sha256sum "\$apk"$/m);
});
