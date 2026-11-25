// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Tests for `NetTasks.connect` and `NetTasks.serve`. */

import { test } from "../../../tests/_testing.ts";
import { assertEquals, assertRejects } from "../../../tests/_assert.ts";
import { NetTasks } from "../src/net.ts";

/** Everything `stream` yields, as text. */
async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

test("NetTasks.connect reaches a listener, and bytes cross both ways", async () => {
  const listener = await NetTasks.listen();
  try {
    const [client, server] = await Promise.all([
      NetTasks.connect(listener.port),
      listener.accept(),
    ]);
    await client.write(new TextEncoder().encode("ping"));
    await client.closeWrite();
    assertEquals(await text(server.readable), "ping");
    await server.write(new TextEncoder().encode("pong"));
    await server.closeWrite();
    assertEquals(await text(client.readable), "pong");
    client.close();
    server.close();
  } finally {
    listener.close();
  }
});

test("NetTasks.connect to a host it is given, and rejects when nothing listens", async () => {
  const listener = await NetTasks.listen();
  const port = listener.port;
  const accepted = listener.accept();
  const client = await NetTasks.connect(port, (s) => s.hostname("127.0.0.1"));
  (await accepted).close();
  client.close();
  listener.close();
  // The port was just released, so nothing accepts on it now.
  await assertRejects(() => NetTasks.connect(port));
});

test("NetTasks.serve answers requests with the handler until it is closed", async () => {
  const server = await NetTasks.serve((request) =>
    new Response(`${request.method} ${new URL(request.url).pathname}`)
  );
  const response = await fetch(`http://127.0.0.1:${server.port}/hello`);
  assertEquals(await response.text(), "GET /hello");
  await server.close();
  await assertRejects(() => fetch(`http://127.0.0.1:${server.port}/`));
});

test("NetTasks.serve rejects a port that is already taken", async () => {
  const taken = await NetTasks.listen();
  try {
    await assertRejects(() =>
      NetTasks.serve(() => new Response(), (s) => s.port(taken.port))
    );
  } finally {
    taken.close();
  }
});
