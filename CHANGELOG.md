# Changelog

## 1.0.0

First stable release. The command line options, the exit statuses (0, 1, 2, 3, 130) and the layout of
the JSON report (`"version": 1`) are now stable.

Highlights of 0.x:

- Fixed number of requests or a duration, concurrency, `--rate`, `--warmup`, `--ramp-up`, `--think`.
- Latency percentiles from a fixed-memory histogram; the whole response body is read before a request
  counts as finished; latency under `--rate` is measured from the due time (no coordinated omission).
- Reports: text with a histogram and a per-second timeline, JSON, Markdown; `--threshold`,
  `--compare` / `--max-regression` for CI.
- Requests: methods, headers, bodies (files are sent as bytes), basic authentication, a requests file with
  several different requests, `--template` placeholders, redirects, `--no-keepalive`.
- Graceful Ctrl-C with a partial report.
- Requires Node.js 22 or newer (18 until May 2025, 20 until May 2026).
