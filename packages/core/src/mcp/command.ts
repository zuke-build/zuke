/**
 * The `zuke mcp` reserved command: run an MCP server over the build on stdio.
 *
 * @module
 */

import type { Build } from "../build.ts";
import { type ByteWriter, serveStdio } from "./jsonrpc.ts";
import { McpServer, type McpServerOptions } from "./server.ts";

/** Options for {@link serveMcp}. */
export interface ServeMcpOptions extends McpServerOptions {
  /** The message stream to read (defaults to stdin); injectable for tests. */
  input?: ReadableStream<Uint8Array>;
  /** The sink to write responses to (defaults to stdout); injectable for tests. */
  output?: ByteWriter;
  /** Suppress the stderr startup banner (used by tests). */
  quiet?: boolean;
}

/**
 * Serve the build over MCP on stdin/stdout until the input stream closes.
 * Returns the process exit code (`0`). Diagnostics — the one-line startup
 * banner — go to stderr so they never corrupt the JSON-RPC stream on stdout.
 */
export async function serveMcp(
  build: Build,
  options: ServeMcpOptions = {},
): Promise<number> {
  const server = new McpServer(build, options);
  if (!options.quiet) {
    const mode = options.allowRun ? "run enabled" : "read-only";
    console.error(
      `zuke mcp: serving on stdio (${mode}). Press Ctrl-C to stop.`,
    );
  }
  await serveStdio(
    (message) => server.handleMessage(message),
    options.input,
    options.output,
  );
  return 0;
}
