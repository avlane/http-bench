import { performance } from "node:perf_hooks";

/** One status line for a run in progress. */
export function formatProgress({ elapsedMs, requests, failed }) {
  const seconds = elapsedMs / 1000;
  const rate = seconds > 0 ? requests / seconds : 0;
  return `${seconds.toFixed(1).padStart(6)} s  ${requests.toLocaleString("en-US")} requests  ${rate.toFixed(0)} req/s  ${failed} failed`;
}

/**
 * Redraw a status line on `stream` every `intervalMs` while a run is in progress.
 * Returns a function that stops the updates and erases the line.
 */
export function startProgress(recorder, stream, { intervalMs = 500, now = () => performance.now() } = {}) {
  intervalMs ??= 500;
  const started = now();
  const draw = () => {
    stream.write(`\r${formatProgress({ elapsedMs: now() - started, requests: recorder.requests, failed: recorder.requests - recorder.successes })}`);
  };
  const timer = setInterval(draw, intervalMs);
  return function stop() {
    clearInterval(timer);
    stream.write("\r\x1b[K");
  };
}
