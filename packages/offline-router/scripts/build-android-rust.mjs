import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const argv = process.argv.slice(2);

function readFlag(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const outDir = readFlag("--out-dir");
const ndkPath = readFlag("--ndk");
const profile = readFlag("--profile") ?? "release";
const abis = (readFlag("--abis") ?? "arm64-v8a,x86_64").split(",").map((value) => value.trim()).filter(Boolean);

if (!outDir) throw new Error("--out-dir is required");
if (!ndkPath) throw new Error("--ndk is required");
if (!abis.length) throw new Error("--abis must contain at least one Android ABI");

const absoluteOutDir = resolve(packageRoot, outDir);
rmSync(absoluteOutDir, { recursive: true, force: true });
mkdirSync(absoluteOutDir, { recursive: true });

const command = [
  "ndk",
  ...abis.flatMap((abi) => ["-t", abi]),
  "-o",
  absoluteOutDir,
  "build",
  "-p",
  "cch-routing-lite-ffi",
  "-p",
  "tile-server-lite"
];

if (profile === "release") {
  command.push("--release");
} else if (profile !== "debug") {
  throw new Error(`unsupported profile: ${profile}`);
}

const result = spawnSync("cargo", command, {
  cwd: workspaceRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ANDROID_NDK_HOME: ndkPath,
    ANDROID_NDK_ROOT: ndkPath
  }
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
