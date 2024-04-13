import http from "node:http";

/**
 * A small HTTP server for the tests, listening on a random local port.
 *
 *   /ok               200 "ok"
 *   /status/CODE      the given status
 *   /slow?ms=N        200 after N milliseconds
 *   /echo             JSON with the method, headers and body of the request
 *   /drop             closes the connection without answering
 *
 * Every request is recorded in `requests`.
 */
export async function startServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body });
      const send = (status, text, headers = {}) => {
        res.writeHead(status, { "content-type": "text/plain", ...headers });
        res.end(text);
      };
      if (url.pathname === "/ok") return send(200, "ok");
      if (url.pathname.startsWith("/status/")) return send(Number(url.pathname.split("/")[2]), "status");
      if (url.pathname === "/slow") return void setTimeout(() => send(200, "slow"), Number(url.searchParams.get("ms") ?? 50));
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
