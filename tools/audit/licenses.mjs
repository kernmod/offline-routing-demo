import { existsSync, readFileSync } from "node:fs";

const required = ["LICENSE", "LICENSE-APACHE", "LICENSE-MIT", "NOTICE.md"];
const missing = required.filter((path) => !existsSync(new URL(`../../${path}`, import.meta.url)));
if (missing.length > 0) {
  console.error(`Missing licensing files: ${missing.join(", ")}`);
  process.exit(1);
}

const notice = readFileSync(new URL("../../NOTICE.md", import.meta.url), "utf8");
if (!/OpenStreetMap/.test(notice) || !/ODbL/.test(notice)) {
  console.error("NOTICE.md must include OpenStreetMap attribution and the ODbL license.");
  process.exit(1);
}
