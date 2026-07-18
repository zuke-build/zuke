/**
 * The `zuke mcp` reserved command: run an MCP server over the build, on stdio
 * (the default) or over HTTP (`--http <host:port>`).
 *
 * @module
 */

import type { Build } from "../build.ts";
import { type ByteWriter, serveStdio } from "./jsonrpc.ts";
import { serveHttp } from "./http.ts";
import { McpServer, type McpServerOptions } from "./server.ts";

/** A parsed `--http` bind address. */
export interface HttpAddress {
  /** The hostname/address to bind. */
  host: string;
  /** The TCP port to bind. */
  port: number;
}

/** Options for {@link serveMcp}. */
export interface ServeMcpOptions extends McpServerOptions {
  /** The message stream to read (defaults to stdin); injectable for tests. */
  input?: ReadableStream<Uint8Array>;
  /** The sink to write responses to (defaults to stdout); injectable for tests. */
  output?: ByteWriter;
  /** Suppress the stderr startup banner (used by tests). */
  quiet?: boolean;
  /** Serve over HTTP on this address instead of stdio. */
  http?: HttpAddress;
  /** Bearer token for the HTTP transport (defaults to `ZUKE_MCP_TOKEN`). */
  token?: string;
  /** Reads an environment variable (injectable for tests). */
  readEnv?: (name: string) => string | undefined;
  /** Abort to stop the HTTP server (test hook; the CLI runs until killed). */
  signal?: AbortSignal;
  /** Called once the HTTP listener is bound, with its address (test hook). */
  onListen?: (address: { hostname: string; port: number }) => void;
}

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Whether `host` is a loopback address (no bearer token required to bind it). */
function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Serve the build over MCP. Without {@link ServeMcpOptions.http} it runs on
 * stdin/stdout until the input stream closes; with it, over HTTP until the
 * server is stopped. Returns the process exit code. Diagnostics go to stderr so
 * they never corrupt a JSON-RPC stream.
 */
export async function serveMcp(
  build: Build,
  options: ServeMcpOptions = {},
): Promise<number> {
  const server = new McpServer(build, options);
  if (options.http !== undefined) {
    return await serveMcpHttp(server, options.http, options);
  }
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

/**
 * Serve over the HTTP transport. Enforces the security default: a non-loopback
 * bind **must** have a bearer token (from {@link ServeMcpOptions.token} or
 * `ZUKE_MCP_TOKEN`), else the server refuses to start rather than exposing an
 * unauthenticated endpoint. A loopback bind may run without one.
 */
async function serveMcpHttp(
  server: McpServer,
  address: HttpAddress,
  options: ServeMcpOptions,
): Promise<number> {
  const readEnv = options.readEnv ?? defaultReadEnv;
  const token = options.token ?? readEnv("ZUKE_MCP_TOKEN");
  const hasToken = token !== undefined && token !== "";
  if (!isLoopback(address.host) && !hasToken) {
    console.error(
      `zuke mcp: refusing to bind ${address.host}:${address.port} without a ` +
        `bearer token. A non-loopback MCP endpoint must be authenticated — set ` +
        `ZUKE_MCP_TOKEN, or bind 127.0.0.1 for local-only access.`,
    );
    return 1;
  }
  if (!options.quiet) {
    const mode = options.allowRun ? "run enabled" : "read-only";
    const auth = hasToken ? "bearer token required" : "no auth (loopback only)";
    console.error(
      `zuke mcp: serving on http://${address.host}:${address.port} ` +
        `(${mode}, ${auth}). Press Ctrl-C to stop.`,
    );
  }
  await serveHttp((message) => server.handleMessage(message), {
    host: address.host,
    port: address.port,
    token: hasToken ? token : undefined,
    signal: options.signal,
    onListen: options.onListen,
  });
  return 0;
}
