import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, parameter, target } from "../mod.ts";
import { McpServer, type McpServerOptions } from "../src/mcp/server.ts";
import { FileSystemStateStore } from "../src/state/fs_store.ts";
import { defaultStateHost } from "../src/state/store.ts";
import { AUDIT_RUN_ID } from "../src/mcp/audit.ts";
import type { RunEvent, RunRecord } from "../src/state/types.ts";

/** A build with a read-only, a plain, and a protected-worthy target, plus params. */
class Demo extends Build {
  environment = parameter("Env").options("dev", "prod").default("dev");
  secret = parameter("Secret").secret();
  note = parameter("Note"); // a free-text, non-secret parameter
  status = target().description("Status").readOnly().executes(() => {});
  deploy = target().description("Deploy").executes(() => {});
  promote = target().description("Promote").executes(() => {});
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

/** The advertised tool list. */
async function toolList(
  server: McpServer,
): Promise<Array<{ name: string; annotations?: Record<string, unknown> }>> {
  const res = await server.handleMessage(req("tools/list"));
  const result = res?.result;
  if (typeof result !== "object" || result === null || !("tools" in result)) {
    throw new Error("no tools");
  }
  return (result as {
    tools: Array<{ name: string; annotations?: Record<string, unknown> }>;
  }).tools;
}

/** Run `fn` with a temp-dir store and a server built over it, then clean up. */
async function withServer(
  options: Omit<McpServerOptions, "stateStore">,
  fn: (server: McpServer, store: FileSystemStateStore) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const server = new McpServer(new Demo(), { ...options, stateStore: store });
    await fn(server, store);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Read the audit trail from the store. */
async function auditEvents(store: FileSystemStateStore): Promise<RunEvent[]> {
  const loaded = await store.getRun(AUDIT_RUN_ID);
  return loaded === null ? [] : loaded.record.events;
}

Deno.test("readOnly targets advertise readOnlyHint; others destructiveHint", async () => {
  await withServer({ allowRun: true }, async (server) => {
    const tools = await toolList(server);
    const status = tools.find((t) => t.name === "run:status");
    const deploy = tools.find((t) => t.name === "run:deploy");
    assertEquals(status?.annotations?.readOnlyHint, true);
    assertEquals(deploy?.annotations?.destructiveHint, true);
  });
});

Deno.test("the allow-list hides non-matching run tools and denies them opaquely", async () => {
  await withServer(
    { allowRun: true, allowRunPatterns: ["deploy"] },
    async (server) => {
      const names = (await toolList(server)).map((t) => t.name);
      assertEquals(names.includes("run:deploy"), true);
      assertEquals(names.includes("run:promote"), false);
      assertEquals(names.includes("run:status"), false);
      // A call to a disallowed target looks exactly like a nonexistent tool.
      const denied = await call(server, "run:promote");
      assertEquals(denied.isError, true);
      assertStringIncludes(denied.text, "Unknown tool: run:promote");
    },
  );
});

Deno.test("run tools are absent, and a run call is refused, without --allow-run", async () => {
  await withServer({ allowRun: false }, async (server) => {
    const names = (await toolList(server)).map((t) => t.name);
    assertEquals(names.some((n) => n.startsWith("run:")), false);
    const denied = await call(server, "run:deploy");
    assertEquals(denied.isError, true);
    assertStringIncludes(denied.text, "disabled");
  });
});

Deno.test("a protected target requires a valid operator token, fail-closed", async () => {
  // Configured token.
  await withServer(
    {
      allowRun: true,
      protectPatterns: ["promote"],
      operatorToken: "swordfish",
    },
    async (server) => {
      const promote = (await toolList(server)).find((t) =>
        t.name === "run:promote"
      );
      const schema = promote?.annotations === undefined ? undefined : promote;
      assertEquals(schema !== undefined, true);

      // Missing token → denied.
      const missing = await call(server, "run:promote");
      assertEquals(missing.isError, true);
      assertStringIncludes(missing.text, "missing_operator_token");

      // Wrong token → denied.
      const wrong = await call(server, "run:promote", {
        operatorToken: "nope",
      });
      assertEquals(wrong.isError, true);
      assertStringIncludes(wrong.text, "invalid_operator_token");

      // Correct token → runs.
      const ok = await call(server, "run:promote", {
        operatorToken: "swordfish",
      });
      assertEquals(ok.isError, false);
      assertStringIncludes(ok.text, "promote succeeded");
    },
  );

  // No token configured → always denied (fail-closed).
  await withServer(
    { allowRun: true, protectPatterns: ["promote"] },
    async (server) => {
      const denied = await call(server, "run:promote", {
        operatorToken: "anything",
      });
      assertEquals(denied.isError, true);
      assertStringIncludes(denied.text, "operator_token_unconfigured");
    },
  );
});

Deno.test("confirm-destructive returns a plan until confirm:true; readOnly is exempt", async () => {
  await withServer(
    { allowRun: true, confirmDestructive: true },
    async (server) => {
      // Destructive without confirm → the plan, not an execution.
      const planned = await call(server, "run:deploy");
      assertEquals(planned.isError, false);
      assertStringIncludes(planned.text, "confirmation_required");
      assertStringIncludes(planned.text, "deploy");

      // With confirm → runs.
      const confirmed = await call(server, "run:deploy", { confirm: true });
      assertEquals(confirmed.isError, false);
      assertStringIncludes(confirmed.text, "deploy succeeded");

      // A dry run skips the gate.
      const dry = await call(server, "run:deploy", { dryRun: true });
      assertStringIncludes(dry.text, "deploy");

      // A read-only target is never gated.
      const status = await call(server, "run:status");
      assertStringIncludes(status.text, "status succeeded");
    },
  );
});

Deno.test("store-backed run tools appear with a store; mutating ones need --allow-run", async () => {
  await withServer({ allowRun: false }, async (server) => {
    const names = (await toolList(server)).map((t) => t.name);
    assertEquals(names.includes("list_runs"), true);
    assertEquals(names.includes("show_run"), true);
    assertEquals(names.includes("signal_run"), false); // mutating, needs allowRun
  });
  await withServer({ allowRun: true }, async (server) => {
    const names = (await toolList(server)).map((t) => t.name);
    assertEquals(names.includes("signal_run"), true);
    assertEquals(names.includes("resume_check"), true);
    assertEquals(names.includes("cancel_run"), true);
  });
});

Deno.test("cancel_run cancels a suspended run, gated by the allow-list and audited", async () => {
  await withServer(
    { allowRun: true, allowRunPatterns: ["safe*"], actor: "ops" },
    async (server, store) => {
      const excluded = await seedSuspended(store, "deploy"); // not allow-listed
      const denied = await call(server, "cancel_run", { runId: excluded });
      assertEquals(denied.isError, true);
      assertEquals(JSON.parse(denied.text).reason, "not_allowed");
    },
  );
  await withServer({ allowRun: true, actor: "ops" }, async (server, store) => {
    // A missing run is a structured no_run.
    const missing = await call(server, "cancel_run", { runId: "nope" });
    assertEquals(missing.isError, true);
    assertEquals(JSON.parse(missing.text).error, "no_run");

    // A real suspended run cancels; the call is audited under the actor.
    const id = await seedSuspended(store, "deploy");
    const ok = await call(server, "cancel_run", { runId: id });
    assertEquals(ok.isError, false);
    const body = JSON.parse(ok.text);
    assertEquals(body.status, "cancelled");
    const loaded = await store.getRun(id);
    assertEquals(loaded?.record.status, "cancelled");
    const audit = await auditEvents(store);
    assertEquals(audit.some((e) => e.tool === "cancel_run"), true);
  });
});

Deno.test("run tools query the store and return structured errors", async () => {
  await withServer({ allowRun: true }, async (server) => {
    const list = await call(server, "list_runs");
    assertEquals(list.isError, false);
    assertEquals(JSON.parse(list.text), []);

    const missing = await call(server, "show_run", { runId: "nope" });
    assertEquals(missing.isError, true);
    assertEquals(JSON.parse(missing.text).error, "no_run");

    const signal = await call(server, "signal_run", { runId: "nope" });
    assertEquals(signal.isError, true);
    // The run is loaded before resuming, so a missing one is a structured no_run.
    assertEquals(JSON.parse(signal.text).error, "no_run");
  });
});

Deno.test("mutating tool calls are audited with a redacted, attributed trail", async () => {
  await withServer(
    {
      allowRun: true,
      actor: "tester",
      protectPatterns: ["promote"],
      operatorToken: "swordfish",
    },
    async (server, store) => {
      // A successful run, with a secret arg that must be masked.
      await call(server, "run:deploy", {
        environment: "dev",
        secret: "hunter2",
      });
      // A denied protected call.
      await call(server, "run:promote", { operatorToken: "wrong" });

      const events = await auditEvents(store);
      const deploy = events.find((e) => e.tool === "run:deploy");
      const promote = events.find((e) => e.tool === "run:promote");
      assertEquals(deploy?.outcome, "ok");
      assertEquals(deploy?.actor, "tester");
      assertEquals(deploy?.args.secret, "[redacted]"); // secret masked
      assertEquals(deploy?.args.environment, "dev");
      assertEquals(promote?.outcome, "denied");
      // The operator token is never recorded.
      assertEquals("operatorToken" in (promote?.args ?? {}), false);
    },
  );
});

/** Persist a suspended run with the given root target, and return its id. */
async function seedSuspended(
  store: FileSystemStateStore,
  rootTarget: string,
): Promise<string> {
  const now = new Date().toISOString();
  const record: RunRecord = {
    id: `run-${rootTarget}`,
    build: "Demo",
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

Deno.test("resume tools respect the allow-list (no bypass of an excluded target)", async () => {
  await withServer(
    { allowRun: true, allowRunPatterns: ["safe*"] },
    async (server, store) => {
      const id = await seedSuspended(store, "deploy"); // deploy is NOT allow-listed

      // signal_run on the excluded target is denied.
      const signal = await call(server, "signal_run", {
        runId: id,
        signal: "go",
      });
      assertEquals(signal.isError, true);
      assertEquals(JSON.parse(signal.text).reason, "not_allowed");

      // A resume_check sweep skips it (checks nothing it may not touch).
      const sweep = await call(server, "resume_check");
      assertEquals(JSON.parse(sweep.text).checked, 0);
    },
  );
});

Deno.test("resume tools require the operator token for a protected target", async () => {
  await withServer(
    {
      allowRun: true,
      protectPatterns: ["deploy"],
      operatorToken: "swordfish",
    },
    async (server, store) => {
      const id = await seedSuspended(store, "deploy");

      // Missing token → denied.
      const missing = await call(server, "signal_run", {
        runId: id,
        signal: "go",
      });
      assertEquals(missing.isError, true);
      assertEquals(JSON.parse(missing.text).reason, "missing_operator_token");

      // Wrong token → denied.
      const wrong = await call(server, "signal_run", {
        runId: id,
        signal: "go",
        operatorToken: "nope",
      });
      assertEquals(JSON.parse(wrong.text).reason, "invalid_operator_token");

      // resume_check enforces the same gate for a single protected run.
      const checkNoToken = await call(server, "resume_check", { runId: id });
      assertEquals(checkNoToken.isError, true);
      assertEquals(
        JSON.parse(checkNoToken.text).reason,
        "missing_operator_token",
      );

      // The sweep (no runId) silently skips runs the caller can't authorise.
      const sweep = await call(server, "resume_check");
      assertEquals(JSON.parse(sweep.text).checked, 0);
      // (A correct token proceeds to resumeRun; that outcome is covered by the
      // resume tests — the point here is that the token gate is enforced.)
    },
  );
});

Deno.test("a secret echoed into a non-secret argument is masked in the audit", async () => {
  await withServer({ allowRun: true }, async (server, store) => {
    await call(server, "run:deploy", {
      environment: "dev",
      secret: "hunter2",
      note: "deploying with hunter2 now",
    });
    const events = await auditEvents(store);
    const deploy = events.find((e) => e.tool === "run:deploy");
    assertEquals(deploy?.args.secret, "[redacted]");
    // The secret value must not survive inside the non-secret note.
    assertEquals(deploy?.args.note?.includes("hunter2"), false);
  });
});

Deno.test("a truthy-but-not-true confirm still returns the plan, not an execution", async () => {
  await withServer(
    { allowRun: true, confirmDestructive: true },
    async (server) => {
      // A JSON string "true" is truthy but not boolean true → still gated.
      const planned = await call(server, "run:deploy", { confirm: "true" });
      assertStringIncludes(planned.text, "confirmation_required");
      const numeric = await call(server, "run:deploy", { confirm: 1 });
      assertStringIncludes(numeric.text, "confirmation_required");
    },
  );
});

Deno.test("a thrown framework error returns a structured result, not a crash", async () => {
  // A build whose onStart throws makes execute() throw out of #run.
  class Boom extends Build {
    override onStart(): void {
      throw new Error("startup exploded");
    }
    go = target().executes(() => {});
  }
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    const server = new McpServer(new Boom(), {
      allowRun: true,
      stateStore: store,
    });
    const res = await call(server, "run:go");
    assertEquals(res.isError, true);
    assertStringIncludes(res.text, "errored during execution");
    // The raw message is not echoed (it bypassed redaction).
    assertEquals(res.text.includes("startup exploded"), false);
    // The failure is audited.
    const events = await auditEvents(store);
    assertEquals(events.find((e) => e.tool === "run:go")?.outcome, "error");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
