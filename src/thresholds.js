import { parseDuration } from "./duration.js";
import { formatMs } from "./format.js";

const OPERATORS = {
  "<": (actual, limit) => actual < limit,
  "<=": (actual, limit) => actual <= limit,
  ">": (actual, limit) => actual > limit,
  ">=": (actual, limit) => actual >= limit,
};

const LATENCY_METRICS = new Set(["min", "mean", "max"]);

function isLatencyMetric(metric) {
  return LATENCY_METRICS.has(metric) || /^p\d+(?:\.\d+)?$/.test(metric);
}

/**
 * Parse an expectation such as "p99<250ms", "mean <= 80ms", "errors<1%" or "rps>500".
 * Metrics: min, mean, max, p<percentile> (latency, needs a duration), rps (requests per
 * second) and errors (the percentage of requests that failed).
 */
export function parseThreshold(text) {
  const match = /^\s*([a-z0-9.]+)\s*(<=|>=|<|>)\s*(\S+)\s*$/i.exec(text);
  if (!match) throw new Error(`invalid threshold '${text}' (examples: p99<250ms, errors<1%, rps>500)`);
  const [, metric, operator, raw] = match;
  let value;
  if (isLatencyMetric(metric)) {
    if (metric.startsWith("p") && !(Number(metric.slice(1)) > 0 && Number(metric.slice(1)) <= 100)) {
      throw new Error(`invalid threshold '${text}': percentiles are between 0 and 100`);
    }
    try {
      value = parseDuration(raw);
    } catch (error) {
      throw new Error(`invalid threshold '${text}': ${error.message}`);
    }
  } else if (metric === "rps" || metric === "errors") {
    const number = /^(\d+(?:\.\d+)?)(%?)$/.exec(raw);
    if (!number || (metric === "rps" && number[2])) throw new Error(`invalid threshold '${text}': ${metric} needs ${metric === "rps" ? "a number" : "a percentage such as 1%"}`);
    value = Number(number[1]);
  } else {
    throw new Error(`invalid threshold '${text}': unknown metric '${metric}' (use min, mean, max, p99, rps or errors)`);
  }
  return { expression: `${metric}${operator}${raw}`, metric, operator, value };
}

function actualValue(metric, analysis) {
  if (metric === "rps") return analysis.requestsPerSecond;
  if (metric === "errors") return analysis.requests === 0 ? 0 : (analysis.errors / analysis.requests) * 100;
  if (analysis.latency.count === 0) return null;
  if (metric === "min" || metric === "mean" || metric === "max") return analysis.latency[metric];
  return analysis.percentile(Number(metric.slice(1)));
}

/** Check each threshold against the results. A latency that could not be measured fails. */
export function evaluateThresholds(thresholds, analysis) {
  return thresholds.map((threshold) => {
    const actual = actualValue(threshold.metric, analysis);
    return {
      expression: threshold.expression,
      actual,
      passed: actual !== null && OPERATORS[threshold.operator](actual, threshold.value),
    };
  });
}

export function formatActual(result) {
  if (result.actual === null) return "no data";
  const metric = /^[a-z0-9.]+/i.exec(result.expression)[0];
  if (metric === "rps") return `${result.actual.toFixed(1)} req/s`;
  if (metric === "errors") return `${result.actual.toFixed(2)}%`;
  return formatMs(result.actual);
}
