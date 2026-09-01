import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WASM_BINDGEN_VERSION = "0.2.127";
const workspaceRoot = new URL("../../", import.meta.url);
const workspacePath = resolve(fileURLToPath(workspaceRoot));
const wasmTargetDir = resolve(workspacePath, ".cache/wasm-target");

function stableRustflags() {
  const home = resolve(homedir());
  const cargoHome = resolve(process.env.CARGO_HOME || resolve(home, ".cargo"));
  const rustupHome = resolve(process.env.RUSTUP_HOME || resolve(home, ".rustup"));
  return [
    `--remap-path-prefix=${workspacePath}=/workspace`,
    `--remap-path-prefix=${cargoHome}=/cargo-home`,
    `--remap-path-prefix=${rustupHome}=/rustup-home`,
  ].join("\u001f");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: {
      ...process.env,
      CARGO_TARGET_DIR: wasmTargetDir,
      CARGO_ENCODED_RUSTFLAGS: stableRustflags(),
      CARGO_INCREMENTAL: "0",
      RUSTFLAGS: "",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  return result.stdout?.trim() ?? "";
}

const installed = run("wasm-bindgen", ["--version"], { capture: true });
if (installed !== `wasm-bindgen ${WASM_BINDGEN_VERSION}`) {
  throw new Error(`wasm-bindgen ${WASM_BINDGEN_VERSION} is required; found ${installed || "nothing"}`);
}

rmSync(wasmTargetDir, { recursive: true, force: true });
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
  `${wasmTargetDir}/wasm32-unknown-unknown/release/cch_routing_lite_wasm.wasm`,
]);
rmSync(wasmTargetDir, { recursive: true, force: true });
