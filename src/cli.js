import fs from "node:fs";
import { parseArgs } from "node:util";

import { parseDuration } from "./duration.js";
import { buildRequest } from "./request.js";
import { formatText } from "./report.js";
import { run } from "./runner.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_NO_SUCCESS = 3; // the target was unreachable or every request failed

const HELP = `Usage: http-bench [options] URL

Send HTTP requests to URL and report throughput and latency percentiles.

Options:
  -n, --requests N     number of requests to send (default: 100 unless --duration is given)
      --timeout TIME   give up on a request after this long (default: 10s)
  -d, --duration TIME  send requests for this long, e.g. 10s or 1m (stops at -n if that comes first)
  -c, --concurrency N  requests in flight at a time (default: 10)
  -X, --method METHOD  HTTP method (default: GET, or POST when there is a body)
  -H, --header LINE    add a request header, "Name: value" (repeatable)
  -b, --body TEXT      request body
      --body-file FILE read the request body from FILE
  -h, --help           show this help
  -v, --version        show the version
`;

const OPTIONS = {
  requests: { type: "string", short: "n" },
  duration: { type: "string", short: "d" },
  timeout: { type: "string", default: "10s" },
  concurrency: { type: "string", short: "c", default: "10" },
  method: { type: "string", short: "X" },
  header: { type: "string", short: "H", multiple: true },
  body: { type: "string", short: "b" },
  "body-file": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

class UsageError extends Error {}

function positiveInteger(name, text) {
  if (!/^[1-9]\d*$/.test(text)) throw new UsageError(`--${name} must be a positive integer, got '${text}'`);
  return Number(text);
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
    if (positionals.length !== 1) throw new UsageError("expected exactly one URL");
    let url;
    try {
      url = new URL(positionals[0]);
    } catch {
      throw new UsageError(`not a valid URL: ${positionals[0]}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new UsageError(`unsupported protocol ${url.protocol} (use http or https)`);

    let duration;
    if (values.duration !== undefined) {
      try {
        duration = parseDuration(values.duration);
      } catch (error) {
        throw new UsageError(`--duration: ${error.message}`);
      }
      if (duration === 0) throw new UsageError("--duration must be longer than zero");
    }
    let timeout;
    try {
      timeout = parseDuration(values.timeout);
    } catch (error) {
      throw new UsageError(`--timeout: ${error.message}`);
    }
    if (timeout === 0) throw new UsageError("--timeout must be longer than zero");
    let request;
    try {
      request = buildRequest({
        method: values.method,
        headers: values.header,
        body: values.body,
        bodyFile: values["body-file"],
        userAgent: `http-bench/${pkg.version}`,
      });
    } catch (error) {
      throw new UsageError(error.message);
    }
    const config = {
      url: url.href,
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeout,
      requests: values.requests !== undefined ? positiveInteger("requests", values.requests) : duration === undefined ? 100 : undefined,
      duration,
      concurrency: positiveInteger("concurrency", values.concurrency),
    };
    const result = await run({ ...config, fetchImpl: io.fetch });
    stdout.write(formatText(config, result));
    return result.samples.some((s) => s.status !== undefined) ? EXIT_OK : EXIT_NO_SUCCESS;
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`http-bench: ${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
}
