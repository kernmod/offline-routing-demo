import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const adrPath = resolve(root, "docs/adr/0007-route-studio.md");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("Route Studio has an accepted decision with explicit boundaries", () => {
  assert.equal(existsSync(adrPath), true, "missing docs/adr/0007-route-studio.md");
  const adr = read("docs/adr/0007-route-studio.md");
  assert.match(adr, /^# ADR 0007: Route Studio/m);
  assert.match(adr, /^- Status: accepted/m);
  for (const section of [
    "Context",
    "Decision",
    "Shared domain",
    "Draft lifecycle",
    "Browser routing boundary",
    "Public elevation data",
    "Testing contract",
    "Consequences",
  ]) {
    assert.match(adr, new RegExp(`^## ${section}$`, "m"), `missing ${section} section`);
  }
});

test("one shared editor domain owns drafts and emits the immutable publish boundary", () => {
  const adr = read("docs/adr/0007-route-studio.md");
  assert.match(adr, /packages\/route-studio/);
  assert.match(adr, /RouteDraft/);
  assert.match(adr, /published API record|published records/i);
  assert.match(adr, /schemaVersion/);
  assert.match(adr, /revision/);
  assert.match(adr, /idempotency/i);
  assert.match(adr, /Mobile.*viewer/is);
  assert.match(adr, /must not define.*independent editable route models/is);
});

test("draft state remains local until an explicit, idempotent publication", () => {
  const adr = read("docs/adr/0007-route-studio.md");
  assert.match(adr, /draft\s*(?:→|->)\s*ready\s*(?:→|->)\s*publishing\s*(?:→|->)\s*published/);
  assert.match(adr, /publishing\s*(?:→|->)\s*ready/);
  assert.match(adr, /explicit publish/i);
  assert.match(adr, /local persistence/i);
  assert.match(adr, /server-assigned/i);
  assert.match(adr, /published.*immutable/is);
});

test("browser routing consumes the exact mobile pack locally and has no routing API", () => {
  const adr = read("docs/adr/0007-route-studio.md");
  const architecture = read("docs/architecture.md");
  const combined = `${adr}\n${architecture}`;
  assert.match(combined, /WebAssembly|WASM/);
  assert.match(combined, /same byte-identical .*routing\.pack/i);
  assert.match(combined, /SHA-256/);
  assert.match(combined, /page runtime|browser/i);
  assert.match(combined, /no (?:HTTP )?routing (?:API|endpoint)/i);
  assert.match(combined, /publish\/read API.*never.*route/is);
});

test("public DEM provenance and elevation semantics are part of the fixture contract", () => {
  const adr = read("docs/adr/0007-route-studio.md");
  assert.match(adr, /public DEM/i);
  assert.match(adr, /licen[cs]e/i);
  assert.match(adr, /source.*SHA-256/is);
  assert.match(adr, /vertical datum/i);
  assert.match(adr, /no-data/i);
  assert.match(adr, /elevationM/);
  assert.match(adr, /elevationGainM/);
  assert.match(adr, /elevationLossM/);
  assert.match(adr, /D\+.*D-/s);
});

test("Route Studio records RED-first gates and enforceable coverage thresholds", () => {
  const testing = read("docs/testing.md");
  assert.match(testing, /^## Route Studio TDD contract/m);
  assert.match(testing, /shared domain.*95%.*90%/i);
  assert.match(testing, /studio UI.*90%.*85%/i);
  assert.match(testing, /WASM adapter.*90%/i);
  assert.match(testing, /API transition.*95%.*90%/i);
  assert.match(testing, /RED.*domain.*DEM.*pack parity.*publish/is);
  assert.match(testing, /no network.*route/is);
  assert.match(testing, /route-studio-contract\.test\.mjs.*RED/i);
});
