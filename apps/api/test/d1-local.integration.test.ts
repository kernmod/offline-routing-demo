import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const apiRoot = resolve(import.meta.dirname, "..");
const query = "EXPLAIN QUERY PLAN SELECT DISTINCT s.id FROM segment_cells sc JOIN segments s ON s.id = sc.segment_id WHERE sc.tile_key IN ('14/15073/9831') AND s.max_lat >= -33.871 AND s.min_lat <= -33.868 AND s.max_lng >= 151.208 AND s.min_lng <= 151.212 AND (s.is_seed = 1 OR s.expires_at > '2026-08-31T12:34:00.000Z') ORDER BY s.created_at DESC LIMIT 50";

function wrangler(args: string[]): string {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: apiRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" }
  });
}

test("Wrangler applies the versioned migrations to real local D1 and EXPLAIN uses segment_cells", () => {
  const state = mkdtempSync(resolve(tmpdir(), "offline-routing-wrangler-d1-"));
  try {
    const migration = wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "--config", "wrangler.toml"]);
    assert.match(migration, /0001_init\.sql/);
    assert.match(migration, /0002_seed_segments\.sql/);
    const explain = wrangler(["d1", "execute", "DB", "--local", "--persist-to", state, "--config", "wrangler.toml", "--command", query]);
    assert.match(explain, /segment_cells/i);
    assert.match(explain, /SEARCH sc USING/i);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("Wrangler local CORS defaults include the viewer development origins", () => {
  const config = readFileSync(resolve(apiRoot, "wrangler.toml"), "utf8");
  assert.match(config, /http:\/\/localhost:4173/);
  assert.match(config, /http:\/\/127\.0\.0\.1:4173/);
});
