/**
 * A registry-backed MCP server — dynamic pipeline discovery.
 *
 * Where {@link "./server.ts".McpServer} serves the single build its process was
 * launched with, {@link RegistryMcpServer} serves a whole
 * {@link "../registry/registry.ts".BuildRegistry}: it reads the catalog **fresh
 * on every `tools/list` and `tools/call`**, so a pipeline registered by another
 * process (`zuke register`) shows up as a tool in an already-running server with
 * no redeploy.
 *
 * A registered build has no live instance here — only a
 * {@link "../registry/descriptor.ts".BuildDescriptor}. So a run tool does not
 * `execute()` in-process; it **spawns the descriptor's launch location** (the
 * `deno run <module> <target>` the operator registered, or an explicit command),
 * captures its output, and returns it. That is a code-execution surface, so it
 * rides entirely on M5's gates: it is off unless `--allow-run`, honours the
 * allow-list / operator-token / confirmation tiers (keyed on the qualified
 * `<buildId>:<target>` name), and every mutating or denied call is audited.
 *
 * Scope note: a run tool takes no per-parameter inputs yet (only `dryRun`,
 * `confirm`, and `operatorToken`); the spawned build resolves its own parameters
 * from the server's environment. Passing parameters across the spawn boundary —
 * which needs a secret-safe contract the descriptor does not yet carry — is a
 * follow-up.
 *
 * @module
 */

import { absolutePath } from "../path.ts";
import { Redactor } from "../redact.ts";
import { resolveActor } from "../state/record.ts";
import type { RunEvent, RunEventOutcome } from "../state/types.ts";
import type { StateStore } from "../state/store.ts";
import type { RunStateWriter } from "../state/writer.ts";
import type { BuildLocation } from "../registry/descriptor.ts";
import type { BuildRegistry } from "../registry/registry.ts";
import { openAuditLog } from "./audit.ts";
import { targetMatcher, timingSafeEqual } from "./authz.ts";
import {
  type McpTool,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "./server.ts";
import {
  err,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  type JsonRpcResponse,
  METHOD_NOT_FOUND,
  ok,
} from "./jsonrpc.ts";

/** The `run:` prefix that names a per-target execution tool. */
const RUN_PREFIX = "run:";

/** The captured result of spawning a registered build. */
export interface RegistryRunResult {
  /** The subprocess exit code (0 on success). */
  code: number;
  /** Everything the build wrote to stdout. */
  stdout: string;
  /** Everything the build wrote to stderr. */
  stderr: string;
}

/**
 * Spawns a registered build and captures its output. The default
 * ({@link defaultRegistryRunner}) uses {@link Deno.Command}; tests inject a fake
 * so no real subprocess runs.
 */
export type RegistryRunner = (
  argv: readonly string[],
  cwd: string,
) => Promise<RegistryRunResult>;

/** The real, `Deno`-backed {@link RegistryRunner}. */
export const defaultRegistryRunner: RegistryRunner = async (argv, cwd) => {
  // The build inherits the server's environment (that is how it resolves its own
  // parameters), but the MCP server's *authorization* secrets are stripped — a
  // spawned pipeline must not be able to read the operator or HTTP bearer token.
  const env = Deno.env.toObject();
  delete env.ZUKE_OPERATOR_TOKEN;
  delete env.ZUKE_MCP_TOKEN;
  const command = new Deno.Command(argv[0], {
    args: [...argv.slice(1)],
    cwd,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const decoder = new TextDecoder();
  return {
    code,
    stdout: decoder.decode(stdout),
    stderr: decoder.decode(stderr),
  };
};

/** Options for {@link RegistryMcpServer}. */
export interface RegistryMcpServerOptions {
  /** Expose `run:<buildId>:<target>` tools that spawn build code. Off by default. */
  allowRun?: boolean;
  /**
   * Restrict the exposed run tools to **qualified** names (`<buildId>:<target>`)
   * matching these globs (from `--allow-run=a,b*`). `undefined` (a bare
   * `--allow-run`) exposes every registered target; a non-matched target is
   * neither advertised nor runnable.
   */
  allowRunPatterns?: readonly string[];
  /** Qualified names (globs, from `--protect`) whose run tool needs an operator token. */
  protectPatterns?: readonly string[];
  /** The operator token a protected call must carry (from `ZUKE_OPERATOR_TOKEN`). */
  operatorToken?: string;
  /** Require `confirm: true` before a run tool spawns (from `--confirm-destructive`). */
  confirmDestructive?: boolean;
  /** The durable store; when set, every mutating/denied call is audited. */
  stateStore?: StateStore;
  /** Who to attribute audited calls to (`--actor`), highest precedence. */
  actor?: string;
  /** Reads an environment variable (injectable for tests). */
  readEnv?: (name: string) => string | undefined;
  /** The server version reported in `initialize`. Defaults to `"0.0.0"`. */
  version?: string;
  /** Spawns a registered build; defaults to {@link defaultRegistryRunner}. */
  runner?: RegistryRunner;
}

/** The MCP result content for a single block of text. */
function textResult(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError };
}

/** Whether a JSON value is a plain object (a string-keyed record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An MCP server bound to a {@link "../registry/registry.ts".BuildRegistry}.
 * Construct it once, then feed each incoming JSON-RPC message to
 * {@link RegistryMcpServer.handleMessage}. Every tool list and call re-reads the
 * registry, so the exposed pipelines track the catalog live.
 */
export class RegistryMcpServer {
  readonly #registry: BuildRegistry;
  readonly #allowRun: boolean;
  readonly #version: string;
  /** Matches a qualified `<buildId>:<target>` allowed to run (allow-list glob, or all). */
  readonly #allowMatch: (name: string) => boolean;
  /** Matches a qualified name that needs an operator token to run. */
  readonly #isProtected: (name: string) => boolean;
  readonly #operatorToken?: string;
  readonly #confirmDestructive: boolean;
  readonly #store?: StateStore;
  readonly #actor?: string;
  readonly #readEnv: (name: string) => string | undefined;
  readonly #runner: RegistryRunner;
  /** The connecting client's `initialize` name, a low-priority audit actor. */
  #clientLabel?: string;
  /** The audit-log writer, opened lazily on the first audited call. */
  #auditLog?: RunStateWriter;

  /** Build the server over `registry`, applying the authz/audit options. */
  constructor(registry: BuildRegistry, options: RegistryMcpServerOptions = {}) {
    this.#registry = registry;
    this.#allowRun = options.allowRun ?? false;
    this.#allowMatch = targetMatcher(options.allowRunPatterns);
    // An empty/absent protect list protects nothing; targetMatcher(undefined)
    // matches everything, so map that case to a never-match.
    this.#isProtected = options.protectPatterns === undefined ||
        options.protectPatterns.length === 0
      ? () => false
      : targetMatcher(options.protectPatterns);
    this.#operatorToken = options.operatorToken;
    this.#confirmDestructive = options.confirmDestructive ?? false;
    this.#store = options.stateStore;
    this.#actor = options.actor;
    this.#readEnv = options.readEnv ?? (() => undefined);
    this.#version = options.version ?? "0.0.0";
    this.#runner = options.runner ?? defaultRegistryRunner;
  }

  /**
   * Handle one parsed JSON-RPC message. Returns the response to send, or `null`
   * for a notification (which takes no reply).
   */
  async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (
      typeof message !== "object" || message === null ||
      !("method" in message) || typeof message.method !== "string"
    ) {
      return err(idOf(message), INVALID_PARAMS, "Invalid Request");
    }
    const method = message.method;
    const id = idOf(message);
    const params = "params" in message ? message.params : undefined;

    if (id === null && method.startsWith("notifications/")) return null;

    switch (method) {
      case "initialize":
        return ok(id, this.#initialize(params));
      case "ping":
        return ok(id, {});
      case "tools/list":
        // Listing reads the registry live (a hosted backend can throw on a
        // transient fault or a malformed descriptor). Guard it — like tools/call
        // below — so one registry hiccup returns an error instead of tearing
        // down the transport for every client.
        try {
          return ok(id, { tools: await this.tools() });
        } catch {
          return err(id, INTERNAL_ERROR, "Internal error listing tools");
        }
      case "tools/call":
        // Backstop: no tool call may crash the transport. Anything unforeseen
        // becomes a generic error so no raw detail escapes.
        try {
          return await this.#callTool(id, params);
        } catch {
          return err(
            id,
            INTERNAL_ERROR,
            "Internal error handling the tool call",
          );
        }
      default:
        if (id === null) return null;
        return err(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  /**
   * The tools advertised to the client, read from the registry live: two read
   * tools always, plus one `run:<buildId>:<target>` per registered target when
   * execution is enabled and the target is allow-listed.
   */
  async tools(): Promise<McpTool[]> {
    const tools: McpTool[] = [
      {
        name: "list_builds",
        description:
          "List the pipelines registered in the build registry (id, name, actor).",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: "describe_build",
        description:
          "Describe one registered build's surface: its targets and parameters.",
        inputSchema: {
          type: "object",
          properties: {
            build: { type: "string", description: "The registered build id." },
          },
          required: ["build"],
        },
        annotations: { readOnlyHint: true },
      },
    ];
    if (!this.#allowRun) return tools;
    for (const summary of await this.#registry.listBuilds({})) {
      const loaded = await this.#registry.getBuild(summary.id);
      if (loaded === null) continue; // deregistered between list and read
      for (const target of loaded.descriptor.surface.targets) {
        const qualified = `${summary.id}:${target.name}`;
        if (this.#allowMatch(qualified)) {
          tools.push(
            this.#runTool(summary.id, target.name, target.description),
          );
        }
      }
    }
    return tools;
  }

  /** Build the `run:<buildId>:<target>` tool definition. */
  #runTool(buildId: string, target: string, description: string): McpTool {
    const qualified = `${buildId}:${target}`;
    const properties: Record<string, Record<string, unknown>> = {
      dryRun: {
        type: "boolean",
        description: "Plan without executing any target body.",
      },
    };
    const required: string[] = [];
    if (this.#isProtected(qualified)) {
      properties.operatorToken = {
        type: "string",
        description:
          "Operator token (ZUKE_OPERATOR_TOKEN) required to run this protected target.",
      };
      required.push("operatorToken");
    }
    // A registered target's read-only-ness is not carried in the descriptor, so
    // every registry run tool is treated as destructive (the safe default).
    if (this.#confirmDestructive) {
      properties.confirm = {
        type: "boolean",
        description:
          "Set true to spawn this target; otherwise a confirmation is returned.",
      };
    }
    const schema: Record<string, unknown> = { type: "object", properties };
    if (required.length > 0) schema.required = required;
    return {
      name: `${RUN_PREFIX}${qualified}`,
      description: description === ""
        ? `Run the "${target}" target of registered build "${buildId}".`
        : `Run the "${target}" target of registered build "${buildId}": ${description}`,
      inputSchema: schema,
      annotations: { title: `Run ${qualified}`, destructiveHint: true },
    };
  }

  /**
   * The `initialize` result: negotiate the protocol version (echo the client's
   * only when supported), and remember the client's self-reported name as a
   * low-priority audit actor (an untrusted label, never an authorization input).
   */
  #initialize(params: unknown): Record<string, unknown> {
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

  /** Dispatch a `tools/call`. */
  async #callTool(
    id: string | number | null,
    params: unknown,
  ): Promise<JsonRpcResponse> {
    if (!isRecord(params) || !("name" in params)) {
      return err(id, INVALID_PARAMS, "tools/call requires a tool name");
    }
    const name = params.name;
    if (typeof name !== "string") {
      return err(id, INVALID_PARAMS, "tool name must be a string");
    }
    const args = isRecord(params.arguments) ? params.arguments : {};

    if (name === "list_builds") {
      return ok(id, textResult(await this.#listBuilds()));
    }
    if (name === "describe_build") {
      return ok(id, await this.#describeBuild(args));
    }
    if (name.startsWith(RUN_PREFIX)) {
      return await this.#run(id, name.slice(RUN_PREFIX.length), args);
    }
    return ok(id, textResult(`Unknown tool: ${name}`, true));
  }

  /** The registry catalog as pretty JSON. */
  async #listBuilds(): Promise<string> {
    return JSON.stringify(await this.#registry.listBuilds({}), null, 2);
  }

  /** Describe one registered build's surface, or an error when it is unknown. */
  async #describeBuild(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const buildId = args.build;
    if (typeof buildId !== "string") {
      return textResult("describe_build requires a string `build` id.", true);
    }
    const loaded = await this.#registry.getBuild(buildId);
    if (loaded === null) {
      return textResult(`No registered build "${buildId}".`, true);
    }
    return textResult(JSON.stringify(loaded.descriptor.surface, null, 2));
  }

  /** Spawn a registered target: enforce the allow-list, protection, and confirmation. */
  async #run(
    id: string | number | null,
    qualified: string,
    args: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const runName = `${RUN_PREFIX}${qualified}`;
    if (!this.#allowRun) {
      await this.#audit(runName, args, "denied", "run_disabled");
      return ok(
        id,
        textResult(
          "Running targets is disabled. Start the server with " +
            "`zuke mcp --registry --allow-run` to enable execution.",
          true,
        ),
      );
    }

    const colon = qualified.indexOf(":");
    const buildId = colon === -1 ? qualified : qualified.slice(0, colon);
    const target = colon === -1 ? "" : qualified.slice(colon + 1);
    const loaded = colon === -1 ? null : await this.#registry.getBuild(buildId);
    const known = loaded !== null &&
      loaded.descriptor.surface.targets.some((t) => t.name === target);
    // Unknown build/target and a non-allow-listed one are reported identically,
    // so a denial never reveals which protected pipelines exist.
    if (!known || !this.#allowMatch(qualified)) {
      await this.#audit(runName, args, "denied", "not_allowed");
      return ok(id, textResult(`Unknown tool: ${runName}`, true));
    }

    if (this.#isProtected(qualified)) {
      const denial = this.#checkOperatorToken(args);
      if (denial !== null) {
        await this.#audit(runName, args, "denied", denial);
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
    }

    const dryRun = args.dryRun === true;
    // Unlike the in-process server, a spawn can't enforce dry-run — `--dry-run`
    // is only appended to the child argv, and a command-form wrapper may ignore
    // it and execute for real. So confirmation is required before *any* spawn,
    // dry run included; it is not exempt the way an in-process dry run is.
    if (this.#confirmDestructive && args.confirm !== true) {
      return ok(
        id,
        textResult(
          JSON.stringify(
            {
              status: "confirmation_required",
              tool: runName,
              hint: "Re-call with confirm:true to spawn this target.",
            },
            null,
            2,
          ),
          false,
        ),
      );
    }

    const launch = this.#launch(loaded.descriptor.location, target, dryRun);
    if (launch.argv.length === 0 || launch.argv[0] === "") {
      await this.#audit(runName, args, "error", "no_launch_command");
      return ok(
        id,
        textResult(
          `Registered build "${buildId}" has no runnable launch command.`,
          true,
        ),
      );
    }

    let result: RegistryRunResult;
    try {
      result = await this.#runner(launch.argv, launch.cwd);
    } catch (error) {
      await this.#audit(runName, args, "error", "spawn_failed");
      const kind = error instanceof Error ? error.name : "Error";
      return ok(
        id,
        textResult(`Failed to spawn ${qualified} (${kind}).`, true),
      );
    }
    await this.#audit(runName, args, result.code === 0 ? "ok" : "error");
    const output = [result.stdout, result.stderr].filter((s) => s !== "").join(
      "\n",
    );
    const status = result.code === 0
      ? `\n\n✔ ${qualified} succeeded.`
      : `\n\n✘ ${qualified} exited ${result.code}.`;
    return ok(id, textResult(output + status, result.code !== 0));
  }

  /** Build the launch argv and working directory for a target's location. */
  #launch(
    location: BuildLocation,
    target: string,
    dryRun: boolean,
  ): { argv: string[]; cwd: string } {
    const trailing = dryRun ? [target, "--dry-run"] : [target];
    if (location.kind === "command") {
      // An empty command has nothing to launch — return an empty argv so the
      // caller reports it rather than spawning the bare target as a program.
      if (location.command.length === 0) return { argv: [], cwd: location.cwd };
      return { argv: [...location.command, ...trailing], cwd: location.cwd };
    }
    return {
      argv: [Deno.execPath(), "run", "-A", location.module, ...trailing],
      cwd: absolutePath(location.cwd).path,
    };
  }

  /**
   * Validate a protected target's operator token, returning a denial reason (for
   * the structured error and audit) or `null` when the token is valid.
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
   * No-op without a store. The operator token is dropped from the recorded args
   * so nothing sensitive reaches the durable trail.
   */
  async #audit(
    tool: string,
    args: Record<string, unknown>,
    outcome: RunEventOutcome,
    detail?: string,
  ): Promise<void> {
    const store = this.#store;
    if (store === undefined) return;
    const event: RunEvent = {
      at: new Date().toISOString(),
      tool,
      actor: this.#resolveActor(),
      outcome,
      args: auditArgs(args),
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
}

/**
 * Sanitise tool arguments for the audit log: drop the operator token entirely,
 * and stringify the rest (registry run tools take only `dryRun`/`confirm`, so
 * there are no secret parameter values to mask).
 */
function auditArgs(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "operatorToken") continue;
    out[key] = typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value);
  }
  return out;
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
