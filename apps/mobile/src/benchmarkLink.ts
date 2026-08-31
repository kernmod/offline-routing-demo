const BENCHMARK_DEVICE = /^[a-zA-Z0-9._() -]{1,80}$/;

export function parseBenchmarkUrl(url: string): { device: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "offlineroutingdemo:" || parsed.hostname !== "benchmark") {
    return null;
  }
  const device = parsed.searchParams.get("device");
  if (!device || !BENCHMARK_DEVICE.test(device)) {
    return null;
  }
  return { device };
}

export function benchmarkUrl(device: string): string {
  if (!BENCHMARK_DEVICE.test(device)) {
    throw new Error("invalid_benchmark_device");
  }
  return `offlineroutingdemo://benchmark?device=${encodeURIComponent(device)}`;
}
