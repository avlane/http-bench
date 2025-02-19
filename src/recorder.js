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
  }

  #increment(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  /** `{latency, status, bytes}` for a response, `{error}` for a request that failed to get one. */
  record({ latency, status, error, bytes = 0 }) {
    this.requests += 1;
    if (error !== undefined) {
      this.#increment(this.errorCounts, error);
      return;
    }
    this.responses += 1;
    this.bytes += bytes;
    this.#increment(this.statusCodes, status);
    this.histogram.record(latency);
    if (status >= 400) this.#increment(this.errorCounts, `HTTP ${status}`);
    else this.successes += 1;
  }
}
