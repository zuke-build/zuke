// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The MCP client configuration `zuke setup --mcp` writes: a project-scoped
 * `.mcp.json` registering the build's own MCP server, so an agent can list
 * the targets, read the graph and run one through typed calls from the first
 * commit — instead of someone hand-writing the registration later.
 *
 * The file is Claude Code's project format (`mcpServers.<name>`), which Codex
 * and most stdio MCP clients read too. The command is `deno run -A zuke.ts
 * mcp` rather than the launcher because it is the same on every platform.
 *
 * @module
 */

import { isRecord } from "./records.ts";

/** The MCP client configuration file `--mcp` writes, next to `zuke.ts`. */
export const MCP_CONFIG_FILE = ".mcp.json";

/** The server name registered in the file. */
export const MCP_SERVER_NAME = "zuke";

/** One server entry in `mcpServers`: the command and its arguments. */
export interface McpServerEntry {
  /** The executable — always `deno`, which is the same on every platform. */
  command: string;
  /** The arguments: `run -A zuke.ts mcp`, plus `--allow-run` when asked for. */
  args: string[];
}

/**
 * The entry that launches this build's MCP server. Read-only by default: the
 * agent can inspect the build but not execute targets until `allowRun` opts
 * in, mirroring `zuke mcp --allow-run`.
 */
export function mcpServerEntry(allowRun: boolean): McpServerEntry {
  return {
    command: "deno",
    args: ["run", "-A", "zuke.ts", "mcp", ...(allowRun ? ["--allow-run"] : [])],
  };
}

/** Whether an `.mcp.json` text already registers the `zuke` server. */
export type McpConfigState = "present" | "absent" | "unparseable";

/** Classify an `.mcp.json` text by whether it already has the `zuke` entry. */
export function mcpConfigState(text: string): McpConfigState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unparseable";
  }
  if (
    isRecord(parsed) && isRecord(parsed.mcpServers) &&
    MCP_SERVER_NAME in parsed.mcpServers
  ) {
    return "present";
  }
  return "absent";
}

/**
 * Merge the `zuke` server into an `.mcp.json` document, preserving every
 * other server and top-level key. `existing` is the file text, or `null` to
 * start fresh; an existing `zuke` entry is replaced.
 */
export function mergeMcpConfig(
  existing: string | null,
  allowRun: boolean,
): string {
  const root: Record<string, unknown> = {};
  if (existing !== null) {
    const parsed: unknown = JSON.parse(existing);
    if (isRecord(parsed)) Object.assign(root, parsed);
  }
  const servers: Record<string, unknown> = isRecord(root.mcpServers)
    ? { ...root.mcpServers }
    : {};
  servers[MCP_SERVER_NAME] = mcpServerEntry(allowRun);
  root.mcpServers = servers;
  return `${JSON.stringify(root, null, 2)}\n`;
}
