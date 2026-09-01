import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYDNEY_GEOMETRY = Object.freeze([
  Object.freeze({ lat: -33.8688, lng: 151.2093, elevationM: 10 }),
  Object.freeze({ lat: -33.8695, lng: 151.2102, elevationM: 15 }),
  Object.freeze({ lat: -33.8701, lng: 151.2111, elevationM: 12 })
]);
const SYDNEY_BBOX = "-33.871,151.208,-33.868,151.212";
const SEGMENT_KEYS = [
  "bbox",
  "controlPoints",
  "createdAt",
  "distanceM",
  "elevationGainM",
  "elevationLossM",
  "elevationsM",
  "encodedGeometry",
  "expiresAt",
  "id",
  "isSeed",
  "metricsVersion",
  "name",
  "publicationState",
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

function isPublicIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b, c] = octets;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function ipv6Words(address) {
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map((word) => Number.parseInt(word, 16));
}

function isPublicIpv6(address) {
  const words = ipv6Words(address);
  if (!words) return false;
  const [first, second] = words;
  if ((first & 0xe000) !== 0x2000) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  return true;
}

function isPublicIp(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) return true;
  return isIP(normalized) !== 0 && !isPublicIp(normalized);
}

export function systemLookupFactory(ResolverClass = Resolver) {
  const resolver = new ResolverClass();
  return {
    async lookup(hostname) {
      const results = await Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname)
      ]);
      const records = [];
      if (results[0].status === "fulfilled") {
        records.push(...results[0].value.map((address) => ({ address, family: 4 })));
      }
      if (results[1].status === "fulfilled") {
        records.push(...results[1].value.map((address) => ({ address, family: 6 })));
      }
      if (records.length === 0) throw new Error("hostname has no address records");
      return records;
    },
    cancel() {
      resolver.cancel();
    }
  };
}

async function assertPublicHostname(apiOrigin, lookupSession, timeoutMs) {
  const hostname = new URL(apiOrigin).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return;

  let timeout;
  let records;
  try {
    records = await Promise.race([
      lookupSession.lookup(hostname),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => {
            reject(new LiveApiVerificationError(`DNS lookup timed out after ${timeoutMs}ms`));
            try {
              lookupSession.cancel();
            } catch {
              // The timeout error remains the public failure even if a custom
              // test resolver cannot be cancelled cleanly.
            }
          },
          timeoutMs
        );
      })
    ]);
  } catch (error) {
    if (error instanceof LiveApiVerificationError) throw error;
    fail("live API hostname could not be resolved");
  } finally {
    clearTimeout(timeout);
  }
  if (!Array.isArray(records) || records.length === 0) fail("live API hostname could not be resolved");
  if (records.some((record) => !record || !isPublicIp(record.address))) {
    fail("live API hostname resolves to a non-public address");
  }
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
  if (!parsed.hostname.toLowerCase().endsWith(".workers.dev")) {
    fail("live API URL must target a workers.dev Worker");
  }
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
  if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 80) {
    fail(`${label} response contract is invalid`);
  }
  if (value.publicationState !== "published") fail(`${label} response contract is invalid`);
  if (value.metricsVersion !== 1 && value.metricsVersion !== 2) fail(`${label} response contract is invalid`);
  if (
    !Array.isArray(value.controlPoints) ||
    value.controlPoints.length < 2 ||
    value.controlPoints.some((point) => !Number.isSafeInteger(point) || point < 0 || point >= value.pointCount) ||
    value.controlPoints[0] !== 0 ||
    value.controlPoints.at(-1) !== value.pointCount - 1 ||
    value.controlPoints.some((point, index) => index > 0 && point <= value.controlPoints[index - 1])
  ) {
    fail(`${label} response contract is invalid`);
  }
  if (value.metricsVersion === 1) {
    if (value.elevationsM !== null || value.elevationGainM !== null || value.elevationLossM !== null) {
      fail(`${label} response contract is invalid`);
    }
  } else if (
    !Array.isArray(value.elevationsM) ||
    value.elevationsM.length !== value.pointCount ||
    value.elevationsM.some((elevation) => typeof elevation !== "number" || !Number.isFinite(elevation)) ||
    !Number.isSafeInteger(value.elevationGainM) || value.elevationGainM < 0 ||
    !Number.isSafeInteger(value.elevationLossM) || value.elevationLossM < 0
  ) {
    fail(`${label} response contract is invalid`);
  }
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
    if (
      value.isSeed ||
      value.name !== "Sydney verifier route" ||
      value.metricsVersion !== 2 ||
      value.pointCount !== SYDNEY_GEOMETRY.length ||
      value.distanceM !== 221 ||
      value.elevationGainM !== 5 ||
      value.elevationLossM !== 3 ||
      !isDeepStrictEqual(value.elevationsM, [10, 15, 12]) ||
      !isDeepStrictEqual(value.controlPoints, [0, 2]) ||
      value.expiresAt === null
    ) {
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
  lookupFactory = systemLookupFactory,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
}) {
  const apiOrigin = normalizeLiveApiUrl(apiUrl);
  if (typeof fetchImpl !== "function") fail("Fetch API is unavailable; Node 22 is required");
  if (typeof lookupFactory !== "function") fail("DNS lookup is unavailable; Node 22 is required");
  if (typeof randomUUID !== "function") fail("secure UUID generation is unavailable; Node 22 is required");
  assertPositiveInteger(timeoutMs, "configuration");
  assertPositiveInteger(maxResponseBytes, "configuration");
  let lookupSession;
  try {
    lookupSession = lookupFactory();
  } catch {
    fail("DNS lookup is unavailable; Node 22 is required");
  }
  if (
    !lookupSession ||
    typeof lookupSession.lookup !== "function" ||
    typeof lookupSession.cancel !== "function"
  ) {
    fail("DNS lookup is unavailable; Node 22 is required");
  }
  await assertPublicHostname(apiOrigin, lookupSession, timeoutMs);

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
  const publishBody = {
    name: "Sydney verifier route",
    geometry: SYDNEY_GEOMETRY,
    controlPoints: [0, SYDNEY_GEOMETRY.length - 1]
  };
  const published = await requestJson({
    fetchImpl,
    url: `${apiOrigin}/v2/segments`,
    init: {
      method: "POST",
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      }),
      body: JSON.stringify(publishBody)
    },
    label: "publish",
    allowedStatuses: [200, 201],
    timeoutMs,
    maxResponseBytes
  });
  assertSegmentRecord(published.payload, "publish", { published: true });

  const replay = await requestJson({
    fetchImpl,
    url: `${apiOrigin}/v2/segments`,
    init: {
      method: "POST",
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      }),
      body: JSON.stringify(publishBody)
    },
    label: "replay",
    allowedStatuses: [200],
    timeoutMs,
    maxResponseBytes
  });
  assertSegmentRecord(replay.payload, "replay", { published: true });
  if (!isDeepStrictEqual(replay.payload, published.payload)) {
    fail("idempotent replay did not return the published segment unchanged");
  }

  const conflict = await requestJson({
    fetchImpl,
    url: `${apiOrigin}/v2/segments`,
    init: {
      method: "POST",
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      }),
      body: JSON.stringify({ ...publishBody, name: "Sydney verifier route conflict probe" })
    },
    label: "conflict",
    allowedStatuses: [409],
    timeoutMs,
    maxResponseBytes
  });
  if (!hasExactKeys(conflict.payload, ["error"]) || conflict.payload.error !== "idempotency_conflict") {
    fail("conflict response contract is invalid");
  }

  const nearbyUrl = new URL(`${apiOrigin}/v2/segments`);
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
    statuses: {
      health: health.status,
      publish: published.status,
      replay: replay.status,
      conflict: conflict.status,
      nearby: nearby.status
    }
  };
}
