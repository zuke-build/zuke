// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke setup --mcp` end to end: scaffold a project with the real host, then
 * launch exactly the command the written `.mcp.json` registers and ask the
 * server for its tools over stdio — proving the file an agent client reads
 * points at a server that answers.
 *
 * The temp project lives inside the repository so the scaffolded
 * `jsr:@zuke/core@^1` import resolves to this workspace, as the examples do.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { main } from "../../packages/cli/mod.ts";
import { FakePrompter } from "../../packages/cli/tests/_fakes.ts";

/** A JSON-RPC request line for the stdio transport. */
function request(id: number, method: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`;
}

/** The `name` of every tool in a `tools/list` result, navigated without casts. */
function toolNames(reply: unknown): string[] {
  if (typeof reply !== "object" || reply === null) return [];
  const result = Reflect.get(reply, "result");
  if (typeof result !== "object" || result === null) return [];
  const tools = Reflect.get(result, "tools");
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((t) => {
    const name = typeof t === "object" && t !== null
      ? Reflect.get(t, "name")
      : undefined;
    return typeof name === "string" ? [name] : [];
  });
}

Deno.test("setup --mcp registers a server that lists the scaffolded targets", async () => {
  const dir = await Deno.makeTempDir({
    dir: Deno.cwd(),
    prefix: ".setup-mcp-",
  });
  try {
    const code = await main(
      ["setup", "--yes", "--dir", dir, "--mcp", "--name", "Scaffolded"],
      undefined,
      new FakePrompter(false),
    );
    assertEquals(code, 0);

    const config = JSON.parse(await Deno.readTextFile(`${dir}/.mcp.json`));
    const server = config.mcpServers.zuke;
    assertEquals(server.command, "deno");
    assertEquals(server.args, ["run", "-A", "zuke.ts", "mcp"]);

    // Launch what the file says, from the project directory, and talk MCP.
    const child = new Deno.Command(Deno.execPath(), {
      args: server.args.slice(1),
      cwd: dir,
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(
        request(1, "initialize") + request(2, "tools/list"),
      ),
    );
    await writer.close();
    const out = new TextDecoder().decode((await child.output()).stdout);
    const replies = out.split("\n").filter((l) => l.trim() !== "").map((l) =>
      JSON.parse(l)
    );
    const list = replies.find((r) => r.id === 2);
    const names = toolNames(list);
    assertEquals(names.includes("list_targets"), true, out);
    // Read-only registration: no run tool for the scaffolded target.
    assertEquals(names.some((n) => n.startsWith("run:")), false, out);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
