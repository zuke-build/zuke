// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import { connect } from "node:net";
import { FileTasks } from "../src/file.ts";
import { NetTasks } from "../src/net.ts";
import { StreamTasks } from "../src/stream.ts";
import { withTemp } from "./_temp.ts";

/** A stream of `chunks`, then its end. */
function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

Deno.test("StreamTasks.toFile writes every chunk", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/out.bin`;
    await StreamTasks.toFile(path, streamOf([1, 2], [3]));
    assertEquals([...await FileTasks.readBytes(path)], [1, 2, 3]);
    await StreamTasks.toFile(path, streamOf([9]));
    assertEquals([...await FileTasks.readBytes(path)], [9]);
  });
});

Deno.test("StreamTasks.toFile with createNew leaves an existing file", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/out.bin`;
    await StreamTasks.toFile(path, streamOf([1]), (s) => s.createNew());
    await assertRejects(() =>
      StreamTasks.toFile(path, streamOf([2]), (s) => s.createNew())
    );
    assertEquals([...await FileTasks.readBytes(path)], [1]);
  });
});

/** Everything `stream` carries, as text. */
async function textOf(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

Deno.test("NetTasks carries bytes both ways over an accepted connection", async () => {
  const listener = await NetTasks.listen();
  const client = await Deno.connect({
    hostname: "127.0.0.1",
    port: listener.port,
  });
  const server = await listener.accept();
  listener.close();
  await client.write(new TextEncoder().encode("ping"));
  await client.closeWrite();
  assertEquals(await textOf(server.readable), "ping");
  await server.write(new TextEncoder().encode("pong"));
  await server.closeWrite();
  assertEquals(await textOf(client.readable), "pong");
  server.close();
});

Deno.test("NetTasks queues a connection that arrives before accept", async () => {
  const listener = await NetTasks.listen();
  const client = await Deno.connect({
    hostname: "127.0.0.1",
    port: listener.port,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const server = await listener.accept();
  server.close();
  // A connection closed by this side ends what it reads.
  assertEquals(await textOf(server.readable), "");
  client.close();
  listener.close();
  listener.close();
  await assertRejects(() => listener.accept());
});

Deno.test("NetTasks rejects a waiting accept on close, and drops unaccepted connections", async () => {
  const listener = await NetTasks.listen();
  const waiting = listener.accept();
  listener.close();
  await assertRejects(() => waiting);

  const second = await NetTasks.listen();
  const client = await Deno.connect({
    hostname: "127.0.0.1",
    port: second.port,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  second.close();
  // The listener destroyed the connection nobody accepted; reading to the
  // end releases the client's side.
  assertEquals(await textOf(client.readable).catch(() => ""), "");
});

Deno.test("NetTasks fails to listen on a port already taken", async () => {
  const taken = await NetTasks.listen();
  try {
    await assertRejects(() =>
      NetTasks.listen((s) => s.hostname("127.0.0.1").port(taken.port))
    );
  } finally {
    taken.close();
  }
});

Deno.test("NetTasks closes the connection when its reading is cancelled", async () => {
  const listener = await NetTasks.listen();
  const client = await Deno.connect({
    hostname: "127.0.0.1",
    port: listener.port,
  });
  const server = await listener.accept();
  listener.close();
  const reader = server.readable.getReader();
  await client.write(new Uint8Array([1]));
  assertEquals([...((await reader.read()).value ?? [])], [1]);
  await reader.cancel();
  await assertRejects(() => server.write(new Uint8Array(1024 * 1024)));
  client.close();
});

Deno.test("NetTasks errors what it reads when the other side resets", async () => {
  const listener = await NetTasks.listen();
  const client = connect(listener.port, "127.0.0.1");
  const server = await listener.accept();
  listener.close();
  client.resetAndDestroy();
  await assertRejects(() => textOf(server.readable));
  server.close();
});

Deno.test("NetTasks pauses a fast sender until its bytes are read", async () => {
  const listener = await NetTasks.listen();
  const client = await Deno.connect({
    hostname: "127.0.0.1",
    port: listener.port,
  });
  const server = await listener.accept();
  listener.close();
  const size = 8 * 1024 * 1024;
  const sent = (async () => {
    const bytes = new Uint8Array(size);
    // A write may take only part of what it is given.
    for (let at = 0; at < size;) at += await client.write(bytes.subarray(at));
    await client.closeWrite();
  })();
  // Nothing is read for a while, so the stream fills and the socket pauses.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const received = await new Response(server.readable).arrayBuffer();
  await sent;
  assertEquals(received.byteLength, size);
  server.close();
  client.close();
});

Deno.test("StreamTasks.toFile cancels a stream it cannot write", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/taken.bin`;
    await FileTasks.writeBytes(path, new Uint8Array([1]));
    let cancelled = false;
    const data = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await assertRejects(() =>
      StreamTasks.toFile(path, data, (s) => s.createNew())
    );
    assertEquals(cancelled, true);
  });
});

Deno.test("StreamTasks.toFile applies the mode it is given", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/private.bin`;
    await StreamTasks.toFile(path, streamOf([1]), (s) => s.mode(0o600));
    const info = await FileTasks.stat(path);
    assertEquals(
      info.mode === null ? null : info.mode & 0o777,
      Deno.build.os === "windows" ? null : 0o600,
    );
  });
});

Deno.test("NetTasks survives a queued connection reset before it is accepted", async () => {
  const listener = await NetTasks.listen();
  const client = connect(listener.port, "127.0.0.1");
  await new Promise((resolve) => client.once("connect", resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  client.resetAndDestroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Still alive: the reset reaches the reader, not the process.
  const server = await listener.accept();
  listener.close();
  await assertRejects(() => textOf(server.readable));
  server.close();
});

Deno.test("NetTasks closeWrite settles on a connection already closed", async () => {
  const listener = await NetTasks.listen();
  const client = await Deno.connect({
    hostname: "127.0.0.1",
    port: listener.port,
  });
  const server = await listener.accept();
  listener.close();
  await client.write(new Uint8Array([1]));
  for await (const _ of server.readable) break; // cancels, closing the socket
  await server.closeWrite();
  server.close();
  await server.closeWrite();
  client.close();
});
