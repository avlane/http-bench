import { LatencyHistogram } from "./histogram.js";

/**
 * Aggregates the outcome of every request as it happens. Nothing is stored per request,
 * so a run can be as long as you like.
 */
export class Recorder {
  constructor() {
    this.histogram = new LatencyHistogram();
    this.requests = 0;
    this.responses = 0; // a response arrived, whatever its status
    this.successes = 0; // a response with a status below 400
    this.bytes = 0;
    this.statusCodes = new Map();
    this.errorCounts = new Map(); // "timeout", "ECONNREFUSED", "HTTP 503", ...
    this.timeline = []; // [{requests, failed}] for each second of the run
    this.targets = new Map(); // target index -> {requests, failed, histogram}, when targets are told apart
  }

  #recordTarget(target, { latency, status, error }) {
    let entry = this.targets.get(target);
    if (!entry) {
      entry = { requests: 0, failed: 0, histogram: new LatencyHistogram({ precision: 0.02 }) };
      this.targets.set(target, entry);
    }
    entry.requests += 1;
    if (error !== undefined || status >= 400) entry.failed += 1;
    if (error === undefined) entry.histogram.record(Math.max(0, latency));
  }

  #increment(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  /**
   * `{latency, status, bytes}` for a response, `{error}` for a request that failed to get one.
   * `elapsedMs` is how long into the run the request finished, for the per-second timeline.
   * `target` is the index of the request definition, to report them one by one.
   */
  record({ latency, status, error, bytes = 0 }, elapsedMs = 0, target = undefined) {
    this.requests += 1;
    if (target !== undefined) this.#recordTarget(target, { latency, status, error });
    const second = Math.max(0, Math.floor(elapsedMs / 1000));
    while (this.timeline.length <= second) this.timeline.push({ requests: 0, failed: 0 });
    this.timeline[second].requests += 1;
    if (error !== undefined || status >= 400) this.timeline[second].failed += 1;
    if (error !== undefined) {
      this.#increment(this.errorCounts, error);
      return;
    }
    this.responses += 1;
    this.bytes += bytes;
    this.#increment(this.statusCodes, status);
    this.histogram.record(Math.max(0, latency));
    if (status >= 400) this.#increment(this.errorCounts, `HTTP ${status}`);
    else this.successes += 1;
  }
}
