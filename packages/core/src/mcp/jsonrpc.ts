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
 * Read newline-delimited JSON-RPC messages from `input`, pass each parsed
 * message to `handle`, and write any non-null response back to `output`
 * (newline-framed). A line that is not valid JSON yields a parse-error response
 * with a null id, per JSON-RPC. Returns when the input stream ends.
 */
export async function serveStdio(
  handle: (message: unknown) => Promise<JsonRpcResponse | null>,
  input: ReadableStream<Uint8Array> = Deno.stdin.readable,
  output: ByteWriter = Deno.stdout,
): Promise<void> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const send = (response: JsonRpcResponse): Promise<number> =>
    output.write(encoder.encode(`${JSON.stringify(response)}\n`));

  let buffer = "";
  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line === "") continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        await send(err(null, PARSE_ERROR, "Parse error"));
        continue;
      }
      const response = await handle(message);
      if (response !== null) await send(response);
    }
  }
}
