// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Authorization over a run's **whole plan**, not just its root target.
 *
 * A `run:` tool executes the root's entire dependency closure, so a gate that
 * only inspects the root name is one unprotected dependent away from being
 * bypassed: `--protect deploy` means nothing if an unprotected `release` that
 * depends on `deploy` can be called without a token.
 *
 * The two gates deliberately keep different reach, and these tests pin both:
 * the **operator token** is an operation control checked across the plan, while
 * the **allow-list** stays an entry-point control (invoking a target inherently
 * runs its dependencies — that is what a target means). Read-tool visibility
 * follows the allow-list's closure so a hidden target is genuinely unreachable
 * rather than merely undisplayed.
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, parameter, target } from "../mod.ts";
import { McpServer, type McpServerOptions } from "../src/mcp/server.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { AUDIT_RUN_ID } from "../src/mcp/audit.ts";
import type { RunEvent, RunRecord } from "../src/state/types.ts";

/**
 * A build with a real dependency chain. `release` → `deploy` → `lint`, plus an
 * `unrelated` target reachable from nothing, so a closure can be told apart
 * from "every target in the build".
 */
class Chain extends Build {
  token = parameter("Token").secret();
  note = parameter("Note");
  lint = target().description("Lint").executes(() => {});
  deploy = target().description("Deploy").dependsOn(this.lint).executes(
    () => {},
  );
  release = target().description("Release").dependsOn(this.deploy).executes(
    () => {},
  );
  unrelated = target().description("Unrelated").executes(() => {});
}

/** A JSON-RPC request with id 1. */
function req(method: string, params?: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) };
}

/** The `{ text, isError }` of a `tools/call` result. */
function callResult(result: unknown): { text: string; isError: boolean } {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    throw new Error("not a tool result");
  }
  const content = (result as { content: Array<{ text: string }> }).content;
  const isError = (result as { isError?: boolean }).isError ?? false;
  return { text: content[0].text, isError };
}

/** Call a tool and return its result body. */
async function call(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
  const res = await server.handleMessage(
    req("tools/call", { name, arguments: args }),
  );
  return callResult(res?.result);
}

/** One advertised tool, as the client sees it. */
interface ListedTool {
  name: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

/** The advertised tool list. */
async function toolList(server: McpServer): Promise<ListedTool[]> {
  const res = await server.handleMessage(req("tools/list"));
  const result = res?.result;
  if (typeof result !== "object" || result === null || !("tools" in result)) {
    throw new Error("no tools");
  }
  return (result as { tools: ListedTool[] }).tools;
}

/** The target names `list_targets` reports. */
async function visibleTargets(server: McpServer): Promise<string[]> {
  const listed = await call(server, "list_targets");
  const targets: Array<{ name: string }> = JSON.parse(listed.text);
  return targets.map((t) => t.name).sort();
}

/** Run `fn` with a temp-dir store and a server over {@link Chain}. */
async function withServer(
  options: Omit<McpServerOptions, "stateStore">,
  fn: (server: McpServer, store: FileSystemStateStore) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const server = new McpServer(new Chain(), {
      ...options,
      stateStore: store,
    });
    await fn(server, store);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Seed a suspended run rooted at `rootTarget`, returning its id. */
async function seedSuspended(
  store: FileSystemStateStore,
  rootTarget: string,
): Promise<string> {
  const now = new Date().toISOString();
  const record: RunRecord = {
    id: `run-${rootTarget}`,
    build: "Chain",
    rootTarget,
    status: "suspended",
    actor: "someone",
    createdAt: now,
    updatedAt: now,
    graph: [{ name: rootTarget, dependsOn: [] }],
    params: {},
    targets: { [rootTarget]: { status: "waiting", meta: {} } },
    signals: {},
    events: [],
  };
  const put = await store.putRun(record, null);
  if (!put.ok) throw new Error("failed to seed suspended run");
  return record.id;
}

/** Read the audit trail from the store. */
async function auditEvents(store: FileSystemStateStore): Promise<RunEvent[]> {
  const loaded = await store.getRun(AUDIT_RUN_ID);
  return loaded === null ? [] : loaded.record.events;
}

// --- The bypass itself -----------------------------------------------------

Deno.test("a protected target reached as a dependency still needs the token", async () => {
  await withServer(
    { allowRun: true, protectPatterns: ["deploy"], operatorToken: "swordfish" },
    async (server, store) => {
      // `release` is not itself protected, but running it runs `deploy`.
      const denied = await call(server, "run:release", {});
      assertEquals(denied.isError, true);
      assertEquals(JSON.parse(denied.text).reason, "missing_operator_token");

      // The denial is audited against the tool that was actually called.
      const events = await auditEvents(store);
      assertEquals(events.at(-1)?.tool, "run:release");
      assertEquals(events.at(-1)?.outcome, "denied");

      // A wrong token is refused just the same.
      const wrong = await call(server, "run:release", {
        operatorToken: "guess",
      });
      assertEquals(wrong.isError, true);
      assertEquals(JSON.parse(wrong.text).reason, "invalid_operator_token");

      // The right token lets the whole plan run.
      const allowed = await call(server, "run:release", {
        operatorToken: "swordfish",
      });
      assertEquals(allowed.isError, false);
      assertStringIncludes(allowed.text, "release succeeded");
    },
  );
});

Deno.test("a dependent of a protected target advertises operatorToken as required", async () => {
  await withServer(
    { allowRun: true, protectPatterns: ["deploy"], operatorToken: "swordfish" },
    async (server) => {
      const tools = await toolList(server);
      // The schema must state the requirement, or a client would be denied for
      // omitting an argument it was never told about.
      const release = tools.find((t) => t.name === "run:release");
      assertEquals(
        release?.inputSchema?.required?.includes("operatorToken"),
        true,
      );
      // `lint` runs nothing protected, so it stays unencumbered.
      const lint = tools.find((t) => t.name === "run:lint");
      assertEquals(
        lint?.inputSchema?.required?.includes("operatorToken"),
        undefined,
      );
      assertEquals(
        Object.hasOwn(lint?.inputSchema?.properties ?? {}, "operatorToken"),
        false,
      );
    },
  );
});

Deno.test("protection over the plan also gates signal_run and cancel_run", async () => {
  await withServer(
    { allowRun: true, protectPatterns: ["deploy"], operatorToken: "swordfish" },
    async (server, store) => {
      // A run rooted at `release` resumes into `deploy`, so it is protected too.
      const id = await seedSuspended(store, "release");

      const signal = await call(server, "signal_run", {
        runId: id,
        signal: "go",
      });
      assertEquals(signal.isError, true);
      assertEquals(JSON.parse(signal.text).reason, "missing_operator_token");

      const cancel = await call(server, "cancel_run", { runId: id });
      assertEquals(cancel.isError, true);
      assertEquals(JSON.parse(cancel.text).reason, "missing_operator_token");

      // A sweep silently skips what it may not resume.
      const sweep = await call(server, "resume_check");
      assertEquals(JSON.parse(sweep.text).checked, 0);
    },
  );
});

/** A build that reaches a protected target through `.triggers()`, not `dependsOn`. */
class Triggering extends Build {
  deploy = target().description("Deploy").executes(() => {});
  notify = target().description("Notify").triggers(this.deploy).executes(
    () => {},
  );
}

Deno.test("a protected target reached through triggers also needs the token", async () => {
  // `triggers` is the second way a target enters the execution set (executionSet
  // walks dependsOn_ *and* triggers_), so a gate that only followed dependsOn
  // would leave this route open.
  const server = new McpServer(new Triggering(), {
    allowRun: true,
    protectPatterns: ["deploy"],
    operatorToken: "swordfish",
  });
  const denied = await call(server, "run:notify", {});
  assertEquals(denied.isError, true);
  assertEquals(JSON.parse(denied.text).reason, "missing_operator_token");

  const allowed = await call(server, "run:notify", {
    operatorToken: "swordfish",
  });
  assertEquals(allowed.isError, false);
});

Deno.test("confirm-destructive does not leak a protected plan before the token", async () => {
  // The confirmation gate answers with the resolved plan — the target names a
  // run would touch. It must sit *behind* the operator-token check, or an
  // unauthenticated caller could enumerate a protected pipeline just by
  // omitting confirm:true.
  await withServer(
    {
      allowRun: true,
      confirmDestructive: true,
      protectPatterns: ["deploy"],
      operatorToken: "swordfish",
    },
    async (server) => {
      const probe = await call(server, "run:release", {});
      assertEquals(probe.isError, true);
      assertEquals(JSON.parse(probe.text).reason, "missing_operator_token");
      // No plan, and no target names, came back.
      assertEquals(probe.text.includes("confirmation_required"), false);
      assertEquals(probe.text.includes("deploy"), false);
    },
  );
});

// --- The allow-list stays an entry-point control ---------------------------

Deno.test("the allow-list gates invocation, not the dependencies invoking pulls in", async () => {
  await withServer(
    { allowRun: true, allowRunPatterns: ["release"] },
    async (server) => {
      // `deploy` and `lint` are not allow-listed, but running `release` runs
      // them — that is what depending on a target means. Allow-listing a root
      // is allow-listing what it does.
      const ran = await call(server, "run:release", {});
      assertEquals(ran.isError, false);

      // Invoking an excluded target directly is still refused, opaquely.
      const direct = await call(server, "run:deploy", {});
      assertEquals(direct.isError, true);
      assertStringIncludes(direct.text, "Unknown tool: run:deploy");
    },
  );
});

// --- Read-tool visibility follows the allow-list closure --------------------

Deno.test("an allow-list narrows the read tools to its closure", async () => {
  await withServer(
    { allowRun: true, allowRunPatterns: ["release"] },
    async (server) => {
      // Visible: the invokable root and everything invoking it would run.
      // Hidden: `unrelated`, which this client can never cause to run.
      assertEquals(await visibleTargets(server), ["deploy", "lint", "release"]);

      const graph = await call(server, "graph");
      assertStringIncludes(graph.text, "release -> deploy");
      assertEquals(graph.text.includes("unrelated"), false);

      const full = await call(server, "describe_build");
      assertEquals(full.text.includes("unrelated"), false);
    },
  );
});

Deno.test("without an allow-list every target stays visible (the inspect tier)", async () => {
  // A bare --allow-run, and the read-only server, both describe the whole build.
  await withServer({ allowRun: true }, async (server) => {
    assertEquals(await visibleTargets(server), [
      "deploy",
      "lint",
      "release",
      "unrelated",
    ]);
  });
  await withServer({}, async (server) => {
    assertEquals(await visibleTargets(server), [
      "deploy",
      "lint",
      "release",
      "unrelated",
    ]);
  });
});

// --- The audit trail is not readable through the tools it audits ------------

Deno.test("the audit trail is not readable over MCP", async () => {
  await withServer(
    { allowRun: true, actor: "agent" },
    async (server, store) => {
      // Generate a trail entry so the record exists.
      await call(server, "run:lint", {});
      assertEquals((await auditEvents(store)).length > 0, true);

      // show_run refuses it: the principals it audits must not be able to read
      // who called what, nor to confirm their own denials were recorded.
      const shown = await call(server, "show_run", { runId: AUDIT_RUN_ID });
      assertEquals(shown.isError, true);
      assertEquals(JSON.parse(shown.text).error, "not_readable");

      // …and it is not listed as an ordinary run either.
      const listed = await call(server, "list_runs");
      assertEquals(listed.text.includes(AUDIT_RUN_ID), false);
    },
  );
});

Deno.test("the audit trail stays unreadable under a differently-cased id", async () => {
  // The store maps a run id straight to `<id>.json` and permits capitals, so on
  // a case-insensitive volume (macOS, Windows) `MCP-AUDIT` opens the very same
  // file. An exact-match refusal would hold on Linux and serve the trail on the
  // other two platforms — so the guard is case-insensitive, and this pins it on
  // every platform rather than only where the filesystem would expose the gap.
  await withServer({ allowRun: true, actor: "agent" }, async (server) => {
    await call(server, "run:lint", {});
    for (const id of ["MCP-AUDIT", "Mcp-Audit", "mcp-AUDIT"]) {
      const shown = await call(server, "show_run", { runId: id });
      assertEquals(shown.isError, true, `${id} was not refused`);
      assertEquals(JSON.parse(shown.text).error, "not_readable");
    }
  });
});

Deno.test("an unresolvable plan is denied without saying so to the caller", async () => {
  // The denial must not separate "not in the allow-list" from "no longer in the
  // build" — that distinction is an existence signal the opaque answer exists
  // to withhold. The caller sees the collapsed reason; the operator still gets
  // the precise one from the audit trail.
  await withServer(
    {
      allowRun: true,
      protectPatterns: ["deploy"],
      operatorToken: "swordfish",
      actor: "agent",
    },
    async (server, store) => {
      const id = await seedSuspended(store, "targetThatWasDeleted");
      const signal = await call(server, "signal_run", {
        runId: id,
        signal: "go",
      });
      assertEquals(signal.isError, true);
      assertEquals(JSON.parse(signal.text).reason, "not_allowed");
      assertEquals(signal.text.includes("unresolved_plan"), false);
    },
  );
});

Deno.test("a value under an undeclared key is elided from the trail", async () => {
  // Redaction can only mask what it recognises. A value supplied under a
  // *misspelled* secret parameter's name matches no declared secret, so nothing
  // would mask it and it would land in the durable trail verbatim. Undeclared
  // keys therefore keep their name and lose their value — the same posture the
  // registry server already takes.
  await withServer(
    { allowRun: true, actor: "agent" },
    async (server, store) => {
      await call(server, "run:lint", {
        tokens: "please-do-not-store-me", // near-miss for the `token` secret
        note: "kept", // declared, so its value is useful in the trail
        dryRun: true, // a control flag, always safe
      });
      const last = (await auditEvents(store)).at(-1);
      assertEquals(last?.args?.tokens, "<omitted>");
      assertEquals(last?.args?.note, "kept");
      assertEquals(last?.args?.dryRun, "true");
    },
  );
});

Deno.test("a secret supplied as a non-string is still masked where it is echoed", async () => {
  await withServer(
    { allowRun: true, actor: "agent" },
    async (server, store) => {
      // The secret arrives as a JSON number and is echoed into a non-secret
      // argument. Seeding the redactor only from string values would leave the
      // echo in the durable trail.
      await call(server, "run:lint", { token: 13579, note: "code 13579 sent" });
      const last = (await auditEvents(store)).at(-1);
      assertEquals(last?.args?.token, "[redacted]");
      assertEquals(last?.args?.note, "code [redacted] sent");
    },
  );
});

Deno.test("a target whose plan cannot even be resolved fails closed", async () => {
  // A cycle the authoring API forbids, forged by mutating the (public)
  // dependsOn_ array after construction: planGraph throws on it, so the plan
  // is unknowable — an unknown blast radius must be treated as protected.
  class Cyclic extends Build {
    a = target().executes(() => {});
    b = target().dependsOn(this.a).executes(() => {});
  }
  const build = new Cyclic();
  build.a.dependsOn_.push(build.b);
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const server = new McpServer(build, {
      allowRun: true,
      stateStore: store,
      actor: "agent",
    });

    // The advertised schema fails closed too: with no resolvable plan, the
    // run tool demands the operator token.
    const tools = await toolList(server);
    const runA = tools.find((t) => t.name === "run:a");
    assertEquals(runA?.inputSchema?.required?.includes("operatorToken"), true);

    // The call is denied with the collapsed reason — the caller cannot tell
    // an unresolvable plan from a plain not-allowed target…
    const denied = await call(server, "run:a", {});
    assertEquals(denied.isError, true);
    assertEquals(JSON.parse(denied.text).reason, "not_allowed");
    assertEquals(denied.text.includes("unresolved_plan"), false);

    // …while the operator-only audit trail keeps the precise reason.
    const events = await auditEvents(store);
    assertEquals(events.at(-1)?.tool, "run:a");
    assertEquals(events.at(-1)?.outcome, "denied");
    assertEquals(events.at(-1)?.detail, "unresolved_plan");

    // Under an allow-list, the visibility closure of an unresolvable plan is
    // just the root itself — the walk must not crash on it, and it must not
    // guess at what the broken plan might have reached.
    const narrowed = new McpServer(build, {
      allowRun: true,
      allowRunPatterns: ["a"],
    });
    const listed = await call(narrowed, "list_targets");
    const visible: Array<{ name: string }> = JSON.parse(listed.text);
    assertEquals(visible.map((t) => t.name), ["a"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
