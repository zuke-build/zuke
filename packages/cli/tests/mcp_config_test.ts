// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  MCP_CONFIG_FILE,
  MCP_SERVER_NAME,
  mcpConfigState,
  mcpServerEntry,
  mergeMcpConfig,
} from "../src/mcp_config.ts";

Deno.test("mcpServerEntry launches the build's server, read-only by default", () => {
  assertEquals(mcpServerEntry(false), {
    command: "deno",
    args: ["run", "-A", "zuke.ts", "mcp"],
  });
  assertEquals(mcpServerEntry(true).args.at(-1), "--allow-run");
});

Deno.test("mergeMcpConfig writes a fresh file with just the zuke server", () => {
  const text = mergeMcpConfig(null, false);
  assertEquals(text.endsWith("\n"), true);
  assertEquals(JSON.parse(text), {
    mcpServers: {
      zuke: { command: "deno", args: ["run", "-A", "zuke.ts", "mcp"] },
    },
  });
});

Deno.test("mergeMcpConfig keeps other servers and top-level keys", () => {
  const existing = JSON.stringify({
    mcpServers: { github: { command: "gh-mcp", args: [] } },
    other: { kept: true },
  });
  const merged = JSON.parse(mergeMcpConfig(existing, true));
  assertEquals(merged.other, { kept: true });
  assertEquals(merged.mcpServers.github, { command: "gh-mcp", args: [] });
  assertEquals(merged.mcpServers.zuke.args.at(-1), "--allow-run");
});

Deno.test("mergeMcpConfig replaces an existing zuke entry", () => {
  const existing = mergeMcpConfig(null, true);
  const merged = JSON.parse(mergeMcpConfig(existing, false));
  assertEquals(merged.mcpServers.zuke.args.includes("--allow-run"), false);
});

Deno.test("mergeMcpConfig ignores a non-object document", () => {
  const merged = JSON.parse(mergeMcpConfig("[1, 2]", false));
  assertEquals(Object.keys(merged), ["mcpServers"]);
});

Deno.test("mcpConfigState classifies .mcp.json text", () => {
  assertEquals(mcpConfigState(mergeMcpConfig(null, false)), "present");
  assertEquals(mcpConfigState('{"mcpServers":{"other":{}}}'), "absent");
  assertEquals(mcpConfigState("{}"), "absent");
  assertEquals(mcpConfigState("[]"), "absent");
  assertEquals(mcpConfigState("not json"), "unparseable");
});

Deno.test("the file and server names are the ones clients look for", () => {
  assertEquals(MCP_CONFIG_FILE, ".mcp.json");
  assertEquals(MCP_SERVER_NAME, "zuke");
});
