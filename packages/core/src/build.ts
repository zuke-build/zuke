/**
 * The {@link Build} base class and target discovery.
 *
 * Users extend `Build` and declare targets as instance properties. After the
 * subclass is constructed, {@link discoverTargets} introspects the instance's
 * own enumerable properties to find every {@link TargetBuilder} and bind it to
 * its property name. Discovery recurses into plain object fields, so a reusable
 * **component** — a function returning a bundle of targets — contributes its
 * targets under a dotted path (e.g. `release.publish`).
 */

import { Group, type Remediation, TargetBuilder } from "./target.ts";
import type { OrderingEdge } from "./graph.ts";
import type { RemoteCacheStore } from "./remote_cache.ts";
import type { StateStore } from "./state/store.ts";
import type { BuildRegistry } from "./registry/registry.ts";
import type { McpIdentityHook } from "./mcp/jsonrpc.ts";

/** Whether a value is a plain object (a component bundle), not a class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Visit every field of a build, recursing into plain object fields (component
 * bundles). Each field is reported with its dotted path (`a`, `a.b`, …).
 */
export function forEachField(
  root: object,
  visit: (path: string, value: unknown) => void,
): void {
  const seen = new WeakSet<object>();
  const walk = (obj: object, prefix: string) => {
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      visit(path, value);
      if (isPlainObject(value)) walk(value, path);
    }
  };
  walk(root, "");
}

/**
 * The outcome of a single target, reported in the summary and lifecycle hooks.
 * `waiting` marks a `.waitsFor(...)` gate whose event has not occurred — the run
 * suspends there.
 */
export type TargetStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "cached"
  | "waiting";

/** Result passed to the {@link Build.onFinish} lifecycle hook. */
export interface BuildResult {
  /** Whether every executed target succeeded (also `true` for a suspended run). */
  ok: boolean;
  /** Names of the targets that ran, in execution order. */
  executed: string[];
  /** The error that aborted the run, if any. */
  error?: unknown;
  /**
   * True when the run **suspended** at a `.waitsFor(...)` gate rather than
   * finishing — its state is saved and it can be resumed later. The process
   * still exits 0.
   */
  suspended?: boolean;
  /**
   * True when the run was **cancelled** (via `options.signal` / Ctrl-C, or by
   * another process running `zuke cancel`) rather than failing on its own.
   * Its compensations have run and the record is `cancelled`. `ok` is `false`.
   */
  cancelled?: boolean;
  /**
   * The run's id, when a run identity was established (always, in practice —
   * every {@link "./executor.ts".execute} generates one). Lets the caller point
   * a follow-up (`zuke runs show`, `zuke cancel`) at this run.
   */
  runId?: string;
}

/**
 * Base class for user-defined builds. Provides no targets of its own; subclasses
 * declare targets as properties. Optionally override the lifecycle hooks.
 */
export class Build {
  /** Called once before any target runs. */
  onStart(): void | Promise<void> {}

  /** Called once after the run completes (success or failure). */
  onFinish(_result: BuildResult): void | Promise<void> {}

  /** Called just before a target's body executes (not for skipped/cached). */
  onTargetStart(_name: string): void | Promise<void> {}

  /** Called after each target settles, with its final status. */
  onTargetEnd(_name: string, _status: TargetStatus): void | Promise<void> {}

  /**
   * Remediations applied to **every** target, running after each target's own
   * {@link "./target.ts".TargetBuilder.recoverWith} when its body fails. Override
   * to attach a global AI fixer once instead of repeating it per target; the
   * default is none. Both styles compose — a target's own remediations run
   * first, then these.
   *
   * ```ts
   * class CI extends Build {
   *   key = parameter("OpenAI API key").secret();
   *   override recoverWith() {
   *     return [aiFixer((f) => f.provider("openai").apiKey(this.key))];
   *   }
   *   lint = target().executes(() => DenoTasks.lint()); // healed globally
   * }
   * ```
   */
  recoverWith(): Remediation[] {
    return [];
  }

  /**
   * The {@link "./remote_cache.ts".RemoteCacheStore} that shares target
   * {@link "./target.ts".TargetBuilder.outputs} across machines. Override to
   * declare one in code; the default is none, and — unless overridden — the
   * executor falls back to {@link "./remote_cache.ts".envCacheStore} (the
   * `ZUKE_REMOTE_CACHE_*` environment variables). Applies to targets that
   * declare both `inputs` and `outputs`.
   *
   * ```ts
   * class CI extends Build {
   *   override remoteCache() {
   *     return new HttpCacheStore({ url: this.cacheUrl.value, token: this.cacheToken.value });
   *   }
   *   build = target().inputs("src").outputs("dist").executes(...);
   * }
   * ```
   */
  remoteCache(): RemoteCacheStore | undefined {
    return undefined;
  }

  /**
   * The {@link "./state/store.ts".StateStore} that persists this build's run
   * records. Override to declare one in code; the default is none, and — unless
   * overridden — the executor falls back to the `ZUKE_STATE_URL` /
   * `ZUKE_STATE_DIR` environment variables, then (only when the run opts into
   * durable state) a filesystem store under `<root>/.zuke/runs`.
   *
   * ```ts
   * class CD extends Build {
   *   override stateStore() {
   *     return new HttpStateStore({ url: this.stateUrl.value, token: this.stateToken.value });
   *   }
   *   deploy = target().executes(async (ctx) => { await ctx.state.set({ at: "sit-7" }); });
   * }
   * ```
   */
  stateStore(): StateStore | undefined {
    return undefined;
  }

  /**
   * Extra **soft ordering edges** to impose on the plan, beyond the `dependsOn`
   * / `before` / `after` declared on targets. Override to feed an external graph
   * — e.g. a monorepo's `dependency-graph.json` — into scheduling without wiring
   * every edge by hand. Return `[before, after]` pairs from the passed
   * `targets` map (keyed by dotted name); each means `before` runs before
   * `after`. Edges whose endpoints are not both in a run's execution set are
   * ignored, and a cycle is reported with the usual friendly error.
   *
   * These are **execution-ordering** edges. Like `.before()` / `.after()`, they
   * are *not* reflected in CI generated by `cicd()` — a fan-out job's `needs:`
   * mirrors hard `dependsOn` only — so an ordering that CI must also honour has
   * to be expressed as a `dependsOn`, not a soft edge.
   *
   * ```ts
   * class Monorepo extends Build {
   *   web = target().executes(...);
   *   api = target().executes(...);
   *   override extraEdges(t: Map<string, Target>) {
   *     // `api` must build before `web`, per the external dependency graph.
   *     const edges: OrderingEdge[] = [];
   *     const api = t.get("api"), web = t.get("web");
   *     if (api && web) edges.push([api, web]);
   *     return edges;
   *   }
   * }
   * ```
   */
  extraEdges(_targets: Map<string, TargetBuilder>): OrderingEdge[] {
    return [];
  }

  /**
   * The {@link "./registry/registry.ts".BuildRegistry} this build registers
   * itself in (`zuke register`) and that a registry-backed `zuke mcp` server
   * discovers pipelines from. Override to declare one in code; the default is
   * none, and — unless overridden — the resolution falls back to the
   * `ZUKE_REGISTRY_URL` / `ZUKE_REGISTRY_DIR` environment variables, then (for
   * `zuke register`) a filesystem registry under `<root>/.zuke/builds`. Kept a
   * separate concern from {@link stateStore} (a run history and a build catalog
   * are different things), so a consumer can host a richer catalog as a plugin.
   *
   * ```ts
   * class CD extends Build {
   *   override registry() {
   *     return new HttpBuildRegistry({ url: this.registryUrl.value, token: this.registryToken.value });
   *   }
   * }
   * ```
   */
  registry(): BuildRegistry | undefined {
    return undefined;
  }

  /**
   * A per-request identity hook for `zuke mcp` — resolve a **trusted** caller
   * from the request context (an authenticating reverse proxy's header) so a
   * shared, multi-user server attributes each call to the real engineer rather
   * than a client-self-reported label. When set, the resolved actor overrides
   * `--actor`, the environment, and the client label for that call, and flows to
   * the audit trail, run records, lock holders, and (for a registry-spawned
   * build) the child's `ZUKE_ACTOR`; a throwing hook rejects the request before
   * anything runs. Default: none — stdio/local use is unchanged.
   *
   * ```ts
   * class ControlPlane extends Build {
   *   override mcpIdentity() {
   *     return (ctx: McpRequestContext) => {
   *       // The proxy strips any client copy of this header and injects its own.
   *       const sub = ctx.headers.get("x-forwarded-user");
   *       if (!sub) throw new Error("no identity from proxy");
   *       return { actor: sub, via: "oauth-proxy" };
   *     };
   *   }
   * }
   * ```
   */
  mcpIdentity(): McpIdentityHook | undefined {
    return undefined;
  }
}

/**
 * Discover all targets declared on a build instance.
 *
 * Scans the instance's fields (recursing into plain-object component bundles)
 * for {@link TargetBuilder} values, assigns each its dotted property path, and
 * returns a name → target map preserving declaration order.
 *
 * @throws if two properties reference the same builder instance under different
 *   names (a programming error that would corrupt naming).
 */
export function discoverTargets(build: Build): Map<string, TargetBuilder> {
  const targets = new Map<string, TargetBuilder>();
  forEachField(build, (path, value) => {
    if (value instanceof TargetBuilder) {
      if (value.name_ !== undefined && value.name_ !== path) {
        throw new Error(
          `Target instance is bound to two names: "${value.name_}" and "${path}". ` +
            `Each target() must be assigned to exactly one property.`,
        );
      }
      value.name_ = path;
      targets.set(path, value);
    }
  });
  return targets;
}

/**
 * Discover all parallel {@link Group} batches declared on a build instance,
 * binding each its property path (for labelling, e.g. in the graph). Groups
 * that are not assigned to a build property simply stay unnamed.
 */
export function discoverGroups(build: Build): Map<string, Group> {
  const groups = new Map<string, Group>();
  forEachField(build, (path, value) => {
    if (value instanceof Group) {
      value.name_ = path;
      groups.set(path, value);
    }
  });
  return groups;
}
