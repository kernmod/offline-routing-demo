import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const assets = resolve(here, "../assets");
await mkdir(assets, { recursive: true });
await Promise.all([
  copyFile(resolve(root, "fixtures/sydney/map.pmtiles"), resolve(assets, "tiles.pmtiles")),
  copyFile(resolve(root, "fixtures/sydney/routing.pack"), resolve(assets, "routing.pack")),
  copyFile(resolve(root, "fixtures/sydney/manifest.json"), resolve(assets, "fixture-manifest.json")),
  copyFile(resolve(assets, "style.json"), resolve(assets, "style.mapstyle"))
]);
console.log("mobile fixture assets prepared from public fixture");
