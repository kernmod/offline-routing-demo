import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("verification CLI accepts the checked-in fixture", () => {
  const result = spawnSync(process.execPath, ["tools/fixtures/verify.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FIXTURE_OK/);
});

test("default fixture tests rebuild routing packs independently", () => {
  const result = spawnSync(process.execPath, ["tools/fixtures/reproduce.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FIXTURE_REPRODUCIBLE/);
});
