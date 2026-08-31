#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const query =
  "EXPLAIN QUERY PLAN SELECT DISTINCT s.id FROM segment_cells sc JOIN segments s ON s.id = sc.segment_id WHERE sc.tile_key IN ('14/15073/9831') AND s.max_lat >= -33.871 AND s.min_lat <= -33.868 AND s.max_lng >= 151.208 AND s.min_lng <= 151.212 AND (s.is_seed = 1 OR s.expires_at > '2026-08-31T12:34:00.000Z') ORDER BY s.created_at DESC LIMIT 50";

const root = resolve(import.meta.dirname, "..");
const state = mkdtempSync(join(tmpdir(), "offline-routing-d1-"));
const mode = process.argv[2];

function runWrangler(args) {
  execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  });
}

try {
  runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    state,
    "--config",
    "wrangler.toml",
  ]);

  if (mode === "migrate") {
    process.exitCode = 0;
  } else if (mode === "explain") {
    runWrangler([
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      state,
      "--config",
      "wrangler.toml",
      "--command",
      query,
    ]);
    process.exitCode = 0;
  } else {
    throw new Error("usage: node scripts/d1-local.mjs <migrate|explain>");
  }
} finally {
  rmSync(state, { recursive: true, force: true });
}
