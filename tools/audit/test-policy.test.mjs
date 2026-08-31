import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findDisabledTests } from "./test-policy-lib.mjs";

function withTree(files, run) {
  const root = mkdtempSync(join(tmpdir(), "offline-routing-test-policy-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts ordinary JS and Rust tests", () => {
  withTree(
    {
      "web/example.test.ts": "test('works', () => {});\n",
      "crates/example/src/lib.rs": "#[test]\nfn works() {}\n"
    },
    (root) => assert.deepEqual(findDisabledTests(root), [])
  );
});

test("rejects focused and skipped JavaScript tests", () => {
  const only = ["test", "only"].join(".");
  const skip = ["describe", "skip"].join(".");
  const todo = ["test", "todo"].join(".");
  const skippedOption = ["sk", "ip: true"].join("");

  withTree(
    {
      "web/focused.test.ts": `${only}('focused', () => {});\n`,
      "web/skipped.spec.ts": `${skip}('suite', () => {});\n`,
      "web/todo.test.js": `${todo}('later');\n`,
      "web/option.test.mjs": `test('disabled', { ${skippedOption} }, () => {});\n`
    },
    (root) => {
      const findings = findDisabledTests(root);
      assert.deepEqual(
        findings.map(({ path, rule }) => ({ path, rule })),
        [
          { path: "web/focused.test.ts", rule: "focused-js-test" },
          { path: "web/option.test.mjs", rule: "skipped-js-test" },
          { path: "web/skipped.spec.ts", rule: "skipped-js-test" },
          { path: "web/todo.test.js", rule: "skipped-js-test" }
        ]
      );
    }
  );
});

test("rejects ignored Rust tests, including spaced attributes", () => {
  const compact = ["#[", "ignore]"].join("");
  const spaced = ["# [", " ignore ", "]"].join("");

  withTree(
    {
      "crates/a/tests/compact.rs": `${compact}\n#[test]\nfn hidden() {}\n`,
      "crates/a/src/lib.rs": `${spaced}\n#[test]\nfn hidden_too() {}\n`
    },
    (root) => {
      assert.deepEqual(
        findDisabledTests(root).map(({ path, rule }) => ({ path, rule })),
        [
          { path: "crates/a/src/lib.rs", rule: "ignored-rust-test" },
          { path: "crates/a/tests/compact.rs", rule: "ignored-rust-test" }
        ]
      );
    }
  );
});

test("ignores vendored, generated, and coverage trees", () => {
  const only = ["it", "only"].join(".");
  const ignored = ["#[", "ignore]"].join("");

  withTree(
    {
      "node_modules/pkg/bad.test.js": `${only}('x', () => {});\n`,
      "target/debug/build/example.rs": `${ignored}\n`,
      "coverage/generated.test.js": `${only}('x', () => {});\n`,
      "dist/generated.test.js": `${only}('x', () => {});\n`
    },
    (root) => assert.deepEqual(findDisabledTests(root), [])
  );
});
