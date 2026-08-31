import assert from "node:assert/strict";
import test from "node:test";

import { validateApiDeployConfig } from "./validate-api-config-lib.mjs";

const configuredD1 = `
[[d1_databases]]
database_id = "12345678-1234-4abc-8def-1234567890ab"
`;

test("production preflight accepts a configured D1 and public HTTPS viewer origin", () => {
  assert.deepEqual(validateApiDeployConfig(configuredD1, "https://portfolio.example"), {
    viewerOrigin: "https://portfolio.example"
  });
});

test("production preflight rejects the placeholder or missing D1 identifier", () => {
  assert.throws(
    () => validateApiDeployConfig('database_id = "00000000-0000-0000-0000-000000000000"', "https://portfolio.example"),
    /D1 database_id/
  );
  assert.throws(() => validateApiDeployConfig("name = 'demo'", "https://portfolio.example"), /D1 database_id/);
});

test("production preflight rejects non-public, credentialed, and non-origin viewer URLs", () => {
  for (const origin of [
    "",
    "not a URL",
    "http://portfolio.example",
    "https://localhost:4173",
    "https://127.0.0.1",
    "https://viewer.local",
    "https://singlelabel",
    "https://portfolio.example/path",
    "https://portfolio.example?token=value"
  ]) {
    assert.throws(() => validateApiDeployConfig(configuredD1, origin), /viewer origin/, origin);
  }

  const credentialed = new URL("https://portfolio.example");
  credentialed.username = "fixture-user";
  assert.throws(() => validateApiDeployConfig(configuredD1, credentialed.href), /viewer origin/);
});
