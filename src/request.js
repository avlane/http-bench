import fs from "node:fs";

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** "Name: value" as [name, value]. */
export function parseHeader(text) {
  const colon = text.indexOf(":");
  const name = colon > 0 ? text.slice(0, colon).trim() : "";
  if (!TOKEN.test(name)) throw new Error(`invalid header '${text}' (expected 'Name: value')`);
  return [name, text.slice(colon + 1).trim()];
}

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

/**
 * Turn the command line options into what fetch needs. A body makes the method POST unless
 * a method was given (as curl does); GET and HEAD cannot carry one.
 */
export function buildRequest({ method, headers = [], body, bodyFile, userAgent }) {
  if (body !== undefined && bodyFile !== undefined) throw new Error("use either --body or --body-file, not both");
  let payload = body;
  if (bodyFile !== undefined) {
    try {
      payload = fs.readFileSync(bodyFile, "utf8");
    } catch (error) {
      throw new Error(`cannot read ${bodyFile}: ${error.code ?? error.message}`);
    }
  }
  const verb = (method ?? (payload === undefined ? "GET" : "POST")).toUpperCase();
  if (payload !== undefined && METHODS_WITHOUT_BODY.has(verb)) throw new Error(`${verb} requests cannot have a body`);
  if (!TOKEN.test(verb)) throw new Error(`invalid method '${method}'`);

  const result = new Headers();
  for (const text of headers) {
    const [name, value] = parseHeader(text);
    result.append(name, value);
  }
  if (!result.has("user-agent") && userAgent) result.set("user-agent", userAgent);
  return { method: verb, headers: result, body: payload };
}
