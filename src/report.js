import { describeConfig } from "./analysis.js";
import { formatMs } from "./format.js";

const BAR_WIDTH = 30;

function histogramLines(rows) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const widest = Math.max(...rows.map((row) => row.count));
  return rows.map((row) => {
    const label = `${row.from.toFixed(2)} - ${row.to.toFixed(2)} ms`.padStart(22);
    const bar = "\u2588".repeat(Math.round((row.count / widest) * BAR_WIDTH)).padEnd(BAR_WIDTH);
    const percent = ((row.count / total) * 100).toFixed(1).padStart(5);
    return `  ${label}  ${bar}  ${String(row.count).padStart(6)}  ${percent}%${row.tail ? "  (slowest 1%)" : ""}`;
  });
}

export function formatText(config, analysis) {
  const { latency } = analysis;
  const lines = [
    `${config.method} ${config.url}`,
    `${analysis.requests} requests in ${(analysis.elapsedMs / 1000).toFixed(2)} s with concurrency ${config.concurrency}`,
    `${analysis.requestsPerSecond.toFixed(1)} requests/s`,
  ];
  if (analysis.errors > 0) {
    const detail = Object.entries(analysis.errorCounts).map(([name, count]) => `${name}: ${count}`).join(", ");
    lines.push(`${analysis.errors} failed (${detail})`);
  }
  const statuses = Object.entries(analysis.statusCodes);
  if (statuses.length > 0) {
    lines.push("", "Status codes", ...statuses.map(([status, count]) => `  ${status}  ${count}`));
  }
  if (latency.count > 0) {
    lines.push("", "Latency", `  min   ${formatMs(latency.min)}`, `  mean  ${formatMs(latency.mean)}`);
    for (const [p, value] of Object.entries(latency.percentiles)) lines.push(`  p${p}`.padEnd(8) + formatMs(value));
    lines.push(`  max   ${formatMs(latency.max)}`);
    lines.push("", "Histogram", ...histogramLines(analysis.histogram));
  }
  return lines.join("\n") + "\n";
}

/** The machine-readable report; the layout is described in the README. */
export function formatJson(config, analysis, version) {
  const { latency } = analysis;
  const document = {
    version: 1,
    tool: { name: "http-bench", version },
    config: describeConfig(config),
    summary: {
      requests: analysis.requests,
      responses: analysis.responses,
      successes: analysis.successes,
      errors: analysis.errors,
      elapsedMs: analysis.elapsedMs,
      requestsPerSecond: analysis.requestsPerSecond,
    },
    latencyMs: {
      min: latency.min,
      mean: latency.mean,
      stddev: latency.stddev,
      max: latency.max,
      percentiles: latency.percentiles,
    },
    histogram: analysis.histogram.map(({ from, to, count, tail }) => ({ fromMs: from, toMs: to, count, ...(tail ? { tail } : {}) })),
    statusCodes: analysis.statusCodes,
    errors: analysis.errorCounts,
  };
  return JSON.stringify(document, null, 2) + "\n";
}
