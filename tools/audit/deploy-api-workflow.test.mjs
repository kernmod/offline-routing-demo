import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL("../../.github/workflows/deploy-api.yml", import.meta.url);
const wranglerPath = new URL("../../apps/api/wrangler.toml", import.meta.url);

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
    "tools/deploy/**",
    ".github/workflows/deploy-api.yml"
  ]);
});

test("API deploy uses reproducible tools and least GitHub privilege", () => {
  const source = workflow();

  assert.match(source, /^permissions:\s*\n\s+contents: read$/m);
  assert.doesNotMatch(source, /\b(?:actions|checks|deployments|id-token|issues|packages|pages|pull-requests|statuses):\s*write\b/);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(source, /pnpm\/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa[\s\S]*version: 10\.24\.0/);
  assert.match(source, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020[\s\S]*node-version: 22\.23\.2/);
  assert.match(source, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(source, /\bnpx\b|cloudflare\/wrangler-action|wrangler@(?:latest|\^|~)/);
});

test("API deploy scopes the two Cloudflare credentials and bootstrap salt", () => {
  const source = workflow();
  const referencedSecrets = [...source.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  const jobPreamble = source.match(/jobs:\s*\n[\s\S]*?steps:/)?.[0];

  assert.deepEqual([...new Set(referencedSecrets)].sort(), [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "RATE_LIMIT_SALT"
  ]);
  assert.doesNotMatch(jobPreamble, /\benv:/, "credentials must be scoped to Cloudflare run steps");
  assert.equal(referencedSecrets.filter((name) => name === "CLOUDFLARE_ACCOUNT_ID").length, 2);
  assert.equal(referencedSecrets.filter((name) => name === "CLOUDFLARE_API_TOKEN").length, 2);
  assert.equal(referencedSecrets.filter((name) => name === "RATE_LIMIT_SALT").length, 1);
  assert.doesNotMatch(source, /wrangler secret put/);
  assert.doesNotMatch(source, /wrangler secret list/);
  assert.doesNotMatch(source, /set -x/);
});

test("API deploy validates production inputs, migrates, then bootstraps atomically", () => {
  const source = workflow();
  const preflight = source.indexOf("tools/deploy/validate-api-config.mjs");
  const secretPreparation = source.indexOf("Prepare deployment secret");
  const migration = source.indexOf("wrangler d1 migrations apply DB --remote");
  const deploy = source.indexOf("wrangler deploy");

  assert.match(source, /VIEWER_ORIGIN:\s*\$\{\{ vars\.VIEWER_ORIGIN \}\}/);
  assert.match(source, /RATE_LIMIT_SALT/);
  assert.ok(preflight >= 0, "the workflow must validate D1 and the production viewer origin");
  assert.ok(preflight < secretPreparation, "configuration preflight must precede secret preparation");
  assert.ok(secretPreparation < migration, "the salt must be validated before remote migrations");
  assert.ok(migration < deploy, "remote migrations must finish before Worker deployment");
  assert.match(source, /node tools\/deploy\/validate-api-config\.mjs apps\/api\/wrangler\.toml/);
  assert.match(source, /pnpm exec wrangler d1 migrations apply DB --remote/);
  assert.match(source, /worker-secrets\.json/);
  assert.match(source, /writeFileSync\(path, JSON\.stringify\(\{ RATE_LIMIT_SALT: salt \}\), \{ mode: 0o600 \}\)/);
  assert.match(source, /pnpm exec wrangler deploy --var "ALLOWED_ORIGINS:\$VIEWER_ORIGIN" --secrets-file "\$RUNNER_TEMP\/worker-secrets\.json"/);
  assert.match(source, /name: Remove deployment secret[\s\S]*if: always\(\)[\s\S]*rmSync/);
});

test("D1 migrations use Wrangler 4 non-interactive CI mode", () => {
  const migrationStep = workflow().match(/- name: Apply remote D1 migrations[\s\S]*?(?=\n      - name:)/)?.[0] ?? "";

  assert.match(migrationStep, /CI: "true"[\s\S]*pnpm exec wrangler d1 migrations apply DB --remote$/m);
  assert.doesNotMatch(migrationStep, /--yes\b/);
});

test("the live Wrangler config documents the atomic deployment path", () => {
  const source = readFileSync(wranglerPath, "utf8");

  assert.match(source, /public D1 identifier/);
  assert.match(source, /--secrets-file/);
  assert.doesNotMatch(source, /placeholder|wrangler secret put/);
});

test("API deployments are serialized without cancelling an active deployment", () => {
  const source = workflow();

  assert.match(source, /concurrency:\s*\n\s+group: deploy-api-production\s*\n\s+cancel-in-progress: false/);
});
