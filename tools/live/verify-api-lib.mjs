import { isDeepStrictEqual } from "node:util";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYDNEY_GEOMETRY = Object.freeze([
  Object.freeze({ lat: -33.8688, lng: 151.2093 }),
  Object.freeze({ lat: -33.8695, lng: 151.2102 }),
  Object.freeze({ lat: -33.8701, lng: 151.2111 })
]);
const SYDNEY_BBOX = "-33.871,151.208,-33.868,151.212";
const SEGMENT_KEYS = [
  "bbox",
  "createdAt",
  "distanceM",
  "encodedGeometry",
  "expiresAt",
  "id",
  "isSeed",
  "pointCount"
].sort();

export class LiveApiVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LiveApiVerificationError";
  }
}

function fail(message) {
  throw new LiveApiVerificationError(message);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    isPrivateIpv4(normalized)
  );
}

/**
 * Reduces a caller-provided API address to a credential-free public HTTPS
 * origin. Validation failures intentionally never echo the input.
 */
export function normalizeLiveApiUrl(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    fail("live API URL is required");
  }

  let parsed;
  try {
    parsed = new URL(rawValue.trim());
  } catch {
    fail("live API URL is invalid");
  }

  if (parsed.protocol !== "https:") fail("live API URL must use HTTPS");
  if (parsed.username || parsed.password) fail("live API URL must not contain credentials");
  if (parsed.search || parsed.hash) fail("live API URL must not contain a query or fragment");
  if (parsed.pathname !== "/") fail("live API URL must be an origin without a path");
  if (parsed.port && parsed.port !== "443") fail("live API URL must use the standard HTTPS port");
  if (isLocalHostname(parsed.hostname)) fail("live API URL must not target a local or private host");
  if (!parsed.hostname.includes(".") && !parsed.hostname.includes(":")) {
    fail("live API URL must use a public hostname");
  }
  return parsed.origin;
}

export function resolveLiveApiUrl(argv, env) {
  let cliValue;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--url") {
      if (cliValue !== undefined) fail("--url may only be provided once");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("--url requires a value");
      cliValue = value;
      index += 1;
    } else if (argument.startsWith("--url=")) {
      if (cliValue !== undefined) fail("--url may only be provided once");
      cliValue = argument.slice("--url=".length);
      if (!cliValue) fail("--url requires a value");
    } else {
      fail("unknown argument; expected --url <HTTPS origin>");
    }
  }

  const rawValue = cliValue ?? env.SEGMENTS_API_URL;
  if (!rawValue) fail("provide --url <HTTPS origin> or SEGMENTS_API_URL");
  return normalizeLiveApiUrl(rawValue);
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} response contract is invalid`);
}

function assertIsoTimestamp(value, label) {
  if (typeof value !== "string") fail(`${label} response contract is invalid`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail(`${label} response contract is invalid`);
  }
  return timestamp;
}

function assertBbox(value, label) {
  if (!hasExactKeys(value, ["maxLat", "maxLng", "minLat", "minLng"])) {
    fail(`${label} response contract is invalid`);
  }
  for (const coordinate of Object.values(value)) {
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
      fail(`${label} response contract is invalid`);
    }
  }
  if (value.minLat > value.maxLat || value.minLng > value.maxLng) {
    fail(`${label} response contract is invalid`);
  }
}

function assertSegmentRecord(value, label, { published = false } = {}) {
  if (!hasExactKeys(value, SEGMENT_KEYS)) fail(`${label} response contract is invalid`);
  if (!UUID_V4.test(value.id)) fail(`${label} response contract is invalid`);
  if (typeof value.encodedGeometry !== "string" || value.encodedGeometry.length === 0 || value.encodedGeometry.length > 4096) {
    fail(`${label} response contract is invalid`);
  }
  assertPositiveInteger(value.pointCount, label);
  assertPositiveInteger(value.distanceM, label);
  assertBbox(value.bbox, label);
  const createdAt = assertIsoTimestamp(value.createdAt, label);
  if (typeof value.isSeed !== "boolean") fail(`${label} response contract is invalid`);
  if (value.expiresAt === null) {
    if (!value.isSeed) fail(`${label} response contract is invalid`);
  } else {
    const expiresAt = assertIsoTimestamp(value.expiresAt, label);
    if (expiresAt <= createdAt) fail(`${label} response contract is invalid`);
  }
  if (published) {
    if (value.isSeed || value.pointCount !== SYDNEY_GEOMETRY.length || value.expiresAt === null) {
      fail(`${label} response contract is invalid`);
    }
    const expected = {
      minLat: Math.min(...SYDNEY_GEOMETRY.map(({ lat }) => lat)),
      minLng: Math.min(...SYDNEY_GEOMETRY.map(({ lng }) => lng)),
      maxLat: Math.max(...SYDNEY_GEOMETRY.map(({ lat }) => lat)),
      maxLng: Math.max(...SYDNEY_GEOMETRY.map(({ lng }) => lng))
    };
    if (!isDeepStrictEqual(value.bbox, expected)) fail(`${label} response contract is invalid`);
  }
}

function assertPublicHeaders(response, label) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) fail(`${label} response must use application/json`);

  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  const directives = cacheControl.split(",").map((directive) => directive.trim());
  if (!directives.includes("no-store") || directives.includes("public")) {
    fail(`${label} response must declare cache-control: no-store`);
  }
  if (response.headers.has("access-control-allow-origin")) {
    fail(`${label} response exposed CORS to an Origin-less verifier request`);
  }
  if (response.headers.has("access-control-allow-credentials")) {
    fail(`${label} response must not expose credentialed CORS`);
  }
}

async function readBoundedJson(response, label, maxResponseBytes) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) fail(`${label} response has an invalid content-length`);
    if (length > maxResponseBytes) fail(`${label} response exceeds ${maxResponseBytes} bytes`);
  }
  if (!response.body) fail(`${label} response body is missing`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel();
        fail(`${label} response exceeds ${maxResponseBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof LiveApiVerificationError) throw error;
    fail(`${label} response body could not be read`);
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} response is not valid JSON`);
  }
}

async function requestJson({ fetchImpl, url, init, label, allowedStatuses, timeoutMs, maxResponseBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    if (!allowedStatuses.includes(response.status)) fail(`${label} returned HTTP ${response.status}`);
    assertPublicHeaders(response, label);
    const payload = await readBoundedJson(response, label, maxResponseBytes);
    return { payload, status: response.status };
  } catch (error) {
    if (error instanceof LiveApiVerificationError) throw error;
    if (controller.signal.aborted) fail(`${label} request timed out after ${timeoutMs}ms`);
    fail(`${label} request failed`);
  } finally {
    clearTimeout(timer);
  }
}

function headers(values = {}) {
  return { accept: "application/json", ...values };
}

/** Runs the state-changing live smoke test against one explicitly selected API. */
export async function verifyLiveApi({
  apiUrl,
  fetchImpl = globalThis.fetch,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
}) {
  const apiOrigin = normalizeLiveApiUrl(apiUrl);
  if (typeof fetchImpl !== "function") fail("Fetch API is unavailable; Node 22 is required");
  if (typeof randomUUID !== "function") fail("secure UUID generation is unavailable; Node 22 is required");
  assertPositiveInteger(timeoutMs, "configuration");
  assertPositiveInteger(maxResponseBytes, "configuration");

  const health = await requestJson({
    fetchImpl,
    url: `${apiOrigin}/health`,
    init: { method: "GET", headers: headers() },
    label: "health",
    allowedStatuses: [200],
    timeoutMs,
    maxResponseBytes
  });
  if (!hasExactKeys(health.payload, ["ok"]) || health.payload.ok !== true) {
    fail("health response contract is invalid");
  }

  const idempotencyKey = randomUUID();
  if (!UUID_V4.test(idempotencyKey)) fail("secure UUID generator returned an invalid UUIDv4");
  const published = await requestJson({
    fetchImpl,
    url: `${apiOrigin}/segments`,
    init: {
      method: "POST",
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      }),
      body: JSON.stringify({ geometry: SYDNEY_GEOMETRY })
    },
    label: "publish",
    allowedStatuses: [200, 201],
    timeoutMs,
    maxResponseBytes
  });
  assertSegmentRecord(published.payload, "publish", { published: true });

  const nearbyUrl = new URL(`${apiOrigin}/segments`);
  nearbyUrl.searchParams.set("bbox", SYDNEY_BBOX);
  const nearby = await requestJson({
    fetchImpl,
    url: nearbyUrl,
    init: { method: "GET", headers: headers() },
    label: "nearby",
    allowedStatuses: [200],
    timeoutMs,
    maxResponseBytes
  });
  if (!hasExactKeys(nearby.payload, ["segments"]) || !Array.isArray(nearby.payload.segments)) {
    fail("nearby response contract is invalid");
  }
  for (const segment of nearby.payload.segments) assertSegmentRecord(segment, "nearby");
  const rereadUnchanged = nearby.payload.segments.some(
    (segment) => segment.id === published.payload.id && isDeepStrictEqual(segment, published.payload)
  );
  if (!rereadUnchanged) {
    fail("published segment was not returned unchanged by the bbox read");
  }

  return {
    apiOrigin,
    segmentId: published.payload.id,
    statuses: { health: health.status, publish: published.status, nearby: nearby.status }
  };
}
