const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/**
 * "500ms", "2s", "1.5s", "1m", "1m30s" as milliseconds. A unit is required,
 * because "10" could as well mean ten milliseconds or ten seconds.
 */
export function parseDuration(text) {
  const trimmed = text.trim();
  const part = /(\d+(?:\.\d+)?)(ms|s|m|h)/gy;
  let total = 0;
  let consumed = 0;
  for (let match = part.exec(trimmed); match !== null; match = part.exec(trimmed)) {
    total += Number(match[1]) * UNIT_MS[match[2]];
    consumed = part.lastIndex;
  }
  if (trimmed === "" || consumed !== trimmed.length) {
    throw new Error(`invalid duration '${text}' (examples: 500ms, 10s, 1m30s)`);
  }
  return total;
}
