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
            roles: ["deploy"],
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
      assertEquals(spawns[0].actorRoles, ["deploy"]);
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
