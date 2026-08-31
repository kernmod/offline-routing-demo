import { findDisabledTests } from "./test-policy-lib.mjs";

const root = new URL("../../", import.meta.url).pathname;
const findings = findDisabledTests(root);

for (const finding of findings) {
  console.error(`${finding.path}:${finding.line}:${finding.column} ${finding.rule}`);
}

if (findings.length > 0) {
  console.error("Focused, skipped, todo, fixme, and #[ignore] tests are forbidden.");
  process.exit(1);
}

console.log("TEST_POLICY_OK");
