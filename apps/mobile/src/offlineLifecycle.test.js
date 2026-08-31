import assert from "node:assert/strict";
import test from "node:test";

import { startOfflineRuntime } from "./offlineLifecycle.ts";

function fakeRouter({ port = 4321, loadError } = {}) {
  const calls = [];
  return {
    calls,
    startTileServer(directory) {
      calls.push(["start", directory]);
      return port;
    },
    loadPack(pack) {
      calls.push(["load", pack.byteLength]);
      if (loadError) throw loadError;
    },
    stopTileServer() {
      calls.push(["stop"]);
    }
  };
}

test("clears a stale native server before starting and loading the local runtime", async () => {
  const router = fakeRouter();
  const port = await startOfflineRuntime(router, "/fixture", async () => new ArrayBuffer(4));

  assert.equal(port, 4321);
  assert.deepEqual(router.calls, [["stop"], ["start", "/fixture"], ["load", 4]]);
});

test("stops the local server when reading or loading the pack fails", async () => {
  const readFailure = fakeRouter();
  await assert.rejects(
    startOfflineRuntime(readFailure, "/fixture", async () => { throw new Error("read failed"); }),
    /read failed/
  );
  assert.deepEqual(readFailure.calls, [["stop"], ["start", "/fixture"], ["stop"]]);

  const loadFailure = fakeRouter({ loadError: new Error("invalid pack") });
  await assert.rejects(
    startOfflineRuntime(loadFailure, "/fixture", async () => new ArrayBuffer(8)),
    /invalid pack/
  );
  assert.deepEqual(loadFailure.calls, [["stop"], ["start", "/fixture"], ["load", 8], ["stop"]]);
});

test("rejects a zero port without attempting to load the pack", async () => {
  const router = fakeRouter({ port: 0 });
  await assert.rejects(
    startOfflineRuntime(router, "/fixture", async () => new ArrayBuffer(2)),
    /local_tile_server_failed/
  );
  assert.deepEqual(router.calls, [["stop"], ["start", "/fixture"]]);
});
