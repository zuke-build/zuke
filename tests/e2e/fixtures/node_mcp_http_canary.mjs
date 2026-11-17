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
import { connect } from "node:net";

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

// The same over a raw connection still uploading when the limit is reached:
// 64 MiB declared and sent in slices. The 413 must come back, and then the
// server must end the connection, since the rest of the body is not read.
// The status line is kept the moment it arrives, so a reset after it cannot
// erase it, and a round left open fails after a while instead of hanging.
for (let round = 0; round < 3; round++) {
  const status = await new Promise((resolve) => {
    const slow = connect(Number(new URL(url).port), "127.0.0.1");
    let reply = "";
    let line = "";
    let sent = 0;
    let ended = false;
    const total = 64 * 1024 * 1024;
    const slice = Buffer.alloc(256 * 1024, 120);
    const finish = (outcome) => {
      clearTimeout(deadline);
      slow.destroy();
      resolve(outcome);
    };
    const deadline = setTimeout(
      () => finish(`not ended within 30s: ${line}`),
      30_000,
    );
    slow.on("data", (chunk) => {
      reply += chunk;
      if (line === "" && reply.includes("\r\n")) line = reply.split("\r\n")[0];
    });
    // The server has said all it will say: stop sending.
    slow.on("end", () => ended = true);
    slow.on("error", () => {});
    slow.on("close", () => finish(line));
    slow.write(
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
        `Authorization: Bearer secret\r\nContent-Length: ${total}\r\n\r\n`,
    );
    const pump = () => {
      if (slow.destroyed || ended) return;
      if (sent >= total) return void slow.end();
      slow.write(slice);
      sent += slice.length;
      setTimeout(pump, 5);
    };
    pump();
  });
  assert.equal(status, "HTTP/1.1 413 Payload Too Large");
}

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

// A stop that arrives while a connection still owes the answer to a request
// it was sent behind another one lets that answer go out first.
const pipelined = new AbortController();
let pipelinedPort = () => {};
const pipelinedBound = new Promise((resolve) => pipelinedPort = resolve);
let requests = 0;
const pipelining = serveOnNode({
  hostname: "127.0.0.1",
  port: 0,
  signal: pipelined.signal,
  onListen: (address) => pipelinedPort(address.port),
}, async () => {
  requests++;
  if (requests === 1) return new Response("first");
  await new Promise((resolve) => setTimeout(resolve, 300));
  return new Response("second");
});
const socket = connect(await pipelinedBound, "127.0.0.1");
let received = "";
const ended = new Promise((resolve) => socket.on("close", resolve));
socket.on("data", (chunk) => {
  received += chunk;
  if (received.includes("first")) pipelined.abort();
});
socket.write(
  "GET /a HTTP/1.1\r\nHost: x\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n\r\n",
);
await pipelining;
await ended;
assert.ok(received.includes("second"), received);

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
