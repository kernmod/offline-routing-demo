#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const demRoot = join(root, "fixtures/sydney/dem");
const source = JSON.parse(readFileSync(join(demRoot, "source.json"), "utf8"));

for (const tile of source.tiles) {
  const response = await fetch(tile.url, {
    headers: { "user-agent": "offline-routing-demo-fixture-builder/1.1" },
  });
  if (!response.ok) throw new Error(`DEM tile ${tile.x}/${tile.y} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== tile.bytes || digest !== tile.sha256) {
    throw new Error(`DEM tile ${tile.x}/${tile.y} does not match its pinned size/hash`);
  }
  const output = join(demRoot, tile.path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
}

console.log(`DEM_FETCHED tiles=${source.tiles.length} provider=${source.provider}`);
