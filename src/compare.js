import fs from "node:fs";

import { formatMs } from "./format.js";

const LATENCY = (key) => (doc) => doc.latencyMs?.percentiles?.[key] ?? null;

// lowerIsBetter: a bigger number is a regression. "points" rows are compared as a difference
// in percentage points, the others as a relative change.
const ROWS = [
  { label: "p50", get: LATENCY("50"), lowerIsBetter: true, unit: "ms" },
  { label: "p90", get: LATENCY("90"), lowerIsBetter: true, unit: "ms" },
  { label: "p95", get: LATENCY("95"), lowerIsBetter: true, unit: "ms" },
  { label: "p99", get: LATENCY("99"), lowerIsBetter: true, unit: "ms" },
  { label: "mean", get: (doc) => doc.latencyMs?.mean ?? null, lowerIsBetter: true, unit: "ms" },
  { label: "rps", get: (doc) => doc.summary?.requestsPerSecond ?? null, lowerIsBetter: false, unit: "rps" },
  {
    label: "errors",
    get: (doc) => (doc.summary?.requests ? (doc.summary.errors / doc.summary.requests) * 100 : null),
    lowerIsBetter: true,
    unit: "points",
  },
];

/** Read a report written by an earlier `--json` run. */
export function loadBaseline(file) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read baseline ${file}: ${error instanceof SyntaxError ? "not valid JSON" : error.code ?? error.message}`);
  }
  if (document?.version !== 1 || document?.tool?.name !== "http-bench" || !document.summary) {
    throw new Error(`${file} is not an http-bench --json report`);
  }
  return document;
}

/**
 * Compare two reports (as objects). A row is "worse" if the number moved the wrong way, and
 * "regressed" if it moved the wrong way by more than `maxRegression` percent (percentage
 * points for the error rate).
 */
export function compareRuns(baseline, current, { maxRegression } = {}) {
  const rows = [];
  for (const row of ROWS) {
    const before = row.get(baseline);
    const after = row.get(current);
    if (before === null || after === null) continue;
    const change = row.unit === "points" ? after - before : before === 0 ? (after === 0 ? 0 : Infinity) : ((after - before) / before) * 100;
    const worse = row.lowerIsBetter ? change > 0 : change < 0;
    const regressed = maxRegression !== undefined && worse && Math.abs(change) > maxRegression;
    rows.push({ metric: row.label, unit: row.unit, before, after, change: Number.isFinite(change) ? change : null, worse, regressed });
  }
  return { rows, regressed: rows.some((row) => row.regressed) };
}

export function comparisonValue(row, value) {
  return formatValue(row, value);
}

function formatValue(row, value) {
  if (row.unit === "ms") return formatMs(value);
  if (row.unit === "rps") return value.toFixed(1);
  return `${value.toFixed(2)}%`;
}

function formatChange(row) {
  if (row.change === null) return "new";
  const sign = row.change >= 0 ? "+" : "";
  return row.unit === "points" ? `${sign}${row.change.toFixed(2)} pts` : `${sign}${row.change.toFixed(1)}%`;
}

export function comparisonLines(comparison) {
  const lines = [`Compared with ${comparison.baseline}`, "  metric    before       after        change"];
  for (const row of comparison.rows) {
    const flag = row.regressed ? "  REGRESSION" : row.worse ? "  worse" : "";
    lines.push(`  ${row.metric.padEnd(8)}  ${formatValue(row, row.before).padEnd(11)}  ${formatValue(row, row.after).padEnd(11)}  ${formatChange(row)}${flag}`);
  }
  return lines;
}
