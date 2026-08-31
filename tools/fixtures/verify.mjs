#!/usr/bin/env node

import { resolve } from "node:path";
import { verifyFixture } from "./lib.mjs";

const fixture = resolve(process.argv[2] ?? "fixtures/sydney");
const result = verifyFixture(fixture);
console.log(
  `FIXTURE_OK ${fixture} assets=${result.manifest.assets.length} bytes=${result.declaredBytes} tiles=${result.header.addressedTiles} routing=${result.manifest.routing.status}`,
);
