import { histogram, summarize } from "./stats.js";

const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

function countBy(samples, key) {
  const counts = new Map();
  for (const sample of samples) {
    const value = sample[key];
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** The settings of a run as plain data, with credentials in headers hidden. */
export function describeConfig(config) {
  const headers = {};
  for (const [name, value] of config.headers ?? []) headers[name] = SENSITIVE_HEADERS.has(name) ? "<redacted>" : value;
  return {
    url: config.url,
    method: config.method,
    concurrency: config.concurrency,
    requests: config.requests ?? null,
    durationMs: config.duration ?? null,
    warmup: config.warmup ?? null,
    timeoutMs: config.timeout ?? null,
    headers,
    bodyBytes: config.body === undefined ? 0 : Buffer.byteLength(config.body),
  };
}

/** Everything the reports need, computed once from the raw samples. */
export function analyze({ samples, elapsedMs }) {
  const responses = samples.filter((s) => s.error === undefined);
  const latencies = responses.map((s) => s.latency);
  const failedStatuses = responses.filter((s) => s.status >= 400).length;
  return {
    requests: samples.length,
    responses: responses.length,
    // Failures are transport errors and HTTP error statuses (4xx, 5xx). Redirects are fine.
    errors: samples.length - responses.length + failedStatuses,
    successes: responses.length - failedStatuses,
    statusCodes: Object.fromEntries([...countBy(responses, "status")].sort((a, b) => a[0] - b[0])),
    elapsedMs,
    bytes: responses.reduce((sum, s) => sum + (s.bytes ?? 0), 0),
    requestsPerSecond: elapsedMs > 0 ? samples.length / (elapsedMs / 1000) : 0,
    latency: summarize(latencies),
    histogram: histogram(latencies),
    errorCounts: {
      ...Object.fromEntries(countBy(samples, "error")),
      ...Object.fromEntries([...countBy(responses.filter((s) => s.status >= 400), "status")].map(([status, count]) => [`HTTP ${status}`, count])),
    },
  };
}
