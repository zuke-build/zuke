// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a build's `mcpAuth()` authenticator, end to end.
 *
 * The unit tests pin the seam's own normalisation; this drives the whole path —
 * a real `Build`, the real `zuke mcp` command, its HTTP transport, a real state
 * store — and then reads the result back through the CLI `main()`. It proves
 * three things fit together: an accepted call runs the target and the *resolved*
 * actor (not `--actor`) reaches the run record and the audit trail an operator
 * reads; a refusal is answered with its own status and `WWW-Authenticate`
 * challenge and writes nothing at all; and in registry mode the caller's kind
 * and roles reach the spawned build.
 *
 * The HTTP cases enter one level below `main()`, at `serveMcp` — the function
 * the `mcp` command *is*. That command forwards neither an abort signal nor an
 * `onListen` hook, so an in-process `runCli(Fleet, ["mcp", "--http", …])` could
 * neither learn its ephemeral port nor ever be stopped. The startup refusal,
 * which exits before binding anything, does go through `runCli`.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  type McpAuthenticator,
  type McpIdentityHook,
  type McpRequestContext,
  protectedResource,
  type ProtectedResourceSettings,
  target,
} from "../../packages/core/mod.ts";
import {
  serveMcp,
  type ServeMcpOptions,
} from "../../packages/core/src/mcp/command.ts";
import { FileSystemBuildRegistry } from "../../packages/core/src/registry/fs_registry.ts";
import { registerCommand } from "../../packages/core/src/registry/register.ts";
import type {
  RegistryRunner,
  RegistryRunOptions,
} from "../../packages/core/src/mcp/registry_server.ts";
import { silence } from "../../packages/core/tests/_console.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The key the fixture trusts — a stand-in for a verified credential. */
const API_KEY = "kestrel";

/**
 * A build that authenticates its own MCP callers: the key names a service
 * account holding one role; anything else is refused with a `403` and a
 * challenge, so the refusal's own status — not a `200` carrying an error —
 * is what a client sees.
 */
class Fleet extends Build {
  deploy = target().description("Deploy the fleet").executes(() => {});

  override mcpAuth(): McpAuthenticator {
    return {
      authenticate: (ctx: McpRequestContext) =>
        ctx.headers.get("x-api-key") === API_KEY
          ? {
            actor: "svc-releaser",
            kind: "service",
            // "run" is what the default policy asks for to execute a target;
            // "deploy" is a group name from the identity provider, which only
            // means something to a target declaring requiresRole("deploy").
            roles: ["run", "deploy"],
            via: "api-key",
          }
          : {
            status: 403,
            error: "invalid_key",
            detail: "unknown API key",
            challenge: 'Bearer realm="zuke"',
          },
    };
  }
}

/** Start `serveMcp` over HTTP on an ephemeral loopback port. */
async function startMcp(
  build: Build,
  options: ServeMcpOptions,
): Promise<{ url: string; stop: () => Promise<number> }> {
  const aborter = new AbortController();
  let setPort = (_: number) => {};
  const portReady = new Promise<number>((resolve) => (setPort = resolve));
  const finished = serveMcp(build, {
    ...options,
    http: { host: "127.0.0.1", port: 0 },
    quiet: true,
    signal: aborter.signal,
    onListen: (address) => setPort(address.port),
  });
  const url = `http://127.0.0.1:${await portReady}/`;
  return {
    url,
    stop: () => {
      aborter.abort();
      return finished;
    },
  };
}

/** POST one `tools/call` for `name`, with whatever headers the caller offers. */
async function callTool(
  url: string,
  name: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; challenge: string | null; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  });
  return {
    status: response.status,
    challenge: response.headers.get("www-authenticate"),
    body: await response.json(),
  };
}

/** Whether `value` is a plain object (a string-keyed record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON-RPC error message in a response body, or `""` if it carries none. */
function rpcErrorMessage(body: unknown): string {
  const error = isRecord(body) ? body.error : undefined;
  const message = isRecord(error) ? error.message : undefined;
  return typeof message === "string" ? message : "";
}

Deno.test("an authenticated call runs the target, attributed to the resolved actor", async () => {
  await withStateDir(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    // `--actor` is set too: the authenticated identity must outrank it.
    const server = await startMcp(new Fleet(), {
      allowRun: true,
      actor: "cli-default",
    });
    try {
      const called = await callTool(server.url, "run:deploy", {
        "x-api-key": API_KEY,
      });
      assertEquals(called.status, 200);

      // The build really ran, and its record names the authenticator's actor.
      const runs = (await store.listRuns({})).filter((r) =>
        r.rootTarget === "deploy"
      );
      assertEquals(runs.length, 1);

      const shown = await runCli(Fleet, ["runs", "show", runs[0].id]);
      assertEquals(shown.code, 0);
      assertStringIncludes(shown.out, "status:   succeeded");
      assertStringIncludes(shown.out, "actor:    svc-releaser");
      assertEquals(shown.out.includes("cli-default"), false);

      // …and so does the trail the operator reads on the host.
      const audit = await runCli(Fleet, ["runs", "show", "mcp-audit"]);
      assertEquals(audit.code, 0);
      assertStringIncludes(audit.out, "Audit:");
      assertStringIncludes(audit.out, "run:deploy");
      assertStringIncludes(audit.out, "svc-releaser");
      assertEquals(audit.out.includes("cli-default"), false);
    } finally {
      assertEquals(await server.stop(), 0);
    }
  });
});

Deno.test("a refused call gets the refusal's status and challenge, and writes nothing", async () => {
  await withStateDir(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const server = await startMcp(new Fleet(), { allowRun: true });
    try {
      // No key: the authenticator refuses before the body is even read.
      const refused = await callTool(server.url, "run:deploy");
      assertEquals(refused.status, 403);
      assertEquals(refused.challenge, 'Bearer realm="zuke"');
      // The reason still reaches a client that only speaks JSON-RPC.
      assertEquals(
        rpcErrorMessage(refused.body),
        "invalid_key: unknown API key",
      );

      // Nothing ran and nothing was recorded — not even an audit event, which
      // would mean the request had reached dispatch.
      assertEquals(await store.listRuns({}), []);
      assertEquals(await store.getRun("mcp-audit"), null);
      const audit = await runCli(Fleet, ["runs", "show", "mcp-audit"]);
      assertEquals(audit.code, 1);
      assertStringIncludes(audit.err, 'no run "mcp-audit"');
    } finally {
      assertEquals(await server.stop(), 0);
    }
  });
});

Deno.test("in registry mode the caller's kind and roles reach the spawned build", async () => {
  await withStateDir(async (dir) => {
    const registry = new FileSystemBuildRegistry(`${dir}/builds`);
    await silence(async () => {
      const code = await registerCommand(new Fleet(), {
        registry,
        location: { kind: "module", module: "file:///r/fleet.ts", cwd: "/r" },
        readEnv: () => undefined,
        now: () => "2026-01-01T00:00:00.000Z",
      });
      assertEquals(code, 0);
    });

    // A fake runner: no subprocess, just what the spawn would have been told.
    const spawns: RegistryRunOptions[] = [];
    const runner: RegistryRunner = (_argv, _cwd, options) => {
      spawns.push({ ...options });
      return Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
    };
    const server = await startMcp(new Fleet(), {
      allowRun: true,
      actor: "cli-default",
      registry,
      runner,
    });
    try {
      const called = await callTool(server.url, "run:Fleet:deploy", {
        "x-api-key": API_KEY,
      });
      assertEquals(called.status, 200);

      // All three travel together, so the child never reads one caller's actor
      // with another's entitlements.
      assertEquals(spawns.length, 1);
      assertEquals(spawns[0].actor, "svc-releaser");
      assertEquals(spawns[0].actorKind, "service");
      assertEquals(spawns[0].actorRoles, ["run", "deploy"]);
    } finally {
      assertEquals(await server.stop(), 0);
    }
  });
});

Deno.test("a build declaring both mcpAuth() and mcpIdentity() refuses to start", async () => {
  class Confused extends Build {
    deploy = target().executes(() => {});

    override mcpAuth(): McpAuthenticator {
      return { authenticate: () => ({ actor: "svc-releaser" }) };
    }

    override mcpIdentity(): McpIdentityHook {
      return () => ({ actor: "proxy-user" });
    }
  }

  // Through the real CLI: the server exits before binding a transport, so the
  // whole command runs in-process.
  const { code, err } = await runCli(Confused, ["mcp"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "mcpAuth() and mcpIdentity()");
  assertStringIncludes(err, "keep");
});

/** A build that declares itself an OAuth protected resource. */
class Guarded extends Build {
  deploy = target().description("Deploy").executes(() => {});

  override mcpProtectedResource(): ProtectedResourceSettings {
    return protectedResource("https://build.example.com/mcp")
      .authorizationServer("https://acme.eu.auth0.com")
      .scopes("zuke:run")
      .name("Acme build server");
  }
}

Deno.test("the metadata document is served at the path-inserted location", async () => {
  const server = await startMcp(new Guarded(), {});
  try {
    // Only there. A client that probed the root would derive the bare origin as
    // the expected `resource` and, per RFC 9728 3.3, discard a document naming
    // a path — so a copy at the root would have no correct consumer.
    {
      const path = ".well-known/oauth-protected-resource/mcp";
      const response = await fetch(`${server.url}${path}`);
      assertEquals(response.status, 200);
      // Public and cross-origin readable: a browser-based client fetches this
      // before it has any credential to be checked.
      assertEquals(response.headers.get("access-control-allow-origin"), "*");
      assertEquals(await response.json(), {
        resource: "https://build.example.com/mcp",
        authorization_servers: ["https://acme.eu.auth0.com"],
        bearer_methods_supported: ["header"],
        scopes_supported: ["zuke:run"],
        resource_name: "Acme build server",
      });
    }
    const root = await fetch(
      `${server.url}.well-known/oauth-protected-resource`,
    );
    assertEquals(root.status, 405);
    await root.body?.cancel();
  } finally {
    await server.stop();
  }
});

Deno.test("a malformed Host header does not fault the server", async () => {
  // The metadata branch runs before every other check and parses the request
  // URL, which Deno builds from the raw Host header — and it accepts hosts the
  // WHATWG parser rejects. Unguarded, that answered *every* request with a 500,
  // authenticated ones included: an unauthenticated caller could fault the
  // whole endpoint just by declaring a protected resource on it.
  const server = await startMcp(new Guarded(), {});
  try {
    const port = Number(new URL(server.url).port);
    const connection = await Deno.connect({ hostname: "127.0.0.1", port });
    await connection.write(
      new TextEncoder().encode(
        "GET / HTTP/1.1\r\nHost: bad host\r\nConnection: close\r\n\r\n",
      ),
    );
    const buffer = new Uint8Array(256);
    const read = await connection.read(buffer);
    connection.close();
    const statusLine = new TextDecoder()
      .decode(buffer.subarray(0, read ?? 0))
      .split("\r\n")[0];
    // The ordinary refusal for a GET on the MCP endpoint — not a fault.
    assertStringIncludes(statusLine, "405");
  } finally {
    await server.stop();
  }
});

Deno.test("an unauthenticated call is refused with a challenge naming the document", async () => {
  const server = await startMcp(new Guarded(), { token: "shared-token" });
  try {
    const bare = await fetch(`${server.url}`, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assertEquals(bare.status, 401);
    const challenge = bare.headers.get("www-authenticate") ?? "";
    assertStringIncludes(
      challenge,
      `resource_metadata="https://build.example.com` +
        `/.well-known/oauth-protected-resource/mcp"`,
    );
    // Nothing was presented, so nothing of the client's has been rejected.
    assertEquals(challenge.includes("error="), false);
    // The declared scopes are named, rather than left for the client to guess
    // by requesting the whole advertised catalogue.
    assertStringIncludes(challenge, `scope="zuke:run"`);

    // A token that was presented and rejected says so, which is a different
    // thing for a client to act on than "you have not logged in".
    const wrong = await fetch(`${server.url}`, {
      method: "POST",
      headers: { authorization: "Bearer nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assertEquals(wrong.status, 401);
    const rejected = wrong.headers.get("www-authenticate") ?? "";
    assertStringIncludes(rejected, `error="invalid_token"`);
    assertStringIncludes(rejected, "resource_metadata=");
  } finally {
    await server.stop();
  }
});

Deno.test("a build declaring no protected resource publishes nothing", async () => {
  // The surface is opt-in: no document, and no discovery parameters on any
  // challenge. The one thing that did change for such a build is deliberate —
  // a token that was presented and rejected now says so.
  const server = await startMcp(new Fleet(), { token: "shared-token" });
  try {
    const document = await fetch(
      `${server.url}.well-known/oauth-protected-resource`,
    );
    assertEquals(document.status, 405);
    await document.body?.cancel();
    const refused = await fetch(`${server.url}`, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assertEquals(refused.status, 401);
    assertEquals(refused.headers.get("www-authenticate"), "Bearer");
    await refused.body?.cancel();

    // A wrong token names itself. This is the one behaviour that changed for a
    // build declaring nothing, and it is the OAuth-defined answer: the client
    // learns its stored credential was refused rather than that it has none.
    const wrong = await fetch(`${server.url}`, {
      method: "POST",
      headers: { authorization: "Bearer nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assertEquals(wrong.status, 401);
    assertEquals(
      wrong.headers.get("www-authenticate"),
      `Bearer error="invalid_token"`,
    );
    // ...and still no discovery, because none was declared.
    assertEquals(
      (wrong.headers.get("www-authenticate") ?? "").includes(
        "resource_metadata",
      ),
      false,
    );
    await wrong.body?.cancel();
  } finally {
    await server.stop();
  }
});

Deno.test("a preflight for the metadata document is answered", async () => {
  const server = await startMcp(new Guarded(), {});
  try {
    const response = await fetch(
      `${server.url}.well-known/oauth-protected-resource/mcp`,
      { method: "OPTIONS" },
    );
    assertEquals(response.status, 204);
    assertEquals(response.headers.get("access-control-allow-origin"), "*");
    assertStringIncludes(
      response.headers.get("access-control-allow-methods") ?? "",
      "GET",
    );
  } finally {
    await server.stop();
  }
});

Deno.test("the metadata response is a cacheable JSON document, and answers HEAD", async () => {
  // RFC 9728 3.2 makes the 200 + application/json a MUST; the cache header is
  // what stops every cold client re-fetching a constant.
  const server = await startMcp(new Guarded(), {});
  try {
    const url = `${server.url}.well-known/oauth-protected-resource/mcp`;
    const response = await fetch(url);
    assertEquals(response.headers.get("content-type"), "application/json");
    assertStringIncludes(
      response.headers.get("cache-control") ?? "",
      "max-age=3600",
    );
    await response.body?.cancel();

    const head = await fetch(url, { method: "HEAD" });
    assertEquals(head.status, 200);
    assertEquals(head.headers.get("content-type"), "application/json");
    await head.body?.cancel();
  } finally {
    await server.stop();
  }
});

Deno.test("an unusable protected-resource declaration stops the server starting", async () => {
  // Validated once at startup rather than per request: a client discovering the
  // mistake would be a client that cannot authenticate, and the throw would
  // land on a public route as a 500.
  class Broken extends Build {
    deploy = target().executes(() => {});
    override mcpProtectedResource(): ProtectedResourceSettings {
      return protectedResource("https://build.example.com/mcp");
    }
  }
  // Through the real CLI: it exits before binding a transport, so the whole
  // command runs in-process, exactly like the both-seams refusal above.
  const { code, err } = await runCli(Broken, ["mcp"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "authorization server");
});
