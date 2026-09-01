import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_VIEWER_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@offline-routing/route-studio": fileURLToPath(new URL("../../packages/route-studio/index.js", import.meta.url))
    }
  },
  publicDir: fileURLToPath(new URL("../../fixtures/sydney", import.meta.url)),
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true }
});
