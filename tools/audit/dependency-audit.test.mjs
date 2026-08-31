import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDependencyAudit } from "./dependency-audit-lib.mjs";

const acceptedUnpatched = (id) => ({
  id,
  module_name: "image-size",
  severity: "high",
  patched_versions: "<0.0.0",
  findings: [{ paths: ["apps__mobile>expo>@expo/metro>metro>image-size"] }]
});

test("dependency audit accepts only the two documented unpatched build-time parsers", () => {
  const result = evaluateDependencyAudit({
    advisories: {
      "1138808": acceptedUnpatched(1138808),
      "1138809": acceptedUnpatched(1138809)
    }
  });
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.accepted.map((item) => item.id), [1138808, 1138809]);
});

test("dependency audit blocks critical, newly high, patched, or wrongly-routed advisories", () => {
  const result = evaluateDependencyAudit({
    advisories: {
      "1": { ...acceptedUnpatched(1), severity: "critical" },
      "2": { ...acceptedUnpatched(2), patched_versions: ">=2.1.0" },
      "3": { ...acceptedUnpatched(3), module_name: "another-package" },
      "4": { ...acceptedUnpatched(4), findings: [{ paths: ["apps/api>image-size"] }] }
    }
  });
  assert.equal(result.blocking.length, 4);
});
