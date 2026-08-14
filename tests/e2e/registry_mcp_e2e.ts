// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the M11 acceptance across real processes. A `zuke mcp --registry`
 * server starts over an empty build registry; a separate process registers a new
 * build; **without restarting the server**, that build's target appears as an
 * MCP tool and is runnable — the server spawns the registered build and returns
 * its captured output. Proves live registry discovery and spawn-based execution
 * between genuinely separate processes.
 *
 * Excluded from the fast unit gate (`*_e2e.ts`); run by the `integration` target
 * / integration.yml on the OS matrix.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  freePort,
  killMcpWithin,
  rpc as rpcTo,
  runFixture,
  waitReady,
} from "./_harness.ts";

const FIXTURE = new URL("./fixtures/discoverable_build.ts", import.meta.url);
const PORT = freePort();
const BASE = `http://127.0.0.1:${PORT}/`;

/** Post a JSON-RPC message to the running MCP server on this file's port. */
const rpc = (method: string, params?: unknown): Promise<unknown> =>
  rpcTo(BASE, method, params);

/** The tool names from a `tools/list` reply. */
function toolNames(reply: unknown): string[] {
  const result = (reply as { result?: { tools?: Array<{ name: string }> } })
    .result;
  return (result?.tools ?? []).map((t) => t.name);
}

/** Whether a value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The input schema of a named tool from a `tools/list` reply. */
function runToolInputSchema(
  reply: unknown,
  name: string,
): Record<string, unknown> {
  const result = isRecord(reply) ? reply.result : undefined;
  const tools = isRecord(result) && Array.isArray(result.tools)
    ? result.tools
    : [];
  for (const t of tools) {
    if (isRecord(t) && t.name === name && isRecord(t.inputSchema)) {
      return t.inputSchema;
    }
  }
  throw new Error(`no tool ${name}`);
}

/** The text block of a `tools/call` reply. */
function toolText(reply: unknown): string {
  const result =
    (reply as { result?: { content?: Array<{ text: string }> } }).result;
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("no tool text");
  return text;
}

Deno.test("a build registered after startup appears as a runnable MCP tool", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-reg-mcp-e2e-" });
  let server: Deno.ChildProcess | undefined;
  try {
    // A registry-backed MCP server over an initially-empty registry.
    server = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        FIXTURE.href,
        "mcp",
        "--registry",
        "--http",
        `127.0.0.1:${PORT}`,
        "--allow-run",
      ],
      env: { ZUKE_REGISTRY_DIR: dir },
      stdout: "null",
      stderr: "null",
    }).spawn();
    await waitReady(BASE, Date.now() + 10_000);

    // No pipelines registered yet: only the read tools are exposed.
    const before = toolNames(await rpc("tools/list"));
    assertEquals(before.includes("run:Widget:hello"), false);

    // A separate process registers the build.
    const registered = await runFixture(FIXTURE, ["register"], {
      ZUKE_REGISTRY_DIR: dir,
    });
    assertEquals(registered.code, 0);

    // Without restarting the server, the new target is now a tool…
    const after = toolNames(await rpc("tools/list"));
    assertEquals(after.includes("run:Widget:hello"), true);

    // …and running it spawns the registered build and returns its output.
    const ran = toolText(
      await rpc("tools/call", { name: "run:Widget:hello", arguments: {} }),
    );
    assertStringIncludes(ran, "HELLO-FROM-REGISTERED");
    assertStringIncludes(ran, "succeeded");

    // The parameterized target advertises its inputs…
    const schema = runToolInputSchema(
      await rpc("tools/list"),
      "run:Widget:deploy",
    );
    const props = isRecord(schema.properties) ? schema.properties : {};
    assertEquals(isRecord(props.repos), true);
    assertEquals(isRecord(props.skipE2e), true);

    // …and a call binds the supplied values into the spawned build, proving the
    // values crossed the process boundary as resolved parameters.
    const deployed = toolText(
      await rpc("tools/call", {
        name: "run:Widget:deploy",
        arguments: { repos: ["expense-service", "web"], skipE2e: true },
      }),
    );
    assertStringIncludes(
      deployed,
      "DEPLOY repos=expense-service,web skipE2e=true sit=auto",
    );

    // A type mismatch is rejected without ever spawning the build.
    const bad = await rpc("tools/call", {
      name: "run:Widget:deploy",
      arguments: { repos: "expense-service" },
    });
    const badText = toolText(bad);
    assertStringIncludes(badText, "repos");
    assertEquals(badText.includes("DEPLOY"), false);
  } finally {
    if (server !== undefined) {
      server.kill();
      await killMcpWithin(server, 10_000);
    }
    // Best-effort: a cleanup failure must not mask the real assertion error.
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
