import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { createNativeOfflineRouter } from "react-native-offline-router";
import { startOfflineRuntime } from "./offlineLifecycle";
import { fileUriToPath } from "./localUri";
const fixtureDirectory = `${FileSystem.cacheDirectory}offline-routing-fixture`;
async function materialize(module: number, fileName: string) {
  const asset = Asset.fromModule(module); await asset.downloadAsync();
  if (!asset.localUri) throw new Error(`embedded_asset_missing:${fileName}`);
  const target = `${fixtureDirectory}/${fileName}`;
  await FileSystem.copyAsync({ from: asset.localUri, to: target }); return target;
}
function bytesFromBase64(value: string) { const binary = globalThis.atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer; }
/** Prepares only local Expo assets. It deliberately contains no HTTP request. */
export async function prepareOfflineFixture() {
  await FileSystem.makeDirectoryAsync(fixtureDirectory, { intermediates: true });
  const [mapPath, stylePath, packPath] = await Promise.all([
    materialize(require("../assets/tiles.pmtiles"), "map.pmtiles"), materialize(require("../assets/style.mapstyle"), "style.json"), materialize(require("../assets/routing.pack"), "routing.pack")
  ]);
  const router = createNativeOfflineRouter();
  const port = await startOfflineRuntime(router, fileUriToPath(fixtureDirectory), async () => {
    const pack = await FileSystem.readAsStringAsync(packPath, { encoding: FileSystem.EncodingType.Base64 });
    return bytesFromBase64(pack);
  });
  const styleUrl = `http://127.0.0.1:${port}/style.json`;
  console.log(`OfflineRoutingBootReady ${JSON.stringify({ mapPath, stylePath, packPath, styleUrl })}`);
  return { router, mapPath, stylePath, packPath, port, styleUrl };
}
