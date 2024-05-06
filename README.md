# http-bench

A small HTTP load tester built on Node's global `fetch`. No dependencies.

Work in progress. Planned: fixed numbers of requests or a duration, concurrency, warmup,
percentile latencies, a latency histogram and JSON output.

    npx http-bench -n 1000 -c 20 http://localhost:3000/
`-n` sends a fixed number of requests, `-d 10s` sends for a fixed time (the first limit reached
wins), `-c` sets how many are in flight at once.
