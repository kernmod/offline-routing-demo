import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertAndCollectCoverage, cleanCoverage } from "./coverage-evidence-lib.mjs";

const validLcov = "TN:\nSF:src/example.js\nDA:1,1\nLF:1\nLH:1\nend_of_record\n";

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "offline-routing-coverage-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root, path, content = validLcov) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

test("collects one non-empty LCOV report for every JavaScript workspace", () => {
  withRoot((root) => {
    for (const path of [
      "coverage/js/root/lcov.info",
      "coverage/js/mobile/lcov.info",
      "coverage/js/offline-router/lcov.info",
      "apps/api/coverage/lcov.info",
      "apps/viewer/.cache/coverage/lcov.info",
      "packages/shared/coverage/lcov.info"
    ]) write(root, path);

    const reports = assertAndCollectCoverage(root);
    assert.equal(reports.length, 6);
    for (const name of ["api", "viewer", "shared"]) {
      const output = join(root, "coverage", "js", name, "lcov.info");
      assert.equal(existsSync(output), true);
      assert.equal(readFileSync(output, "utf8"), validLcov);
    }
  });
});

test("rejects missing or malformed LCOV evidence", () => {
  withRoot((root) => {
    write(root, "coverage/js/root/lcov.info", "not lcov\n");
    assert.throws(() => assertAndCollectCoverage(root), /invalid LCOV.*root/i);
  });
});

test("clean removes every source and collected report to prevent stale evidence", () => {
  withRoot((root) => {
    for (const path of [
      "coverage/js/root/lcov.info",
      "apps/api/coverage/lcov.info",
      "apps/viewer/.cache/coverage/lcov.info",
      "packages/shared/coverage/lcov.info"
    ]) write(root, path);

    cleanCoverage(root);
    assert.equal(existsSync(join(root, "coverage", "js")), false);
    assert.equal(existsSync(join(root, "apps", "api", "coverage")), false);
    assert.equal(existsSync(join(root, "apps", "viewer", ".cache", "coverage")), false);
    assert.equal(existsSync(join(root, "packages", "shared", "coverage")), false);
  });
});
