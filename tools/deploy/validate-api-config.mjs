#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { validateApiDeployConfig } from "./validate-api-config-lib.mjs";

const configPath = process.argv[2];
try {
  if (!configPath || process.argv.length !== 3) throw new Error("expected one Wrangler config path");
  const result = validateApiDeployConfig(readFileSync(configPath, "utf8"), process.env.VIEWER_ORIGIN);
  process.stdout.write(`API_DEPLOY_CONFIG_OK viewer_origin=${result.viewerOrigin}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "invalid deployment configuration";
  process.stderr.write(`API_DEPLOY_CONFIG_INVALID ${message}\n`);
  process.exitCode = 1;
}
