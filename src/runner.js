import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import { Recorder } from "./recorder.js";

/** A short name for why a request failed: a system error code, "timeout" or the error name. */
export function describeError(error) {
  if (error?.name === "TimeoutError") return "timeout";
  return error?.cause?.code ?? error?.code ?? error?.name ?? "error";
}

/**
 * A pacer for `rate` requests per second: each call reserves the next time slot, waits for it
 * and returns the slot's time. Slots are reserved immediately, so concurrent callers queue up
 * in order and a slow response doesn't shift the schedule of the next ones.
 */
export function createPacer(rate, { now = () => performance.now(), wait = sleep } = {}) {
  const interval = 1000 / rate;
  let next = null;
  return async function pace() {
    next = next === null ? now() : next + interval;
    const scheduled = next;
    const delay = scheduled - now();
    if (delay > 0) await wait(delay);
    return scheduled;
  };
}

/**
 * Send requests with `concurrency` of them in flight at a time, until `requests` have been
 * sent or `duration` milliseconds have passed, whichever comes first. A request that
 * is already in flight when the time is up is allowed to finish.
 * `targets` ([{url, method, headers, body}]) are sent in turn; a single `url` is a short way of
 * giving one target.
 * With `rate` (requests per second) the requests are spread evenly instead of being sent as
 * fast as the responses allow; `concurrency` is then the maximum in flight, and latency is
 * measured from the time a request was due, not from when a free worker got to send it.
 * With `warmup` ({requests} or {duration}) a first phase of that size runs before the
 * measured one and its results are discarded.
 * A request that takes longer than `timeout` milliseconds is abandoned and counted as the
 * error "timeout".
 *
 * A `signal` (AbortSignal) cancels the run: nothing new is sent, requests in flight are abandoned
 * without being counted, and the result has `interrupted: true`.
 * Results go to `recorder` (a new one by default), which may be watched while the run is in
 * progress. Returns `{recorder, elapsedMs}`; see Recorder for what is collected.
 */
export async function run({ warmup, recorder = new Recorder(), signal, ...options }) {
  if (warmup) {
    // Connections, DNS and server caches get warm; none of this is measured.
    await runPhase({ ...options, requests: warmup.requests, duration: warmup.duration, signal }, new Recorder());
  }
  return runPhase({ ...options, signal }, recorder);
}

async function runPhase({ targets, url, requests, duration, concurrency, rate, method = "GET", headers, body, timeout, redirect, signal: stop, fetchImpl = globalThis.fetch }, recorder) {
  const list = targets ?? [{ url, method, headers, body }];
  const limit = requests ?? Infinity;
  const pace = rate ? createPacer(rate) : null;
  let issued = 0;
  const started = performance.now();
  const deadline = duration === undefined ? Infinity : started + duration;
  async function worker() {
    while (issued < limit && performance.now() < deadline && !stop?.aborted) {
      issued += 1;
      const target = list[(issued - 1) % list.length];
      let start;
      if (pace) {
        // With a rate, a request is "due" at its time slot. If the previous responses were
        // slow and it can only be sent later, that delay is part of what a client at that
        // rate would have experienced - measuring from the actual send time would hide it
        // (coordinated omission).
        start = await pace();
        if (performance.now() >= deadline || stop?.aborted) break;
      } else {
        start = performance.now();
      }
      let outcome;
      try {
        const signals = [timeout === undefined ? null : AbortSignal.timeout(timeout), stop ?? null].filter(Boolean);
        const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
        const response = await fetchImpl(target.url, { method: target.method, headers: target.headers, body: target.body, redirect, signal });
        // Read the whole body: the request is not finished before that, the connection can
        // only be reused afterwards, and the transferred bytes are part of the results.
        const content = await response.arrayBuffer();
        // A timer can fire a little early, so a very fast response can finish before the time
        // slot it was due in; that is a latency of zero, not a negative one.
        outcome = { latency: Math.max(0, performance.now() - start), status: response.status, bytes: content.byteLength };
      } catch (error) {
        if (stop?.aborted) break; // cancelled by the caller: not a result
        outcome = { error: describeError(error) };
      }
      recorder.record(outcome);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, limit) }, worker));
  return { recorder, elapsedMs: performance.now() - started, interrupted: Boolean(stop?.aborted) };
}
