#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildFixture, listFiles, sha256, verifyFixture } from "./lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "sydney-repro-"));
const outputs = [join(temporaryRoot, "a"), join(temporaryRoot, "b")];

try {
  for (const output of outputs) {
    buildFixture({ root, out: output, includeExistingRouting: false });
    execFileSync(
      "cargo",
      [
        "run", "--quiet", "--release", "-p", "cch-routing-lite", "--bin", "build-pack", "--",
        join(output, "graph.json"), join(output, "routing.pack"),
      ],
      { cwd: root, env: { ...process.env, CARGO_NET_OFFLINE: "true" }, stdio: "pipe" },
    );
    buildFixture({ root, out: output, includeExistingRouting: false });
    verifyFixture(output);
  }
  const firstFiles = listFiles(outputs[0]).sort();
  const secondFiles = listFiles(outputs[1]).sort();
  if (JSON.stringify(firstFiles) !== JSON.stringify(secondFiles)) {
    throw new Error("reproducible builds emitted different file lists");
  }
  for (const path of firstFiles) {
    if (sha256(join(outputs[0], path)) !== sha256(join(outputs[1], path))) {
      throw new Error(`reproducibility mismatch: ${path}`);
    }
  }
  console.log(`FIXTURE_REPRODUCIBLE files=${firstFiles.length}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
