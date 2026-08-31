import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL("../../.github/workflows/deploy-api.yml", import.meta.url);

function workflow() {
  return readFileSync(workflowPath, "utf8");
}

test("API deploy only runs for relevant main changes or manual dispatch", () => {
  const source = workflow();

  assert.match(source, /push:\s*\n\s+branches:\s*\[main\]/);
  assert.match(source, /workflow_dispatch:/);

  const paths = source.match(/paths:\s*\n((?:\s+- [^\n]+\n)+)/)?.[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^\s*-\s+["']?|["']?\s*$/g, ""));

  assert.deepEqual(paths, [
    "apps/api/**",
    "packages/shared/**",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".node-version",
    ".github/workflows/deploy-api.yml"
  ]);
});

test("API deploy uses reproducible tools and least GitHub privilege", () => {
  const source = workflow();

  assert.match(source, /^permissions:\s*\n\s+contents: read$/m);
  assert.doesNotMatch(source, /\b(?:actions|checks|deployments|id-token|issues|packages|pages|pull-requests|statuses):\s*write\b/);
  assert.match(source, /pnpm\/action-setup@v4[\s\S]*version: 10\.24\.0/);
  assert.match(source, /actions\/setup-node@v4[\s\S]*node-version: 22\.23\.2/);
  assert.match(source, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(source, /\bnpx\b|cloudflare\/wrangler-action|wrangler@(?:latest|\^|~)/);
});

test("API deploy uses only the two Cloudflare credentials", () => {
  const source = workflow();
  const referencedSecrets = [...source.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  const jobPreamble = source.match(/jobs:\s*\n[\s\S]*?steps:/)?.[0];

  assert.deepEqual([...new Set(referencedSecrets)].sort(), [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN"
  ]);
  assert.doesNotMatch(jobPreamble, /\benv:/, "credentials must be scoped to Cloudflare run steps");
  assert.equal(referencedSecrets.filter((name) => name === "CLOUDFLARE_ACCOUNT_ID").length, 3);
  assert.equal(referencedSecrets.filter((name) => name === "CLOUDFLARE_API_TOKEN").length, 3);
  assert.doesNotMatch(source, /RATE_LIMIT_SALT:\s*\$\{\{/);
  assert.doesNotMatch(source, /wrangler secret put/);
});

test("API deploy validates prerequisites, migrates remotely, then deploys", () => {
  const source = workflow();
  const preflight = source.indexOf("wrangler secret list --format json");
  const migration = source.indexOf("wrangler d1 migrations apply DB --remote");
  const deploy = source.indexOf("wrangler deploy");

  assert.match(source, /00000000-0000-0000-0000-000000000000/);
  assert.match(source, /RATE_LIMIT_SALT/);
  assert.ok(preflight >= 0, "the workflow must verify the pre-provisioned Worker secret");
  assert.ok(preflight < migration, "secret preflight must run before migrations");
  assert.ok(migration < deploy, "remote migrations must finish before Worker deployment");
  assert.match(source, /working-directory: apps\/api/);
  assert.match(source, /pnpm exec wrangler d1 migrations apply DB --remote --yes/);
  assert.match(source, /pnpm exec wrangler deploy/);
});

test("API deployments are serialized without cancelling an active deployment", () => {
  const source = workflow();

  assert.match(source, /concurrency:\s*\n\s+group: deploy-api-production\s*\n\s+cancel-in-progress: false/);
});
