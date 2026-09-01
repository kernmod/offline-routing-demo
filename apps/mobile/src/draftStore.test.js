import assert from "node:assert/strict";
import test from "node:test";

import { createDraftStore } from "./draftStore.ts";

function fakeFs(initial = null) {
  let value = initial;
  const calls = [];
  return {
    calls,
    async getInfoAsync(path) { calls.push(["info", path]); return { exists: value !== null }; },
    async readAsStringAsync(path) { calls.push(["read", path]); return value; },
    async writeAsStringAsync(path, next) { calls.push(["write", path]); value = next; },
    async deleteAsync(path) { calls.push(["delete", path]); value = null; }
  };
}

test("draft store persists one private JSON envelope in the app sandbox", async () => {
  const fs = fakeFs();
  const store = createDraftStore(fs, "/private/route-studio-draft.json");
  assert.equal(await store.load(), null);
  await store.save({ serializedDraft: "{}", nameInput: "harbour", pendingPublishKey: null });
  assert.deepEqual(await store.load(), { serializedDraft: "{}", nameInput: "harbour", pendingPublishKey: null });
  await store.clear();
  assert.equal(await store.load(), null);
});

test("draft store ignores corrupted or structurally unsafe persisted data", async () => {
  const malformed = createDraftStore(fakeFs("not-json"), "/draft");
  assert.equal(await malformed.load(), null);
  const wrongShape = createDraftStore(fakeFs(JSON.stringify({ serializedDraft: 4 })), "/draft");
  assert.equal(await wrongShape.load(), null);
  const wrongKey = createDraftStore(fakeFs(JSON.stringify({ serializedDraft: "{}", nameInput: "x", pendingPublishKey: 4 })), "/draft");
  assert.equal(await wrongKey.load(), null);
});
