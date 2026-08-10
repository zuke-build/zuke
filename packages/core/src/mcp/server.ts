/**
 * An MCP (Model Context Protocol) server over a Zuke build.
 *
 * {@link McpServer} turns a build into a set of MCP tools an AI client can
 * discover and call: read tools that describe the targets, parameters, and
 * dependency graph, plus — when execution is enabled — one `run:<target>` tool
 * per target whose JSON-Schema input is derived from the build's parameters.
 * The protocol handling is a pure {@link McpServer.handleMessage} (message in,
 * response out) so it is exercised without touching real stdio; the transport
 * loop lives in {@link serveStdio}.
 *
 * A run tool executes the target through {@link execute} with a buffering
 * reporter, so the captured output is returned to the client — and because that
 * output passes through the same reporter pipeline, `secret` parameter values
 * are redacted from it exactly as on the console.
 *
 * @module
 */

import type { Build, BuildResult } from "../build.ts";
import { discoverTargets } from "../build.ts";
import { type AnyParameter, discoverParameters } from "../params.ts";
import { describeBuildSurface } from "../describe.ts";
import { execute, type Reporter } from "../executor.ts";
import { planGraph } from "../graph.ts";
import type { TargetBuilder } from "../target.ts";
import { Redactor } from "../redact.ts";
import { resolveActor } from "../state/record.ts";
import type { RunEvent, RunEventOutcome } from "../state/types.ts";
import type { StateStore } from "../state/store.ts";
import type { RunStateWriter } from "../state/writer.ts";
import { openAuditLog } from "./audit.ts";
import { targetMatcher, timingSafeEqual } from "./authz.ts";
import {
  callRunStateTool,
  isMutatingRunTool,
  runStateToolDefs,
} from "./runtools.ts";
import {
  err,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  type JsonRpcResponse,
  type McpIdentityHook,
  type McpRequestContext,
  METHOD_NOT_FOUND,
  ok,
  resolveIdentity,
} from "./jsonrpc.ts";

/**
 * The MCP protocol versions this server implements, newest first. The server's
 * method surface (`initialize`, `tools/list`, `tools/call`, `ping`) is common
 * to all of them; {@link PROTOCOL_VERSION} is the newest.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/** The newest MCP protocol version this server implements. */
export const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** The `run:` prefix that names a per-target execution tool. */
const RUN_PREFIX = "run:";

/** The request context handed to {@link McpServer.handleMessage} on stdio (no headers). */
const EMPTY_CONTEXT: McpRequestContext = { headers: new Headers() };

/** A JSON Schema fragment (kept loose — MCP only needs plain JSON Schema). */
type JsonSchema = Record<string, unknown>;

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

/** Options for {@link McpServer}. */
export interface McpServerOptions {
  /**
   * Expose `run:<target>` tools that execute build code. Off by default, so a
   * freshly-connected agent can only inspect the build; enable it with
   * `zuke mcp --allow-run`.
   */
  allowRun?: boolean;
  /**
   * Restrict the exposed `run:` tools to targets matching these globs (from
   * `--allow-run=a,b*`). `undefined` (a bare `--allow-run`) exposes every
   * target. A target not matched is not advertised and cannot be run — a call
   * to it is indistinguishable from a call to a nonexistent tool, and the read
   * tools narrow to the matched targets' dependency closure so it is not
   * discoverable there either.
   *
   * This gates **invocation**, not execution: invoking a target runs its
   * dependencies, so allow-listing a root allows everything that root does.
   * Use {@link protectPatterns} to gate an individual operation wherever it is
   * reached from.
   */
  allowRunPatterns?: readonly string[];
  /**
   * Targets (globs, from `--protect a,b*`) that require an operator token
   * argument, checked against {@link operatorToken}. Enforced over a run's
   * whole plan: a call that would execute a protected target — as the root
   * **or** anywhere in its dependency closure — requires the token, and
   * advertises it in that run tool's schema.
   */
  protectPatterns?: readonly string[];
  /**
   * The operator token a protected target's call must carry (from
   * `ZUKE_OPERATOR_TOKEN`). Absent → every protected target is denied
   * (fail-closed), so a misconfigured server never silently exposes one.
   */
  operatorToken?: string;
  /**
   * Require an explicit `confirm: true` argument before a destructive target
   * executes (from `--confirm-destructive`); an unconfirmed call returns the
   * resolved plan instead of running. Read-only targets are never gated.
   */
  confirmDestructive?: boolean;
  /**
   * The durable {@link "../state/store.ts".StateStore}. When set, the
   * store-backed run tools (`list_runs`/`show_run`, and — with {@link allowRun}
   * — `signal_run`/`resume_check`) are exposed, and every mutating or denied
   * tool call is written to the audit log.
   */
  stateStore?: StateStore;
  /** Who to attribute audited calls to (`--actor`); below {@link identity}. */
  actor?: string;
  /**
   * Resolve a trusted caller identity per request (e.g. from an authenticating
   * reverse proxy's header). When set, its actor overrides `--actor`, the
   * environment, and the client's self-reported label for every call, and a
   * throwing hook rejects the request before anything runs. Off by default, so
   * stdio/local use is unchanged.
   */
  identity?: McpIdentityHook;
  /** Reads an environment variable (injectable for tests). */
  readEnv?: (name: string) => string | undefined;
  /** The server version reported in `initialize`. Defaults to `"0.0.0"`. */
  version?: string;
}

/** A reporter that records every line, for returning a run's output. */
function bufferingReporter(): { reporter: Reporter; text(): string } {
  const lines: string[] = [];
  return {
    reporter: {
      info: (line) => void lines.push(line),
      error: (line) => void lines.push(line),
    },
    text: () => lines.join("\n"),
  };
}

/** The JSON-Schema type keyword for a parameter's value kind. */
function schemaForParam(param: AnyParameter): JsonSchema {
  if (param.array_) {
    return { type: "array", items: { type: "string" } };
  }
  const base: JsonSchema = { type: param.kind_ };
  if (param.description_) base.description = param.description_;
  if (param.options_ && param.options_.length > 0) {
    base.enum = [...param.options_];
  }
  return base;
}

/** The MCP result content for a single block of text. */
function textResult(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError };
}

/** Whether a JSON value is a plain object (a string-keyed record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a JSON value is a scalar a parameter can accept. */
function isScalar(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

/**
 * Coerce a JSON argument to the string a parameter parses, or `null` when the
 * value's shape is invalid (an object, `null`, or a non-scalar/list mismatch).
 * An array parameter accepts a list of scalars (joined like a repeated flag);
 * every other parameter accepts a single scalar.
 */
function coerceArg(value: unknown, isArray: boolean): string | null {
  if (Array.isArray(value)) {
    if (!isArray || !value.every(isScalar)) return null;
    return value.map(String).join(",");
  }
  return isScalar(value) ? String(value) : null;
}

/**
 * An MCP server bound to a build. Construct it once, then feed each incoming
 * JSON-RPC message to {@link McpServer.handleMessage}.
 */
export class McpServer {
  readonly #targets: Map<string, TargetBuilder>;
  readonly #params: Map<string, AnyParameter>;
  readonly #allowRun: boolean;
  readonly #version: string;
  /** Matches a target name allowed to run (allow-list glob, or all). */
  readonly #allowMatch: (name: string) => boolean;
  /** Whether an allow-list was configured at all (a bare `--allow-run` sets none). */
  readonly #hasAllowList: boolean;
  /** Matches a target name that needs an operator token to run. */
  readonly #isProtected: (name: string) => boolean;
  /** Memoised visible-target closure, computed on first describe/list. */
  #visibleNames?: ReadonlySet<string>;
  readonly #operatorToken?: string;
  readonly #confirmDestructive: boolean;
  readonly #store?: StateStore;
  readonly #actor?: string;
  readonly #identity?: McpIdentityHook;
  readonly #readEnv: (name: string) => string | undefined;
  /** The connecting client's `initialize` name, a low-priority audit actor. */
  #clientLabel?: string;
  /** The audit-log writer, opened lazily on the first audited call. */
  #auditLog?: RunStateWriter;

  constructor(
    private readonly build: Build,
    options: McpServerOptions = {},
  ) {
    this.#targets = discoverTargets(build);
    this.#params = discoverParameters(build);
    this.#allowRun = options.allowRun ?? false;
    this.#allowMatch = targetMatcher(options.allowRunPatterns);
    this.#hasAllowList = options.allowRunPatterns !== undefined;
    this.#isProtected = targetMatcher(options.protectPatterns);
    // An empty protect list means "protect nothing"; targetMatcher(undefined)
    // matches everything, so map the absent/empty case to a never-match.
    if (
      options.protectPatterns === undefined ||
      options.protectPatterns.length === 0
    ) {
      this.#isProtected = () => false;
    }
    this.#operatorToken = options.operatorToken;
    this.#confirmDestructive = options.confirmDestructive ?? false;
    this.#store = options.stateStore;
    this.#actor = options.actor;
    this.#identity = options.identity;
    this.#readEnv = options.readEnv ?? (() => undefined);
    this.#version = options.version ?? "0.0.0";
  }

  /** Whether a `run:<name>` tool is exposed and runnable (allow-list gate). */
  #isRunnable(name: string): boolean {
    return this.#allowRun && this.#targets.has(name) && this.#allowMatch(name);
  }

  /**
   * The names of every target invoking `name` would run — the root plus its
   * whole dependency closure — or `null` when that cannot be determined (an
   * unknown target, or a graph `planGraph` rejects). A `null` is never treated
   * as "nothing runs": callers fail closed on it, because an unresolvable plan
   * is an unknown blast radius.
   */
  #plannedNames(name: string): string[] | null {
    const root = this.#targets.get(name);
    if (root === undefined) return null;
    let order: readonly TargetBuilder[];
    try {
      order = planGraph(root).order;
    } catch {
      return null;
    }
    return order
      .map((t) => t.name_)
      .filter((n): n is string => n !== undefined);
  }

  /**
   * Whether a plan would run any protected target. Protection is a property of
   * the **operation**, not of the entry point: a protected `deploy` reached as
   * a dependency of an unprotected `release` must still require the operator
   * token, or every protected target is one unprotected dependent away from
   * being run without one.
   */
  #planTouchesProtected(planned: readonly string[]): boolean {
    return planned.some((name) => this.#isProtected(name));
  }

  /**
   * The targets a client may see through the read tools.
   *
   * Without an allow-list every target is visible — the documented "inspect
   * only" tier. With one, visibility is the **closure** of the allow-listed
   * targets: the roots a client may invoke, plus everything invoking them would
   * run. A target outside that set is genuinely unreachable through this
   * server, so hiding it is a real boundary rather than cosmetic; a dependency
   * inside it stays visible, because a client that can already cause it to run
   * gains nothing from being kept ignorant of it — and an agent asked to invoke
   * a target should be able to see what that target actually does.
   */
  #visibleTargets(): Map<string, TargetBuilder> {
    if (!this.#hasAllowList) return this.#targets;
    if (this.#visibleNames === undefined) {
      const names = new Set<string>();
      for (const name of this.#targets.keys()) {
        if (!this.#allowMatch(name)) continue;
        names.add(name);
        for (const planned of this.#plannedNames(name) ?? []) {
          names.add(planned);
        }
      }
      this.#visibleNames = names;
    }
    const visible = new Map<string, TargetBuilder>();
    for (const [name, target] of this.#targets) {
      if (this.#visibleNames.has(name)) visible.set(name, target);
    }
    return visible;
  }

  /** The tools advertised to the client, honouring {@link McpServerOptions.allowRun}. */
  tools(): McpTool[] {
    const tools: McpTool[] = [
      {
        name: "list_targets",
        description:
          "List the build's targets with their descriptions and dependencies.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: "describe_build",
        description:
          "Describe the whole build surface: commands, flags, targets, and parameters.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: "graph",
        description: "Show each target and the targets it depends on.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
    ];
    for (const [name, target] of this.#targets) {
      // Only allow-listed targets are advertised as run tools; the read tools
      // narrow to the same allow-list's closure (see #visibleTargets), so a
      // target outside it is not discoverable through any tool here.
      if (this.#isRunnable(name)) tools.push(this.#runTool(name, target));
    }
    // Store-backed run tools: read tools whenever a store resolves, mutating
    // ones (signal_run/resume_check) only when execution is enabled.
    if (this.#store !== undefined) {
      tools.push(...runStateToolDefs(this.#allowRun));
    }
    return tools;
  }

  /** Build the `run:<name>` tool for one target from the build's parameters. */
  #runTool(name: string, target: TargetBuilder): McpTool {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [paramName, param] of this.#params) {
      properties[paramName] = schemaForParam(param);
      if (param.required_ && !param.hasFallback_) required.push(paramName);
    }
    // Execution controls, alongside the declared parameters.
    properties.dryRun = {
      type: "boolean",
      description: "Plan without executing any target body.",
    };
    // A call that would run a protected target must carry the operator token.
    // Checked over the whole plan, so a target that merely *depends* on a
    // protected one advertises the requirement too — otherwise the schema would
    // omit the very argument the call is then denied for.
    const planned = this.#plannedNames(name);
    if (planned === null || this.#planTouchesProtected(planned)) {
      properties.operatorToken = {
        type: "string",
        description:
          "Operator token (ZUKE_OPERATOR_TOKEN) required: this target, or one " +
          "it depends on, is protected.",
      };
      required.push("operatorToken");
    }
    // With --confirm-destructive, a destructive target needs an explicit
    // confirm:true or it returns its plan instead of running.
    if (this.#confirmDestructive && !target.readOnly_) {
      properties.confirm = {
        type: "boolean",
        description:
          "Set true to execute this destructive target; otherwise its plan is returned.",
      };
    }
    const description = target.description_
      ? `Run the "${name}" target: ${target.description_}`
      : `Run the "${name}" target.`;
    const schema: JsonSchema = { type: "object", properties };
    if (required.length > 0) schema.required = required;
    // A target that declares .readOnly() advertises readOnlyHint; everything
    // else is treated as destructive (the default for a build step).
    const annotations = target.readOnly_
      ? { title: `Run ${name}`, readOnlyHint: true }
      : { title: `Run ${name}`, destructiveHint: true };
    return {
      name: `${RUN_PREFIX}${name}`,
      description,
      inputSchema: schema,
      annotations,
    };
  }

  /**
   * Handle one parsed JSON-RPC message. Returns the response to send, or `null`
   * for a notification (which takes no reply).
   */
  async handleMessage(
    message: unknown,
    ctx: McpRequestContext = EMPTY_CONTEXT,
  ): Promise<JsonRpcResponse | null> {
    if (
      typeof message !== "object" || message === null ||
      !("method" in message) || typeof message.method !== "string"
    ) {
      return err(idOf(message), INVALID_PARAMS, "Invalid Request");
    }
    const method = message.method;
    const id = idOf(message);
    const params = "params" in message ? message.params : undefined;

    // Notifications (no id) never receive a response.
    if (id === null && method.startsWith("notifications/")) return null;

    // Resolve the trusted caller identity once, before any dispatch. A throwing
    // hook — or one that yields no usable actor — rejects the whole request:
    // nothing runs, nothing is written, and it never falls back to the
    // (untrusted) static actor, so the hook's precedence stays absolute.
    let identityActor: string | undefined;
    if (this.#identity !== undefined) {
      const resolved = resolveIdentity(this.#identity, ctx);
      if (resolved === null) return err(id, INVALID_REQUEST, "Unauthorized");
      identityActor = resolved;
    }

    switch (method) {
      case "initialize":
        return ok(id, this.#initialize(params));
      case "ping":
        return ok(id, {});
      case "tools/list":
        // Same backstop as tools/call: building the tool list now walks each
        // target's plan, so an unforeseen throw must not tear down the
        // transport for every later message on the connection.
        try {
          return ok(id, { tools: this.tools() });
        } catch {
          return err(id, INTERNAL_ERROR, "Internal error listing tools");
        }
      case "tools/call":
        // Backstop: no tool call may crash the transport. Expected failures are
        // already structured tool results; this catches anything unforeseen and
        // returns a JSON-RPC error (generic, so no raw detail can escape).
        try {
          return await this.#callTool(id, params, identityActor);
        } catch {
          return err(
            id,
            INTERNAL_ERROR,
            "Internal error handling the tool call",
          );
        }
      default:
        // An unknown notification is silently ignored; an unknown request errors.
        if (id === null) return null;
        return err(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  /**
   * The `initialize` result. Negotiate the protocol version per the MCP spec:
   * echo the client's requested version only when this server implements it,
   * otherwise answer with the server's newest supported version (the client
   * then proceeds or disconnects). An unknown or malformed request never
   * reflects an unsupported version back.
   */
  #initialize(params: unknown): Record<string, unknown> {
    // Remember the client's self-reported name as a low-priority audit actor.
    // It is an untrusted label (never an authorization input), and on a shared
    // HTTP endpoint it reflects the most recent client to connect — set --actor
    // for authoritative attribution there (see docs/mcp.md).
    if (
      isRecord(params) && isRecord(params.clientInfo) &&
      typeof params.clientInfo.name === "string"
    ) {
      this.#clientLabel = params.clientInfo.name;
    }
    const requested = isRecord(params) &&
        typeof params.protocolVersion === "string"
      ? params.protocolVersion
      : undefined;
    const protocolVersion = requested !== undefined &&
        SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : PROTOCOL_VERSION;
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "zuke", version: this.#version },
    };
  }

  /** Dispatch a `tools/call`, attributed to `actor` (the resolved caller). */
  async #callTool(
    id: string | number | null,
    params: unknown,
    actor: string | undefined,
  ): Promise<JsonRpcResponse> {
    if (!isRecord(params) || !("name" in params)) {
      return err(id, INVALID_PARAMS, "tools/call requires a tool name");
    }
    const name = params.name;
    if (typeof name !== "string") {
      return err(id, INVALID_PARAMS, "tool name must be a string");
    }
    const args = isRecord(params.arguments) ? params.arguments : {};

    if (name === "list_targets") {
      return ok(id, textResult(this.#describe().targets));
    }
    if (name === "describe_build") {
      return ok(id, textResult(this.#describe().full));
    }
    if (name === "graph") {
      return ok(id, textResult(this.#describe().graph));
    }
    if (name.startsWith(RUN_PREFIX)) {
      return await this.#run(id, name.slice(RUN_PREFIX.length), args, actor);
    }
    const runStateResult = await this.#callRunStateTool(name, args, actor);
    if (runStateResult !== null) return ok(id, runStateResult);
    // An unknown tool is reported through the result (isError), per MCP, so the
    // model sees it rather than a transport-level failure.
    return ok(id, textResult(`Unknown tool: ${name}`, true));
  }

  /**
   * Dispatch a store-backed run tool (`list_runs`/`show_run`/`signal_run`/
   * `resume_check`), or return `null` when `name` is not one. Mutating tools are
   * gated behind `--allow-run` and audited; a call to a store tool with no store
   * configured falls through to the "unknown tool" result.
   */
  async #callRunStateTool(
    name: string,
    args: Record<string, unknown>,
    identityActor: string | undefined,
  ): Promise<Record<string, unknown> | null> {
    const store = this.#store;
    if (store === undefined) return null;
    const actor = identityActor ?? this.#resolveActor();
    const mutating = isMutatingRunTool(name);
    if (mutating && !this.#allowRun) {
      return textResult(
        `${name} changes run state and needs execution enabled — start the ` +
          "server with `zuke mcp --allow-run`.",
        true,
      );
    }
    const result = await callRunStateTool(
      {
        store,
        build: this.build,
        actor,
        readEnv: this.#readEnv,
        authorize: (targetName, callArgs) =>
          this.#authorizeTarget(targetName, callArgs),
      },
      name,
      args,
    );
    if (result === null) return null;
    if (mutating) {
      await this.#audit(name, args, result.isError ? "error" : "ok", actor);
    }
    return textResult(result.text, result.isError);
  }

  /** The three read tools' payloads, as pretty JSON / text. */
  #describe(): { targets: string; full: string; graph: string } {
    const surface = describeBuildSurface(this.#visibleTargets(), this.#params);
    const graph = surface.targets
      .map((t) =>
        t.dependsOn.length > 0
          ? `${t.name} -> ${t.dependsOn.join(", ")}`
          : `${t.name} (no dependencies)`
      )
      .join("\n");
    return {
      targets: JSON.stringify(surface.targets, null, 2),
      full: JSON.stringify(surface, null, 2),
      graph,
    };
  }

  /** Execute a target: enforce the allow-list, protection, and confirmation. */
  async #run(
    id: string | number | null,
    targetName: string,
    args: Record<string, unknown>,
    identityActor: string | undefined,
  ): Promise<JsonRpcResponse> {
    const runName = `${RUN_PREFIX}${targetName}`;
    const actor = identityActor ?? this.#resolveActor();
    // Execution off entirely: a generic message (reveals no specific target).
    if (!this.#allowRun) {
      await this.#audit(runName, args, "denied", actor, "run_disabled");
      return ok(
        id,
        textResult(
          "Running targets is disabled. Start the server with " +
            "`zuke mcp --allow-run` to enable execution.",
          true,
        ),
      );
    }
    const root = this.#targets.get(targetName);
    // A target that is unknown OR not in the allow-list is reported identically,
    // so a denial never reveals which protected targets exist.
    if (root === undefined || !this.#allowMatch(targetName)) {
      await this.#audit(runName, args, "denied", actor, "not_allowed");
      return ok(id, textResult(`Unknown tool: ${runName}`, true));
    }

    // Protection is enforced over the whole plan, not just the root, so a
    // protected target reached as a dependency still demands the operator
    // token. Fail-closed twice over: a plan that cannot be resolved is denied,
    // and so is a protected target with no server-side token configured.
    const denial = this.#authorizeTarget(targetName, args);
    if (denial !== null) {
      await this.#audit(runName, args, "denied", actor, denial);
      return ok(
        id,
        textResult(
          JSON.stringify(
            { error: "unauthorized", tool: runName, reason: denial },
            null,
            2,
          ),
          true,
        ),
      );
    }

    const dryRun = args.dryRun === true;

    // Confirmation tiering: a destructive target without confirm:true returns
    // its resolved plan instead of executing (a dry run needs no confirmation).
    if (
      this.#confirmDestructive && !root.readOnly_ && !dryRun &&
      args.confirm !== true
    ) {
      const plan = planGraph(root).order
        .map((t) => t.name_)
        .filter((n): n is string => n !== undefined);
      return ok(
        id,
        textResult(
          JSON.stringify(
            {
              status: "confirmation_required",
              tool: runName,
              plan,
              hint: "Re-call with confirm:true to execute.",
            },
            null,
            2,
          ),
          false,
        ),
      );
    }

    // Coerce each supplied argument to the string form the parameter layer
    // parses (the same path as a CLI flag), rejecting non-scalar JSON so a
    // stray object/array can't be smuggled in as `[object Object]`. The
    // parameter parsers then validate the string content (number, boolean,
    // allowed options), surfacing an invalid value as a build failure.
    const values: Record<string, string> = {};
    const badArgs: string[] = [];
    for (const [paramName, param] of this.#params) {
      const value = args[paramName];
      if (value === undefined) continue;
      const coerced = coerceArg(value, param.array_);
      if (coerced === null) badArgs.push(paramName);
      else values[paramName] = coerced;
    }
    if (badArgs.length > 0) {
      await this.#audit(runName, args, "error", actor, "invalid_arguments");
      return ok(
        id,
        textResult(
          `Invalid argument type for: ${badArgs.join(", ")}. Each parameter ` +
            "accepts a string, number, or boolean (an array parameter also " +
            "accepts a list of them).",
          true,
        ),
      );
    }
    const buffer = bufferingReporter();
    // Parameters resolve like the CLI: MCP arguments beat the environment beats
    // the declared default, so a value set in the server's environment still
    // applies unless the agent overrides it.
    // `execute` captures target failures into its result, but can still throw
    // on a framework error (a build hook or plugin throwing, etc.). Catch it so
    // a tool call never crashes the transport — and don't echo the raw message,
    // which bypassed the reporter's redaction.
    let result: BuildResult;
    try {
      result = await execute(this.build, root, {
        params: values,
        reporter: buffer.reporter,
        dryRun,
        github: false,
        actor,
        readEnv: this.#readEnv,
      });
    } catch (error) {
      await this.#audit(runName, args, "error", actor, "execute_threw");
      const kind = error instanceof Error ? error.name : "Error";
      return ok(
        id,
        textResult(
          `${buffer.text()}\n\n✘ ${targetName} errored during execution (${kind}).`,
          true,
        ),
      );
    }
    await this.#audit(runName, args, result.ok ? "ok" : "error", actor);
    const status = result.ok
      ? `\n\n✔ ${targetName} succeeded.`
      : `\n\n✘ ${targetName} failed.`;
    return ok(id, textResult(buffer.text() + status, !result.ok));
  }

  /**
   * Authorize causing target `name` to run — the shared gate for a `run:` tool
   * and for a resume or cancel (`signal_run`/`resume_check`/`cancel_run`, which
   * re-run the target's code). Returns a denial reason or `null` when allowed.
   *
   * The two gates deliberately have different reach. The **allow-list** is an
   * entry-point control: it decides which targets a client may invoke, and
   * invoking one necessarily runs its dependencies — that is what a build
   * target means, so a dependency is not separately allow-listed. The
   * **operator token** is an operation control: it must hold wherever the
   * protected target runs, so it is checked across the entire plan.
   */
  #authorizeTarget(name: string, args: Record<string, unknown>): string | null {
    if (!this.#allowMatch(name)) return "not_allowed";
    const planned = this.#plannedNames(name);
    if (planned === null) return "unresolved_plan";
    if (this.#planTouchesProtected(planned)) {
      const denial = this.#checkOperatorToken(args);
      if (denial !== null) return denial;
    }
    return null;
  }

  /**
   * Validate a protected target's operator token, returning a denial reason
   * (for the structured error and audit) or `null` when the token is valid.
   */
  #checkOperatorToken(args: Record<string, unknown>): string | null {
    if (this.#operatorToken === undefined || this.#operatorToken === "") {
      return "operator_token_unconfigured";
    }
    const provided = args.operatorToken;
    if (typeof provided !== "string") return "missing_operator_token";
    return timingSafeEqual(provided, this.#operatorToken)
      ? null
      : "invalid_operator_token";
  }

  /** Resolve the actor for audited calls: --actor → env → the client label. */
  #resolveActor(): string {
    return resolveActor(this.#actor, this.#readEnv, [this.#clientLabel]);
  }

  /**
   * Append a tool call to the audit log (best-effort; never breaks a call).
   * No-op without a store. Attributed to `actor` — the trusted per-call identity
   * when a hook is configured, else the resolved `--actor`/env/label. `args` are
   * sanitised by {@link "#auditArgs"} first — the operator token dropped, secret
   * values masked wherever they appear — so nothing sensitive reaches the trail.
   */
  async #audit(
    tool: string,
    args: Record<string, unknown>,
    outcome: RunEventOutcome,
    actor: string,
    detail?: string,
  ): Promise<void> {
    const store = this.#store;
    if (store === undefined) return;
    const event: RunEvent = {
      at: new Date().toISOString(),
      tool,
      actor,
      outcome,
      args: this.#auditArgs(args),
    };
    if (detail !== undefined) event.detail = detail;
    try {
      this.#auditLog ??= await openAuditLog(
        store,
        () => new Date().toISOString(),
        new Redactor(),
      );
      await this.#auditLog.appendEvent(event);
    } catch {
      // Auditing is best-effort: a store hiccup must not fail the tool call.
    }
  }

  /**
   * Sanitise tool arguments for the audit log: drop the operator token, mask
   * each secret parameter's value, and — via a redactor seeded from this call's
   * secret values — mask any secret **echoed into a non-secret argument** too,
   * so a secret can't slip into the durable trail through another field.
   */
  #auditArgs(args: Record<string, unknown>): Record<string, string> {
    const redactor = new Redactor();
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined) continue;
      if (key !== "operatorToken" && !this.#params.get(key)?.secret_) continue;
      // Seed from the value's *audit* string form, not just from strings: a
      // secret supplied as a JSON number (or nested in a structure) must still
      // be masked when it is echoed into some other, non-secret argument.
      redactor.add(auditText(value));
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      if (key === "operatorToken") continue; // never persist the operator token
      if (this.#params.get(key)?.secret_) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redactor.redact(auditText(value));
    }
    return out;
  }
}

/**
 * The string form an argument takes in the audit trail: a structure is
 * serialised, everything else stringified. Used both to seed the redactor and
 * to render the recorded value, so the two can never disagree about what text
 * a value produces.
 */
function auditText(value: unknown): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);
}

/** Extract a JSON-RPC id from a message, defaulting to `null`. */
function idOf(message: unknown): string | number | null {
  if (
    typeof message === "object" && message !== null && "id" in message &&
    (typeof message.id === "string" || typeof message.id === "number")
  ) {
    return message.id;
  }
  return null;
}
