import { assertAndCollectCoverage, cleanCoverage } from "./coverage-evidence-lib.mjs";

const action = process.argv[2];
const root = new URL("../../", import.meta.url).pathname;

if (action === "clean") {
  cleanCoverage(root);
  console.log("COVERAGE_CLEAN");
} else if (action === "assert") {
  const reports = assertAndCollectCoverage(root);
  for (const report of reports) console.log(`LCOV_OK ${report.name} ${report.path}`);
} else {
  console.error("usage: node tools/audit/coverage-evidence.mjs <clean|assert>");
  process.exit(2);
}
