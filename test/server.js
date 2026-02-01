import http from "node:http";

/** A local port where nothing is listening, for testing connection errors. */
export async function closedPort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * A small HTTP server for the tests, listening on a random local port.
 *
 *   /ok               200 "ok"
 *   /redirect?to=P    302 to the path P (default /ok)
 *   /status/CODE      the given status
 *   /slow?ms=N        200 after N milliseconds
 *   /echo             JSON with the method, headers and body of the request
 *   /big?kb=N&ms=D    N KiB sent in four chunks D milliseconds apart
 *   /flaky            every third response is a 500
 *   /drop             closes the connection without answering
 *
 * Every request is recorded in `requests`.
 */
export async function startServer() {
  const requests = [];
  let flakyCount = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body, port: req.socket.remotePort });
      const send = (status, text, headers = {}) => {
        res.writeHead(status, { "content-type": "text/plain", ...headers });
        res.end(text);
      };
      if (url.pathname === "/ok") return send(200, "ok");
      if (url.pathname === "/redirect") return send(302, "moved", { location: url.searchParams.get("to") ?? "/ok" });
      if (url.pathname === "/created") return send(201, "created");
      if (url.pathname.startsWith("/status/")) return send(Number(url.pathname.split("/")[2]), "status");
      if (url.pathname === "/slow") return void setTimeout(() => send(200, "slow"), Number(url.searchParams.get("ms") ?? 50));
      if (url.pathname === "/big") {
        // KB kilobytes in four chunks, `ms` milliseconds apart: the headers arrive at once but
        // the response is only complete after the last chunk.
        const total = Number(url.searchParams.get("kb") ?? 64) * 1024;
        const delay = Number(url.searchParams.get("ms") ?? 20);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        let sent = 0;
        const timer = setInterval(() => {
          const size = Math.min(total / 4, total - sent);
          res.write(Buffer.alloc(size, 0x61));
          sent += size;
          if (sent >= total) {
            clearInterval(timer);
            res.end();
          }
        }, delay);
        res.on("close", () => clearInterval(timer));
        return;
      }
      if (url.pathname === "/flaky") {
        flakyCount += 1;
        return send(flakyCount % 3 === 0 ? 500 : 200, flakyCount % 3 === 0 ? "boom" : "ok");
      }
      if (url.pathname === "/echo") {
        return send(200, JSON.stringify({ method: req.method, headers: req.headers, body: body.toString("utf8") }), { "content-type": "application/json" });
      }
      if (url.pathname === "/drop") return void req.socket.destroy();
      return send(404, "not found");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}
