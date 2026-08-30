# http-bench

A small HTTP load tester built on Node's global `fetch`. No dependencies, one command. It sends
requests with a fixed concurrency (or at a fixed rate) for a number of requests or a duration, and
reports throughput, latency percentiles and a histogram - as text, JSON or a Markdown table - and can
fail a CI job when the numbers are not good enough. Needs Node.js 22 or newer.

    $ http-bench -d 10s -c 20 http://localhost:3000/api/items
    GET http://localhost:3000/api/items
    4871 requests in 10.00 s with concurrency 20
    487.1 requests/s
    1.9 MiB received (194.0 KiB/s)

    Status codes
      200  4871

    Latency
      min   1.12 ms
      mean  40.1 ms
      p50   38.6 ms
      p75   47.9 ms
      p90   58.2 ms
      p95   66.0 ms
      p99   92.4 ms
      p99.9 140 ms
      max   151 ms

    Histogram
         1.12 - 10.31 ms  ████                           103    2.1%
        10.31 - 19.50 ms  ██████                         151    3.1%
        ...

    $ echo $?
    0

## Usage

    http-bench [options] URL
    http-bench [options] --requests-file FILE [BASE_URL]

### What to send

| option | |
| --- | --- |
| `-n N` | send N requests (default 100 unless `-d` is given) |
| `-d TIME` | send for this long, e.g. `10s`, `1m30s` (the first of `-n` and `-d` wins) |
| `-c N` | requests in flight at a time (default 10) |
| `--rate N` | at most N requests per second, evenly spaced |
| `--warmup N\|TIME` | send N requests (or for TIME) first, unmeasured |
| `--ramp-up TIME` | start the workers one by one over TIME |
| `--think TIME` | each worker pauses after a response; `50ms-150ms` for a random pause |
| `-X METHOD`, `-H "Name: value"`, `-b TEXT`, `--body-file FILE` | the request; a body means POST; files are sent as bytes |
| `-u USER:PASSWORD` | basic authentication (also taken from `http://user:pass@host/`) |
| `--requests-file FILE` | send the requests described in a JSON array or JSON Lines file, in turn |
| `--template` | fill in `{{i}}`, `{{uuid}}`, `{{timestamp}}`, `{{rand:1-100}}`, `{{env:NAME}}` per request |
| `--redirect follow\|manual` | measure a redirect instead of following it |
| `--no-keepalive` | a new connection for every request |
| `--timeout TIME` | give up on a request after this long (default 10s) |

Response bodies are read completely before a request counts as finished, so latency covers the whole
response and the amount of data received is reported.

With `--rate`, latency is measured from the moment each request was *due*, not from when a free worker
sent it. If the server stalls, the requests that should have gone out meanwhile count as late, as they
would for real clients ("coordinated omission"). Without `--rate` the tool is a closed loop: the next
request waits for a response, and a stalled server simply gets fewer requests.

### Output

`--format text` (default), `--format json` (`--json`) or `--format markdown`; `-o FILE` writes the report
to a file; `--percentiles 50,95,99.9` chooses the percentiles; `--progress` shows a live line on stderr;
`-q` prints a single summary line. Credentials in headers are redacted in the JSON.

The JSON report has `config`, `summary` (`requests`, `successes`, `errors`, `elapsedMs`,
`requestsPerSecond`, `bytes`, `interrupted`), `latencyMs` (`min`, `mean`, `stddev`, `max`,
`percentiles`), `histogram`, `statusCodes`, `errors`, `timeline` (per second: `requests`, `failed`,
`meanLatencyMs`) and `thresholds`; with several request definitions also `requestsByDefinition`.

Latencies are kept in a fixed-size histogram (1% precision), so runs of any length use the same small
amount of memory.

### Using it in CI

    # fail unless the service meets its targets
    http-bench -d 30s -c 50 --threshold 'p99<250ms' --threshold 'errors<1%' --threshold 'rps>500' $URL

    # fail if it got more than 10% slower than the last release
    http-bench --json -d 30s $OLD_URL > before.json
    http-bench -d 30s --compare before.json --max-regression 10% $NEW_URL

Threshold metrics: `min`, `mean`, `max`, `p50`...`p99.9`, `rps`, `errors` (percent of requests that failed).
HTTP 4xx and 5xx responses count as failures; redirects do not.

### Exit status

| code | meaning |
| --- | --- |
| 0 | the run completed and every threshold held |
| 1 | a `--threshold` failed, or `--max-regression` was exceeded |
| 2 | usage error |
| 3 | no request succeeded (target unreachable, or every response was an error) |
| 130 | stopped with Ctrl-C; the report covers what was measured so far |

See [CHANGELOG.md](CHANGELOG.md) for what changed between versions.

## Development

    npm test

The tests start a small HTTP server on a random local port; nothing leaves your machine.
