import { randomUUID } from "node:crypto";

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

function compilePlaceholder(name, env, encode) {
  if (name === "i") return (index) => encode(String(index));
  if (name === "uuid") return () => encode(randomUUID());
  if (name === "timestamp") return () => encode(String(Date.now()));
  const random = /^rand:(-?\d+)-(-?\d+)$/.exec(name);
  if (random) {
    const low = Number(random[1]);
    const high = Number(random[2]);
    if (low > high) throw new Error(`{{${name}}}: the range is empty`);
    return () => encode(String(low + Math.floor(Math.random() * (high - low + 1))));
  }
  const variable = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(name);
  if (variable) {
    const value = env[variable[1]];
    if (value === undefined) throw new Error(`{{${name}}}: environment variable ${variable[1]} is not set`);
    return () => encode(value); // fixed for the whole run
  }
  throw new Error(`unknown placeholder {{${name}}} (use i, uuid, timestamp, rand:MIN-MAX or env:NAME)`);
}

/**
 * Compile text with {{placeholders}} into {dynamic, render(index)}:
 *
 *   {{i}}            the number of the request, starting at 1
 *   {{uuid}}         a random UUID
 *   {{timestamp}}    the current time in milliseconds since the epoch
 *   {{rand:1-1000}}  a random integer in the range, both ends included
 *   {{env:NAME}}     an environment variable, read once when the run starts
 *
 * `encode` is applied to each substituted value (use encodeURIComponent for URLs).
 */
export function compileTemplate(text, { env = process.env, encode = (value) => value } = {}) {
  const pieces = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    pieces.push(text.slice(last, match.index), compilePlaceholder(match[1], env, encode));
    last = match.index + match[0].length;
  }
  pieces.push(text.slice(last));
  const dynamic = pieces.length > 1;
  return {
    dynamic,
    render: (index) => pieces.map((piece) => (typeof piece === "function" ? piece(index) : piece)).join(""),
  };
}

// new URL() writes { and } as %7B and %7D, so a placeholder in a URL has to be recognised in that form.
function restorePlaceholders(url) {
  return url.replace(/%7B%7B(.*?)%7D%7D/gi, (_, name) => `{{${decodeURIComponent(name)}}}`);
}

/**
 * Give a target ({url, method, headers, body}) a `render(index)` that fills in the
 * placeholders in its URL, header values and (text) body. A target without placeholders is
 * returned unchanged.
 */
export function templateTarget(target, { env } = {}) {
  const url = compileTemplate(restorePlaceholders(target.url), { env, encode: encodeURIComponent });
  const headers = [...target.headers].map(([name, value]) => [name, compileTemplate(value, { env })]);
  const body = typeof target.body === "string" ? compileTemplate(target.body, { env }) : null;
  if (!url.dynamic && !body?.dynamic && !headers.some(([, value]) => value.dynamic)) return target;
  const render = (index) => {
    const rendered = new Headers();
    for (const [name, value] of headers) rendered.append(name, value.render(index));
    return {
      url: new URL(url.render(index)).href,
      method: target.method,
      headers: rendered,
      body: body ? body.render(index) : target.body,
    };
  };
  render(1); // fail now, not in the middle of the run, if the result is not a valid URL
  return { ...target, render };
}
