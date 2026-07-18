import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, target } from "../mod.ts";
import type { JsonRpcResponse } from "../src/mcp/jsonrpc.ts";
import { McpServer } from "../src/mcp/server.ts";
import { serveHttp } from "../src/mcp/http.ts";
import { serveMcp } from "../src/mcp/command.ts";

/** A minimal build for the transport tests. */
class Demo extends Build {
  lint = target().description("Lint").executes(() => {});
}

/** A JSON-RPC request/notification object. */
function rpc(method: string, id?: number, params?: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    method,
    ...(params ? { params } : {}),
  });
}

/** Start `serveHttp` on an ephemeral loopback port; returns the port and a stop. */
async function startHttp(
  handle: (m: unknown) => Promise<JsonRpcResponse | null>,
  opts: { token?: string } = {},
): Promise<{ port: number; stop: () => Promise<void> }> {
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((r) => (setPort = r));
  const finished = serveHttp(handle, {
    host: "127.0.0.1",
    port: 0,
    token: opts.token,
    signal: ac.signal,
    onListen: (a) => setPort(a.port),
  });
  const port = await portReady;
  return {
    port,
    stop: async () => {
      ac.abort();
      await finished;
    },
  };
}

Deno.test("http transport answers a POST JSON-RPC request", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m));
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      body: rpc("initialize", 1, {}),
    });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    const body = await res.json();
    assertEquals(body.id, 1);
    assertStringIncludes(JSON.stringify(body.result), "protocolVersion");
  } finally {
    await s.stop();
  }
});

Deno.test("http transport rejects a non-POST with 405", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m));
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/`);
    assertEquals(res.status, 405);
    await res.json();
  } finally {
    await s.stop();
  }
});

Deno.test("http transport answers unparseable JSON with a 400 parse error", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m));
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      body: "{ not json",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.code, -32700);
  } finally {
    await s.stop();
  }
});

Deno.test("http transport answers a notification with 202 and no body", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m));
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      body: rpc("notifications/initialized"), // no id → notification
    });
    assertEquals(res.status, 202);
    assertEquals(await res.text(), "");
  } finally {
    await s.stop();
  }
});

Deno.test("http transport enforces a configured bearer token", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m), {
    token: "swordfish",
  });
  const url = `http://127.0.0.1:${s.port}/`;
  try {
    // Missing token → 401.
    const missing = await fetch(url, { method: "POST", body: rpc("ping", 1) });
    assertEquals(missing.status, 401);
    assertEquals(missing.headers.get("www-authenticate"), "Bearer");
    await missing.json();

    // Wrong token → 401.
    const wrong = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer nope" },
      body: rpc("ping", 1),
    });
    assertEquals(wrong.status, 401);
    await wrong.json();

    // Correct token → 200.
    const good = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer swordfish" },
      body: rpc("ping", 1),
    });
    assertEquals(good.status, 200);
    await good.json();

    // The scheme is case-insensitive and surrounding whitespace is tolerated,
    // but the token itself must still match exactly.
    const lenient = await fetch(url, {
      method: "POST",
      headers: { authorization: "bearer   swordfish" },
      body: rpc("ping", 1),
    });
    assertEquals(lenient.status, 200);
    await lenient.json();

    // Trailing content after the token is rejected (not treated as the token).
    const trailing = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer swordfish extra" },
      body: rpc("ping", 1),
    });
    assertEquals(trailing.status, 401);
    await trailing.json();
  } finally {
    await s.stop();
  }
});

Deno.test("serveMcp serves over HTTP on loopback", async () => {
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((r) => (setPort = r));
  const finished = serveMcp(new Demo(), {
    http: { host: "127.0.0.1", port: 0 },
    quiet: true,
    signal: ac.signal,
    onListen: (a) => setPort(a.port),
  });
  const port = await portReady;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      body: rpc("ping", 1),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.result, {});
  } finally {
    ac.abort();
    assertEquals(await finished, 0);
  }
});

Deno.test("serveMcp refuses a non-loopback HTTP bind without a token", async () => {
  const origErr = console.error;
  const errs: string[] = [];
  console.error = (...a: unknown[]) => void errs.push(a.join(" "));
  try {
    const code = await serveMcp(new Demo(), {
      http: { host: "0.0.0.0", port: 0 },
      quiet: true,
      readEnv: () => undefined, // no ZUKE_MCP_TOKEN
    });
    assertEquals(code, 1);
    assertStringIncludes(errs.join("\n"), "must be authenticated");
  } finally {
    console.error = origErr;
  }
});
