import assert from "node:assert/strict";
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
  assert.match(workflow, /scripts\/build-ios-rust-xcframework\.sh/);
  assert.match(workflow, /pod install/);
  assert.match(workflow, /xcodebuild/);
  assert.match(workflow, /-workspace mobile\.xcworkspace/);
  assert.match(workflow, /-scheme mobile/);
  assert.match(workflow, /-sdk iphonesimulator/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /verify-ios-simulator\.sh/);
  assert.match(verifier, /xcrun simctl bootstatus/);
  assert.match(verifier, /xcrun simctl install/);
  assert.match(verifier, /xcrun simctl openurl/);
  assert.match(verifier, /offlineroutingdemo:\/\/route/);
  assert.match(verifier, /OfflineRoutingMapReady/);
  assert.match(verifier, /OfflineRoutingRoute/);
  assert.match(verifier, /routeSource.*local_native/);
  assert.match(verifier, /networkAttempts.*0/);
  assert.match(workflow, /offline-routing-ios-simulator-app/);
  assert.doesNotMatch(`${workflow}\n${verifier}`, /APPLE_|ASC_|MATCH_|FASTLANE_|PROVISION|CERTIFICATE|P12|KEYCHAIN/);
});
