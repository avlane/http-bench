const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

export const DEFAULT_PERCENTILES = [50, 75, 90, 95, 99, 99.9];

/** The settings of a run as plain data, with credentials in headers hidden. */
export function describeConfig(config) {
  const headers = {};
  for (const [name, value] of config.headers ?? []) headers[name] = SENSITIVE_HEADERS.has(name) ? "<redacted>" : value;
  const targets = config.targets?.length > 1
    ? { targets: config.targets.map((t) => ({ method: t.method, url: t.url, bodyBytes: t.body === undefined ? 0 : Buffer.byteLength(t.body) })) }
    : {};
  return {
    ...targets,
    url: config.url,
    method: config.method,
    concurrency: config.concurrency,
    rate: config.rate ?? null,
    latencyFrom: config.rate ? "scheduled" : "sent",
    redirect: config.redirect ?? "follow",
    template: config.template ?? false,
    requests: config.requests ?? null,
    durationMs: config.duration ?? null,
    warmup: config.warmup ?? null,
    timeoutMs: config.timeout ?? null,
    headers,
    bodyBytes: config.body === undefined ? 0 : Buffer.byteLength(config.body),
  };
}

/** Everything the reports need, computed once from what the recorder collected. */
export function analyze({ recorder, elapsedMs }, percentiles = DEFAULT_PERCENTILES) {
  const histogram = recorder.histogram;
  const latency = histogram.count === 0
    ? { count: 0, min: null, max: null, mean: null, stddev: null, percentiles: {} }
    : {
        count: histogram.count,
        min: histogram.min,
        max: histogram.max,
        mean: histogram.mean,
        stddev: histogram.stddev,
        percentiles: Object.fromEntries(percentiles.map((p) => [p, histogram.percentile(p)])),
      };
  return {
    requests: recorder.requests,
    responses: recorder.responses,
    successes: recorder.successes,
    // Failures are transport errors and HTTP error statuses (4xx, 5xx). Redirects are fine.
    errors: recorder.requests - recorder.successes,
    statusCodes: Object.fromEntries([...recorder.statusCodes].toSorted((a, b) => a[0] - b[0])),
    errorCounts: Object.fromEntries(recorder.errorCounts),
    elapsedMs,
    bytes: recorder.bytes,
    requestsPerSecond: elapsedMs > 0 ? recorder.requests / (elapsedMs / 1000) : 0,
    latency,
    histogram: histogram.rows(),
    timeline: recorder.timeline.map(({ requests, failed }, second) => ({ second, requests, failed })),
    percentile: (p) => histogram.percentile(p),
  };
}
