import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const reports = [
  { name: "root", source: "coverage/js/root/lcov.info", output: "coverage/js/root/lcov.info" },
  { name: "mobile", source: "coverage/js/mobile/lcov.info", output: "coverage/js/mobile/lcov.info" },
  {
    name: "offline-router",
    source: "coverage/js/offline-router/lcov.info",
    output: "coverage/js/offline-router/lcov.info"
  },
  { name: "api", source: "apps/api/coverage/lcov.info", output: "coverage/js/api/lcov.info" },
  {
    name: "viewer",
    source: "apps/viewer/.cache/coverage/lcov.info",
    output: "coverage/js/viewer/lcov.info"
  },
  { name: "shared", source: "packages/shared/coverage/lcov.info", output: "coverage/js/shared/lcov.info" }
];

function validLcov(content) {
  return /^SF:.+$/m.test(content) && /^DA:\d+,\d+$/m.test(content) && /^end_of_record$/m.test(content);
}

export function cleanCoverage(root) {
  for (const path of [
    "coverage/js",
    "apps/api/coverage",
    "apps/viewer/.cache/coverage",
    "packages/shared/coverage"
  ]) {
    rmSync(resolve(root, path), { recursive: true, force: true });
  }
}

export function assertAndCollectCoverage(root) {
  const verified = [];

  for (const report of reports) {
    const source = resolve(root, report.source);
    let content;
    try {
      content = readFileSync(source, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`missing LCOV report for ${report.name}: ${report.source}`);
      }
      throw error;
    }
    if (!validLcov(content)) {
      throw new Error(`invalid LCOV report for ${report.name}: ${report.source}`);
    }

    const output = resolve(root, report.output);
    if (source !== output) {
      mkdirSync(dirname(output), { recursive: true });
      copyFileSync(source, output);
    }
    verified.push({ name: report.name, path: report.output });
  }

  return verified;
}
