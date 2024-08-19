import { formatMs } from "./format.js";
import { histogram, summarize } from "./stats.js";

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

function countBy(samples, key) {
  const counts = new Map();
  for (const sample of samples) {
    const value = sample[key];
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function formatText({ url, method, concurrency }, { samples, elapsedMs }) {
  const responses = samples.filter((s) => s.error === undefined);
  const errors = samples.length - responses.length;
  const latency = summarize(responses.map((s) => s.latency));
  const seconds = elapsedMs / 1000;
  const lines = [
    `${method} ${url}`,
    `${samples.length} requests in ${seconds.toFixed(2)} s with concurrency ${concurrency}`,
    `${(samples.length / seconds).toFixed(1)} requests/s`,
  ];
  if (errors > 0) {
    const detail = [...countBy(samples, "error")].map(([name, count]) => `${name}: ${count}`).join(", ");
    lines.push(`${errors} failed (${detail})`);
  }
  if (latency.count > 0) {
    lines.push("", "Latency", `  min   ${formatMs(latency.min)}`, `  mean  ${formatMs(latency.mean)}`);
    for (const [p, value] of Object.entries(latency.percentiles)) lines.push(`  p${p}`.padEnd(8) + formatMs(value));
    lines.push(`  max   ${formatMs(latency.max)}`);
    lines.push("", "Histogram", ...histogramLines(histogram(responses.map((s) => s.latency))));
  }
  return lines.join("\n") + "\n";
}
