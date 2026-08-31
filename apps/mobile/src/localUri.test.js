import assert from "node:assert/strict";
import test from "node:test";

import { fileUriToPath } from "./localUri.ts";

test("converts Expo file URIs to native filesystem paths without accepting remote URLs", () => {
  assert.equal(fileUriToPath("file:///data/user/0/demo/cache/fixture"), "/data/user/0/demo/cache/fixture");
  assert.equal(fileUriToPath("file:///tmp/a%20b"), "/tmp/a b");
  assert.throws(() => fileUriToPath("https://example.invalid/fixture"), /local_file_uri_required/);
});
