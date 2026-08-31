#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeOverpass } from "./lib.mjs";

const snapshot = "2026-08-31T07:49:41Z";
const bbox = [-33.873, 151.204, -33.862, 151.217];
const query = `[out:json][timeout:60][date:"${snapshot}"];way[highway](${bbox.join(",")});(._;>;);out body;`;
const endpoint = new URL("https://overpass-api.de/api/interpreter");
endpoint.searchParams.set("data", query);

const response = await fetch(endpoint, {
  headers: { "user-agent": "offline-routing-demo-fixture-builder/1.0" },
});
if (!response.ok) {
  throw new Error(`Overpass returned HTTP ${response.status}`);
}

const raw = await response.json();
const source = normalizeOverpass(raw, snapshot);
const output = resolve(import.meta.dirname, "../../fixtures/sydney/source.osm.json");
writeFileSync(output, `${JSON.stringify(source, null, 2)}\n`);
console.log(`SOURCE_WRITTEN ${output} nodes=${source.nodes.length} ways=${source.ways.length}`);
