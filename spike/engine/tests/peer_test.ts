// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
} from "../../../packages/core/tests/_assert.ts";
import { Peer, RpcFailure } from "../src/peer.ts";
import { INVALID_PARAMS, isRecord } from "../src/protocol.ts";

/** The RPC code of a rejection, or NaN when it was not an RpcFailure. */
function codeOf(error: Error): number {
  return error instanceof RpcFailure ? error.code : NaN;
}

/** Two peers joined by a real loopback connection. */
async function pair(): Promise<{
  a: Peer;
  b: Peer;
  close: () => Promise<void>;
}> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const [server, client] = await Promise.all([
    listener.accept(),
    Deno.connect({ hostname: "127.0.0.1", port: listener.addr.port }),
  ]);
  listener.close();
  const a = new Peer(server);
  const b = new Peer(client);
  const serving = Promise.all([a.serve(), b.serve()]);
  return {
    a,
    b,
    close: async () => {
      a.close();
      b.close();
      await serving;
    },
  };
}

/** A Peer talking to a raw socket the test drives byte by byte. */
async function rawPair(): Promise<{
  peer: Peer;
  raw: Deno.Conn;
  close: () => Promise<void>;
}> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const [server, raw] = await Promise.all([
    listener.accept(),
    Deno.connect({ hostname: "127.0.0.1", port: listener.addr.port }),
  ]);
  listener.close();
  const peer = new Peer(server);
  const serving = peer.serve();
  return {
    peer,
    raw,
    close: async () => {
      peer.close();
      try {
        raw.close();
      } catch {
        // A test that closed the raw side itself has nothing left to close.
      }
      await serving;
    },
  };
}

async function readLine(conn: Deno.Conn): Promise<string> {
  const buffer = new Uint8Array(4096);
  let text = "";
  while (!text.includes("\n")) {
    const n = await conn.read(buffer);
    if (n === null) break;
    text += new TextDecoder().decode(buffer.subarray(0, n));
  }
  return text.slice(0, text.indexOf("\n"));
}

Deno.test("a request is answered with the handler's result", async () => {
  const { a, b, close } = await pair();
  b.on("add", (params) => {
    if (!isRecord(params)) throw new Error("expected an object");
    return Number(params.x) + Number(params.y);
  });
  b.on("nothing", () => undefined);
  assertEquals(await a.request("add", { x: 1, y: 2 }), 3);
  assertEquals(await a.request("nothing", {}), {});
  await close();
});

Deno.test("a handler's throw becomes an RpcFailure, keeping an explicit code", async () => {
  const { a, b, close } = await pair();
  b.on("plain", () => {
    throw new Error("bad input");
  });
  b.on("coded", () => {
    throw new RpcFailure(-32001, "cancelled");
  });
  b.on("odd", () => {
    throw "not an error";
  });
  const plain = await assertRejects(() => a.request("plain", {}), RpcFailure);
  assertEquals([codeOf(plain), plain.message], [INVALID_PARAMS, "bad input"]);
  const coded = await assertRejects(() => a.request("coded", {}), RpcFailure);
  assertEquals([codeOf(coded), coded.message], [-32001, "cancelled"]);
  const odd = await assertRejects(() => a.request("odd", {}), RpcFailure);
  assertEquals(odd.message, "not an error");
  const unknown = await assertRejects(() => a.request("nope", {}), RpcFailure);
  assertEquals(
    [codeOf(unknown), unknown.message],
    [-32601, 'unknown method "nope"'],
  );
  await close();
});

Deno.test("a notification reaches its handler and expects no answer", async () => {
  const { a, b, close } = await pair();
  let seen: unknown;
  const arrived = new Promise<void>((resolve) => {
    b.on("note", (params) => {
      seen = params;
      resolve();
    });
  });
  await a.notify("note", { n: 1 });
  await a.notify("unknown-note", {}); // No handler: silently dropped.
  await arrived;
  assertEquals(seen, { n: 1 });
  await close();
});

Deno.test("close() rejects every pending request and makes later sends no-ops", async () => {
  const { a, b, close } = await pair();
  b.on("hang", () => new Promise(() => {}));
  const hanging = a.request("hang", {});
  a.close();
  const failure = await assertRejects(() => hanging, RpcFailure);
  assertEquals(failure.message, "connection closed");
  await a.notify("after", {});
  await close();
});

Deno.test("framing: split chunks are joined and junk lines are ignored", async () => {
  const { peer, raw, close } = await rawPair();
  peer.on("ping", () => "pong");
  const encoder = new TextEncoder();
  await raw.write(encoder.encode("not json\n[1,2]\n"));
  await raw.write(encoder.encode('{"jsonrpc":"2.0","id":99,"result":1}\n'));
  await raw.write(encoder.encode('{"jsonrpc":"2.0","id":7,"meth'));
  await raw.write(encoder.encode('od":"ping"}\n'));
  assertEquals(
    JSON.parse(await readLine(raw)),
    { jsonrpc: "2.0", id: 7, result: "pong" },
  );
  await close();
});

Deno.test("an error answer without code or message gets defaults", async () => {
  const { peer, raw, close } = await rawPair();
  const pending = peer.request("x", {});
  const line = JSON.parse(await readLine(raw));
  await raw.write(
    new TextEncoder().encode(
      JSON.stringify({ jsonrpc: "2.0", id: line.id, error: {} }) + "\n",
    ),
  );
  const failure = await assertRejects(() => pending, RpcFailure);
  assertEquals([codeOf(failure), failure.message], [-32000, "error"]);
  await close();
});

Deno.test("the remote side closing ends serve() and rejects what is pending", async () => {
  const { peer, raw, close } = await rawPair();
  const pending = peer.request("x", {});
  await readLine(raw);
  raw.close();
  await assertRejects(() => pending, RpcFailure, "connection closed");
  await close();
});
