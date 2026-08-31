import { defineConfig, devices } from "@playwright/test";

const viewerBase = process.env.VITE_VIEWER_BASE ?? "/";
const baseURL = new URL(viewerBase, "http://127.0.0.1:4173").toString();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000
  },
  projects: [
    { name: "desktop-chromium", testMatch: "**/*{desktop,base}.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", testMatch: "**/*mobile.spec.ts", use: { ...devices["Pixel 5"] } }
  ]
});
