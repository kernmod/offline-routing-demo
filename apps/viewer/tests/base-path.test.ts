import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { fixtureStyleUrl } from "../src/lib/assets";

describe("static viewer base paths", () => {
  it("keeps the PMTiles style under a non-root Vite base", () => {
    expect(fixtureStyleUrl("/viewer/", "https://portfolio.example")).toBe(
      "https://portfolio.example/viewer/style.json"
    );
  });

  it("uses an isolated stable coverage reports directory", () => {
    const config = readFileSync(resolve(import.meta.dirname, "../vitest.config.ts"), "utf8");
    expect(config).toContain('reportsDirectory: ".cache/coverage"');
  });
});
