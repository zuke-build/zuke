/**
 * The `zuke mcp` reserved command: run an MCP server over the build, on stdio
 * (the default) or over HTTP (`--http <host:port>`).
 *
 * @module
 */

import type { Build } from "../build.ts";
import { absolutePath } from "../path.ts";
import { findConfigDir, pathExists } from "../config.ts";
import { defaultStateHost, type StateStore } from "../state/store.ts";
import { resolveStateStore } from "../state/resolve.ts";
import type { BuildRegistry } from "../registry/registry.ts";
import { resolveBuildRegistry } from "../registry/resolve.ts";
import {
  type ByteWriter,
  type JsonRpcResponse,
  type McpRequestContext,
  serveStdio,
} from "./jsonrpc.ts";
import { serveHttp } from "./http.ts";
import { McpServer, type McpServerOptions } from "./server.ts";
import { RegistryMcpServer, type RegistryRunner } from "./registry_server.ts";

/** A thing that answers MCP messages — either server flavour drives a transport. */
interface McpHandler {
  /**
   * Handle one parsed JSON-RPC message with its per-request context (headers on
   * HTTP; empty on stdio), or return `null` for a notification.
   */
  handleMessage(
    message: unknown,
    ctx?: McpRequestContext,
  ): Promise<JsonRpcResponse | null>;
}

/** A parsed `--http` bind address. */
export interface HttpAddress {
  /** The hostname/address to bind. */
  host: string;
  /** The TCP port to bind. */
  port: number;
}

/** Options for {@link serveMcp}. */
export interface ServeMcpOptions extends McpServerOptions {
  /**
   * Serve the whole {@link "../registry/registry.ts".BuildRegistry} (dynamic
   * pipeline discovery) instead of the single launched build. When set, the
   * server exposes each registered pipeline's targets, re-read live. Tests inject
   * a registry here; the CLI sets {@link useRegistry} and the registry is
   * resolved from the environment / build override / default `.zuke/builds`.
   */
  registry?: BuildRegistry;
  /** Resolve a {@link BuildRegistry} and serve it (the `--registry` CLI flag). */
  useRegistry?: boolean;
  /** Spawns a registered build in registry mode; injectable for tests. */
  runner?: RegistryRunner;
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

/** Resolve the build registry for `zuke mcp --registry` — defaulting on `.zuke/builds`. */
function resolveMcpRegistry(
  build: Build,
  readEnv: (name: string) => string | undefined,
): BuildRegistry | undefined {
  return resolveBuildRegistry(undefined, build.registry(), {
    readEnv,
    host: defaultStateHost,
    defaultDir: absolutePath(
      findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
    )(".zuke", "builds").path,
    enableDefault: true,
  });
}

/** Resolve the store for MCP — like a run, always defaulting on so run tools work. */
function resolveMcpStore(
  build: Build,
  option: StateStore | undefined,
  readEnv: (name: string) => string | undefined,
): StateStore | undefined {
  return resolveStateStore(option, build.stateStore(), {
    readEnv,
    host: defaultStateHost,
    defaultDir: absolutePath(
      findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
    )(".zuke", "runs").path,
    enableDefault: true,
  });
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
  const readEnv = options.readEnv ?? defaultReadEnv;
  // Resolve the durable store (audit + run tools) and the operator token once,
  // then hand them to the server alongside the caller's options.
  const store = resolveMcpStore(build, options.stateStore, readEnv);
  const operatorToken = options.operatorToken ?? readEnv("ZUKE_OPERATOR_TOKEN");
  // The trusted identity hook: an explicit option wins, else the build declares
  // one via `override mcpIdentity()` (the CLI-reachable seam).
  const identity = options.identity ?? build.mcpIdentity();
  // An injected registry (tests) wins; otherwise `--registry` resolves one.
  const registry = options.registry ??
    (options.useRegistry ? resolveMcpRegistry(build, readEnv) : undefined);
  // In registry mode the server serves the catalog (spawning registered builds);
  // otherwise it serves the single launched build in-process.
  const server: McpHandler = registry !== undefined
    ? new RegistryMcpServer(registry, {
      allowRun: options.allowRun,
      allowRunPatterns: options.allowRunPatterns,
      protectPatterns: options.protectPatterns,
      confirmDestructive: options.confirmDestructive,
      operatorToken,
      stateStore: store,
      actor: options.actor,
      identity,
      readEnv,
      version: options.version,
      runner: options.runner,
    })
    : new McpServer(build, {
      ...options,
      readEnv,
      stateStore: store,
      operatorToken,
      identity,
    });
  if (options.http !== undefined) {
    return await serveMcpHttp(server, options.http, options);
  }
  if (!options.quiet) {
    const mode = options.allowRun ? "run enabled" : "read-only";
    const source = registry !== undefined ? "registry, " : "";
    console.error(
      `zuke mcp: serving on stdio (${source}${mode}). Press Ctrl-C to stop.`,
    );
  }
  await serveStdio(
    (message, ctx) => server.handleMessage(message, ctx),
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
  server: McpHandler,
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
    const source =
      options.registry !== undefined || options.useRegistry === true
        ? "registry, "
        : "";
    const auth = hasToken ? "bearer token required" : "no auth (loopback only)";
    console.error(
      `zuke mcp: serving on http://${address.host}:${address.port} ` +
        `(${source}${mode}, ${auth}). Press Ctrl-C to stop.`,
    );
  }
  await serveHttp((message, ctx) => server.handleMessage(message, ctx), {
    host: address.host,
    port: address.port,
    token: hasToken ? token : undefined,
    signal: options.signal,
    onListen: options.onListen,
  });
  return 0;
}
