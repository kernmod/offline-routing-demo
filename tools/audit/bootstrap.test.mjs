import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("bootstrap contract requires CI, testing guide, and public docs", () => {
  const required = [
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    "docs/testing.md",
    "docs/architecture.md",
    "docs/security/public-boundary.md",
    "README.md",
    "Makefile",
    "NOTICE.md"
  ];

  for (const path of required) {
    assert.equal(existsSync(resolve(root, path)), true, `missing ${path}`);
  }
});

test("README describes the recruiter-facing problem and commands", () => {
  const readme = read("README.md");
  assert.match(readme, /^# Offline Routing Demo/m);
  assert.match(readme, /^## Try the complete flow/m);
  assert.match(readme, /^## What this demonstrates/m);
  assert.match(readme, /^## Workspace/m);
  assert.match(readme, /^## Reproduce it/m);
  assert.match(readme, /https:\/\/kernmod\.github\.io\/offline-routing-demo\//);
  assert.match(readme, /https:\/\/offline-routing-segments\.yaktrak\.workers\.dev/);
  assert.match(readme, /releases\/latest\/download\/offline-routing-demo-route-studio\.apk/);
  assert.match(readme, /pnpm verify:live-api --url https:\/\/<worker-origin>/);
  assert.doesNotMatch(readme, /pending (?:GitHub Release|public URL|Worker URL)/i);
  assert.equal(existsSync(resolve(root, "docs/evidence/2026-08-31T20-01-00Z-live-viewer.png")), true);
  assert.equal(existsSync(resolve(root, "docs/evidence/2026-08-31T20-10-00Z-mobile-live.png")), true);
});

test("API documentation matches the published v2 record and query columns", () => {
  const api = read("docs/api-explain.md");

  for (const field of [
    "publicationState",
    "elevationsM",
    "elevationGainM",
    "elevationLossM",
    "metricsVersion"
  ]) {
    assert.match(api, new RegExp(`"${field}"`), `missing documented v2 field ${field}`);
  }
  assert.match(api, /s\.publication_state/);
  assert.match(api, /s\.elevation_gain_m/);
  assert.match(api, /s\.elevation_loss_m/);
  assert.match(api, /s\.metrics_version/);
  assert.doesNotMatch(api, /"status"\s*:|"ascentM"\s*:|"descentM"\s*:/);
  assert.doesNotMatch(api, /s\.status\b|s\.ascent_m\b|s\.descent_m\b/);
});

test("the Android release artifact is named for Route Studio rather than a stale pack revision", () => {
  const buildScript = read("scripts/build-apk.sh");
  const readme = read("README.md");
  const releaseEvidence = read("docs/evidence/2026-09-01T03-59-40Z-release-device.txt");
  const visibilityEvidence = read("docs/evidence/2026-09-01T06-23-00Z-release-device.txt");
  const multipointEvidence = read("docs/evidence/2026-09-01T01-51-18Z-release-multipoint-airplane.txt");

  assert.match(buildScript, /offline-routing-demo-route-studio\.apk/);
  assert.doesNotMatch(buildScript, /cchp1/i);
  assert.match(readme, /v0\.3\.0/);
  assert.match(readme, /d4a4e6b1f10f74c0a63f614e1c5d57400e9b7037c9ab6b4bfdb443d2e36d6b1a/);
  assert.match(releaseEvidence, /release=v0\.3\.0/);
  assert.match(releaseEvidence, /airplane_mode=1/);
  assert.match(releaseEvidence, /route=local_native/);
  assert.match(releaseEvidence, /apk_sha256=d4a4e6b1f10f74c0a63f614e1c5d57400e9b7037c9ab6b4bfdb443d2e36d6b1a/);
  assert.match(readme, /2026-09-01T06-23-00Z-release-device\.txt/);
  assert.match(visibilityEvidence, /release=v0\.4\.0/);
  assert.match(visibilityEvidence, /airplane_mode=1/);
  assert.match(visibilityEvidence, /route=local_native/);
  assert.match(visibilityEvidence, /apk_sha256=bed72cc37e2dfc84f2d6920e66f33731be234f616ed93c6c49c60072e0186bcc/);
  assert.match(multipointEvidence, /control_points=3/);
  assert.match(multipointEvidence, /network_attempts=0/);
  assert.match(multipointEvidence, /redo_enabled_after_undo=pass/);
  assert.match(multipointEvidence, /apk_sha256=ad121007ab699974609103faf5ec3fd37192b9347da464cb5ec8c8eec3f9661f/);
});

test("the Android release checksum is portable outside the builder filesystem", () => {
  const buildScript = read("scripts/build-apk.sh");

  assert.match(buildScript, /apk_name="\$\(basename "\$apk_target"\)"/);
  assert.match(buildScript, /\(cd "\$release_dir" && sha256sum "\$apk_name" > "\$apk_name\.sha256"\)/);
  assert.doesNotMatch(buildScript, /sha256sum "\$apk_target" >/);
});

test("public evidence omits builder home paths", () => {
  const evidenceDir = resolve(root, "docs/evidence");
  const evidenceFiles = readdirSync(evidenceDir, { recursive: true })
    .filter((name) => /\.(?:md|txt)$/i.test(name));

  for (const name of evidenceFiles) {
    const evidence = readFileSync(resolve(evidenceDir, name), "utf8");
    assert.doesNotMatch(evidence, /\/(?:root|home)\//);
    assert.doesNotMatch(evidence, /(?:localhost|127\.0\.0\.1):\d+/);
  }
});

test("testing guide documents TDD and coverage thresholds", () => {
  const testing = read("docs/testing.md");
  assert.match(testing, /TDD/i);
  assert.match(testing, /80%/i);
  assert.match(testing, /95%/i);
  assert.match(testing, /branches/i);
  assert.match(testing, /property/i);
  assert.match(testing, /integration/i);
  assert.match(testing, /end-to-end|E2E/i);
  assert.match(testing, /device/i);
  assert.match(testing, /no \.skip|no \#\[ignore\]/i);
});

test("CI executes public audit, tests, coverage, and secret scanning", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /audit:public/);
  assert.match(ci, /test:coverage/);
  assert.match(ci, /test:policy/);
  assert.match(ci, /cargo install cargo-llvm-cov --locked --version 0\.9\.0/);
  assert.match(ci, /gitleaks/i);
  assert.match(ci, /GITHUB_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(ci, /clippy/);
});

test("CI pins every GitHub Action to an immutable commit", () => {
  const ci = read(".github/workflows/ci.yml");
  const actions = [...ci.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((match) => match[1]);

  assert.ok(actions.length > 0);
  for (const action of actions) {
    assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/);
  }
});

test("CI fetches complete history for the gitleaks push range", () => {
  const ci = read(".github/workflows/ci.yml");
  const checkoutStart = ci.indexOf("- uses: actions/checkout@");
  const checkoutEnd = ci.indexOf("\n      - ", checkoutStart + 1);
  const checkoutStep = ci.slice(checkoutStart, checkoutEnd);

  assert.notEqual(checkoutStart, -1);
  assert.match(checkoutStep, /fetch-depth:\s*0/);
  assert.ok(checkoutStart < ci.indexOf("gitleaks/gitleaks-action@"));
});

test("coverage is mandatory and CI preserves both JS and Rust LCOV evidence", () => {
  const manifestText = read("package.json");
  const manifest = JSON.parse(manifestText);
  const ci = read(".github/workflows/ci.yml");
  const makefile = read("Makefile");

  assert.doesNotMatch(manifestText, /--if-present/);
  assert.match(manifest.scripts["coverage:root"], /--all/);
  assert.match(manifest.scripts["coverage:root"], /tools\/audit/);
  assert.match(manifest.scripts["coverage:root"], /tools\/fixtures/);
  assert.match(manifest.scripts["test:coverage"], /coverage:assert/);
  assert.match(ci, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(ci, /coverage\/js/);
  assert.match(ci, /coverage\/rust\.lcov/);
  assert.match(ci, /if:\s*always\(\)/);
  assert.match(makefile, /--output-path coverage\/rust\.lcov/);
  assert.match(makefile, /pnpm test:coverage/);
});

test("the same focused-test policy is enforced locally and in CI", () => {
  const manifest = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");
  const makefile = read("Makefile");

  assert.equal(manifest.scripts["test:policy"], "node tools/audit/test-policy.mjs");
  assert.match(manifest.scripts.test, /test:policy/);
  assert.match(ci, /pnpm test:policy/);
  assert.match(makefile, /test:policy/);
});

test("every JavaScript workspace has mandatory test and coverage scripts", () => {
  for (const workspaceRoot of ["apps", "packages"]) {
    for (const entry of readdirSync(resolve(root, workspaceRoot), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = resolve(root, workspaceRoot, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      assert.equal(typeof manifest.scripts?.test, "string", `${manifest.name} has no test script`);
      assert.equal(
        typeof manifest.scripts?.["test:coverage"],
        "string",
        `${manifest.name} has no test:coverage script`
      );
      assert.doesNotMatch(manifest.scripts["test:coverage"], /--if-present/);
    }
  }
});

test("viewer coverage bootstraps its isolated reports directory after cleanup", () => {
  const viewer = JSON.parse(read("apps/viewer/package.json"));
  const config = read("apps/viewer/vitest.config.ts");
  assert.match(viewer.scripts["test:coverage"], /mkdir -p \.cache\/coverage(?:\/\.tmp)?/);
  assert.match(viewer.scripts["test:coverage"], /vitest run --coverage/);
  assert.match(config, /fileParallelism:\s*false/);
});

test("mobile build and lint execute a real static type gate", () => {
  const mobile = JSON.parse(read("apps/mobile/package.json"));
  assert.match(mobile.scripts.build, /tsc\s+--noEmit/);
  assert.match(mobile.scripts.lint, /tsc\s+--noEmit/);
  assert.doesNotMatch(`${mobile.scripts.build}\n${mobile.scripts.lint}`, /pending/i);
});

test("the repository and CI use Node 22 required by the pinned Wrangler", () => {
  const manifest = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");
  assert.match(manifest.engines?.node ?? "", /^>=22/);
  assert.match(read(".node-version").trim(), /^22\./);
  assert.match(ci, /node-version:\s*22\.23\.2/);
});

test("GitHub Pages deploys the viewer safely under the repository sub-path", () => {
  const pages = read(".github/workflows/pages.yml");
  const viewerReadme = read("apps/viewer/README.md");
  const buildJob = pages.slice(pages.indexOf("  build:"), pages.indexOf("\n  deploy:"));
  const deployJob = pages.slice(pages.indexOf("\n  deploy:"));

  assert.match(pages, /branches:\s*\[main\]/);
  assert.doesNotMatch(pages, /pull_request/);
  assert.match(pages, /version:\s*10\.24\.0/);
  assert.match(pages, /node-version:\s*22\.23\.2/);
  assert.match(pages, /pnpm install --frozen-lockfile/);
  assert.match(pages, /VITE_VIEWER_BASE:\s*\/offline-routing-demo\//);
  assert.match(pages, /SEGMENTS_API_URL:\s*\$\{\{ vars\.SEGMENTS_API_URL \}\}/);
  assert.match(pages, /VITE_API_BASE_URL:\s*\$\{\{ vars\.SEGMENTS_API_URL \}\}/);
  assert.equal((pages.match(/VITE_API_BASE_URL:/g) ?? []).length, 1);
  assert.doesNotMatch(pages, /secrets\./);
  assert.doesNotMatch(pages, /inputs:/);
  assert.match(pages, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(pages, /pnpm\/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa/);
  assert.match(pages, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(pages, /actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9/);
  assert.match(pages, /actions\/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d/);
  assert.doesNotMatch(pages, /enablement:/);
  assert.match(viewerReadme, /one-time repository-administrator step[\s\S]*build_type=workflow/i);
  assert.match(pages, /actions\/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128/);
  assert.match(pages, /path:\s*apps\/viewer\/dist/);
  assert.match(buildJob, /\n    permissions:\n      contents: read\n    steps:/);
  assert.match(
    deployJob,
    /\n    permissions:\n      pages: write\n      id-token: write\n    environment:/
  );
});

test("public audit is non-mutating and runs every publication check", () => {
  const manifest = JSON.parse(read("package.json"));
  const command = manifest.scripts["audit:public"];
  assert.doesNotMatch(command, /clean-generated\.sh/);
  assert.match(command, /audit:structure/);
  assert.match(command, /audit:licenses/);
  assert.match(command, /audit:denylist/);
  assert.match(command, /audit:dependencies/);
});

test("live API verification is explicit and stays outside the offline local gate", () => {
  const manifest = JSON.parse(read("package.json"));
  const makefile = read("Makefile");
  const readme = read("README.md");
  const testing = read("docs/testing.md");

  assert.equal(manifest.scripts["verify:live-api"], "node tools/live/verify-api.mjs");
  assert.match(manifest.scripts["test:root"], /tools\/live\/\*\.test\.mjs/);
  assert.match(manifest.scripts["coverage:root"], /tools\/live\/verify-api-lib\.mjs/);
  assert.match(
    makefile,
    /^verify-live-api:\n\t(?:pnpm verify:live-api|\$\(NODE22\) "pnpm verify:live-api")$/m
  );
  assert.match(readme, /pnpm verify:live-api --url https:\/\/<worker-origin>/);
  assert.match(testing, /pnpm verify:live-api --url https:\/\/your-worker\.workers\.dev/);
  assert.doesNotMatch(`${readme}\n${testing}`, /verify:live-api -- --url/);
  const localGate = makefile.match(/^verify-local:[^\n]+/m)?.[0] ?? "";
  assert.doesNotMatch(localGate, /verify-live-api/);
});

test("architecture and public boundary stay honest about live delivery status", () => {
  const architecture = read("docs/architecture.md");
  const boundary = read("docs/security/public-boundary.md");
  const readiness = read("docs/security/public-readiness.md");
  const deliveryStatus = `${architecture}\n${readiness}`;
  assert.match(architecture, /public production URLs now serve the `v1\.1` contract[\s\S]*deployed `main` baseline/i);
  assert.match(readiness, /public live[\s\S]*verification is closed[\s\S]*deployed `main` baseline/i);
  assert.match(readiness, /LIVE_API_OK health=200 publish=201 replay=200 conflict=409 nearby=200/);
  assert.doesNotMatch(deliveryStatus, /still need a redeploy|verification is pending/i);
  assert.match(architecture, /Nitro bridge.*Rust CCH/i);
  assert.match(architecture, /PMTiles/i);
  assert.match(boundary, /clean history/i);
  assert.match(boundary, /remote/i);
  assert.match(boundary, /secret/i);
});
