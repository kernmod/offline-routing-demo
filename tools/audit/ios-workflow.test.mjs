import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url).pathname;
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("public iOS workflow proves simulator builds without Apple signing secrets", () => {
  const workflow = read(".github/workflows/ios.yml");
  const verifier = read("packages/offline-router/scripts/verify-ios-simulator.sh");
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /xcode-version: 16\.4/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /git diff --exit-code -- packages\/offline-router\/nitrogen\/generated/);
  assert.match(workflow, /scripts\/build-ios-rust-xcframework\.sh/);
  assert.match(workflow, /pod install/);
  assert.match(workflow, /xcodebuild/);
  assert.match(workflow, /-workspace mobile\.xcworkspace/);
  assert.match(workflow, /-scheme mobile/);
  assert.match(workflow, /-sdk iphonesimulator/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /IOS_SIMULATOR_DEVICE_NAME: "iPhone 16 Pro"/);
  assert.match(workflow, /name=iPhone 16 Pro,OS=latest/);
  assert.match(workflow, /verify-ios-simulator\.sh/);
  assert.match(verifier, /IOS_SIMULATOR_DEVICE_NAME/);
  assert.match(verifier, /device\.name === requestedName/);
  assert.match(verifier, /xcrun simctl bootstatus/);
  assert.match(verifier, /xcrun simctl install/);
  assert.match(verifier, /--offline-routing-verification-route/);
  assert.doesNotMatch(verifier, /xcrun simctl openurl/);
  assert.match(workflow, /--offline-routing-verification-route/);
  assert.doesNotMatch(workflow, /xcrun simctl openurl/);
  assert.match(verifier, /offlineroutingdemo:\/\/route/);
  assert.match(verifier, /OfflineRoutingMapReady/);
  assert.match(verifier, /OfflineRoutingRoute/);
  assert.match(verifier, /routeSource.*local_native/);
  assert.match(verifier, /networkAttempts.*0/);
  assert.match(workflow, /offline-routing-ios-simulator-app/);
  assert.match(workflow, /Upload simulator application\n        if: success\(\)/);
  assert.match(workflow, /Upload Rust XCFramework\n        if: success\(\)/);
  assert.doesNotMatch(`${workflow}\n${verifier}`, /APPLE_|ASC_|MATCH_|FASTLANE_|PROVISION|CERTIFICATE|P12|KEYCHAIN/);
});

test("public iOS physical delivery is configured through EAS remote credentials", () => {
  const appConfig = JSON.parse(read("apps/mobile/app.json"));
  const easConfig = JSON.parse(read("apps/mobile/eas.json"));
  const mobilePackage = JSON.parse(read("apps/mobile/package.json"));
  const rootPackage = JSON.parse(read("package.json"));
  const pbxproj = read("apps/mobile/ios/mobile.xcodeproj/project.pbxproj");
  const distributionWorkflow = read(".github/workflows/ios-distribution.yml");
  const readme = read("README.md");
  const architecture = read("docs/architecture.md");
  const testing = read("docs/testing.md");
  const signedBuildEvidence = read("docs/evidence/2026-09-01T08-44-36Z-ios-eas-signed-build.md");
  const preInstall = read("scripts/ios/eas-build-pre-install.sh");
  const generatedBridge = "packages/offline-router/nitrogen/generated/ios/OfflineRouter+autolinking.rb";

  assert.equal(appConfig.expo.owner, "milo78");
  assert.match(appConfig.expo.extra.eas.projectId, /^[0-9a-f-]{36}$/);
  assert.equal(appConfig.expo.ios.bundleIdentifier, "dev.offlinerouting.demo");
  assert.match(pbxproj, /PRODUCT_BUNDLE_IDENTIFIER = dev\.offlinerouting\.demo;/);
  assert.doesNotMatch(pbxproj, /PRODUCT_BUNDLE_IDENTIFIER = org\.name\.mobile;/);
  assert.equal(appConfig.expo.ios.supportsTablet, true);

  assert.match(easConfig.cli.version, /^>= 23\./);
  assert.equal(easConfig.cli.appVersionSource, "remote");
  assert.equal(easConfig.build["ios-internal"].distribution, "internal");
  assert.equal(easConfig.build["ios-internal"].ios.credentialsSource, "remote");
  assert.equal(easConfig.build["ios-testflight"].ios.credentialsSource, "remote");
  assert.equal(easConfig.build["ios-testflight"].autoIncrement, true);
  assert.equal(
    easConfig.build["ios-internal"].env.EXPO_PUBLIC_SEGMENTS_API_URL,
    "https://offline-routing-segments.yaktrak.workers.dev"
  );
  assert.equal(
    easConfig.build["ios-testflight"].env.EXPO_PUBLIC_SEGMENTS_API_URL,
    "https://offline-routing-segments.yaktrak.workers.dev"
  );
  assert.equal(easConfig.build["ios-simulator"].extends, "ios-internal");
  assert.equal(easConfig.build["ios-simulator"].ios.simulator, true);
  assert.match(mobilePackage.scripts["build:ios-internal"], /eas build --platform ios --profile ios-internal --non-interactive/);
  assert.match(
    mobilePackage.scripts["build:ios-internal:refresh"],
    /eas build --platform ios --profile ios-internal --non-interactive --refresh-ad-hoc-provisioning-profile/
  );
  assert.match(mobilePackage.scripts["build:ios-testflight"], /eas build --platform ios --profile ios-testflight --non-interactive/);
  assert.match(mobilePackage.scripts["submit:ios-testflight"], /eas submit --platform ios --profile production --latest --non-interactive/);
  assert.equal(mobilePackage.scripts["eas-build-pre-install"], "bash ../../scripts/ios/eas-build-pre-install.sh");
  assert.match(rootPackage.devDependencies["eas-cli"], /^23\./);
  assert.match(distributionWorkflow, /workflow_dispatch/);
  assert.match(distributionWorkflow, /profile:/);
  assert.match(distributionWorkflow, /ios-internal/);
  assert.match(distributionWorkflow, /ios-testflight/);
  assert.match(distributionWorkflow, /EXPO_TOKEN/);
  assert.match(distributionWorkflow, /EXPO_ASC_API_KEY_BASE64/);
  assert.match(distributionWorkflow, /EXPO_ASC_API_KEY_PATH/);
  assert.match(distributionWorkflow, /EXPO_ASC_KEY_ID/);
  assert.match(distributionWorkflow, /EXPO_ASC_ISSUER_ID/);
  assert.match(distributionWorkflow, /App Store Connect key already managed remotely by Expo/);
  assert.match(distributionWorkflow, /if \[\[ -z "\$EXPO_ASC_API_KEY_BASE64" \]\]/);
  assert.doesNotMatch(distributionWorkflow, /test -n "\$EXPO_ASC_API_KEY_BASE64"/);
  assert.match(distributionWorkflow, /build --platform ios --profile/);
  assert.match(distributionWorkflow, /submit --platform ios --profile production --latest --non-interactive/);
  assert.match(distributionWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(distributionWorkflow, /environment: ios-distribution/);
  assert.match(distributionWorkflow, /Remove temporary App Store Connect key/);
  assert.match(
    distributionWorkflow,
    /- name: Remove temporary App Store Connect key\n        if: always\(\)\n        run: \|/,
    "cleanup commands with YAML-significant colons must use a block scalar"
  );
  const installStep = distributionWorkflow.slice(
    distributionWorkflow.indexOf("- name: Install dependencies"),
    distributionWorkflow.indexOf("- name: Prepare optional App Store Connect API key")
  );
  assert.doesNotMatch(installStep, /EXPO_TOKEN|secrets\./);
  assert.doesNotMatch(
    distributionWorkflow,
    /jobs:\n  distribute:[\s\S]*?\n    env:\n      EXPO_TOKEN:/,
    "distribution secrets must be step-scoped"
  );
  assert.doesNotMatch(distributionWorkflow, /APPLE_P8_PRIVATE_KEY|APPLE_KEY_ID|APPLE_TEAM_ID|MATCH_|FASTLANE_|KEYCHAIN|\.p12|\.mobileprovision/i);
  assert.match(preInstall, /EAS_BUILD_PLATFORM/);
  assert.match(preInstall, /aarch64-apple-ios/);
  assert.match(preInstall, /build-ios-rust-xcframework\.sh/);
  assert.doesNotMatch(preInstall, /APPLE_|ASC_|MATCH_|FASTLANE_|KEYCHAIN|\.p12|\.mobileprovision/i);
  const trackedBridge = spawnSync("git", ["ls-files", "--error-unmatch", generatedBridge], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(trackedBridge.status, 0, "EAS must receive the generated Nitro bridge before pod install");
  assert.match(read(generatedBridge), /OfflineRouter/);
  assert.match(readme, /TestFlight/);
  assert.match(readme, /ios-distribution\.yml/);
  assert.match(readme, /EXPO_TOKEN/);
  assert.match(readme, /EXPO_ASC_API_KEY_PATH|EXPO_ASC_API_KEY_BASE64/);
  assert.match(readme, /build:ios-internal:refresh/);
  assert.match(readme, /2026-09-01T08-44-36Z-ios-eas-signed-build\.md/);
  assert.doesNotMatch(readme, /still blocked by remote credential bootstrap/);
  assert.doesNotMatch(readme, /Physical iPhone installation is not part of the secret-free public scope/);
  assert.match(architecture, /ad hoc internal build/);
  assert.match(architecture, /refresh-ad-hoc-provisioning-profile/);
  assert.match(architecture, /TestFlight/);
  assert.match(testing, /ios-distribution\.yml/);
  assert.match(testing, /build:ios-internal:refresh/);
  assert.match(testing, /build:ios-testflight/);
  assert.match(testing, /submit:ios-testflight/);
  assert.match(testing, /signed ad hoc build/i);
  assert.match(signedBuildEvidence, /status: `FINISHED`/);
  assert.match(signedBuildEvidence, /distribution: `INTERNAL`/);
  assert.match(signedBuildEvidence, /bundle: `dev\.offlinerouting\.demo`/);
  assert.match(signedBuildEvidence, /architecture: `arm64`/);
  assert.match(signedBuildEvidence, /879f973bd04c950cfd794c0f7443f7a70f2a5e644d41beacb65449950cf3b325/);
  assert.match(signedBuildEvidence, /not published as a GitHub release asset/i);
  assert.doesNotMatch(
    signedBuildEvidence,
    /UDID|Serial Number|Developer Portal ID|sottilinim|SW4AV5L9WZ|00008101|2005EF/i,
    "public build evidence must not expose Apple account, certificate, profile, or device identifiers"
  );
  assert.doesNotMatch(JSON.stringify(easConfig), /APPLE_|MATCH_|FASTLANE_|P12|KEYCHAIN/i);
});
