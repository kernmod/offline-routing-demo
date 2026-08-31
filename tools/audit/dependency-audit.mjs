#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import { evaluateDependencyAudit } from "./dependency-audit-lib.mjs";

const audit = spawnSync("pnpm", ["audit", "--json"], {
  cwd: new URL("../..", import.meta.url),
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("Dependency audit did not return valid JSON.");
  process.exit(1);
}

const result = evaluateDependencyAudit(report);
for (const advisory of result.accepted) {
  console.log(
    `Accepted unpatched build-only advisory ${advisory.id}: ${advisory.module_name} (${advisory.github_advisory_id})`
  );
}
if (result.blocking.length > 0) {
  for (const advisory of result.blocking) {
    console.error(
      `Blocking ${advisory.severity} advisory ${advisory.id}: ${advisory.module_name} (${advisory.github_advisory_id ?? "unknown"})`
    );
  }
  process.exit(1);
}
console.log("DEPENDENCY_AUDIT_OK");
