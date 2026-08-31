import { auditRepository } from "./public-audit-lib.mjs";

const root = new URL("../../", import.meta.url).pathname;
const result = auditRepository(root, {
  contentAllowlist: new Map([
    ["tools/audit/public-audit-lib.mjs", "audit implementation contains encoded detection patterns"],
    ["tools/fixtures/fixture.test.mjs", "fixture tests assert the denylist against exact private tokens"],
    ["tools/fixtures/lib.mjs", "fixture verification contains exact denylist assertions against private tokens"]
  ])
});

for (const finding of result.findings) {
  console.error(
    `${finding.kind} ${finding.scope ?? "tree"} ${finding.path ?? "."}: ${finding.message}`
  );
}

if (result.findings.length > 0) {
  process.exit(1);
}
