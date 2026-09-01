import { spawnSync } from "node:child_process";

const WASM_BINDGEN_VERSION = "0.2.127";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  return result.stdout?.trim() ?? "";
}

const installed = run("wasm-bindgen", ["--version"], { capture: true });
if (installed !== `wasm-bindgen ${WASM_BINDGEN_VERSION}`) {
  throw new Error(`wasm-bindgen ${WASM_BINDGEN_VERSION} is required; found ${installed || "nothing"}`);
}

run("cargo", [
  "build",
  "--locked",
  "--release",
  "--target",
  "wasm32-unknown-unknown",
  "-p",
  "cch-routing-lite-wasm",
]);
run("wasm-bindgen", [
  "--target",
  "web",
  "--out-dir",
  "apps/viewer/src/wasm/pkg",
  "--out-name",
  "cch_routing_lite_wasm",
  "target/wasm32-unknown-unknown/release/cch_routing_lite_wasm.wasm",
]);
