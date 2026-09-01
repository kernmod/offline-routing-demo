import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("WASM generation pins Rust, target, and wasm-bindgen for reproducible public builds", () => {
  const toolchain = read("rust-toolchain.toml");
  const packageJson = JSON.parse(read("package.json"));
  const builder = read("tools/wasm/build.mjs");

  assert.match(toolchain, /channel\s*=\s*"1\.94\.1"/);
  assert.match(toolchain, /wasm32-unknown-unknown/);
  assert.match(toolchain, /rustfmt/);
  assert.match(toolchain, /clippy/);
  assert.equal(packageJson.scripts["build:wasm"], "node tools/wasm/build.mjs");
  assert.match(builder, /0\.2\.127/);
  assert.match(builder, /wasm32-unknown-unknown/);
  assert.match(builder, /cch-routing-lite-wasm/);
  assert.match(builder, /apps\/viewer\/src\/wasm\/pkg/);
  assert.doesNotMatch(builder, /shell:\s*true/);
});

test("CI and Pages install the exact WASM generator before building the viewer", () => {
  for (const path of [".github/workflows/ci.yml", ".github/workflows/pages.yml"]) {
    const workflow = read(path);
    assert.match(workflow, /toolchain:\s*1\.94\.1/);
    assert.match(workflow, /targets:\s*wasm32-unknown-unknown/);
    assert.match(workflow, /cargo install wasm-bindgen-cli --locked --version 0\.2\.127/);
  }
});
