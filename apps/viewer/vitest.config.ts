import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reportsDirectory: ".cache/coverage",
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/**/*.d.ts"]
    }
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }
});
