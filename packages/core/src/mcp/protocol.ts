// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The MCP protocol envelope, shared by both server flavours.
 *
 * {@link "./server.ts".McpServer} (one live build, executed in-process) and
 * {@link "./registry_server.ts".RegistryMcpServer} (a whole registry, each run a
 * spawned subprocess) differ only in **what** their tools do. The JSON-RPC method
 * dispatch, the `initialize` version negotiation, the `tools/call` argument
 * parsing, the run-tool control properties, and the shapes of the denial /
 * confirmation results are identical — so they live here once and cannot drift
 * apart.
 *
 * Module-internal: nothing here is re-exported from `mod.ts`.
 *
 * @module
 */

import {
  err,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  type JsonRpcResponse,
  type McpRequestContext,
  messageId,
  METHOD_NOT_FOUND,
  ok,
} from "./jsonrpc.ts";
import {
  authenticateRequest,
  isResolvedIdentity,
  type McpAuthenticator,
  refusalReason,
  type ResolvedIdentity,
} from "./auth.ts";

/**
 * The MCP protocol versions these servers implement, newest first. The method
 * surface (`initialize`, `tools/list`, `tools/call`, `ping`) is common to all of
 * them; {@link PROTOCOL_VERSION} is the newest.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/** The newest MCP protocol version these servers implement. */
export const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** The `run:` prefix that names a per-target execution tool. */
export const RUN_PREFIX = "run:";

/** A JSON Schema fragment (kept loose — MCP only needs plain JSON Schema). */
export type JsonSchema = Record<string, unknown>;

/** An MCP tool definition, as returned by `tools/list`. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly annotations?: {
    readonly title?: string;
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
  };
}

/** The MCP result content for a single block of text. */
export function textResult(
  text: string,
  isError = false,
): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError };
}

/** Whether a JSON value is a plain object (a string-keyed record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What {@link dispatchMessage} needs from a server to answer one message. */
export interface McpDispatchHooks {
  /**
   * Authenticate the caller per request, when the server has one configured.
   * An authenticator that refuses — or throws — rejects the whole request before
   * any dispatch. Skipped when the transport already authenticated (see the
   * `identity` argument of {@link dispatchMessage}).
   */
  readonly authenticator?: McpAuthenticator;
  /** The `initialize` result (and the side effect of noting the client label). */
  initialize(params: unknown): Record<string, unknown>;
  /**
   * The advertised tools. Awaited unconditionally, so a server that reads a
   * live catalog (the registry) and one that inspects an in-process build share
   * this dispatcher.
   */
  tools(): McpTool[] | Promise<McpTool[]>;
  /** Dispatch a `tools/call`, attributed to the resolved caller `identity`. */
  callTool(
    id: string | number | null,
    params: unknown,
    identity: ResolvedIdentity | undefined,
  ): Promise<JsonRpcResponse>;
}

/**
 * Handle one parsed JSON-RPC message against `hooks`. Returns the response to
 * send, or `null` for a notification (which takes no reply).
 *
 * Authentication runs once, before any dispatch: an authenticator that yields no
 * trusted actor rejects the request outright — nothing runs, nothing is written,
 * and it never falls back to the (untrusted) static actor, so its precedence
 * stays absolute. `identity` is the transport's own already-authenticated
 * caller (the HTTP transport authenticates at its edge, so a refusal becomes a
 * real status and challenge); when it is absent and an authenticator is
 * configured, this dispatcher runs it — so neither transport can dispatch a
 * request nobody authenticated.
 *
 * `tools/list` and `tools/call` are each wrapped in a backstop, because neither
 * may crash the transport for every later message on the connection; the error
 * is generic so no raw detail escapes.
 */
export async function dispatchMessage(
  message: unknown,
  ctx: McpRequestContext,
  hooks: McpDispatchHooks,
  identity?: ResolvedIdentity,
): Promise<JsonRpcResponse | null> {
  if (
    typeof message !== "object" || message === null ||
    !("method" in message) || typeof message.method !== "string"
  ) {
    return err(messageId(message), INVALID_PARAMS, "Invalid Request");
  }
  const method = message.method;
  const id = messageId(message);
  const params = "params" in message ? message.params : undefined;

  // Notifications (no id) never receive a response.
  if (id === null && method.startsWith("notifications/")) return null;

  let caller = identity;
  if (caller === undefined && hooks.authenticator !== undefined) {
    const resolved = await authenticateRequest(hooks.authenticator, ctx);
    if (!isResolvedIdentity(resolved)) {
      // JSON-RPC carries no status, so a stdio caller learns only the reason —
      // the same sentence the HTTP transport writes beside the status.
      return err(id, INVALID_REQUEST, refusalReason(resolved));
    }
    caller = resolved;
  }

  switch (method) {
    case "initialize":
      return ok(id, hooks.initialize(params));
    case "ping":
      return ok(id, {});
    case "tools/list":
      try {
        return ok(id, { tools: await hooks.tools() });
      } catch {
        return err(id, INTERNAL_ERROR, "Internal error listing tools");
      }
    case "tools/call":
      try {
        return await hooks.callTool(id, params, caller);
      } catch {
        return err(id, INTERNAL_ERROR, "Internal error handling the tool call");
      }
    default:
      // An unknown notification is silently ignored; an unknown request errors.
      if (id === null) return null;
      return err(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

/**
 * The `initialize` result for server `version`, plus the client's self-reported
 * label when it sent one.
 *
 * The protocol version is negotiated per the MCP spec: echo the client's
 * requested version only when this server implements it, otherwise answer with
 * the newest supported version (the client then proceeds or disconnects), so an
 * unknown or malformed request never reflects an unsupported version back.
 * `clientLabel` is `clientInfo.name` — an untrusted, lowest-priority audit
 * actor, never an authorization input.
 */
export function negotiateInitialize(
  params: unknown,
  version: string,
): { result: Record<string, unknown>; clientLabel?: string } {
  const requested = isRecord(params) &&
      typeof params.protocolVersion === "string"
    ? params.protocolVersion
    : undefined;
  const protocolVersion = requested !== undefined &&
      SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : PROTOCOL_VERSION;
  const result: Record<string, unknown> = {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "zuke", version },
  };
  return isRecord(params) && isRecord(params.clientInfo) &&
      typeof params.clientInfo.name === "string"
    ? { result, clientLabel: params.clientInfo.name }
    : { result };
}

/**
 * Parse a `tools/call`'s params into the tool name and its arguments, or the
 * {@link INVALID_PARAMS} message to answer with when they are malformed.
 * Arguments default to `{}`, since MCP lets a client omit them entirely.
 */
export function toolCall(
  params: unknown,
): { name: string; args: Record<string, unknown> } | { error: string } {
  if (!isRecord(params) || !("name" in params)) {
    return { error: "tools/call requires a tool name" };
  }
  const name = params.name;
  if (typeof name !== "string") return { error: "tool name must be a string" };
  return { name, args: isRecord(params.arguments) ? params.arguments : {} };
}

/** The `dryRun` control property every run tool advertises. */
export const DRY_RUN_PROPERTY: JsonSchema = {
  type: "boolean",
  description: "Plan without executing any target body.",
};

/**
 * The `operatorToken` control property a run tool advertises when its plan
 * touches a protected target — the single home of the `ZUKE_OPERATOR_TOKEN`
 * wording, so both servers ask for the token in the same words.
 */
export const OPERATOR_TOKEN_PROPERTY: JsonSchema = {
  type: "string",
  description:
    "Operator token (ZUKE_OPERATOR_TOKEN) required: this target, or one " +
    "it depends on, is protected.",
};

/**
 * The result for a run tool called with execution disabled. `flags` names the
 * flags that would enable it (`--allow-run`, or `--registry --allow-run` for the
 * registry server); the message is deliberately generic, revealing no specific
 * target.
 */
export function runDisabledResult(flags: string): Record<string, unknown> {
  return textResult(
    "Running targets is disabled. Start the server with " +
      `\`zuke mcp ${flags}\` to enable execution.`,
    true,
  );
}

/**
 * The structured `unauthorized` result a denied run tool returns: the tool's
 * name and the client-facing denial `reason`, as pretty JSON.
 */
export function unauthorizedResult(
  tool: string,
  reason: string,
): Record<string, unknown> {
  return textResult(
    JSON.stringify({ error: "unauthorized", tool, reason }, null, 2),
    true,
  );
}

/**
 * The `confirmation_required` result a destructive run tool returns instead of
 * acting, when `--confirm-destructive` is on and the call carried no
 * `confirm: true`. `plan` is included when the server can resolve one — the
 * in-process server can, a registry spawn cannot. Not flagged as an error: the
 * client is expected to re-call with the confirmation.
 */
export function confirmationResult(
  tool: string,
  hint: string,
  plan?: readonly string[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    status: "confirmation_required",
    tool,
  };
  if (plan !== undefined) payload.plan = plan;
  payload.hint = hint;
  return textResult(JSON.stringify(payload, null, 2), false);
}
