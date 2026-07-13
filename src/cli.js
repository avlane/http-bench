import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { analyze } from "./analysis.js";
import { compareRuns, loadBaseline } from "./compare.js";
import { startProgress } from "./progress.js";
import { Recorder } from "./recorder.js";
import { HELP, OPTIONS, UsageError, buildConfig, chooseFormat } from "./options.js";
import { evaluateThresholds } from "./thresholds.js";
import { buildDocument, formatJson, formatMarkdown, formatQuiet, formatText } from "./report.js";
import { run } from "./runner.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const EXIT_OK = 0;
export const EXIT_THRESHOLD = 1; // a --threshold was not met
export const EXIT_USAGE = 2;
export const EXIT_INTERRUPTED = 130; // stopped with Ctrl-C; the report covers what was measured
export const EXIT_NO_SUCCESS = 3; // the target was unreachable or every request failed

/** Write to a temporary file next to the target and rename it, so readers never see half a report. */
function writeFileAtomically(file, text) {
  const temporary = path.join(path.dirname(path.resolve(file)), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw new UsageError(`cannot write ${file}: ${error.code ?? error.message}`);
  }
}

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

    const format = chooseFormat(values);
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
      result = await run({ ...config, recorder, signal: io.signal, fetchImpl: io.fetch });
    } finally {
      stopProgress();
    }
    const analysis = analyze(result, config.percentiles);
    analysis.interrupted = result.interrupted;
    analysis.thresholds = evaluateThresholds(config.thresholds, analysis);
    if (baseline) {
      const comparison = compareRuns(baseline, buildDocument(config, analysis, pkg.version), { maxRegression: config.maxRegression });
      analysis.comparison = { baseline: config.compare, ...comparison };
    }
    const report = format === "json" ? formatJson(config, analysis, pkg.version) : format === "markdown" ? formatMarkdown(config, analysis) : values.quiet ? formatQuiet(config, analysis) : formatText(config, analysis);
    if (values.output) writeFileAtomically(values.output, report);
    else stdout.write(report);
    if (result.interrupted) return EXIT_INTERRUPTED;
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
