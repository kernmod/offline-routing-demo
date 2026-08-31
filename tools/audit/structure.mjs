import { existsSync } from "node:fs";

const required = [
  "README.md",
  "Makefile",
  "Cargo.toml",
  "package.json",
  "pnpm-workspace.yaml",
  "fixtures/sydney",
  "apps/mobile",
  "apps/viewer",
  "apps/api",
  "packages/offline-router",
  "packages/shared",
  "crates/cch-routing-lite",
  "crates/cch-routing-lite-ffi",
  "crates/tile-server-lite",
  "docs/adr",
  "docs/benchmarks",
  "docs/architecture.md",
  "docs/testing.md",
  "docs/security/public-boundary.md",
  ".github/workflows/ci.yml"
];

const missing = required.filter((path) => !existsSync(new URL(`../../${path}`, import.meta.url)));
if (missing.length > 0) {
  console.error("Missing required paths:");
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}
