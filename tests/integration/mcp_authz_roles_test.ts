// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the MCP role policy, end to end through `zuke mcp`.
 *
 * What these prove that a unit test cannot: the policy reaches a real HTTP
 * server built from a real `Build`, the compatibility guarantee holds for a
 * server whose authenticator predates roles, and a denial is refused before the
 * build's code runs rather than after.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  type McpAuthenticator,
  type McpRequestContext,
  target,
} from "../../packages/core/mod.ts";
import { serveMcp } from "../../packages/core/src/mcp/command.ts";
import { withStateDir } from "./_harness.ts";

/** Bodies that actually executed. */
const ran: string[] = [];

/**
 * A control plane whose authenticator reads roles from a header — the shape an
 * identity-provider mapping produces.
 */
class ControlPlane extends Build {
  deploy = target().executes(() => void ran.push("deploy"));
  promote = target().requiresRole("operator").executes(() =>
    void ran.push("promote")
  );
  override mcpAuth(): McpAuthenticator {
    return {
      authenticate: (ctx: McpRequestContext) => {
        const roles = ctx.headers.get("x-roles");
        if (roles === null) {
          return { status: 401, error: "no_identity", challenge: "Bearer" };
        }
        return {
          actor: ctx.headers.get("x-user") ?? "anon",
          kind: "human" as const,
          roles: roles === "" ? [] : roles.split(","),
        };
      },
    };
  }
}

/**
 * A build using the legacy proxy-header seam — the pre-policy shape. That seam
 * never had roles to give, so the policy leaves it alone; an `mcpAuth()`
 * authenticator omitting roles is a different claim and is denied.
 */
class Legacy extends Build {
  deploy = target().executes(() => void ran.push("deploy"));
  override mcpIdentity() {
    return () => ({ actor: "ada", via: "proxy" });
  }
}

/** Start `BuildClass` over HTTP on loopback; returns its URL and a stopper. */
async function startMcp(
  BuildClass: new () => Build,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const ac = new AbortController();
  let setPort = (_: number) => {};
  const ready = new Promise<number>((r) => (setPort = r));
  const finished = serveMcp(new BuildClass(), {
    http: { host: "127.0.0.1", port: 0 },
    allowRun: true,
    quiet: true,
    signal: ac.signal,
    onListen: (a) => setPort(a.port),
  });
  const port = await ready;
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: async () => {
      ac.abort();
      await finished;
    },
  };
}

/** Call a tool with the given identity headers, returning the result body. */
async function callTool(
  url: string,
  name: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  });
  return { status: res.status, text: JSON.stringify(await res.json()) };
}

Deno.test("the role policy gates a real server's tools", async () => {
  await withStateDir(async () => {
    ran.length = 0;
    const server = await startMcp(ControlPlane);
    try {
      // `read` can look but not run.
      const looked = await callTool(server.url, "list_targets", {
        "x-user": "ada",
        "x-roles": "read",
      });
      assertEquals(looked.status, 200);
      assertEquals(looked.text.includes("unauthorized"), false);

      const refused = await callTool(server.url, "run:deploy", {
        "x-user": "ada",
        "x-roles": "read",
      });
      assertStringIncludes(refused.text, "unauthorized");
      assertEquals(ran.includes("deploy"), false, ran.join(","));

      // `run` can run an ordinary target…
      const allowed = await callTool(server.url, "run:deploy", {
        "x-user": "ada",
        "x-roles": "run",
      });
      assertEquals(allowed.text.includes("unauthorized"), false, allowed.text);
      assertEquals(ran.includes("deploy"), true);

      // …but not one that asks for operator.
      const promoteRefused = await callTool(server.url, "run:promote", {
        "x-user": "ada",
        "x-roles": "run",
      });
      assertStringIncludes(promoteRefused.text, "unauthorized");
      assertEquals(ran.includes("promote"), false, ran.join(","));

      // An operator can, and satisfies `run` without holding it.
      const promoted = await callTool(server.url, "run:promote", {
        "x-user": "ada",
        "x-roles": "operator",
      });
      assertEquals(
        promoted.text.includes("unauthorized"),
        false,
        promoted.text,
      );
      assertEquals(ran.includes("promote"), true);
    } finally {
      await server.stop();
    }
  });
});

Deno.test("the legacy identity hook is unconstrained by the policy", async () => {
  // The compatibility guarantee, end to end: a server using the seam that
  // predates roles keeps working exactly as it did.
  await withStateDir(async () => {
    ran.length = 0;
    const server = await startMcp(Legacy);
    try {
      const called = await callTool(server.url, "run:deploy", {});
      assertEquals(called.status, 200);
      assertEquals(called.text.includes("unauthorized"), false, called.text);
      assertEquals(ran.includes("deploy"), true);
    } finally {
      await server.stop();
    }
  });
});

Deno.test("a caller granted no roles at all is refused everything", async () => {
  await withStateDir(async () => {
    ran.length = 0;
    const server = await startMcp(ControlPlane);
    try {
      for (const tool of ["list_targets", "run:deploy"]) {
        const res = await callTool(server.url, tool, {
          "x-user": "ada",
          "x-roles": "",
        });
        assertStringIncludes(res.text, "unauthorized", tool);
      }
      assertEquals(ran, []);
    } finally {
      await server.stop();
    }
  });
});

// ---- Regressions from the adversarial review -------------------------------

/** A build whose operator-only target sits behind an ordinary one. */
class Chained extends Build {
  promote = target().requiresRole("operator").executes(() =>
    void ran.push("promote")
  );
  release = target().dependsOn(this.promote).executes(() =>
    void ran.push("release")
  );
  override mcpAuth(): McpAuthenticator {
    return {
      authenticate: (ctx: McpRequestContext) => {
        const roles = ctx.headers.get("x-roles");
        if (roles === null) {
          return { status: 401, error: "no_identity", challenge: "Bearer" };
        }
        return {
          actor: ctx.headers.get("x-user") ?? "anon",
          kind: "human" as const,
          roles: roles === "" ? [] : roles.split(","),
        };
      },
    };
  }
}

Deno.test("requiresRole is enforced across the plan, not just the entry point", async () => {
  // Invoking a target runs its dependencies, so a requirement guarding only the
  // named target would be bypassed by invoking anything that depends on it —
  // which is why --protect is plan-wide too.
  await withStateDir(async () => {
    ran.length = 0;
    const server = await startMcp(Chained);
    try {
      const direct = await callTool(server.url, "run:promote", {
        "x-user": "mallory",
        "x-roles": "run",
      });
      assertStringIncludes(direct.text, "unauthorized");

      // The dependency route must be refused identically.
      const viaDependent = await callTool(server.url, "run:release", {
        "x-user": "mallory",
        "x-roles": "run",
      });
      assertStringIncludes(viaDependent.text, "unauthorized");
      assertEquals(ran, [], `bodies ran: ${ran.join(",")}`);

      // An operator gets through both.
      const asOperator = await callTool(server.url, "run:release", {
        "x-user": "ada",
        "x-roles": "operator",
      });
      assertEquals(
        asOperator.text.includes("unauthorized"),
        false,
        asOperator.text,
      );
      assertEquals(ran.includes("promote"), true);
    } finally {
      await server.stop();
    }
  });
});

/** An mcpAuth() authenticator that omits roles for one caller. */
class Partial extends Build {
  promote = target().requiresRole("operator").executes(() =>
    void ran.push("promote")
  );
  override mcpAuth(): McpAuthenticator {
    return {
      authenticate: (ctx: McpRequestContext) => {
        const roles = ctx.headers.get("x-roles");
        return {
          actor: ctx.headers.get("x-user") ?? "anon",
          kind: "human" as const,
          // The shape of the shipped example: a claim that is simply absent
          // from some tokens.
          ...(roles === null ? {} : { roles: roles.split(",") }),
        };
      },
    };
  }
}

Deno.test("a token carrying no roles gets no privilege from the omission", async () => {
  // Less information must never buy more privilege. Whether roles are enforced
  // is a property of the seam, so an mcpAuth() identity that omits them settles
  // to none and is denied — rather than skipping the policy entirely.
  await withStateDir(async () => {
    ran.length = 0;
    const server = await startMcp(Partial);
    try {
      const withRole = await callTool(server.url, "run:promote", {
        "x-user": "ada",
        "x-roles": "read",
      });
      assertStringIncludes(withRole.text, "unauthorized");

      const withoutAny = await callTool(server.url, "run:promote", {
        "x-user": "mallory",
      });
      assertStringIncludes(withoutAny.text, "unauthorized");
      assertEquals(ran, [], `bodies ran: ${ran.join(",")}`);
    } finally {
      await server.stop();
    }
  });
});
