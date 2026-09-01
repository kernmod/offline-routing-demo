import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const apiRoot = resolve(import.meta.dirname, "..");
const nodeRuntime =
  process.versions.node.startsWith("22.")
    ? { command: process.execPath, prefix: [] as string[] }
    : { command: "npx", prefix: ["--yes", "--package=node@22.23.2", "node"] };
const wranglerCli = resolve(apiRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const query = "EXPLAIN QUERY PLAN SELECT DISTINCT s.id FROM segment_cells sc JOIN segments s ON s.id = sc.segment_id WHERE sc.tile_key IN ('14/15073/9831') AND s.max_lat >= -33.871 AND s.min_lat <= -33.868 AND s.max_lng >= 151.208 AND s.min_lng <= 151.212 AND (s.is_seed = 1 OR s.expires_at > '2026-08-31T12:34:00.000Z') ORDER BY s.created_at DESC LIMIT 50";
const v2Query = "EXPLAIN QUERY PLAN SELECT DISTINCT s.id FROM segment_cells sc JOIN segments s ON s.id = sc.segment_id WHERE sc.tile_key IN ('14/15073/9831') AND s.publication_state = 'published' AND s.max_lat >= -33.871 AND s.min_lat <= -33.868 AND s.max_lng >= 151.208 AND s.min_lng <= 151.212 AND (s.is_seed = 1 OR s.expires_at > '2026-08-31T12:34:00.000Z') ORDER BY s.created_at DESC LIMIT 50";

function wrangler(args: string[]): string {
  return execFileSync(nodeRuntime.command, [...nodeRuntime.prefix, wranglerCli, ...args], {
    cwd: apiRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" }
  });
}

function wranglerAt(cwd: string, args: string[]): string {
  return execFileSync(nodeRuntime.command, [...nodeRuntime.prefix, wranglerCli, ...args], {
    cwd,
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
    assert.match(migration, /0003_published_segments_v2\.sql/);
    assert.match(migration, /0004_expand_published_geometry\.sql/);
    const explain = wrangler(["d1", "execute", "DB", "--local", "--persist-to", state, "--config", "wrangler.toml", "--command", query]);
    assert.match(explain, /segment_cells/i);
    assert.match(explain, /SEARCH sc USING/i);
    const v2Explain = wrangler(["d1", "execute", "DB", "--local", "--persist-to", state, "--config", "wrangler.toml", "--command", v2Query]);
    assert.match(v2Explain, /SEARCH sc USING/i);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("Wrangler upgrades a populated v1 D1 without changing legacy geometry or inventing elevation metrics", () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "offline-routing-d1-upgrade-"));
  const state = resolve(workspace, "state");
  const migrationsDirectory = resolve(workspace, "migrations");
  const config = resolve(workspace, "wrangler.toml");
  try {
    mkdirSync(migrationsDirectory, { recursive: true });
    writeFileSync(config, [
      'name = "offline-routing-upgrade-test"',
      'main = "worker.js"',
      'compatibility_date = "2026-05-03"',
      '[[d1_databases]]',
      'binding = "DB"',
      'database_name = "offline-routing-upgrade-test"',
      'database_id = "12345678-1234-4abc-8def-1234567890ab"',
      'migrations_dir = "migrations"'
    ].join("\n"));
    writeFileSync(resolve(workspace, "worker.js"), "export default {};\n");
    for (const migration of ["0001_init.sql", "0002_seed_segments.sql"]) {
      writeFileSync(resolve(migrationsDirectory, migration), readFileSync(resolve(apiRoot, "migrations", migration)));
    }
    wranglerAt(workspace, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "--config", config]);
    wranglerAt(workspace, [
      "d1", "execute", "DB", "--local", "--persist-to", state, "--config", config, "--command",
      "INSERT INTO segments (id, encoded_geometry, point_count, distance_m, min_lat, min_lng, max_lat, max_lng, created_at, expires_at, idempotency_key_hash, is_seed) VALUES ('018f9be5-4370-4a48-9f64-571f55555555', 'legacy-polyline', 3, 221, -33.8701, 151.2093, -33.8688, 151.2111, '2026-08-31T12:34:00.000Z', '2026-09-01T12:34:00.000Z', 'legacy-hash', 0)"
    ]);

    writeFileSync(
      resolve(migrationsDirectory, "0003_published_segments_v2.sql"),
      readFileSync(resolve(apiRoot, "migrations", "0003_published_segments_v2.sql"))
    );
    writeFileSync(
      resolve(migrationsDirectory, "0004_expand_published_geometry.sql"),
      readFileSync(resolve(apiRoot, "migrations", "0004_expand_published_geometry.sql"))
    );
    const upgrade = wranglerAt(workspace, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "--config", config]);
    assert.match(upgrade, /0003_published_segments_v2\.sql/);
    assert.match(upgrade, /0004_expand_published_geometry\.sql/);
    const legacy = wranglerAt(workspace, [
      "d1", "execute", "DB", "--local", "--persist-to", state, "--config", config, "--command",
      "SELECT encoded_geometry, distance_m, name, publication_state, elevations_json, elevation_gain_m, elevation_loss_m, metrics_version, control_points_json FROM segments WHERE id = '018f9be5-4370-4a48-9f64-571f55555555'"
    ]);
    assert.match(legacy, /legacy-polyline/);
    assert.match(legacy, /Legacy segment/);
    assert.match(legacy, /published/);
    assert.match(legacy, /"metrics_version": 1/);
    assert.match(legacy, /\[0,2\]/);
    assert.doesNotMatch(legacy, /"elevation_gain_m": 0|"elevation_loss_m": 0/);

    const noOp = wranglerAt(workspace, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "--config", config]);
    assert.match(noOp, /No migrations to apply/i);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Wrangler local CORS defaults include the viewer development origins", () => {
  const config = readFileSync(resolve(apiRoot, "wrangler.toml"), "utf8");
  assert.match(config, /http:\/\/localhost:4173/);
  assert.match(config, /http:\/\/127\.0\.0\.1:4173/);
});
