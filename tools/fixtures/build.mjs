#!/usr/bin/env node

import { resolve } from "node:path";
import { buildFixture } from "./lib.mjs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
if (outIndex >= 0 && !args[outIndex + 1]) throw new Error("--out requires a value");
const root = resolve(import.meta.dirname, "../..");
const out = outIndex >= 0 ? resolve(args[outIndex + 1]) : resolve(root, "fixtures/sydney");
const manifest = buildFixture({ root, out });
const total = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0);
console.log(`FIXTURE_BUILT ${out} assets=${manifest.assets.length} bytes=${total} routing=${manifest.routing.status}`);
