// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Shared harness for the subprocess e2e suite, the sibling of
 * `tests/integration/_harness.ts`. Everything here is about the one thing an
 * in-process test cannot do: run a fixture build as a *real* `deno` process and
 * talk to it across the process boundary.
 *
 * The leading underscore keeps the file out of both test-discovery lanes — the
 * fast gate skips it because it is not `*_test.ts`, and the `integration`
 * target's `tests/e2e/*_e2e.ts` glob skips it too.
 *
 * @module
 */

/** The captured result of one fixture subprocess. */
export interface FixtureRun {
  /** The process exit code. */
  code: number;
  /** Everything the fixture wrote to stdout, decoded. */
  out: string;
  /**
   * Everything the fixture wrote to stderr, decoded. Worth keeping even when a
   * test only asserts on stdout: a fixture exiting non-zero explains itself on
   * stderr, and a race that only shows up on a slower runner cannot be
   * diagnosed at all if the reason was thrown away.
   */
  err: string;
}

/**
 * The `Deno.Command` every fixture subprocess is built from. The fixture is
 * passed as a `file://` URL — deno's native module specifier — rather than
 * `URL.pathname`, which is `/C:/…` on Windows. `env` is the child's extra
 * environment: the throwaway `ZUKE_STATE_DIR`/`ZUKE_REGISTRY_DIR` the run must
 * write into, plus whatever the fixture itself reads.
 */
function fixtureCommand(
  fixture: URL,
  args: string[],
  env: Record<string, string>,
): Deno.Command {
  return new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", fixture.href, ...args],
    env,
    stdout: "piped",
    stderr: "piped",
  });
}

/** Run `fixture` to completion as a real `deno` subprocess, capturing both streams. */
export async function runFixture(
  fixture: URL,
  args: string[],
  env: Record<string, string>,
): Promise<FixtureRun> {
  const { code, stdout, stderr } = await fixtureCommand(fixture, args, env)
    .output();
  const decoder = new TextDecoder();
  return {
    code,
    out: decoder.decode(stdout),
    err: decoder.decode(stderr),
  };
}

/**
 * Spawn `fixture` as a real `deno` subprocess and hand back the live child, for
 * the tests that must interact with a run while it is still in flight.
 */
export function spawnFixture(
  fixture: URL,
  args: string[],
  env: Record<string, string>,
): Deno.ChildProcess {
  return fixtureCommand(fixture, args, env).spawn();
}

/**
 * Grab an OS-assigned free TCP port for a server subprocess to bind: bind
 * ephemeral, read the port, release it. This removes the port collision-flake
 * class a fixed constant has. caveat: a tiny bind→close→rebind race window
 * remains; the race-free fix is to bind `:0` in the server and report the
 * assigned port, which needs a core CLI change.
 */
export function freePort(): number {
  const listener = Deno.listen({ port: 0 });
  const addr = listener.addr;
  listener.close();
  if (addr.transport !== "tcp") throw new Error("expected a TCP listener");
  return addr.port;
}

/** Post a JSON-RPC message to the MCP server at `base` and return the parsed reply. */
export async function rpc(
  base: string,
  method: string,
  params?: unknown,
): Promise<unknown> {
  const res = await fetch(base, {
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

/** Poll the MCP server at `base` until it answers `ping`, or throw past `deadline`. */
export async function waitReady(
  base: string,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base, {
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

/**
 * Await a signalled MCP server process exiting within `ms`, throwing a clear
 * error otherwise — a server that outlives its SIGTERM is swallowing the signal.
 */
export async function killMcpWithin(
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

/** The marker file's lines, or an empty list if it does not exist yet. */
export async function markerLines(marker: string): Promise<string[]> {
  try {
    const text = await Deno.readTextFile(marker);
    return text.split("\n").filter((line) => line !== "");
  } catch {
    return [];
  }
}
