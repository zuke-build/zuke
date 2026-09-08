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

/**
 * A parsed `.mcp.json`, ready to merge. `present` means a well-formed
 * {@link McpServerEntry} is registered as `zuke` (whatever its arguments — a
 * deliberate `--allow-run` or transport choice survives a re-run without
 * `--force`); `absent` covers a missing key and a malformed one alike, so a
 * broken registration is repaired rather than kept. `document` is the file's
 * top-level object — empty when the text was not one — for the merge to
 * extend. An `unparseable` text carries no document: it is never rewritten,
 * because there is no telling what it held.
 */
export type McpConfig =
  | {
    /** The `zuke` entry is registered, or not. */
    state: "present" | "absent";
    /** The top-level object every other key and server is preserved from. */
    document: Record<string, unknown>;
  }
  | {
    /** The text is not JSON. */
    state: "unparseable";
  };

/** Whether `value` is a well-formed server entry: a command and its arguments. */
function isServerEntry(value: unknown): value is McpServerEntry {
  return isRecord(value) && typeof value.command === "string" &&
    Array.isArray(value.args) &&
    value.args.every((arg) => typeof arg === "string");
}

/**
 * Parse an `.mcp.json` text and classify its `zuke` entry. This is the only
 * place the text is parsed: {@link mergeMcpConfig} takes the document it
 * yields, so an unparseable file is rejected here, once, and can never reach
 * the merge.
 */
export function parseMcpConfig(text: string): McpConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "unparseable" };
  }
  const document = isRecord(parsed) ? parsed : {};
  const state = isRecord(document.mcpServers) &&
      isServerEntry(document.mcpServers[MCP_SERVER_NAME])
    ? "present"
    : "absent";
  return { state, document };
}

/**
 * Merge the `zuke` server into a parsed `.mcp.json` document, preserving
 * every other server and top-level key. `document` is the object
 * {@link parseMcpConfig} yielded, or `{}` to start fresh; an existing `zuke`
 * entry is replaced. Pure: it parses nothing and cannot throw.
 */
export function mergeMcpConfig(
  document: Record<string, unknown>,
  allowRun: boolean,
): string {
  const servers: Record<string, unknown> = isRecord(document.mcpServers)
    ? { ...document.mcpServers }
    : {};
  servers[MCP_SERVER_NAME] = mcpServerEntry(allowRun);
  return `${JSON.stringify({ ...document, mcpServers: servers }, null, 2)}\n`;
}
