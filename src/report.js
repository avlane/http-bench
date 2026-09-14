import { describeConfig } from "./analysis.js";
import { formatBytes, formatMs } from "./format.js";
import { comparisonLines, comparisonValue } from "./compare.js";
import { formatActual } from "./thresholds.js";

const BAR_WIDTH = 30;
const BLOCKS = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";

/** One character per value, as tall as the value is relative to the largest. */
export function sparkline(values) {
  const peak = Math.max(...values);
  if (!(peak > 0)) return BLOCKS[0].repeat(values.length);
  return values.map((value) => BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((value / peak) * (BLOCKS.length - 1) + 0.5))]).join("");
}

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

/** When nothing at all worked, say what the most common cause of the usual errors is. */
export function hintLines(config, analysis) {
  if (analysis.successes > 0) return [];
  const { host, port, hostname } = new URL(config.url);
  const errors = analysis.errorCounts;
  if (errors.ECONNREFUSED) return [`Hint: nothing is accepting connections on ${host}${port ? "" : " (default port)"} - is the server running?`];
  if (errors.ENOTFOUND || errors.EAI_AGAIN) return [`Hint: the host name ${hostname} could not be resolved.`];
  if (errors.timeout === analysis.errors) return [`Hint: every request timed out after ${formatMs(config.timeout)}; the server may be overloaded, or --timeout too short.`];
  return [];
}

export function formatText(config, analysis) {
  const { latency } = analysis;
  const targets = config.targets ?? [];
  const lines = [
    ...(analysis.interrupted ? [`Interrupted: the results cover the first ${(analysis.elapsedMs / 1000).toFixed(1)} s only.`] : []),
    ...(targets.length > 1
      ? [`${targets.length} requests in turn:`, ...targets.slice(0, 5).map((t) => `  ${t.method} ${t.url}`), ...(targets.length > 5 ? [`  ... and ${targets.length - 5} more`] : [])]
      : [`${config.method} ${config.url}`]),
    `${analysis.requests} requests in ${(analysis.elapsedMs / 1000).toFixed(2)} s with concurrency ${config.concurrency}`,
    `${analysis.requestsPerSecond.toFixed(1)} requests/s`,
    `${formatBytes(analysis.bytes)} received (${formatBytes(analysis.bytes / (analysis.elapsedMs / 1000))}/s)`,
  ];
  if (analysis.errors > 0) {
    const detail = Object.entries(analysis.errorCounts).map(([name, count]) => `${name}: ${count}`).join(", ");
    lines.push(`${analysis.errors} failed (${detail})`);
    lines.push(...hintLines(config, analysis));
  }
  if (analysis.timeline.length >= 3) lines.push("", `Requests per second  ${sparkline(analysis.timeline.map((t) => t.requests))}  (peak ${Math.max(...analysis.timeline.map((t) => t.requests))})`);
  if (analysis.timeline.length >= 3 && analysis.timeline.some((t) => t.meanLatencyMs !== null)) {
    const means = analysis.timeline.map((t) => t.meanLatencyMs ?? 0);
    lines.push(`Mean latency         ${sparkline(means)}  (peak ${formatMs(Math.max(...means))})`);
  }
  const statuses = Object.entries(analysis.statusCodes);
  if (statuses.length > 0) {
    lines.push("", "Status codes", ...statuses.map(([status, count]) => `  ${status}  ${count}`));
  }
  if (latency.count > 0) {
    lines.push("", config.rate ? "Latency (from the time each request was due)" : "Latency", `  min   ${formatMs(latency.min)}`, `  mean  ${formatMs(latency.mean)}`);
    for (const [p, value] of Object.entries(latency.percentiles)) lines.push(`  p${p}`.padEnd(8) + formatMs(value));
    lines.push(`  max   ${formatMs(latency.max)}`);
    lines.push("", "Histogram", ...histogramLines(analysis.histogram));
  }
  if (analysis.byTarget.length > 1) {
    lines.push("", "By request", "  requests  failed  p50        p99        request");
    for (const row of analysis.byTarget) {
      const { method, url } = config.targets[row.index];
      const location = new URL(url);
      lines.push(`  ${String(row.requests).padStart(8)}  ${String(row.failed).padStart(6)}  ${formatMs(row.p50).padEnd(9)}  ${formatMs(row.p99).padEnd(9)}  ${method} ${location.pathname}${location.search}`);
    }
  }
  if (analysis.comparison) lines.push("", ...comparisonLines(analysis.comparison));
  if (analysis.thresholds?.length > 0) {
    lines.push("", "Thresholds");
    for (const result of analysis.thresholds) lines.push(`  ${result.passed ? "PASS" : "FAIL"}  ${result.expression}  (${formatActual(result)})`);
  }
  return lines.join("\n") + "\n";
}

/** Text for a Markdown table cell: a pipe would start a new column, a newline end the row. */
function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** A code span for a table cell; backticks inside the text are handled by using a longer fence. */
function code(text) {
  const value = String(text);
  const fence = "`".repeat(Math.max(0, ...[...value.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return cell(`${fence}${pad}${value}${pad}${fence}`);
}

/** A table for pull request comments and chat. */
export function formatMarkdown(config, analysis) {
  const { latency } = analysis;
  const target = (config.targets?.length ?? 0) > 1 ? `${config.targets.length} requests in turn` : `${config.method} ${config.url}`;
  const rows = [
    ["Requests", `${analysis.requests} in ${(analysis.elapsedMs / 1000).toFixed(2)} s with concurrency ${config.concurrency}`],
    ["Succeeded", `${analysis.successes} (${analysis.requests ? ((analysis.successes / analysis.requests) * 100).toFixed(1) : "0.0"}%)`],
    ["Failed", cell(`${analysis.errors}${analysis.errors > 0 ? ` (${Object.entries(analysis.errorCounts).map(([name, count]) => `${name}: ${count}`).join(", ")})` : ""}`)],
    ["Throughput", `${analysis.requestsPerSecond.toFixed(1)} requests/s`],
    ["Received", formatBytes(analysis.bytes)],
  ];
  if (latency.count > 0) {
    rows.push(["Latency min", formatMs(latency.min)], ["Latency mean", formatMs(latency.mean)]);
    for (const [p, value] of Object.entries(latency.percentiles)) rows.push([`Latency p${p}`, formatMs(value)]);
    rows.push(["Latency max", formatMs(latency.max)]);
  }
  const lines = [`### http-bench: ${code(target)}`, "", "| | |", "| --- | --- |", ...rows.map(([name, value]) => `| ${name} | ${value} |`)];
  if (analysis.thresholds?.length > 0) {
    lines.push("", "| Threshold | Result | Actual |", "| --- | --- | --- |");
    for (const t of analysis.thresholds) lines.push(`| ${code(t.expression)} | ${t.passed ? "pass" : "**FAIL**"} | ${formatActual(t)} |`);
  }
  if (analysis.comparison) {
    lines.push("", `Compared with ${code(analysis.comparison.baseline)}:`, "", "| Metric | Before | After | Change |", "| --- | --- | --- | --- |");
    for (const row of analysis.comparison.rows) {
      const change = row.change === null ? "new" : `${row.change >= 0 ? "+" : ""}${row.change.toFixed(row.unit === "points" ? 2 : 1)}${row.unit === "points" ? " pts" : "%"}`;
      lines.push(`| ${row.metric} | ${comparisonValue(row, row.before)} | ${comparisonValue(row, row.after)} | ${change}${row.regressed ? " **REGRESSION**" : ""} |`);
    }
  }
  return lines.join("\n") + "\n";
}

/** One line for scripts, followed by the thresholds and regressions that were not met. */
export function formatQuiet(config, analysis) {
  const parts = [`${analysis.requests} requests in ${(analysis.elapsedMs / 1000).toFixed(2)} s`, `${analysis.requestsPerSecond.toFixed(1)} req/s`];
  for (const p of ["50", "99"]) {
    if (analysis.latency.percentiles[p] !== undefined) parts.push(`p${p} ${formatMs(analysis.latency.percentiles[p])}`);
  }
  parts.push(`${analysis.errors} failed`);
  const lines = [`${parts[0]}: ${parts.slice(1).join(", ")}`];
  for (const result of analysis.thresholds ?? []) {
    if (!result.passed) lines.push(`FAIL ${result.expression} (${formatActual(result)})`);
  }
  for (const row of analysis.comparison?.rows ?? []) {
    if (row.regressed) lines.push(`REGRESSION ${row.metric}`);
  }
  return lines.join("\n") + "\n";
}

/** The machine-readable report as an object; the layout is described in the README. */
export function buildDocument(config, analysis, version) {
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
      interrupted: Boolean(analysis.interrupted),
      bytes: analysis.bytes,
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
    timeline: analysis.timeline,
    ...(analysis.byTarget.length > 1 ? { requestsByDefinition: analysis.byTarget.map((row) => ({ ...row, method: config.targets[row.index].method, url: config.targets[row.index].url })) } : {}),
    thresholds: (analysis.thresholds ?? []).map(({ expression, actual, passed }) => ({ expression, actual, passed })),
  };
  if (analysis.comparison) document.comparison = analysis.comparison;
  return document;
}

export function formatJson(config, analysis, version) {
  return JSON.stringify(buildDocument(config, analysis, version), null, 2) + "\n";
}
