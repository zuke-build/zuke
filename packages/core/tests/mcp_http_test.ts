// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, type McpRequestContext, target } from "../mod.ts";
import type { JsonRpcResponse } from "../src/mcp/jsonrpc.ts";
import { McpServer } from "../src/mcp/server.ts";
import { originAllowed, serveHttp } from "../src/mcp/http.ts";
import type { McpAuthenticator, ResolvedIdentity } from "../src/mcp/auth.ts";
import { serveMcp } from "../src/mcp/command.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";

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
  handle: (
    m: unknown,
    ctx: McpRequestContext,
    identity?: ResolvedIdentity,
  ) => Promise<JsonRpcResponse | null>,
  opts: { token?: string; authenticator?: McpAuthenticator } = {},
): Promise<{ port: number; stop: () => Promise<void> }> {
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((r) => (setPort = r));
  const finished = serveHttp(handle, {
    host: "127.0.0.1",
    port: 0,
    token: opts.token,
    authenticator: opts.authenticator,
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

Deno.test("originAllowed enforces the loopback / allow-list rules", () => {
  // No Origin (a CLI/MCP client) is always allowed.
  assertEquals(originAllowed(null, undefined, "127.0.0.1"), true);
  // On a loopback bind, only loopback origins pass.
  assertEquals(
    originAllowed("http://localhost:5173", undefined, "127.0.0.1"),
    true,
  );
  assertEquals(originAllowed("http://127.0.0.5", undefined, "127.0.0.1"), true);
  assertEquals(originAllowed("http://[::1]:8080", undefined, "::1"), true);
  assertEquals(
    originAllowed("https://evil.example", undefined, "127.0.0.1"),
    false,
  );
  // A domain that merely *starts* with `127.` is not loopback (anchored match).
  assertEquals(
    originAllowed("http://127.0.0.1.evil.com", undefined, "127.0.0.1"),
    false,
  );
  assertEquals(
    originAllowed("http://localhost.evil.com", undefined, "127.0.0.1"),
    false,
  );
  assertEquals(originAllowed("not a url", undefined, "127.0.0.1"), false);
  // A non-loopback bind runs no default Origin check (operator's responsibility).
  assertEquals(
    originAllowed("https://evil.example", undefined, "10.0.0.5"),
    true,
  );
  // An explicit allow-list is matched exactly, regardless of the bind.
  assertEquals(
    originAllowed("https://app.example", ["https://app.example"], "0.0.0.0"),
    true,
  );
  assertEquals(
    originAllowed("https://evil.example", ["https://app.example"], "0.0.0.0"),
    false,
  );
});

Deno.test("http transport rejects a cross-origin browser request (drive-by guard)", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m));
  try {
    // A drive-by / DNS-rebinding page sends its own (non-loopback) Origin.
    const blocked = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: rpc("initialize", 1, {}),
    });
    assertEquals(blocked.status, 403);
    await blocked.json();
    // A loopback origin (a legit local dev tool) is allowed.
    const ok = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
      body: rpc("initialize", 2, {}),
    });
    assertEquals(ok.status, 200);
    await ok.json();
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

Deno.test("http transport refuses an oversized body with 413", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m));
  try {
    // A single MCP message is a tool call with a few scalar arguments, so a
    // body past the cap is either a bug or an attempt to exhaust memory. It is
    // refused without being buffered whole.
    const huge = `{"jsonrpc":"2.0","id":1,"method":"ping","params":"${
      "x".repeat(1024 * 1024 + 64)
    }"}`;
    const res = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      body: huge,
    });
    assertEquals(res.status, 413);
    const body = await res.json();
    assertEquals(body.error.code, -32600);

    // A normal message on the same server is unaffected.
    const fine = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      body: rpc("ping", 2),
    });
    assertEquals(fine.status, 200);
    await fine.json();
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

Deno.test("serveMcp applies the build's identity hook to HTTP requests", async () => {
  // A build declaring a per-call identity hook via the override seam.
  class Guarded extends Build {
    deploy = target().description("Deploy").executes(() => {});
    override mcpIdentity() {
      return (ctx: McpRequestContext) => {
        const user = ctx.headers.get("x-user");
        if (user === null) throw new Error("no identity from proxy");
        return { actor: user, via: "test-proxy" };
      };
    }
  }
  const dir = await Deno.makeTempDir();
  const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((r) => (setPort = r));
  const finished = serveMcp(new Guarded(), {
    http: { host: "127.0.0.1", port: 0 },
    allowRun: true,
    stateStore: store,
    quiet: true,
    signal: ac.signal,
    onListen: (a) => setPort(a.port),
  });
  const url = `http://127.0.0.1:${await portReady}/`;
  try {
    // A request carrying the trusted header runs and is audited to that actor.
    const ok = await fetch(url, {
      method: "POST",
      headers: { "x-user": "engineer-a" },
      body: rpc("tools/call", 1, { name: "run:deploy", arguments: {} }),
    });
    assertEquals(ok.status, 200);
    await ok.json();

    // A request WITHOUT the header is rejected — the hook throws, nothing runs.
    // The refusal is a real 401 with a challenge (what an MCP client needs to
    // discover where to authenticate), and still carries the JSON-RPC error so a
    // client that only reads the body sees a reason.
    const denied = await fetch(url, {
      method: "POST",
      body: rpc("tools/call", 2, { name: "run:deploy", arguments: {} }),
    });
    assertEquals(denied.status, 401);
    assertEquals(denied.headers.get("www-authenticate"), "Bearer");
    const deniedBody = await denied.json();
    assertEquals(deniedBody.error.message, "Unauthorized");

    // The audit trail names the trusted actor for the successful call only.
    const events = (await store.getRun("mcp-audit"))?.record.events ?? [];
    assertEquals(
      events.some((e) => e.tool === "run:deploy" && e.actor === "engineer-a"),
      true,
    );
    assertEquals(events.every((e) => e.actor !== "anonymous"), true);
  } finally {
    ac.abort();
    await finished;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("serveMcp prints an HTTP banner naming the mode and (lack of) auth", async () => {
  const origErr = console.error;
  const banner: string[] = [];
  console.error = (...a: unknown[]) => void banner.push(a.join(" "));
  try {
    const ac = new AbortController();
    let setPort = (_: number) => {};
    const portReady = new Promise<number>((r) => (setPort = r));
    // Not quiet: the operator gets told where the server is and how open it is.
    const finished = serveMcp(new Demo(), {
      http: { host: "127.0.0.1", port: 0 },
      readEnv: () => undefined, // no ZUKE_MCP_TOKEN
      signal: ac.signal,
      onListen: (a) => setPort(a.port),
    });
    await portReady;
    ac.abort();
    assertEquals(await finished, 0);
  } finally {
    console.error = origErr;
  }
  const text = banner.join("\n");
  assertStringIncludes(text, "http://127.0.0.1:");
  // Read-only, tokenless loopback: the banner says exactly that — and does not
  // claim a registry is being served.
  assertStringIncludes(text, "read-only");
  assertStringIncludes(text, "no auth (loopback only)");
  assertEquals(text.includes("registry"), false);
});

Deno.test("http transport answers a refusal with the authenticator's own status", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m), {
    authenticator: {
      authenticate: (ctx) => {
        switch (ctx.headers.get("x-case")) {
          case "forbidden":
            return {
              status: 403,
              error: "insufficient_scope",
              challenge: 'Bearer error="insufficient_scope"',
            };
          case "bare":
            return { status: 403, error: "insufficient_scope" };
          case "detail":
            return {
              status: 401,
              error: "invalid_token",
              detail: "token expired",
              challenge: "Bearer",
            };
          default:
            return { actor: "engineer-a" };
        }
      },
    },
  });
  const url = `http://127.0.0.1:${s.port}/`;
  try {
    // The status and the challenge are the refusal's own — a 403 proves neither
    // is a constant baked into the transport.
    const forbidden = await fetch(url, {
      method: "POST",
      headers: { "x-case": "forbidden" },
      body: rpc("ping", 1),
    });
    assertEquals(forbidden.status, 403);
    assertEquals(
      forbidden.headers.get("www-authenticate"),
      'Bearer error="insufficient_scope"',
    );
    // The reason still reaches a client that only reads the JSON-RPC body.
    const forbiddenBody = await forbidden.json();
    assertEquals(forbiddenBody.error.message, "insufficient_scope");

    // A refusal that carries no challenge gets no invented WWW-Authenticate.
    const bare = await fetch(url, {
      method: "POST",
      headers: { "x-case": "bare" },
      body: rpc("ping", 2),
    });
    assertEquals(bare.status, 403);
    assertEquals(bare.headers.get("www-authenticate"), null);
    await bare.json();

    // A detail is appended to the reason as "<error>: <detail>".
    const detail = await fetch(url, {
      method: "POST",
      headers: { "x-case": "detail" },
      body: rpc("ping", 3),
    });
    assertEquals(detail.status, 401);
    assertEquals(detail.headers.get("www-authenticate"), "Bearer");
    const detailBody = await detail.json();
    assertEquals(detailBody.error.message, "invalid_token: token expired");

    // An accepted caller is dispatched normally.
    const ok = await fetch(url, { method: "POST", body: rpc("ping", 4) });
    assertEquals(ok.status, 200);
    await ok.json();
  } finally {
    await s.stop();
  }
});

Deno.test("http transport hands the resolved identity to the handler", async () => {
  const server = new McpServer(new Demo());
  const seen: (ResolvedIdentity | undefined)[] = [];
  const views: { method: string; hasBody: boolean }[] = [];
  const s = await startHttp((m, _ctx, identity) => {
    seen.push(identity);
    return server.handleMessage(m);
  }, {
    authenticator: {
      authenticate: (ctx) => {
        const request = ctx.request;
        if (request !== undefined) {
          views.push({
            method: request.method,
            hasBody: request.body !== null,
          });
        }
        return ctx.headers.get("x-kind") === "service"
          ? {
            actor: "deploy-bot",
            kind: "service",
            roles: ["deploy", "read"],
            via: "oidc",
          }
          : { actor: "engineer-a" };
      },
    },
  });
  const url = `http://127.0.0.1:${s.port}/`;
  try {
    const service = await fetch(url, {
      method: "POST",
      headers: { "x-kind": "service" },
      body: rpc("ping", 1),
    });
    assertEquals(service.status, 200);
    await service.json();

    const human = await fetch(url, { method: "POST", body: rpc("ping", 2) });
    assertEquals(human.status, 200);
    await human.json();
  } finally {
    await s.stop();
  }
  assertEquals(seen[0], {
    actor: "deploy-bot",
    kind: "service",
    roles: ["deploy", "read"],
    via: "oidc",
  });
  // The defaults are settled before the handler sees them: an authenticator that
  // says nothing about kind or roles is read as a human holding none.
  assertEquals(seen[1], { actor: "engineer-a", kind: "human", roles: [] });
  // The authenticator sees the request, but not its body — that belongs to the
  // transport, and a body can only be read once.
  assertEquals(views, [
    { method: "POST", hasBody: false },
    { method: "POST", hasBody: false },
  ]);
});

Deno.test("http transport authenticates after the method, Origin and token checks", async () => {
  const server = new McpServer(new Demo());
  let calls = 0;
  const s = await startHttp((m) => server.handleMessage(m), {
    token: "swordfish",
    authenticator: {
      authenticate: () => {
        calls += 1;
        return { actor: "engineer-a" };
      },
    },
  });
  const url = `http://127.0.0.1:${s.port}/`;
  const authorized = { authorization: "Bearer swordfish" };
  try {
    // A non-POST is refused before the authenticator runs …
    const get = await fetch(url, { headers: authorized });
    assertEquals(get.status, 405);
    await get.json();
    assertEquals(calls, 0);

    // … so is a cross-origin browser request …
    const origin = await fetch(url, {
      method: "POST",
      headers: { ...authorized, origin: "https://evil.example" },
      body: rpc("ping", 1),
    });
    assertEquals(origin.status, 403);
    await origin.json();
    assertEquals(calls, 0);

    // … and so is a bad static bearer token: a caller who fails the cheap,
    // constant-time check never reaches the (possibly expensive) authenticator.
    const badToken = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer nope" },
      body: rpc("ping", 2),
    });
    assertEquals(badToken.status, 401);
    await badToken.json();
    assertEquals(calls, 0);

    // Past all three, it runs exactly once.
    const ok = await fetch(url, {
      method: "POST",
      headers: authorized,
      body: rpc("ping", 3),
    });
    assertEquals(ok.status, 200);
    await ok.json();
    assertEquals(calls, 1);
  } finally {
    await s.stop();
  }
});

Deno.test("http transport refuses an unauthenticated caller before reading its body", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m), {
    authenticator: {
      authenticate: () => ({
        status: 401,
        error: "invalid_token",
        challenge: "Bearer",
      }),
    },
  });
  try {
    // Over the 1 MiB body cap: were the body read first this would be a 413.
    // It is a 401, so an unauthenticated caller never makes the server buffer
    // a megabyte for it.
    const huge = `{"jsonrpc":"2.0","id":1,"method":"ping","params":"${
      "x".repeat(1024 * 1024 + 64)
    }"}`;
    const res = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      body: huge,
    });
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error.message, "invalid_token");
  } finally {
    await s.stop();
  }
});

Deno.test("http transport answers a throwing authenticator with the bare 401", async () => {
  const server = new McpServer(new Demo());
  const s = await startHttp((m) => server.handleMessage(m), {
    authenticator: {
      authenticate: () => {
        throw new Error("jwks fetch failed: https://idp.example/keys");
      },
    },
  });
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/`, {
      method: "POST",
      body: rpc("ping", 1),
    });
    assertEquals(res.status, 401);
    assertEquals(res.headers.get("www-authenticate"), "Bearer");
    // The generic refusal, so a broken authenticator leaks nothing about why.
    const body = await res.json();
    assertEquals(body.error.message, "Unauthorized");
  } finally {
    await s.stop();
  }
});

Deno.test("serveMcp refuses a build declaring both mcpAuth() and mcpIdentity()", async () => {
  // Two gates on one build: one would silently win, so the server refuses to
  // start instead of leaving the other one only *looking* enforced.
  class Ambiguous extends Build {
    deploy = target().description("Deploy").executes(() => {});
    override mcpIdentity() {
      return () => ({ actor: "from-hook" });
    }
    override mcpAuth(): McpAuthenticator {
      return { authenticate: () => ({ actor: "from-authenticator" }) };
    }
  }
  const origErr = console.error;
  const errs: string[] = [];
  console.error = (...a: unknown[]) => void errs.push(a.join(" "));
  try {
    const code = await serveMcp(new Ambiguous(), { quiet: true });
    assertEquals(code, 1);
    const text = errs.join("\n");
    assertStringIncludes(text, "mcpAuth()");
    assertStringIncludes(text, "mcpIdentity()");
  } finally {
    console.error = origErr;
  }
});

Deno.test("serveMcp accepts a non-loopback bind authenticated by mcpAuth()", async () => {
  class Guarded extends Build {
    lint = target().description("Lint").executes(() => {});
    override mcpAuth(): McpAuthenticator {
      return { authenticate: () => ({ actor: "engineer-a" }) };
    }
  }
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((r) => (setPort = r));
  // No ZUKE_MCP_TOKEN: the authenticator alone satisfies the rule that a
  // non-loopback endpoint must authenticate its callers.
  const finished = serveMcp(new Guarded(), {
    http: { host: "0.0.0.0", port: 0 },
    quiet: true,
    readEnv: () => undefined,
    signal: ac.signal,
    onListen: (a) => setPort(a.port),
  });
  await portReady; // it bound rather than exiting 1
  ac.abort();
  assertEquals(await finished, 0);
});

Deno.test("serveMcp's HTTP banner names the authenticator", async () => {
  class Guarded extends Build {
    lint = target().description("Lint").executes(() => {});
    override mcpAuth(): McpAuthenticator {
      return { authenticate: () => ({ actor: "engineer-a" }) };
    }
  }
  const bannerFor = async (token?: string): Promise<string> => {
    const origErr = console.error;
    const lines: string[] = [];
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const ac = new AbortController();
      let setPort = (_: number) => {};
      const portReady = new Promise<number>((r) => (setPort = r));
      const finished = serveMcp(new Guarded(), {
        http: { host: "127.0.0.1", port: 0 },
        token,
        readEnv: () => undefined, // no ZUKE_MCP_TOKEN
        signal: ac.signal,
        onListen: (a) => setPort(a.port),
      });
      await portReady;
      ac.abort();
      assertEquals(await finished, 0);
    } finally {
      console.error = origErr;
    }
    return lines.join("\n");
  };

  // An authenticator alone: the operator is told the endpoint is guarded, and
  // not told about a token that isn't configured.
  const authOnly = await bannerFor();
  assertStringIncludes(authOnly, "authenticator");
  assertEquals(authOnly.includes("bearer token"), false);

  // Both gates configured: the banner names both.
  const both = await bannerFor("swordfish");
  assertStringIncludes(both, "authenticator + bearer token");
});

Deno.test("serveMcp applies the build's mcpAuth() to HTTP requests", async () => {
  // The general seam, refusing by *returning* a rejection rather than throwing.
  class Guarded extends Build {
    deploy = target().description("Deploy").executes(() => {});
    override mcpAuth(): McpAuthenticator {
      return {
        authenticate: (ctx) => {
          const user = ctx.headers.get("x-user");
          return user === null
            ? {
              status: 403,
              error: "insufficient_scope",
              detail: "no x-user header",
            }
            : { actor: user, kind: "service", roles: ["deploy"] };
        },
      };
    }
  }
  const dir = await Deno.makeTempDir();
  const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((r) => (setPort = r));
  const finished = serveMcp(new Guarded(), {
    http: { host: "127.0.0.1", port: 0 },
    allowRun: true,
    stateStore: store,
    quiet: true,
    signal: ac.signal,
    onListen: (a) => setPort(a.port),
  });
  const url = `http://127.0.0.1:${await portReady}/`;
  try {
    // Accepted: the target runs, attributed to the authenticated actor.
    const ok = await fetch(url, {
      method: "POST",
      headers: { "x-user": "deploy-bot" },
      body: rpc("tools/call", 1, { name: "run:deploy", arguments: {} }),
    });
    assertEquals(ok.status, 200);
    await ok.json();

    // Refused: the rejection's own status, no challenge (it offered none), and
    // the reason in the body.
    const denied = await fetch(url, {
      method: "POST",
      body: rpc("tools/call", 2, { name: "run:deploy", arguments: {} }),
    });
    assertEquals(denied.status, 403);
    assertEquals(denied.headers.get("www-authenticate"), null);
    const deniedBody = await denied.json();
    assertEquals(
      deniedBody.error.message,
      "insufficient_scope: no x-user header",
    );

    // Nothing ran for the refused call, so the audit trail holds the accepted
    // one and nothing else.
    const events = (await store.getRun("mcp-audit"))?.record.events ?? [];
    assertEquals(events.length, 1);
    assertEquals(events[0].tool, "run:deploy");
    assertEquals(events[0].actor, "deploy-bot");
  } finally {
    ac.abort();
    await finished;
    await Deno.remove(dir, { recursive: true });
  }
});

// ---- Regressions: a malformed Host, and what unlocks a non-loopback bind ----

Deno.test("a Host the URL parser rejects still serves, with no request view", async () => {
  // Deno builds `request.url` from the raw Host header and accepts hosts the
  // WHATWG parser rejects (`Host: bad host`). Building the authenticator's view
  // of such a request throws, so the view is simply absent — the headers, where
  // a credential lives, are intact, and the exchange completes rather than
  // failing on a header the server itself accepted.
  const seen: Array<{ hasRequest: boolean; token: string | null }> = [];
  const authenticator: McpAuthenticator = {
    authenticate: (ctx) => {
      seen.push({
        hasRequest: ctx.request !== undefined,
        token: ctx.headers.get("x-token"),
      });
      return { actor: "ada" };
    },
  };
  const s = await startHttp(
    (_m, _ctx, identity) =>
      Promise.resolve({
        jsonrpc: "2.0" as const,
        id: 1,
        result: { actor: identity?.actor ?? null },
      }),
    { authenticator },
  );
  try {
    // A raw socket, because `fetch` will not send a Host this malformed.
    const conn = await Deno.connect({ hostname: "127.0.0.1", port: s.port });
    const body = '{"jsonrpc":"2.0","id":1,"method":"tools/call"}';
    await conn.write(
      new TextEncoder().encode(
        `POST / HTTP/1.1\r\nHost: bad host\r\nx-token: t\r\n` +
          `Content-Length: ${body.length}\r\n\r\n${body}`,
      ),
    );
    const buf = new Uint8Array(1024);
    const n = await conn.read(buf);
    const response = new TextDecoder().decode(buf.subarray(0, n ?? 0));
    conn.close();

    assertStringIncludes(response, "200 OK");
    assertStringIncludes(response, '"actor":"ada"');
    // The authenticator ran, saw no request view, and still read its header.
    assertEquals(seen, [{ hasRequest: false, token: "t" }]);
  } finally {
    await s.stop();
  }
});

Deno.test("mcpIdentity() alone does not unlock a non-loopback bind", async () => {
  // The hook trusts a header, which is an identity only when something in front
  // strips the client's copy. On a directly reachable endpoint any caller sets
  // it, so the hook authenticates nobody and the bind guard must still demand a
  // token — exactly as it did before the authenticator seam existed.
  class ProxyTrusting extends Build {
    deploy = target().description("Deploy").executes(() => {});
    override mcpIdentity() {
      return (ctx: McpRequestContext) => {
        const sub = ctx.headers.get("x-forwarded-user");
        if (sub === null) throw new Error("no identity from proxy");
        return { actor: sub };
      };
    }
  }
  const origErr = console.error;
  const errs: string[] = [];
  console.error = (...a: unknown[]) => void errs.push(a.join(" "));
  try {
    const code = await serveMcp(new ProxyTrusting(), {
      http: { host: "0.0.0.0", port: 0 },
      quiet: true,
      readEnv: () => undefined, // no ZUKE_MCP_TOKEN
    });
    assertEquals(code, 1);
    assertStringIncludes(errs.join("\n"), "must be authenticated");
    // …and the message says why the hook did not count.
    assertStringIncludes(
      errs.join("\n"),
      "mcpIdentity() does not authenticate",
    );
  } finally {
    console.error = origErr;
  }
});

Deno.test("mcpAuth() unlocks a non-loopback bind, and still runs the hook path", async () => {
  // The general seam is a deliberate declaration of authentication, so it does
  // satisfy the guard where the proxy hook does not.
  class Guarded extends Build {
    deploy = target().description("Deploy").executes(() => {});
    override mcpAuth(): McpAuthenticator {
      return { authenticate: () => ({ actor: "svc", kind: "service" }) };
    }
  }
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((r) => (setPort = r));
  const finished = serveMcp(new Guarded(), {
    http: { host: "0.0.0.0", port: 0 },
    quiet: true,
    signal: ac.signal,
    readEnv: () => undefined, // no ZUKE_MCP_TOKEN
    onListen: (a) => setPort(a.port),
  });
  const port = await portReady;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      body: rpc("tools/list", 1),
    });
    assertEquals(res.status, 200);
    await res.json();
  } finally {
    ac.abort();
    assertEquals(await finished, 0);
  }
});
