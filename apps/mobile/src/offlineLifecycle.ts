type OfflineRuntime = {
  startTileServer(directory: string): number;
  loadPack(pack: ArrayBuffer): unknown;
  stopTileServer(): void;
};

/** Starts the local runtime atomically: a failed pack load never leaks the server thread. */
export async function startOfflineRuntime(
  router: OfflineRuntime,
  fixtureDirectory: string,
  readPack: () => Promise<ArrayBuffer>
): Promise<number> {
  // The native server is process-global and can outlive an Android Activity.
  // Stopping first makes remount/relaunch deterministic and is idempotent.
  router.stopTileServer();
  const port = router.startTileServer(fixtureDirectory);
  if (port === 0) throw new Error("local_tile_server_failed");

  try {
    router.loadPack(await readPack());
    return port;
  } catch (error) {
    router.stopTileServer();
    throw error;
  }
}
