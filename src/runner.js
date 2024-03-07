import { performance } from "node:perf_hooks";

/** A short name for why a request failed: a system error code, "timeout" or the error name. */
export function describeError(error) {
  if (error?.name === "TimeoutError") return "timeout";
  return error?.cause?.code ?? error?.code ?? error?.name ?? "error";
}

/**
 * Send `requests` requests with `concurrency` of them in flight at a time.
 * Returns one sample per request: {latency (ms), status} or {latency, error}.
 */
export async function run({ url, requests, concurrency, method = "GET", headers, body, fetchImpl = globalThis.fetch }) {
  const samples = [];
  let issued = 0;
  async function worker() {
    while (issued < requests) {
      issued += 1;
      const start = performance.now();
      try {
        const response = await fetchImpl(url, { method, headers, body });
        samples.push({ latency: performance.now() - start, status: response.status });
      } catch (error) {
        samples.push({ latency: performance.now() - start, error: describeError(error) });
      }
    }
  }
  const started = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
  return { samples, elapsedMs: performance.now() - started };
}
