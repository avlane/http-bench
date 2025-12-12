#!/usr/bin/env node
import { main } from "../src/cli.js";

// The first Ctrl-C stops the run and prints what was measured so far; a second one ends the
// process at once (the handlers are removed after the first signal).
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort());

process.exitCode = await main(process.argv.slice(2), { signal: controller.signal });
