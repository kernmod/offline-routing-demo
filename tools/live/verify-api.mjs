#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { resolveLiveApiUrl, verifyLiveApi } from "./verify-api-lib.mjs";

export async function runLiveApiCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = globalThis.fetch,
  lookupFactory,
  uuid = randomUUID
} = {}) {
  try {
    const apiUrl = resolveLiveApiUrl(argv, env);
    const result = await verifyLiveApi({ apiUrl, fetchImpl, lookupFactory, randomUUID: uuid });
    stdout.write(
      `LIVE_API_OK health=${result.statuses.health} publish=${result.statuses.publish} nearby=${result.statuses.nearby}\n`
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "verification failed";
    stderr.write(`LIVE_API_FAILED ${message}\n`);
    return 1;
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) process.exitCode = await runLiveApiCli();
