// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
 * A run tool exposes the build's declared parameters as its input schema (from
 * the descriptor's surface), validates supplied values against their kinds
 * before spawning, and forwards them to the child as `--flag=value` arguments.
 * Secret parameters are structurally absent from the descriptor (`zuke register`
 * omits them), so they can neither be requested nor forwarded — the child
 * resolves a secret from its own environment / `.from()` source.
 *
 * @module
 */

import { absolutePath } from "../path.ts";
import { resolveActor } from "../state/record.ts";
import type { RunEvent, RunEventOutcome } from "../state/types.ts";
import type { StateStore } from "../state/store.ts";
import type { CliParameterInfo, CliTargetInfo } from "../describe.ts";
import type { BuildLocation } from "../registry/descriptor.ts";
import { launchDenial } from "../registry/launch_policy.ts";
import type { BuildRegistry } from "../registry/registry.ts";
import { AUDIT_SAFE_KEYS, auditText, AuditTrail } from "./audit.ts";
import { operatorTokenDenial, targetMatcher } from "./authz.ts";
import {
  confirmationResult,
  dispatchMessage,
  DRY_RUN_PROPERTY,
  type McpTool,
  negotiateInitialize,
  OPERATOR_TOKEN_PROPERTY,
  RUN_PREFIX,
  runDisabledResult,
  textResult,
  toolCall,
  unauthorizedResult,
} from "./protocol.ts";
import {
  EMPTY_CONTEXT,
  err,
  INVALID_PARAMS,
  type JsonRpcResponse,
  type McpRequestContext,
  ok,
} from "./jsonrpc.ts";
import type { McpAuthenticator, ResolvedIdentity } from "./auth.ts";

/** The captured result of spawning a registered build. */
export interface RegistryRunResult {
  /** The subprocess exit code (0 on success). */
  code: number;
  /** Everything the build wrote to stdout. */
  stdout: string;
  /** Everything the build wrote to stderr. */
  stderr: string;
}

/** Extra context a {@link RegistryRunner} may honour when spawning a build. */
export interface RegistryRunOptions {
  /**
   * The resolved caller actor. The default runner exports it as `ZUKE_ACTOR` in
   * the child environment so the spawned build attributes its run to the same
   * (trusted, when an authenticator is active) actor as the MCP audit trail.
   */
  actor?: string;
  /**
   * Whether a person or a machine asked for the run, exported as
   * `ZUKE_ACTOR_KIND`, so a build can tell an engineer's launch from a
   * scheduler's. Honoured only together with {@link RegistryRunOptions.actor}.
   */
  actorKind?: "human" | "service";
  /**
   * The caller's roles, exported as `ZUKE_ACTOR_ROLES` (comma-separated), so a
   * build can see what the caller was entitled to when it asked. Honoured only
   * together with {@link RegistryRunOptions.actor}.
   *
   * The three describe one caller and are written together or not at all:
   * exporting entitlements beside an actor that came from somewhere else is the
   * mismatch the coupling exists to prevent. Supplying these without an actor
   * therefore changes nothing rather than half-describing a caller.
   */
  actorRoles?: readonly string[];
}

/**
 * Spawns a registered build and captures its output. The default
 * ({@link defaultRegistryRunner}) uses {@link Deno.Command}; tests inject a fake
 * so no real subprocess runs.
 */
export type RegistryRunner = (
  argv: readonly string[],
  cwd: string,
  options?: RegistryRunOptions,
) => Promise<RegistryRunResult>;

/** The real, `Deno`-backed {@link RegistryRunner}. */
export const defaultRegistryRunner: RegistryRunner = async (
  argv,
  cwd,
  options,
) => {
  // The build inherits the server's environment (that is how it resolves its own
  // parameters), but the MCP server's *authorization* secrets are stripped — a
  // spawned pipeline must not be able to read the operator or HTTP bearer token.
  const env = Deno.env.toObject();
  delete env.ZUKE_OPERATOR_TOKEN;
  delete env.ZUKE_MCP_TOKEN;
  // Attribute the child run to the resolved caller (a trusted identity when an
  // authenticator is active), overriding any inherited ZUKE_ACTOR. The three
  // travel together: an inherited kind or role set must not survive beside a
  // fresh actor, or the child would read one caller's actor with another's
  // entitlements.
  if (options?.actor !== undefined && options.actor !== "") {
    env.ZUKE_ACTOR = options.actor;
    env.ZUKE_ACTOR_KIND = options.actorKind ?? "human";
    env.ZUKE_ACTOR_ROLES = (options.actorRoles ?? []).join(",");
  }
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
  /** Who to attribute audited calls to (`--actor`); below {@link authenticator}. */
  actor?: string;
  /**
   * Authenticate the caller per request. When set, the identity it resolves
   * overrides `--actor`, the environment, and the client label for every call —
   * flowing to the audit trail and to the spawned build (as `ZUKE_ACTOR`,
   * `ZUKE_ACTOR_KIND` and `ZUKE_ACTOR_ROLES`) — and a refusal stops the request
   * before anything spawns. Off by default. The CLI builds this from the
   * build's `mcpAuth()` or `mcpIdentity()` (see `serveMcp`).
   */
  authenticator?: McpAuthenticator;
  /** Reads an environment variable (injectable for tests). */
  readEnv?: (name: string) => string | undefined;
  /** The server version reported in `initialize`. Defaults to `"0.0.0"`. */
  version?: string;
  /** Spawns a registered build; defaults to {@link defaultRegistryRunner}. */
  runner?: RegistryRunner;
  /**
   * The most run-tool spawns allowed in flight at once (default
   * {@link DEFAULT_MAX_CONCURRENT_RUNS}). A call past the cap gets an immediate
   * structured busy error rather than queueing; read tools are never counted.
   */
  maxConcurrentRuns?: number;
}

/** The default {@link RegistryMcpServerOptions.maxConcurrentRuns} cap. */
export const DEFAULT_MAX_CONCURRENT_RUNS = 4;

/** The reserved run-tool control keys — never treated as build parameters. */
const CONTROL_KEYS: ReadonlySet<string> = new Set([
  "dryRun",
  "confirm",
  "operatorToken",
]);

/** The JSON-Schema property for one descriptor parameter (kind, enum, default). */
function schemaForParam(p: CliParameterInfo): Record<string, unknown> {
  // `options` constrains string parameters only (the fluent `.options()` is
  // string-typed); an `enum` on a number/boolean would be a malformed schema, so
  // ignore one from an untrusted descriptor rather than emit it.
  const enumValues = p.kind === "string" && p.options.length > 0
    ? [...p.options]
    : undefined;
  if (p.array) {
    const items: Record<string, unknown> = { type: p.kind };
    if (enumValues !== undefined) items.enum = enumValues;
    const schema: Record<string, unknown> = { type: "array", items };
    if (p.description !== "") schema.description = p.description;
    return schema;
  }
  const base: Record<string, unknown> = { type: p.kind };
  if (p.description !== "") base.description = p.description;
  if (enumValues !== undefined) base.enum = enumValues;
  const value = defaultToJson(p);
  if (value !== undefined) base.default = value;
  return base;
}

/**
 * Render a descriptor parameter's string default back to its JSON-typed value,
 * or `undefined` when it does not match the declared kind (a malformed default
 * from an untrusted descriptor is dropped so the advertised schema stays valid).
 */
function defaultToJson(p: CliParameterInfo): unknown {
  if (p.default === undefined) return undefined;
  if (p.kind === "boolean") {
    if (p.default === "true") return true;
    return p.default === "false" ? false : undefined;
  }
  if (p.kind === "number") {
    const n = Number(p.default);
    return Number.isFinite(n) ? n : undefined;
  }
  return p.default;
}

/** A human phrase for a parameter's expected JSON type, used in error messages. */
function describeType(p: CliParameterInfo): string {
  const base = p.array ? `an array of ${p.kind}` : `a ${p.kind}`;
  return p.options.length > 0 ? `${base} in {${p.options.join(", ")}}` : base;
}

/** Whether `value` is a scalar of `kind` (and within `options`, when set). */
function scalarOk(
  value: unknown,
  kind: "string" | "number" | "boolean",
  options: readonly string[],
): value is string | number | boolean {
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === "string" &&
    (options.length === 0 || options.includes(value));
}

/**
 * Coerce a supplied JSON value to the CLI string a parameter parses, or `null`
 * when its shape/type is wrong. An array parameter requires a JSON array of
 * matching scalars (a bare scalar is rejected — the mismatch the requirement
 * calls out); every other parameter requires a single matching scalar. The
 * result is joined the way the child's parser splits an array (on commas).
 */
function coerceParamValue(value: unknown, p: CliParameterInfo): string | null {
  if (p.array) {
    if (!Array.isArray(value)) return null;
    const parts: string[] = [];
    for (const element of value) {
      if (!scalarOk(element, p.kind, p.options)) return null;
      parts.push(String(element));
    }
    return parts.join(",");
  }
  return scalarOk(value, p.kind, p.options) ? String(value) : null;
}

/**
 * Validate supplied tool arguments against the build's declared parameters and
 * turn them into `--flag=value` child arguments. Returns the forward argv, or
 * the list of offending `name (why)` descriptions when any value is the wrong
 * type or names an unknown parameter — so the caller can reject before spawning.
 */
function validateParamArgs(
  args: Record<string, unknown>,
  parameters: readonly CliParameterInfo[],
): { argv: string[] } | { errors: string[] } {
  const byName = new Map(parameters.map((p) => [p.name, p]));
  const argv: string[] = [];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (CONTROL_KEYS.has(key)) continue;
    const param = byName.get(key);
    if (param === undefined) {
      errors.push(`${key} (unknown parameter)`);
      continue;
    }
    const coerced = coerceParamValue(value, param);
    if (coerced === null) {
      errors.push(`${key} (expected ${describeType(param)})`);
    } else argv.push(`--${param.flag}=${coerced}`);
  }
  return errors.length > 0 ? { errors } : { argv };
}

/**
 * `root` plus every target it transitively depends on, read from a registered
 * build's declared surface. A dependency the surface does not carry is skipped:
 * the descriptor is the only graph available to the registry host, and the
 * spawned child resolves the real one itself — so this is a conservative view
 * of what a run will touch, never an authoritative plan.
 */
function closureOf(
  targets: readonly CliTargetInfo[],
  root: string,
): string[] {
  const byName = new Map(targets.map((t) => [t.name, t]));
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    for (const dep of byName.get(name)?.dependsOn ?? []) stack.push(dep);
  }
  return [...seen];
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
  readonly #authenticator?: McpAuthenticator;
  readonly #readEnv: (name: string) => string | undefined;
  readonly #runner: RegistryRunner;
  readonly #maxConcurrentRuns: number;
  /**
   * Requests may be handled concurrently: each run tool spawns its own
   * subprocess and read tools only hit the CAS store, so there is no shared
   * in-process run state to serialise (unlike the single-build server).
   */
  readonly concurrent = true;
  /** Run-tool spawns currently in flight, capped by {@link #maxConcurrentRuns}. */
  #inFlightRuns = 0;
  /** The connecting client's `initialize` name, a low-priority audit actor. */
  #clientLabel?: string;
  /** The audit trail, opened lazily on the first audited call. */
  #trail?: AuditTrail;

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
    this.#authenticator = options.authenticator;
    this.#readEnv = options.readEnv ?? (() => undefined);
    this.#version = options.version ?? "0.0.0";
    this.#runner = options.runner ?? defaultRegistryRunner;
    this.#maxConcurrentRuns = options.maxConcurrentRuns ??
      DEFAULT_MAX_CONCURRENT_RUNS;
  }

  /**
   * Handle one parsed JSON-RPC message. Returns the response to send, or `null`
   * for a notification (which takes no reply).
   */
  handleMessage(
    message: unknown,
    ctx: McpRequestContext = EMPTY_CONTEXT,
    identity?: ResolvedIdentity,
  ): Promise<JsonRpcResponse | null> {
    // `tools/list` reads the registry live (a hosted backend can throw on a
    // transient fault or a malformed descriptor); the shared dispatcher guards
    // it, and `tools/call`, so one hiccup returns an error instead of tearing
    // down the transport for every client.
    return dispatchMessage(message, ctx, {
      authenticator: this.#authenticator,
      initialize: (params) => this.#initialize(params),
      tools: () => this.tools(),
      callTool: (id, params, caller) => this.#callTool(id, params, caller),
    }, identity);
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
            this.#runTool(
              summary.id,
              target.name,
              target.description,
              loaded.descriptor.surface.parameters,
              loaded.descriptor.surface.targets,
            ),
          );
        }
      }
    }
    return tools;
  }

  /**
   * Whether spawning `buildId:target` would run any protected target — the one
   * named, or anything in its declared dependency closure. Spawning a target
   * runs its dependencies in the child process, so protection has to be checked
   * across the plan; gating only the named target leaves every protected target
   * reachable through an unprotected dependent.
   */
  #planTouchesProtected(
    buildId: string,
    targets: readonly CliTargetInfo[],
    root: string,
  ): boolean {
    return closureOf(targets, root)
      .some((name) => this.#isProtected(`${buildId}:${name}`));
  }

  /** Build the `run:<buildId>:<target>` tool definition. */
  #runTool(
    buildId: string,
    target: string,
    description: string,
    parameters: readonly CliParameterInfo[],
    targets: readonly CliTargetInfo[],
  ): McpTool {
    const qualified = `${buildId}:${target}`;
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];
    // The build's declared parameters come first, keyed by property name (the
    // key a tool call supplies), then the reserved execution controls.
    for (const param of parameters) {
      properties[param.name] = schemaForParam(param);
      if (param.required) required.push(param.name);
    }
    properties.dryRun = DRY_RUN_PROPERTY;
    if (this.#planTouchesProtected(buildId, targets, target)) {
      properties.operatorToken = OPERATOR_TOKEN_PROPERTY;
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
   * The `initialize` result, and the side effect of remembering the client's
   * self-reported name as a low-priority audit actor (an untrusted label, never
   * an authorization input).
   */
  #initialize(params: unknown): Record<string, unknown> {
    const { result, clientLabel } = negotiateInitialize(params, this.#version);
    if (clientLabel !== undefined) this.#clientLabel = clientLabel;
    return result;
  }

  /** Dispatch a `tools/call`, attributed to `identity` (the resolved caller). */
  async #callTool(
    id: string | number | null,
    params: unknown,
    identity: ResolvedIdentity | undefined,
  ): Promise<JsonRpcResponse> {
    const call = toolCall(params);
    if ("error" in call) return err(id, INVALID_PARAMS, call.error);
    const { name, args } = call;

    if (name === "list_builds") {
      return ok(id, textResult(await this.#listBuilds()));
    }
    if (name === "describe_build") {
      return ok(id, await this.#describeBuild(args));
    }
    if (name.startsWith(RUN_PREFIX)) {
      return await this.#run(id, name.slice(RUN_PREFIX.length), args, identity);
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
    identity: ResolvedIdentity | undefined,
  ): Promise<JsonRpcResponse> {
    const runName = `${RUN_PREFIX}${qualified}`;
    const actor = identity?.actor ?? this.#resolveActor();
    if (!this.#allowRun) {
      await this.#audit(runName, args, "denied", actor, "run_disabled");
      return ok(id, runDisabledResult("--registry --allow-run"));
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
      await this.#audit(runName, args, "denied", actor, "not_allowed");
      return ok(id, textResult(`Unknown tool: ${runName}`, true));
    }

    // The build's declared parameter names — the only argument keys whose values
    // are safe to record in the audit trail from here on.
    const knownParams = new Set(
      loaded.descriptor.surface.parameters.map((p) => p.name),
    );

    if (
      this.#planTouchesProtected(
        buildId,
        loaded.descriptor.surface.targets,
        target,
      )
    ) {
      const denial = operatorTokenDenial(args, this.#operatorToken);
      if (denial !== null) {
        await this.#audit(runName, args, "denied", actor, denial, knownParams);
        return ok(id, unauthorizedResult(runName, denial));
      }
    }

    // Validate the supplied parameters against the descriptor and turn them into
    // child `--flag=value` arguments — before any spawn, so a type mismatch is a
    // clean tool error rather than a subprocess that fails on bad input.
    const validated = validateParamArgs(
      args,
      loaded.descriptor.surface.parameters,
    );
    if ("errors" in validated) {
      await this.#audit(
        runName,
        args,
        "error",
        actor,
        "invalid_arguments",
        knownParams,
      );
      return ok(
        id,
        textResult(
          `Invalid argument(s): ${validated.errors.join("; ")}.`,
          true,
        ),
      );
    }

    // Where the descriptor says the build lives is as much an authorization
    // question as which target it names: a registry a second party can write to
    // could point the launch at code fetched from the network. Checked before
    // the confirmation prompt, so a refused location fails fast rather than
    // asking the operator to confirm a spawn that will never happen.
    const denial = launchDenial(loaded.descriptor.location, this.#readEnv);
    if (denial !== null) {
      await this.#audit(
        runName,
        args,
        "denied",
        actor,
        denial.reason,
        knownParams,
      );
      return ok(
        id,
        textResult(
          JSON.stringify(
            {
              error: denial.reason,
              tool: runName,
              hint: denial.detail,
            },
            null,
            2,
          ),
          true,
        ),
      );
    }

    const dryRun = args.dryRun === true;
    // Unlike the in-process server, a spawn can't enforce dry-run — `--dry-run`
    // is only appended to the child argv, and a command-form wrapper may ignore
    // it and execute for real. So confirmation is required before *any* spawn,
    // dry run included; it is not exempt the way an in-process dry run is.
    if (this.#confirmDestructive && args.confirm !== true) {
      return ok(
        id,
        confirmationResult(
          runName,
          "Re-call with confirm:true to spawn this target.",
        ),
      );
    }

    const launch = this.#launch(
      loaded.descriptor.location,
      target,
      dryRun,
      validated.argv,
    );
    if (launch.argv.length === 0 || launch.argv[0] === "") {
      await this.#audit(
        runName,
        args,
        "error",
        actor,
        "no_launch_command",
        knownParams,
      );
      return ok(
        id,
        textResult(
          `Registered build "${buildId}" has no runnable launch command.`,
          true,
        ),
      );
    }

    // Concurrency cap: refuse a spawn past the limit immediately with a
    // structured busy error, rather than queueing it. The check and the
    // increment are adjacent (no await between), so two concurrent calls can
    // never both claim the last slot. Read tools never reach here.
    if (this.#inFlightRuns >= this.#maxConcurrentRuns) {
      await this.#audit(
        runName,
        args,
        "denied",
        actor,
        "at_capacity",
        knownParams,
      );
      return ok(
        id,
        textResult(
          JSON.stringify(
            {
              error: "at_capacity",
              tool: runName,
              running: this.#inFlightRuns,
              cap: this.#maxConcurrentRuns,
              hint:
                "The registry server is at its concurrent-run cap; retry shortly.",
            },
            null,
            2,
          ),
          true,
        ),
      );
    }

    this.#inFlightRuns++;
    let result: RegistryRunResult;
    try {
      result = await this.#runner(launch.argv, launch.cwd, {
        actor,
        actorKind: identity?.kind,
        actorRoles: identity?.roles,
      });
    } catch (error) {
      await this.#audit(
        runName,
        args,
        "error",
        actor,
        "spawn_failed",
        knownParams,
      );
      const kind = error instanceof Error ? error.name : "Error";
      return ok(
        id,
        textResult(`Failed to spawn ${qualified} (${kind}).`, true),
      );
    } finally {
      this.#inFlightRuns--;
    }
    await this.#audit(
      runName,
      args,
      result.code === 0 ? "ok" : "error",
      actor,
      undefined,
      knownParams,
    );
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
    params: readonly string[],
  ): { argv: string[]; cwd: string } {
    const trailing = [target, ...params, ...(dryRun ? ["--dry-run"] : [])];
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

  /** Resolve the actor for audited calls: --actor → env → the client label. */
  #resolveActor(): string {
    return resolveActor(this.#actor, this.#readEnv, [this.#clientLabel]);
  }

  /**
   * Append a tool call to the audit log (best-effort; never breaks a call).
   * No-op without a store. Only the values of recognised, non-secret arguments
   * ({@link known} parameters plus the safe control flags) are recorded — the
   * operator token is dropped, and any unrecognised key's value is elided, so a
   * value mistakenly supplied under a `.secret()` parameter's name (a secret is
   * absent from the descriptor, hence "unknown") never reaches the durable trail.
   */
  async #audit(
    tool: string,
    args: Record<string, unknown>,
    outcome: RunEventOutcome,
    actor: string,
    detail?: string,
    known: ReadonlySet<string> = EMPTY_NAMES,
  ): Promise<void> {
    const store = this.#store;
    if (store === undefined) return;
    const event: RunEvent = {
      at: new Date().toISOString(),
      tool,
      actor,
      outcome,
      args: auditArgs(args, known),
    };
    if (detail !== undefined) event.detail = detail;
    this.#trail ??= new AuditTrail(store);
    await this.#trail.append(event);
  }
}

/** An empty name set — the default when a call is audited before params resolve. */
const EMPTY_NAMES: ReadonlySet<string> = new Set();

/**
 * Sanitise tool arguments for the audit log. The operator token is dropped
 * entirely; the value of a **recognised** argument — a declared parameter in
 * `known`, or a safe control flag (`dryRun`/`confirm`) — is stringified and
 * recorded (build parameters name the deploy's repos, slots, etc. — the point
 * of the audit trail). Any other key keeps its name but has its value elided to
 * `"<omitted>"`, so a value mistakenly supplied under a secret parameter's name
 * (a secret is absent from the descriptor, so it reads as an unknown key) is
 * never written verbatim to the durable trail.
 */
function auditArgs(
  args: Record<string, unknown>,
  known: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "operatorToken") continue;
    if (!known.has(key) && !AUDIT_SAFE_KEYS.has(key)) {
      out[key] = "<omitted>";
      continue;
    }
    out[key] = auditText(value);
  }
  return out;
}
