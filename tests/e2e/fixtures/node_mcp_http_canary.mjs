// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run under real Node by `node_process_e2e.ts`: the MCP HTTP transport,
 * loaded as TypeScript source, serving on `node:http`. Its checks must hold
 * there as they do on Deno: a request is answered, a wrong token and a
 * foreign origin are refused before the handler runs, and an abort stops it,
 * also one that arrives while it is starting. A response Node refuses does
 * not take the process down.
 */

import assert from "node:assert/strict";

const { serveHttp } = await import(
  new URL("../../../packages/core/src/mcp/http.ts", import.meta.url).href
);

const controller = new AbortController();
let listening = () => {};
const port = new Promise((resolve) => listening = resolve);
const handled = [];
const finished = serveHttp((message) => {
  handled.push(message.method);
  return Promise.resolve({
    jsonrpc: "2.0",
    id: message.id,
    result: { ok: true },
  });
}, {
  host: "127.0.0.1",
  port: 0,
  token: "secret",
  signal: controller.signal,
  onListen: (address) => listening(address.port),
});
const url = `http://127.0.0.1:${await port}/mcp`;
const call = (headers) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

const answered = await call({ authorization: "Bearer secret" });
assert.equal(answered.status, 200);
assert.deepEqual(await answered.json(), {
  jsonrpc: "2.0",
  id: 1,
  result: { ok: true },
});

const wrongToken = await call({ authorization: "Bearer wrong" });
assert.equal(wrongToken.status, 401);
await wrongToken.body?.cancel();

const foreign = await call({
  authorization: "Bearer secret",
  origin: "https://evil.example",
});
assert.equal(foreign.status, 403);
await foreign.body?.cancel();

const notPost = await fetch(url, {
  headers: { authorization: "Bearer secret" },
});
assert.equal(notPost.status, 405);
await notPost.body?.cancel();

// A body over the limit is refused, read only as far as the limit.
const huge = await fetch(url, {
  method: "POST",
  headers: { authorization: "Bearer secret" },
  body: "x".repeat(8 * 1024 * 1024),
});
assert.equal(huge.status, 413);
await huge.body?.cancel();

// Only the one good request reached the handler.
assert.deepEqual(handled, ["ping"]);

controller.abort();
await finished;
// A response header Node refuses does not take the process down: that
// connection is torn down and the server keeps serving.
const { serveOnNode } = await import(
  new URL("../../../packages/core/src/serve.ts", import.meta.url).href
);
const stopper = new AbortController();
let bound = () => {};
const boundPort = new Promise((resolve) => bound = resolve);
let calls = 0;
const serving = serveOnNode({
  hostname: "127.0.0.1",
  port: 0,
  signal: stopper.signal,
  onListen: (address) => bound(address.port),
}, () => {
  calls++;
  return calls === 1
    ? new Response("x", { headers: { "x-bad": "a\u0001b" } })
    : new Response("still serving");
});
const plain = `http://127.0.0.1:${await boundPort}/`;
await assert.rejects(fetch(plain));
assert.equal(await (await fetch(plain)).text(), "still serving");
stopper.abort();
await serving;

// A stop that arrives while the server is still starting is not missed.
const early = new AbortController();
const starting = serveHttp(() => Promise.resolve(null), {
  host: "127.0.0.1",
  port: 0,
  signal: early.signal,
});
early.abort();
await starting;

console.log("node mcp http canary ok");
