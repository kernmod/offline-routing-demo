const D1_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const D1_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidViewerOrigin() {
  throw new Error("viewer origin must be a public HTTPS origin");
}

function normalizeViewerOrigin(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") invalidViewerOrigin();

  let parsed;
  try {
    parsed = new URL(rawValue.trim());
  } catch {
    invalidViewerOrigin();
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    (parsed.port && parsed.port !== "443") ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    /^\[?[0-9a-f:.]+\]?$/i.test(hostname)
  ) {
    invalidViewerOrigin();
  }
  return parsed.origin;
}

export function validateApiDeployConfig(configSource, viewerOrigin) {
  if (typeof configSource !== "string") throw new Error("D1 database_id is not configured");
  const databaseId = configSource.match(/^\s*database_id\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!databaseId || databaseId === D1_PLACEHOLDER || !D1_ID.test(databaseId)) {
    throw new Error("D1 database_id is not configured");
  }
  return { viewerOrigin: normalizeViewerOrigin(viewerOrigin) };
}
