import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const assets = resolve(here, "../assets");
const fixture = resolve(root, "fixtures/sydney");

await mkdir(assets, { recursive: true });

const publicStyle = JSON.parse(await readFile(resolve(fixture, "style.json"), "utf8"));
const publicSource = publicStyle.sources?.offline;
if (publicSource?.type !== "vector" || typeof publicSource.url !== "string" || !publicSource.url.startsWith("pmtiles://")) {
  throw new Error("fixture style must expose the public PMTiles source as sources.offline");
}

publicStyle.sources.offline = {
  ...publicSource,
  tiles: ["http://127.0.0.1:$PORT/tiles/{z}/{x}/{y}.pbf"],
  minzoom: publicSource.minzoom ?? 13,
  maxzoom: publicSource.maxzoom ?? 16
};
delete publicStyle.sources.offline.url;
const mobileStyle = `${JSON.stringify(publicStyle, null, 2)}\n`;

await Promise.all([
  copyFile(resolve(fixture, "map.pmtiles"), resolve(assets, "tiles.pmtiles")),
  copyFile(resolve(fixture, "routing.pack"), resolve(assets, "routing.pack")),
  copyFile(resolve(fixture, "manifest.json"), resolve(assets, "fixture-manifest.json")),
  writeFile(resolve(assets, "style.json"), mobileStyle),
  writeFile(resolve(assets, "style.mapstyle"), mobileStyle)
]);
console.log("mobile fixture assets and loopback style prepared from public fixture");
