// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: MCP authorization over a real build, and the operator's
 * host-side view of the trail it writes.
 *
 * The unit tests pin the gate's decisions; this drives the whole path — a real
 * `Build`, a real state store, a real `McpServer`, and the real CLI `main()` —
 * to prove two things fit together. First, that a protected target reached as a
 * dependency is denied *and the denial is durably recorded*. Second, that
 * closing the audit trail to MCP readers did not close it to the operator: the
 * documented `zuke runs show mcp-audit` still renders it on the host.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { McpServer } from "../../packages/core/src/mcp/server.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** A build whose release path runs a protected deploy. */
class Pipeline extends Build {
  lint = target().description("Lint").executes(() => {});
  deploy = target().description("Deploy").dependsOn(this.lint).executes(
    () => {},
  );
  release = target().description("Release").dependsOn(this.deploy).executes(
    () => {},
  );
}

/** Call an MCP tool on `server`, returning its text result. */
async function call(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
  const res = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const result = res?.result;
  if (typeof result !== "object" || result === null || !("content" in result)) {
    throw new Error("not a tool result");
  }
  const content = (result as { content: Array<{ text: string }> }).content;
  return {
    text: content[0].text,
    isError: (result as { isError?: boolean }).isError ?? false,
  };
}

Deno.test("a protected dependency blocks the run and the denial reaches the trail", async () => {
  await withStateDir(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const server = new McpServer(new Pipeline(), {
      allowRun: true,
      protectPatterns: ["deploy"],
      operatorToken: "swordfish",
      actor: "agent-7",
      stateStore: store,
    });

    // `release` is not protected, but it runs `deploy`, which is.
    const denied = await call(server, "run:release", {});
    assertEquals(denied.isError, true);
    assertEquals(JSON.parse(denied.text).reason, "missing_operator_token");

    // No run record was created — the build never started.
    const runs = await store.listRuns({});
    assertEquals(runs.filter((r) => r.rootTarget === "release").length, 0);

    // With the operator token the same call runs the whole plan.
    const allowed = await call(server, "run:release", {
      operatorToken: "swordfish",
    });
    assertEquals(allowed.isError, false);

    // The operator can still read the trail on the host — the denial and the
    // successful run, both attributed — even though MCP will not serve it.
    const shown = await runCli(Pipeline, ["runs", "show", "mcp-audit"]);
    assertEquals(shown.code, 0);
    assertStringIncludes(shown.out, "Audit:");
    assertStringIncludes(shown.out, "run:release");
    assertStringIncludes(shown.out, "agent-7");
    assertStringIncludes(shown.out, "denied");
  });
});

Deno.test("the trail is unreadable over MCP while the CLI still renders it", async () => {
  await withStateDir(async (dir) => {
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const server = new McpServer(new Pipeline(), {
      allowRun: true,
      actor: "agent-7",
      stateStore: store,
    });
    await call(server, "run:lint", {});

    // Refused over the wire…
    const overMcp = await call(server, "show_run", { runId: "mcp-audit" });
    assertEquals(overMcp.isError, true);
    assertEquals(JSON.parse(overMcp.text).error, "not_readable");

    // …and absent from the run listing the agent can see.
    const listed = await call(server, "list_runs");
    assertEquals(listed.text.includes("mcp-audit"), false);

    // …but intact for the operator on the host.
    const shown = await runCli(Pipeline, ["runs", "show", "mcp-audit"]);
    assertEquals(shown.code, 0);
    assertStringIncludes(shown.out, "run:lint");
  });
});
