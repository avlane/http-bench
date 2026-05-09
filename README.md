# http-bench

A small HTTP load tester built on Node's global `fetch`. No dependencies. Needs Node.js 22 or newer.

Work in progress. Planned: fixed numbers of requests or a duration, concurrency, warmup,
percentile latencies, a latency histogram and JSON output.

    npx http-bench -n 1000 -c 20 http://localhost:3000/
`-n` sends a fixed number of requests, `-d 10s` sends for a fixed time (the first limit reached
wins), `-c` sets how many are in flight at once.
`--warmup 50` (or `--warmup 2s`) sends traffic first without measuring it, so connection setup
and cold caches don't distort the results.
## JSON output

`--json` (or `--format json`) prints one JSON document instead of the text report, for scripts and for comparing
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
## Several requests

`--requests-file requests.json` sends a list of requests in turn - a JSON array or one JSON object
per line:

    {"url": "/items"}
    {"url": "/items", "method": "POST", "json": {"name": "widget"}}
    {"url": "/items/7", "method": "PUT", "headers": {"X-Trace": "on"}, "body": "raw body"}

URLs may be relative to the URL given on the command line. `-H` headers apply to every request.
## Comparing runs

    http-bench --json -d 30s http://localhost:3000/ > before.json
    # ...change something...
    http-bench -d 30s --compare before.json --max-regression 10% http://localhost:3000/

prints the change of p50, p90, p95, p99, mean, requests per second and error rate, and exits 1 if
latency or throughput got worse by more than 10% (or the error rate by more than 10 points).
## Templates

With `--template`, placeholders in the URL, in header values and in the body are filled in for every
request: `{{i}}` (request number), `{{uuid}}`, `{{timestamp}}` (ms), `{{rand:1-1000}}` and
`{{env:NAME}}` (an environment variable, read once - handy for tokens).

    http-bench --template -X PUT -H 'Authorization: Bearer {{env:TOKEN}}' \\
      -b '{"id": {{i}}, "key": "{{uuid}}"}' 'http://localhost:3000/items/{{rand:1-5000}}'
`--format markdown` prints a table for pull request comments, and `-o report.json` writes the report to a
file instead of standard output.
By default connections are kept alive and reused, like a browser or a client library does.
`--no-keepalive` opens a new connection for every request, which measures connection setup too.
