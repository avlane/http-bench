# http-bench

A small HTTP load tester built on Node's global `fetch`. No dependencies.

Work in progress. Planned: fixed numbers of requests or a duration, concurrency, warmup,
percentile latencies, a latency histogram and JSON output.

    npx http-bench -n 1000 -c 20 http://localhost:3000/
`-n` sends a fixed number of requests, `-d 10s` sends for a fixed time (the first limit reached
wins), `-c` sets how many are in flight at once.
`--warmup 50` (or `--warmup 2s`) sends traffic first without measuring it, so connection setup
and cold caches don't distort the results.
## JSON output

`--json` prints one JSON document instead of the text report, for scripts and for comparing
runs. Header values that look like credentials (`Authorization`, `Cookie`, `X-Api-Key`) are
replaced by `<redacted>` in the `config` section.
`--rate 200` sends 200 requests per second at most, evenly spaced, which is how real clients behave;
without it the tool sends the next request as soon as a response is in.
## Thresholds

`--threshold` turns a run into a check: the exit status is 1 unless every expectation holds.

    http-bench -d 30s -c 50 \
      --threshold 'p99<250ms' --threshold 'errors<1%' --threshold 'rps>500' http://localhost:3000/

Metrics: `min`, `mean`, `max`, `p50`...`p99.9` (latency, with a unit such as `250ms`), `rps` (requests
per second) and `errors` (percentage of requests that failed). Exit status: 0 ok, 1 a threshold failed,
2 usage error, 3 no request succeeded.
