#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outdir = mkdtempSync(join(tmpdir(), "offline-routing-worker-"));

try {
  execFileSync("pnpm", ["exec", "tsc", "--project", "tsconfig.json", "--noEmit"], {
    cwd: root,
    stdio: "inherit",
  });
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "deploy", "--dry-run", "--outdir", outdir],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
