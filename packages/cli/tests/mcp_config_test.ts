// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  MCP_CONFIG_FILE,
  MCP_SERVER_NAME,
  mcpServerEntry,
  mergeMcpConfig,
  parseMcpConfig,
} from "../src/mcp_config.ts";

/** The document `parseMcpConfig` yields for `text`, or `{}` when it has none. */
function documentOf(text: string): Record<string, unknown> {
  const config = parseMcpConfig(text);
  return config.state === "unparseable" ? {} : config.document;
}

Deno.test("mcpServerEntry launches the build's server, read-only by default", () => {
  assertEquals(mcpServerEntry(false), {
    command: "deno",
    args: ["run", "-A", "zuke.ts", "mcp"],
  });
  assertEquals(mcpServerEntry(true).args.at(-1), "--allow-run");
});

Deno.test("mergeMcpConfig writes a fresh file with just the zuke server", () => {
  const text = mergeMcpConfig({}, false);
  assertEquals(text.endsWith("\n"), true);
  assertEquals(JSON.parse(text), {
    mcpServers: {
      zuke: { command: "deno", args: ["run", "-A", "zuke.ts", "mcp"] },
    },
  });
});

Deno.test("mergeMcpConfig keeps other servers and top-level keys", () => {
  const existing = {
    mcpServers: { github: { command: "gh-mcp", args: [] } },
    other: { kept: true },
  };
  const merged = JSON.parse(mergeMcpConfig(existing, true));
  assertEquals(merged.other, { kept: true });
  assertEquals(merged.mcpServers.github, { command: "gh-mcp", args: [] });
  assertEquals(merged.mcpServers.zuke.args.at(-1), "--allow-run");
  // The caller's document is left alone: the merge builds a new object.
  assertEquals(Object.keys(existing.mcpServers), ["github"]);
});

Deno.test("mergeMcpConfig replaces an existing zuke entry", () => {
  const existing = documentOf(mergeMcpConfig({}, true));
  const merged = JSON.parse(mergeMcpConfig(existing, false));
  assertEquals(merged.mcpServers.zuke.args.includes("--allow-run"), false);
});

Deno.test("mergeMcpConfig replaces a non-object mcpServers", () => {
  const merged = JSON.parse(mergeMcpConfig({ mcpServers: "nope" }, false));
  assertEquals(Object.keys(merged.mcpServers), ["zuke"]);
});

Deno.test("parseMcpConfig classifies .mcp.json text", () => {
  assertEquals(parseMcpConfig(mergeMcpConfig({}, false)).state, "present");
  // A customised but well-formed entry is present: it is kept without --force.
  assertEquals(
    parseMcpConfig(
      '{"mcpServers":{"zuke":{"command":"deno","args":["run","-A","zuke.ts","mcp","--http","7777"]}}}',
    ).state,
    "present",
  );
  // A malformed entry is not a registration; it reads as absent so a re-run
  // repairs it instead of leaving a broken client config in place.
  for (
    const broken of [
      '{"mcpServers":{"zuke":5}}',
      '{"mcpServers":{"zuke":{"command":"deno"}}}',
      '{"mcpServers":{"zuke":{"command":5,"args":[]}}}',
      '{"mcpServers":{"zuke":{"command":"deno","args":["run",7]}}}',
    ]
  ) {
    assertEquals(parseMcpConfig(broken).state, "absent", broken);
  }
  assertEquals(parseMcpConfig('{"mcpServers":{"other":{}}}').state, "absent");
  assertEquals(parseMcpConfig("{}"), { state: "absent", document: {} });
  // A document that is not an object has nothing to preserve.
  assertEquals(parseMcpConfig("[1, 2]"), { state: "absent", document: {} });
  // Not JSON: no document, so nothing downstream can rewrite the file.
  assertEquals(parseMcpConfig("not json"), { state: "unparseable" });
  assertEquals(parseMcpConfig(""), { state: "unparseable" });
});

Deno.test("parseMcpConfig hands the whole document to the merge", () => {
  const document = documentOf('{"mcpServers":{"a":{}},"b":1}');
  assertEquals(document, { mcpServers: { a: {} }, b: 1 });
});

Deno.test("the file and server names are the ones clients look for", () => {
  assertEquals(MCP_CONFIG_FILE, ".mcp.json");
  assertEquals(MCP_SERVER_NAME, "zuke");
});
