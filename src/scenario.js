import fs from "node:fs";

import { buildRequest } from "./request.js";

const ENTRY_FIELDS = new Set(["url", "method", "headers", "body", "json"]);

function parseEntries(text, file) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    let entries;
    try {
      entries = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`${file}: invalid JSON: ${error.message}`);
    }
    return entries.map((entry, index) => ({ entry, where: `${file}, entry ${index + 1}` }));
  }
  const entries = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    try {
      entries.push({ entry: JSON.parse(line), where: `${file}:${index + 1}` });
    } catch (error) {
      throw new Error(`${file}:${index + 1}: invalid JSON: ${error.message}`);
    }
  });
  return entries;
}

/**
 * Read the requests to send from a JSON array or a JSON Lines file. Each entry is an object:
 *
 *     {"url": "/items/7", "method": "PUT", "headers": {"X-Id": "7"}, "json": {"name": "x"}}
 *
 * `url` may be relative to `baseUrl`. `body` is sent as is, `json` is serialised and gets a
 * JSON content type. Headers given on the command line apply to every request; an entry's own
 * headers replace those of the same name. `method` is the default for entries without one.
 * Returns targets {url, method, headers, body}.
 */
export function loadRequestsFile(file, { baseUrl, headers = [], method, userAgent }) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${file}: ${error.code ?? error.message}`);
  }
  const entries = parseEntries(text, file);
  if (entries.length === 0) throw new Error(`${file} contains no requests`);
  return entries.map(({ entry, where }) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`${where}: expected an object`);
    for (const key of Object.keys(entry)) {
      if (!ENTRY_FIELDS.has(key)) throw new Error(`${where}: unknown field '${key}' (use ${[...ENTRY_FIELDS].join(", ")})`);
    }
    if (entry.body !== undefined && entry.json !== undefined) throw new Error(`${where}: use either body or json`);
    let url;
    try {
      url = new URL(entry.url ?? "", baseUrl);
    } catch {
      throw new Error(`${where}: '${entry.url ?? ""}' is not a valid URL${baseUrl ? "" : " (give a base URL or use absolute URLs)"}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${where}: unsupported protocol ${url.protocol}`);

    const own = Object.entries(entry.headers ?? {}).map(([name, value]) => `${name}: ${value}`);
    const ownNames = new Set(Object.keys(entry.headers ?? {}).map((name) => name.toLowerCase()));
    const inherited = headers.filter((line) => !ownNames.has(line.slice(0, line.indexOf(":")).trim().toLowerCase()));
    const lines = [...inherited, ...own];
    let body = entry.body;
    if (entry.json !== undefined) {
      body = JSON.stringify(entry.json);
      if (!lines.some((line) => /^content-type\s*:/i.test(line))) lines.push("Content-Type: application/json");
    }
    try {
      const request = buildRequest({ method: entry.method ?? method, headers: lines, body, userAgent });
      return { url: url.href, method: request.method, headers: request.headers, body: request.body };
    } catch (error) {
      throw new Error(`${where}: ${error.message}`);
    }
  });
}
