// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { NetTasks } from "../mod.ts";
import { test } from "../../../tests/_testing.ts";
import { createServer, Socket } from "node:net";
import { PassThrough, Readable } from "node:stream";
import { assertEquals } from "../../../tests/_assert.ts";
import {
  bodyStream,
  type FetchHandler,
  lingerThenClose,
  OpenConnections,
  sendResponse,
  serve,
  serveOnNode,
  type ServeOptions,
} from "../src/serve.ts";

/** A way of serving. */
type Serve = (options: ServeOptions, handler: FetchHandler) => Promise<void>;

/**
 * The two ways core serves. Both run here: the Node one through Deno's
 * `node:http`, so every expectation below is held to on both.
 */
const BACKENDS: [name: string, serve: Serve][] = [
  ["Deno", serve],
  ["Node", serveOnNode],
];

/** Serve `handler` on a free port, run `fn` against it, then stop. */
async function serving(
  start: Serve,
  handler: FetchHandler,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  let listening = (_port: number) => {};
  const port = new Promise<number>((resolve) => listening = resolve);
  const finished = start({
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
    onListen: ({ port }) => listening(port),
  }, handler);
  try {
    await fn(`http://127.0.0.1:${await port}`);
  } finally {
    controller.abort();
    await finished;
  }
}

for (const [backend, start] of BACKENDS) {
  test(`${backend}: a request reaches the handler whole, and its response comes back whole`, async () => {
    const seen: string[] = [];
    await serving(start, async (request) => {
      const url = new URL(request.url);
      seen.push(
        request.method,
        url.pathname + url.search,
        request.headers.get("x-zuke") ?? "",
        await request.text(),
      );
      return new Response("x".repeat(200_000), {
        status: 201,
        headers: { "x-answer": "yes", "content-type": "text/plain" },
      });
    }, async (base) => {
      const response = await fetch(`${base}/path?q=1`, {
        method: "POST",
        headers: { "x-zuke": "set" },
        body: "y".repeat(100_000),
      });
      assertEquals(response.status, 201);
      assertEquals(response.headers.get("x-answer"), "yes");
      assertEquals((await response.text()).length, 200_000);
    });
    assertEquals(seen, ["POST", "/path?q=1", "set", "y".repeat(100_000)]);
  });

  test(`${backend}: a GET has no body, and a response with none has none`, async () => {
    await serving(start, (request) => {
      assertEquals(request.body, null);
      return new Response(null, { status: 204 });
    }, async (base) => {
      const response = await fetch(`${base}/`);
      assertEquals(response.status, 204);
      assertEquals(await response.text(), "");
    });
  });

  test(`${backend}: a handler that throws is answered 500 and the server keeps serving`, async () => {
    let calls = 0;
    await serving(start, () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return new Response("fine");
    }, async (base) => {
      const failed = await fetch(base);
      assertEquals(failed.status, 500);
      await failed.body?.cancel();
      assertEquals(await (await fetch(base)).text(), "fine");
    });
  });

  test(`${backend}: a body the handler leaves unread does not stall the answer`, async () => {
    await serving(
      start,
      () => new Response("early", { status: 413 }),
      async (base) => {
        const response = await fetch(base, {
          method: "POST",
          body: "z".repeat(50_000),
        });
        assertEquals(response.status, 413);
        assertEquals(await response.text(), "early");
      },
    );
  });

  test(`${backend}: an abort that lands while the server starts stops it`, async () => {
    const controller = new AbortController();
    const finished = start({
      hostname: "127.0.0.1",
      port: 0,
      signal: controller.signal,
      onListen: () => {},
    }, () => new Response());
    // Before the server has had the chance to bind.
    controller.abort();
    await finished;
  });

  test(`${backend}: a listen callback that throws closes the server and passes the error on`, async () => {
    let port = 0;
    const hook = new Error("hook");
    let thrown: unknown;
    try {
      await start({
        hostname: "127.0.0.1",
        port: 0,
        onListen: (address) => {
          port = address.port;
          throw hook;
        },
      }, () => new Response("still serving"));
    } catch (error) {
      thrown = error;
    }
    assertEquals(thrown, hook);
    let refused = false;
    try {
      await (await fetch(`http://127.0.0.1:${port}/`)).text();
    } catch {
      refused = true;
    }
    assertEquals(refused, true);
  });
}

test("a request body reads whole, a chunk at a time", async () => {
  const body = bodyStream(
    Readable.from([new Uint8Array([1, 2]), new Uint8Array([3])]),
  );
  assertEquals(
    new Uint8Array(await new Response(body).arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});

test("cancelling a request body lets the rest flow away and leaves the source open", async () => {
  const source = new PassThrough();
  const reader = bodyStream(source).getReader();
  source.write(new Uint8Array(10));
  assertEquals((await reader.read()).value?.length, 10);
  await reader.cancel();
  // The connection is the caller's to close, after its answer.
  assertEquals(source.destroyed, false);
  // What arrives afterwards flows away, never handed on.
  source.write(new Uint8Array(5));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(source.readableLength, 0);
  source.destroy();
});

test("a cancelled body that then ends, or fails, as it arrives throws nothing", async () => {
  const finishes: readonly ("end" | "error")[] = ["end", "error"];
  for (const finish of finishes) {
    const source = new PassThrough();
    const reader = bodyStream(source).getReader();
    source.write(new Uint8Array(10));
    await reader.read();
    await reader.cancel();
    // The rest of the upload arrives and the body is over, after the cancel.
    source.write(new Uint8Array(5));
    if (finish === "end") source.end();
    else source.destroy(new Error("gone"));
    await new Promise((resolve) => source.once("close", resolve));
  }
});

test("a gentle close says no more but keeps taking what is still sent", async () => {
  let serverSide: Socket | undefined;
  const server = createServer((socket) => {
    serverSide = socket;
    lingerThenClose(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null
    ? address.port
    : 0;
  // A client that keeps its own side open when the server ends its, as one
  // still uploading does.
  const client = new Socket({ allowHalfOpen: true });
  const ended = new Promise((resolve) => client.once("end", resolve));
  client.connect(port, "127.0.0.1");
  // The server has ended its side, and the client hears that first.
  await ended;
  // What the client still sends is taken, not refused with a reset.
  let refused = false;
  client.on("error", () => refused = true);
  client.write(new Uint8Array(64 * 1024));
  const serverClosed = new Promise((resolve) =>
    serverSide?.once("close", resolve)
  );
  client.end();
  await serverClosed;
  assertEquals(refused, false);
  client.destroy();
  await new Promise((resolve) => server.close(resolve));
});

test("a connection whose request finishes after it closed is not kept", async () => {
  const connections = new OpenConnections();
  const socket = new Socket();
  connections.opened(socket);
  connections.busy(socket);
  assertEquals(connections.size, 1);
  const closed = new Promise((resolve) => socket.once("close", resolve));
  socket.destroy();
  await closed;
  // The client went away mid-request; its answer finishes afterwards.
  connections.idle(socket);
  assertEquals(connections.size, 0);
  // A connection reported only after it closed is not kept either.
  connections.opened(socket);
  assertEquals(connections.size, 0);
});

test("only idle connections are closed on stop", async () => {
  const connections = new OpenConnections();
  const [idle, busy] = [new Socket(), new Socket()];
  for (const socket of [idle, busy]) connections.opened(socket);
  connections.busy(busy);
  const closed = new Promise((resolve) => idle.once("close", resolve));
  connections.closeIdle();
  await closed;
  assertEquals([idle.destroyed, busy.destroyed, connections.size], [
    true,
    false,
    1,
  ]);
  busy.destroy();
});

test("a connection answering two requests is idle only once both are answered", async () => {
  const connections = new OpenConnections();
  const socket = new Socket();
  connections.opened(socket);
  // A client sent its next request before the first was answered.
  connections.busy(socket);
  connections.busy(socket);
  assertEquals(connections.idle(socket), false);
  connections.closeIdle();
  assertEquals(socket.destroyed, false);
  assertEquals(connections.idle(socket), true);
  const closed = new Promise((resolve) => socket.once("close", resolve));
  connections.closeIdle();
  await closed;
  assertEquals(socket.destroyed, true);
});

test("a response Node refuses tears the connection down instead of throwing", async () => {
  let destroyed = false;
  const outgoing = Object.assign(new PassThrough(), {
    statusCode: 0,
    setHeader(): never {
      throw new TypeError("Invalid character in header content");
    },
  });
  outgoing.once("close", () => destroyed = true);
  await sendResponse(
    new Response("x", { headers: { "x-bad": "a\u0001b" } }),
    outgoing,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(destroyed, true);
});

test("every Set-Cookie header is sent, not only the last", async () => {
  const set: Record<string, string | string[]> = {};
  const outgoing = Object.assign(new PassThrough(), {
    statusCode: 0,
    setHeader(name: string, value: string | string[]) {
      set[name] = value;
    },
  });
  const headers = new Headers({ "x-one": "1" });
  headers.append("set-cookie", "a=1");
  headers.append("set-cookie", "b=2");
  await sendResponse(new Response(null, { status: 204, headers }), outgoing);
  assertEquals(outgoing.statusCode, 204);
  assertEquals(set, { "x-one": "1", "set-cookie": ["a=1", "b=2"] });
});

for (
  const [name, start] of [["Node", serveOnNode], ["serve", serve]] as const
) {
  test(`${name}: a Host header that makes no URL is answered on the bound address`, async () => {
    await serving(start, (request) => {
      return new Response(new URL(request.url).pathname);
    }, async (base) => {
      const { port } = new URL(base);
      const conn = await NetTasks.connect(Number(port));
      await conn.write(
        new TextEncoder().encode(
          "GET /seen HTTP/1.1\r\nHost: bad host\r\nConnection: close\r\n\r\n",
        ),
      );
      const reply = await new Response(conn.readable).text();
      assertEquals(reply.split("\r\n")[0], "HTTP/1.1 200 OK");
      // The body, however it is framed, carries the path.
      assertEquals(reply.split("\r\n\r\n")[1].includes("/seen"), true);
    });
  });
}

test("a server whose signal was aborted before it starts resolves at once", async () => {
  const controller = new AbortController();
  controller.abort();
  await serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
    onListen: () => {
      throw new Error("nothing should have been opened");
    },
  }, () => new Response());
});
