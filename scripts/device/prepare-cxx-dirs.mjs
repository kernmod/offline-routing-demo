import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export function extractOutputDirectories(compileCommandsText) {
  const entries = JSON.parse(compileCommandsText);
  const directories = new Set();

  for (const entry of entries) {
    const command = typeof entry?.command === "string" ? entry.command : "";
    const workingDirectory = typeof entry?.directory === "string" ? entry.directory : process.cwd();
    for (const flag of ["-o", "-MF"]) {
      const pattern = new RegExp(`${flag}\\s+('([^']+)'|"([^"]+)"|(\\S+))`, "g");
      for (const match of command.matchAll(pattern)) {
        const target = match[2] ?? match[3] ?? match[4];
        if (!target) continue;
        const absoluteTarget = isAbsolute(target) ? target : resolve(workingDirectory, target);
        directories.add(dirname(absoluteTarget));
      }
    }
  }

  return [...directories].sort();
}

function main(argv) {
  if (argv.length < 3) {
    throw new Error("usage: prepare-cxx-dirs.mjs <compile-commands.json> [more-files...]");
  }

  const created = new Set();
  const queue = argv.slice(2).map((entry) => resolve(entry));
  const compileCommandPaths = [];

  while (queue.length > 0) {
    const path = queue.pop();
    if (!path) continue;
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const child of readdirSync(path)) queue.push(resolve(path, child));
      continue;
    }
    if (path.endsWith("compile_commands.json")) compileCommandPaths.push(path);
  }

  for (const path of compileCommandPaths) {
    const directories = extractOutputDirectories(readFileSync(path, "utf8"));
    for (const directory of directories) {
      mkdirSync(directory, { recursive: true });
      created.add(directory);
    }
  }

  console.log(`prepared ${created.size} CMake output directories`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}
