import fs from "node:fs";
import { parseArgs } from "node:util";

import { analyze } from "./analysis.js";
import { compareRuns, loadBaseline } from "./compare.js";
import { startProgress } from "./progress.js";
import { Recorder } from "./recorder.js";
import { HELP, OPTIONS, UsageError, buildConfig } from "./options.js";
import { evaluateThresholds } from "./thresholds.js";
import { buildDocument, formatJson, formatText } from "./report.js";
import { run } from "./runner.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const EXIT_OK = 0;
export const EXIT_THRESHOLD = 1; // a --threshold was not met
export const EXIT_USAGE = 2;
export const EXIT_NO_SUCCESS = 3; // the target was unreachable or every request failed

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    } catch (error) {
      throw new UsageError(`${error.message}\nTry 'http-bench --help'.`);
    }
    const { values, positionals } = parsed;
    if (values.help) {
      stdout.write(HELP);
      return EXIT_OK;
    }
    if (values.version) {
      stdout.write(`http-bench ${pkg.version}\n`);
      return EXIT_OK;
    }

    const config = buildConfig(values, positionals);
    let baseline;
    if (config.compare !== undefined) {
      try {
        baseline = loadBaseline(config.compare);
      } catch (error) {
        throw new UsageError(error.message);
      }
    }
    const recorder = new Recorder();
    const stopProgress = values.progress ? startProgress(recorder, stderr, { intervalMs: io.progressIntervalMs }) : () => {};
    let result;
    try {
      result = await run({ ...config, recorder, fetchImpl: io.fetch });
    } finally {
      stopProgress();
    }
    const analysis = analyze(result);
    analysis.thresholds = evaluateThresholds(config.thresholds, analysis);
    if (baseline) {
      const comparison = compareRuns(baseline, buildDocument(config, analysis, pkg.version), { maxRegression: config.maxRegression });
      analysis.comparison = { baseline: config.compare, ...comparison };
    }
    stdout.write(values.json ? formatJson(config, analysis, pkg.version) : formatText(config, analysis));
    if (analysis.successes === 0) return EXIT_NO_SUCCESS;
    return analysis.thresholds.every((t) => t.passed) && !analysis.comparison?.regressed ? EXIT_OK : EXIT_THRESHOLD;
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`http-bench: ${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
}
