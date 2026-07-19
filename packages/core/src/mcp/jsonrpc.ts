/**
 * A minimal, dependency-free JSON-RPC 2.0 layer for the MCP server.
 *
 * MCP's stdio transport is newline-delimited JSON-RPC 2.0: each message is a
 * single JSON object on its own line, read from stdin and written to stdout
 * (diagnostics go to stderr so they never corrupt the protocol stream). This
 * module provides the wire types, the standard error codes, and a {@link
 * serveStdio} read loop; the method dispatch lives in {@link McpServer}.
 *
 * @module
 */

/** A JSON-RPC 2.0 request or notification (a notification omits `id`). */
export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  /** Present for a request (correlates the response); absent for a notification. */
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

/** A JSON-RPC 2.0 error object. */
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** A JSON-RPC 2.0 response — exactly one of `result` or `error` is set. */
export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

/** Standard JSON-RPC 2.0 error codes. */
export const PARSE_ERROR = -32700;
/** The JSON sent is not a valid Request object. */
export const INVALID_REQUEST = -32600;
/** The method does not exist or is not available. */
export const METHOD_NOT_FOUND = -32601;
/** Invalid method parameters. */
export const INVALID_PARAMS = -32602;
/** Internal JSON-RPC error. */
export const INTERNAL_ERROR = -32603;

/** Build a success response for request `id`. */
export function ok(
  id: string | number | null,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/** Build an error response for request `id`. */
export function err(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** A sink the transport writes framed responses to (stdout in production). */
export interface ByteWriter {
  write(p: Uint8Array): Promise<number>;
}

/**
 * The per-request context a transport hands the message handler. Carries the
 * request's headers, so a server's identity hook can authenticate the caller
 * from a trusted proxy header. Empty on the stdio transport (no headers).
 */
export interface McpRequestContext {
  /** The request headers; an empty {@link Headers} on stdio. */
  readonly headers: Headers;
}

/**
 * A trusted caller identity, resolved per request by a {@link McpIdentityHook}
 * (typically from an authenticating reverse proxy's header). Its
 * {@link McpIdentity.actor} is the highest-precedence attribution — it overrides
 * `--actor`, the environment, and the client's self-reported label for the call.
 */
export interface McpIdentity {
  /** The authenticated actor (e.g. an OAuth subject). */
  actor: string;
  /** How the identity was established (e.g. `"oauth-proxy"`); informational. */
  via?: string;
}

/**
 * Resolve a trusted {@link McpIdentity} from a request's context. Invoked once
 * per message, before any dispatch; **throwing rejects the whole request** with
 * an auth error, so nothing executes and nothing is written to state — the seam
 * a proxy in front of the server uses to inject an authenticated identity.
 */
export type McpIdentityHook = (ctx: McpRequestContext) => McpIdentity;

/**
 * Run an identity `hook` and return its trusted actor, or `null` when the hook
 * throws or yields an unusable actor (empty, or not a string). A caller must
 * reject the request on `null` rather than fall back to a static actor — the
 * hook's precedence is absolute and fail-closed, so a missing identity is a
 * rejection, never an anonymous/spoofable attribution.
 */
export function resolveIdentity(
  hook: McpIdentityHook,
  ctx: McpRequestContext,
): string | null {
  let actor: unknown;
  try {
    // Guard both the call and the property read: a hook returning `undefined`
    // (looser JS typing) must be rejected, not throw out of the dispatch loop.
    actor = hook(ctx).actor;
  } catch {
    return null;
  }
  return typeof actor === "string" && actor !== "" ? actor : null;
}

/** The stdio transport's request context — no headers. */
const STDIO_CONTEXT: McpRequestContext = { headers: new Headers() };

/**
 * Read newline-delimited JSON-RPC messages from `input`, pass each parsed
 * message to `handle`, and write any non-null response back to `output`
 * (newline-framed). A line that is not valid JSON yields a parse-error response
 * with a null id, per JSON-RPC. Returns when the input stream ends.
 */
export async function serveStdio(
  handle: (
    message: unknown,
    ctx: McpRequestContext,
  ) => Promise<JsonRpcResponse | null>,
  input: ReadableStream<Uint8Array> = Deno.stdin.readable,
  output: ByteWriter = Deno.stdout,
): Promise<void> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const send = (response: JsonRpcResponse): Promise<number> =>
    output.write(encoder.encode(`${JSON.stringify(response)}\n`));

  const handleLine = async (raw: string): Promise<void> => {
    const line = raw.trim();
    if (line === "") return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      await send(err(null, PARSE_ERROR, "Parse error"));
      return;
    }
    const response = await handle(message, STDIO_CONTEXT);
    if (response !== null) await send(response);
  };

  let buffer = "";
  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      await handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  // Flush any pending multi-byte character and process a final line that the
  // stream ended without terminating, so no message is silently dropped.
  buffer += decoder.decode();
  await handleLine(buffer);
}
