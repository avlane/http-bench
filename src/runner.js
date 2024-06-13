import { performance } from "node:perf_hooks";

/** A short name for why a request failed: a system error code, "timeout" or the error name. */
export function describeError(error) {
  if (error?.name === "TimeoutError") return "timeout";
  return error?.cause?.code ?? error?.code ?? error?.name ?? "error";
}

/**
 * Send requests with `concurrency` of them in flight at a time, until `requests` have been
 * sent or `duration` milliseconds have passed, whichever comes first. A request that
 * is already in flight when the time is up is allowed to finish.
 * A request that takes longer than `timeout` milliseconds is abandoned and counted as the
 * error "timeout". Returns one sample per request: {latency (ms), status} or {latency, error}.
 */
export async function run({ url, requests, duration, concurrency, method = "GET", headers, body, timeout, fetchImpl = globalThis.fetch }) {
  const samples = [];
  const limit = requests ?? Infinity;
  let issued = 0;
  const started = performance.now();
  const deadline = duration === undefined ? Infinity : started + duration;
  async function worker() {
    while (issued < limit && performance.now() < deadline) {
      issued += 1;
      const start = performance.now();
      try {
        const signal = timeout === undefined ? undefined : AbortSignal.timeout(timeout);
        const response = await fetchImpl(url, { method, headers, body, signal });
        samples.push({ latency: performance.now() - start, status: response.status });
      } catch (error) {
        samples.push({ latency: performance.now() - start, error: describeError(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, limit) }, worker));
  return { samples, elapsedMs: performance.now() - started };
}
