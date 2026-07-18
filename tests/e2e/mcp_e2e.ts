/**
 * End-to-end: the M5 two-session acceptance across real processes. Session A
 * (a CLI run) deploys and suspends at an approval gate; a separate `zuke mcp`
 * server process then serves session B, which queries the suspended run over
 * the HTTP transport and signals it to completion — with the mutating call
 * attributed in the audit log. Proves the store-backed MCP tools, the HTTP
 * transport, and the audit trail work between genuinely separate processes.
 *
 * Excluded from the fast unit gate (`*_e2e.ts`); run by the `integration`
 * target / integration.yml on the OS matrix.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  defaultStateHost,
  FileSystemStateStore,
} from "../../packages/core/mod.ts";

const FIXTURE = new URL("./fixtures/gate_build.ts", import.meta.url);
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}/`;

/** Run the gate fixture as a real `deno` subprocess against state dir `dir`. */
async function runFixture(
  args: string[],
  dir: string,
): Promise<{ code: number; out: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", FIXTURE.href, ...args],
    env: { ZUKE_STATE_DIR: dir },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await command.output();
  return { code, out: new TextDecoder().decode(stdout) };
}

/** Post a JSON-RPC message to the running MCP server and return the parsed reply. */
async function rpc(method: string, params?: unknown): Promise<unknown> {
  const res = await fetch(BASE, {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params ? { params } : {}),
    }),
  });
  return await res.json();
}

/** The text block of a `tools/call` reply, parsed as JSON. */
function toolJson(reply: unknown): unknown {
  const result =
    (reply as { result?: { content?: Array<{ text: string }> } }).result;
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error("no tool text");
  return JSON.parse(text);
}

/** Poll the server until it answers `ping`, or throw past `deadline`. */
async function waitReady(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      const ok = res.ok;
      await res.body?.cancel();
      if (ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("MCP server did not become ready in time");
}

Deno.test("two MCP sessions: query a suspended run over HTTP and signal it, audited", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-mcp-e2e-" });
  let server: Deno.ChildProcess | undefined;
  try {
    // Session A: run to the gate and suspend (a separate process).
    const suspend = await runFixture(["promote"], dir);
    assertEquals(suspend.code, 0);
    assertStringIncludes(suspend.out, "DEPLOYED");

    // A separate MCP server process over the same state dir, execution enabled.
    server = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        FIXTURE.href,
        "mcp",
        "--http",
        `127.0.0.1:${PORT}`,
        "--allow-run",
        "--actor",
        "session-b",
      ],
      env: { ZUKE_STATE_DIR: dir },
      stdout: "null",
      stderr: "null",
    }).spawn();
    await waitReady(Date.now() + 10_000);

    // Session B: find the suspended run and signal it to completion.
    const runs = toolJson(
      await rpc("tools/call", {
        name: "list_runs",
        arguments: { status: "suspended" },
      }),
    );
    if (!Array.isArray(runs) || runs.length !== 1) {
      throw new Error(
        `expected one suspended run, got ${JSON.stringify(runs)}`,
      );
    }
    const id = (runs[0] as { id: string }).id;

    const signalled = toolJson(
      await rpc("tools/call", {
        name: "signal_run",
        arguments: { runId: id, signal: "approved" },
      }),
    );
    assertEquals((signalled as { ok: boolean }).ok, true);

    // The run promoted, and the signal is attributed to session-b in the audit.
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const promoted = await store.getRun(id);
    assertEquals(promoted?.record.status, "succeeded");
    assertEquals(promoted?.record.targets["promote"].status, "succeeded");

    const audit = await store.getRun("mcp-audit");
    const event = audit?.record.events.find((e) => e.tool === "signal_run");
    assertEquals(event?.actor, "session-b");
    assertEquals(event?.outcome, "ok");
  } finally {
    if (server !== undefined) {
      // SIGTERM (kill's default) must terminate the server promptly. `zuke mcp`
      // is a long-lived command, so the CLI must not intercept the signal for
      // graceful build-cancellation and swallow it — fail fast if it does,
      // rather than hang the whole job.
      server.kill();
      await killWithin(server, 10_000);
    }
    await Deno.remove(dir, { recursive: true });
  }
});

/** Await a killed process exiting within `ms`, throwing a clear error otherwise. */
async function killWithin(
  server: Deno.ChildProcess,
  ms: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `mcp server did not exit ${ms}ms after SIGTERM — the CLI is ` +
              `swallowing the signal instead of terminating.`,
          ),
        ),
      ms,
    );
  });
  try {
    await Promise.race([server.status, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
