import fs from "node:fs";

import { parseDuration } from "./duration.js";
import { buildRequest } from "./request.js";
import { loadRequestsFile } from "./scenario.js";
import { parseThreshold } from "./thresholds.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export class UsageError extends Error {}

export const HELP = `Usage: http-bench [options] URL
       http-bench [options] --requests-file FILE [BASE_URL]

Send HTTP requests to URL and report throughput and latency percentiles.

Options:
  -n, --requests N     number of requests to send (default: 100 unless --duration is given)
  -d, --duration TIME  send requests for this long, e.g. 10s or 1m (stops at -n if that comes first)
  -c, --concurrency N  requests in flight at a time (default: 10)
  -X, --method METHOD  HTTP method (default: GET, or POST when there is a body)
  -H, --header LINE    add a request header, "Name: value" (repeatable)
  -b, --body TEXT      request body
      --body-file FILE read the request body from FILE
      --requests-file FILE  send the requests described in FILE (a JSON array or JSON Lines),
                       in turn; URLs may be relative to BASE_URL
      --rate N         send N requests per second at most, evenly spaced (default: as fast as possible)
      --warmup N|TIME  send N requests (or send for TIME) first and leave them out of the results
      --timeout TIME   give up on a request after this long (default: 10s)
      --threshold EXPR  fail (exit 1) unless EXPR holds, e.g. p99<250ms, errors<1%, rps>500 (repeatable)
      --progress       show a live status line on stderr while the run is in progress
      --json           print the results as JSON instead of text
  -h, --help           show this help
  -v, --version        show the version
`;

export const OPTIONS = {
  requests: { type: "string", short: "n" },
  duration: { type: "string", short: "d" },
  timeout: { type: "string", default: "10s" },
  rate: { type: "string" },
  warmup: { type: "string" },
  concurrency: { type: "string", short: "c", default: "10" },
  method: { type: "string", short: "X" },
  header: { type: "string", short: "H", multiple: true },
  body: { type: "string", short: "b" },
  "body-file": { type: "string" },
  "requests-file": { type: "string" },
  threshold: { type: "string", multiple: true },
  progress: { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

function positiveInteger(name, text) {
  if (!/^[1-9]\d*$/.test(text)) throw new UsageError(`--${name} must be a positive integer, got '${text}'`);
  return Number(text);
}

function positiveDuration(name, text) {
  let ms;
  try {
    ms = parseDuration(text);
  } catch (error) {
    throw new UsageError(`--${name}: ${error.message}`);
  }
  if (ms === 0) throw new UsageError(`--${name} must be longer than zero`);
  return ms;
}

function parseBaseUrl(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new UsageError(`not a valid URL: ${text}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UsageError(`unsupported protocol ${url.protocol} (use http or https)`);
  return url;
}

/** Validate the parsed command line and turn it into the settings of a run. */
export function buildConfig(values, positionals) {
  const requestsFile = values["requests-file"];
  if (positionals.length > 1 || (positionals.length === 0 && requestsFile === undefined)) throw new UsageError("expected exactly one URL");
  const baseUrl = positionals.length === 1 ? parseBaseUrl(positionals[0]) : undefined;

  const duration = values.duration === undefined ? undefined : positiveDuration("duration", values.duration);
  let warmup;
  if (values.warmup !== undefined) {
    warmup = /^\d+$/.test(values.warmup)
      ? { requests: positiveInteger("warmup", values.warmup) }
      : { duration: positiveDuration("warmup", values.warmup) };
  }
  let rate;
  if (values.rate !== undefined) {
    rate = Number(values.rate);
    if (!(rate > 0) || !Number.isFinite(rate)) throw new UsageError(`--rate must be a positive number of requests per second, got '${values.rate}'`);
  }
  const userAgent = `http-bench/${pkg.version}`;
  let targets;
  try {
    if (requestsFile !== undefined) {
      if (values.body !== undefined || values["body-file"] !== undefined) {
        throw new Error("--body and --body-file cannot be combined with --requests-file; put the bodies in the file");
      }
      targets = loadRequestsFile(requestsFile, { baseUrl, headers: values.header ?? [], method: values.method, userAgent });
    } else {
      const request = buildRequest({ method: values.method, headers: values.header, body: values.body, bodyFile: values["body-file"], userAgent });
      targets = [{ url: baseUrl.href, method: request.method, headers: request.headers, body: request.body }];
    }
  } catch (error) {
    throw new UsageError(error.message);
  }
  let thresholds;
  try {
    thresholds = (values.threshold ?? []).map(parseThreshold);
  } catch (error) {
    throw new UsageError(`--threshold: ${error.message}`);
  }
  return {
    thresholds,
    targets,
    url: targets[0].url,
    method: targets[0].method,
    headers: targets[0].headers,
    body: targets[0].body,
    timeout: positiveDuration("timeout", values.timeout),
    rate,
    warmup,
    requests: values.requests !== undefined ? positiveInteger("requests", values.requests) : duration === undefined ? 100 : undefined,
    duration,
    concurrency: positiveInteger("concurrency", values.concurrency),
  };
}
