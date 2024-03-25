import { formatMs } from "./format.js";
import { summarize } from "./stats.js";

export function formatText({ url, method, concurrency }, { samples, elapsedMs }) {
  const ok = samples.filter((s) => s.error === undefined);
  const latency = summarize(ok.map((s) => s.latency));
  const seconds = elapsedMs / 1000;
  const lines = [
    `${method} ${url}`,
    `${samples.length} requests in ${seconds.toFixed(2)} s with concurrency ${concurrency}`,
    `${(samples.length / seconds).toFixed(1)} requests/s`,
    "",
    "Latency",
    `  min   ${formatMs(latency.min)}`,
    `  mean  ${formatMs(latency.mean)}`,
  ];
  for (const [p, value] of Object.entries(latency.percentiles)) lines.push(`  p${p}`.padEnd(8) + formatMs(value));
  lines.push(`  max   ${formatMs(latency.max)}`);
  return lines.join("\n") + "\n";
}
