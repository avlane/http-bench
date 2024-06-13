import { formatMs } from "./format.js";
import { summarize } from "./stats.js";

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
  }
  return lines.join("\n") + "\n";
}
