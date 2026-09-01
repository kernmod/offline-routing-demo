#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeOverpass } from "./lib.mjs";

const bbox = [-33.873, 151.204, -33.862, 151.217];
const extent = bbox.join(",");
const query = `[out:json][timeout:120];
(
  way[highway](${extent});
  way[building](${extent});
  way["building:part"](${extent});
  way[natural=water](${extent});
  way[water](${extent});
  way[waterway=riverbank](${extent});
  way[landuse](${extent});
  way[leisure](${extent});
  way[amenity](${extent});
  way[tourism](${extent});
);
(._;>;);
out body;`;
const endpoint = "https://overpass-api.de/api/interpreter";

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "user-agent": "offline-routing-demo-fixture-builder/1.2",
  },
  body: new URLSearchParams({ data: query }),
});
if (!response.ok) {
  throw new Error(`Overpass returned HTTP ${response.status}`);
}

const raw = await response.json();
const snapshot = raw.osm3s?.timestamp_osm_base;
if (typeof snapshot !== "string") throw new Error("Overpass response is missing osm3s.timestamp_osm_base");
const source = normalizeOverpass(raw, snapshot);
const output = resolve(import.meta.dirname, "../../fixtures/sydney/source.osm.json");
writeFileSync(output, `${JSON.stringify(source, null, 2)}\n`);
const counts = Object.fromEntries(
  ["road", "building", "water", "landuse"].map((kind) => [
    kind,
    source.ways.filter((way) => way.kind === kind).length,
  ]),
);
console.log(
  `SOURCE_WRITTEN ${output} snapshot=${snapshot} nodes=${source.nodes.length} ` +
  Object.entries(counts).map(([kind, count]) => `${kind}=${count}`).join(" "),
);
