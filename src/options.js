import fs from "node:fs";

import { parseDuration } from "./duration.js";
import { buildRequest, extractCredentials } from "./request.js";
import { loadRequestsFile } from "./scenario.js";
import { templateTarget } from "./template.js";
import { parseThreshold } from "./thresholds.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export class UsageError extends Error {}

function parsePercentiles(text) {
  const list = text.split(",").map((part) => part.trim());
  const numbers = list.map((part) => (/^\d+(?:\.\d+)?$/.test(part) ? Number(part) : NaN));
  if (numbers.some((n) => !(n > 0 && n <= 100)) || new Set(numbers).size !== numbers.length) {
    throw new UsageError(`--percentiles must be distinct numbers above 0 and up to 100, such as 50,95,99.9; got '${text}'`);
  }
  return numbers.toSorted((a, b) => a - b);
}

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
      --ramp-up TIME   start the workers one by one over this time instead of all at once
      --think TIME     pause this long after each response before a worker sends its next request,
                       or a random time in a range such as 50ms-150ms (simulates users)
      --rate N         send N requests per second at most, evenly spaced (default: as fast as possible)
      --warmup N|TIME  send N requests (or send for TIME) first and leave them out of the results
      --redirect MODE  follow (default) or manual: with manual a 3xx response is the result
      --no-keepalive   open a new connection for every request (sends Connection: close)
      --timeout TIME   give up on a request after this long (default: 10s)
      --percentiles LIST  latency percentiles to report, e.g. 50,95,99.9 (default: 50,75,90,95,99,99.9)
      --threshold EXPR  fail (exit 1) unless EXPR holds, e.g. p99<250ms, errors<1%, rps>500 (repeatable)
      --compare FILE   compare the results with an earlier report written by --json
      --max-regression PCT  with --compare: exit 1 if latency or throughput is worse by more than PCT percent
  -u, --user USER:PASSWORD  send HTTP basic authentication
      --template       fill in {{i}}, {{uuid}}, {{timestamp}}, {{rand:1-100}} and {{env:NAME}} in the URL,
                       header values and body of every request
  -q, --quiet          print one summary line (and any failed threshold) instead of the full report
      --progress       show a live status line on stderr while the run is in progress
      --format FORMAT  text (default), json or markdown (a table for pull request comments)
      --json           same as --format json
  -o, --output FILE    write the report to FILE instead of standard output
  -h, --help           show this help
  -v, --version        show the version
`;

export const OPTIONS = {
  requests: { type: "string", short: "n" },
  duration: { type: "string", short: "d" },
  timeout: { type: "string", default: "10s" },
  rate: { type: "string" },
  think: { type: "string" },
  "ramp-up": { type: "string" },
  "no-keepalive": { type: "boolean" },
  redirect: { type: "string", default: "follow" },
  warmup: { type: "string" },
  concurrency: { type: "string", short: "c", default: "10" },
  method: { type: "string", short: "X" },
  header: { type: "string", short: "H", multiple: true },
  body: { type: "string", short: "b" },
  "body-file": { type: "string" },
  "requests-file": { type: "string" },
  percentiles: { type: "string" },
  threshold: { type: "string", multiple: true },
  compare: { type: "string" },
  "max-regression": { type: "string" },
  user: { type: "string", short: "u" },
  template: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  progress: { type: "boolean" },
  format: { type: "string" },
  output: { type: "string", short: "o" },
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

/** "100ms" or "50ms-150ms" as {min, max} in milliseconds. */
export function parseThink(text) {
  const [low, high, ...extra] = text.split("-");
  if (extra.length > 0) throw new UsageError(`--think must be a duration or a range such as 50ms-150ms, got '${text}'`);
  try {
    const min = parseDuration(low);
    const max = high === undefined ? min : parseDuration(high);
    if (max < min) throw new Error("the range is backwards");
    return { min, max };
  } catch (error) {
    throw new UsageError(`--think: ${error.message}`);
  }
}

function parseBaseUrl(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new UsageError(`not a valid URL: ${text}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UsageError(`unsupported protocol ${url.protocol} (use http or https)`);
  return extractCredentials(url);
}

export const FORMATS = ["text", "json", "markdown"];

/** The report format chosen with --format or --json. */
export function chooseFormat(values) {
  if (values.format !== undefined && !FORMATS.includes(values.format)) {
    throw new UsageError(`--format must be one of ${FORMATS.join(", ")}, got '${values.format}'`);
  }
  if (values.json && values.format !== undefined && values.format !== "json") throw new UsageError("--json conflicts with --format " + values.format);
  const format = values.json ? "json" : values.format ?? "text";
  if (values.quiet && format !== "text") throw new UsageError("--quiet only applies to the text format");
  return format;
}

/** Validate the parsed command line and turn it into the settings of a run. */
export function buildConfig(values, positionals) {
  const requestsFile = values["requests-file"];
  if (positionals.length > 1 || (positionals.length === 0 && requestsFile === undefined)) throw new UsageError("expected exactly one URL");
  const parsedUrl = positionals.length === 1 ? parseBaseUrl(positionals[0]) : undefined;
  const baseUrl = parsedUrl?.url;

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
  if (!["follow", "manual"].includes(values.redirect)) throw new UsageError(`--redirect must be 'follow' or 'manual', got '${values.redirect}'`);
  if (values.user !== undefined && !values.user.includes(":")) throw new UsageError("--user must look like USER:PASSWORD");
  const headerLines = [...(values.header ?? [])];
  if (values["no-keepalive"]) headerLines.push("Connection: close");
  if (parsedUrl?.authorization && values.user === undefined) headerLines.push(parsedUrl.authorization);
  if (values.user !== undefined) headerLines.push(`Authorization: Basic ${Buffer.from(values.user).toString("base64")}`);
  const userAgent = `http-bench/${pkg.version}`;
  let targets;
  try {
    if (requestsFile !== undefined) {
      if (values.body !== undefined || values["body-file"] !== undefined) {
        throw new Error("--body and --body-file cannot be combined with --requests-file; put the bodies in the file");
      }
      targets = loadRequestsFile(requestsFile, { baseUrl, headers: headerLines, method: values.method, userAgent });
    } else {
      const request = buildRequest({ method: values.method, headers: headerLines, body: values.body, bodyFile: values["body-file"], userAgent });
      targets = [{ url: baseUrl.href, method: request.method, headers: request.headers, body: request.body }];
    }
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.template) {
    try {
      targets = targets.map((target) => templateTarget(target));
    } catch (error) {
      throw new UsageError(`--template: ${error.message}`);
    }
  }
  let maxRegression;
  if (values["max-regression"] !== undefined) {
    if (values.compare === undefined) throw new UsageError("--max-regression needs --compare");
    maxRegression = Number(values["max-regression"].replace(/%$/, ""));
    if (!(maxRegression >= 0) || !Number.isFinite(maxRegression) || values["max-regression"] === "") {
      throw new UsageError(`--max-regression must be a percentage such as 10%, got '${values["max-regression"]}'`);
    }
  }
  let thresholds;
  try {
    thresholds = (values.threshold ?? []).map(parseThreshold);
  } catch (error) {
    throw new UsageError(`--threshold: ${error.message}`);
  }
  return {
    thresholds,
    compare: values.compare,
    percentiles: values.percentiles === undefined ? undefined : parsePercentiles(values.percentiles),
    template: Boolean(values.template),
    maxRegression,
    targets,
    url: targets[0].url,
    method: targets[0].method,
    headers: targets[0].headers,
    body: targets[0].body,
    timeout: positiveDuration("timeout", values.timeout),
    redirect: values.redirect,
    rampUp: values["ramp-up"] === undefined ? undefined : positiveDuration("ramp-up", values["ramp-up"]),
    think: values.think === undefined ? undefined : parseThink(values.think),
    rate,
    warmup,
    requests: values.requests !== undefined ? positiveInteger("requests", values.requests) : duration === undefined ? 100 : undefined,
    duration,
    concurrency: positiveInteger("concurrency", values.concurrency),
  };
}
