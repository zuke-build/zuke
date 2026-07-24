/**
 * Target authoring API: the `target()` fluent builder, the `group()` parallel
 * batch, and the `Target` type.
 *
 * A target is declared as a class property on a {@link Build} subclass:
 *
 * ```ts
 * compile = target()
 *   .description("Type-check and build")
 *   .dependsOn(this.clean, this.restore)
 *   .executes(async () => { await $`deno check mod.ts`; });
 * ```
 *
 * Dependencies are declared by passing sibling target *references*
 * (`this.clean`), not strings. The framework maps each builder back to its
 * property name during discovery (see {@link Build}).
 *
 * Targets join a parallel batch with {@link TargetBuilder.partOf}; the
 * {@link group} they belong to runs its members concurrently (even in a
 * sequential build) and can itself be a dependency:
 *
 * ```ts
 * checks = group();
 * lint = target().dependsOn(this.clean).partOf(this.checks).executes(...);
 * format = target().dependsOn(this.clean).partOf(this.checks).executes(...);
 * deploy = target().dependsOn(this.checks).executes(...); // waits for the batch
 * ```
 */

import type { PathLike } from "./path.ts";
import type { AnyParameter } from "./params.ts";
import type { Configure } from "./tooling.ts";
import { type LockHolder, lockKey } from "./state/lock.ts";
import type { WaitTrigger } from "./wait.ts";
import type { SignalRecord } from "./state/types.ts";

/**
 * Fluent configuration for {@link TargetBuilder.lock}, in the settings-lambda
 * style: `.lock((s) => s.lockKey("deploy", repo).withTtl("4h"))`. Set the key
 * (composed from sanitised parts with {@link LockSettings.lockKey}, or directly
 * with {@link LockSettings.key}), the {@link LockSettings.withTtl | TTL}, and an
 * optional {@link LockSettings.onConflict} message. The lambda runs after
 * parameters resolve, so the key may read `this.<param>.value`.
 */
export class LockSettings {
  /** The resolved lock key; set by {@link key} or {@link lockKey}. */
  key_?: string;
  /** The TTL (a duration string or milliseconds); set by {@link withTtl}. */
  ttl_?: string | number;
  /** The conflict-guidance renderer; set by {@link onConflict}. */
  onConflict_?: (holder: LockHolder) => string;

  /**
   * Set the lock key from parts, sanitised and joined via
   * {@link "./state/lock.ts".lockKey} — e.g. `s.lockKey("deploy", repo)`.
   */
  lockKey(...parts: Array<string | number>): this {
    this.key_ = lockKey(...parts);
    return this;
  }

  /** Set the lock key directly (must be filename-safe; prefer {@link lockKey}). */
  key(key: string): this {
    this.key_ = key;
    return this;
  }

  /**
   * How long the lock survives a killed holder — a duration string like `"4h"`
   * / `"30m"` (see the duration parser) or raw milliseconds. A live holder
   * renews it while it runs, so it never expires under it.
   */
  withTtl(ttl: string | number): this {
    this.ttl_ = ttl;
    return this;
  }

  /**
   * Render the guidance shown to a run that loses the lock. Receives the
   * current {@link "./state/lock.ts".LockHolder}; the returned string becomes
   * the failure message. Defaults to a generic "held by … then retry" line.
   */
  onConflict(render: (holder: LockHolder) => string): this {
    this.onConflict_ = render;
    return this;
  }
}

/** What a timed-out wait does — resolved from {@link WaitSettings.onTimeout}. */
export type OnTimeout = () => TargetBuilder | "fail" | "cancel-run";

/**
 * A compensation registered with {@link TargetBuilder.onCancel}: either a
 * sibling target directly, or a thunk returning one. The thunk form defers
 * evaluation so a compensation declared *below* the target it cleans up (class
 * fields initialise top-to-bottom) can still be referenced.
 */
export type OnCancel = TargetBuilder | (() => TargetBuilder);

/**
 * Fluent configuration for {@link TargetBuilder.waitsFor}:
 * `.waitsFor((s) => s.on(externalSignal("approved")).timeout("72h"))`. Set the
 * {@link WaitSettings.on | trigger}, an optional {@link WaitSettings.timeout},
 * and an optional {@link WaitSettings.onTimeout} disposition. The lambda runs
 * when the target is reached, so the trigger may read `this.<param>.value`.
 */
export class WaitSettings {
  /** The trigger deciding when the wait is satisfied; set by {@link on}. */
  trigger_?: WaitTrigger;
  /** The deadline duration (string or ms); set by {@link timeout}. */
  timeout_?: string | number;
  /** The timeout disposition thunk; set by {@link onTimeout}. */
  onTimeout_?: OnTimeout;

  /** Set the {@link "./wait.ts".WaitTrigger} the wait is satisfied by. */
  on(trigger: WaitTrigger): this {
    this.trigger_ = trigger;
    return this;
  }

  /** Give the wait a deadline (a duration like `"72h"` or milliseconds). */
  timeout(duration: string | number): this {
    this.timeout_ = duration;
    return this;
  }

  /**
   * What to do when the deadline passes: a thunk returning a sibling
   * compensation target (a thunk, so it can reference a target declared *below*
   * this one), or the string `"fail"` / `"cancel-run"`. Defaults to `"fail"`.
   */
  onTimeout(disposition: OnTimeout): this {
    this.onTimeout_ = disposition;
    return this;
  }
}

/**
 * Fluent configuration for {@link TargetBuilder.forEach}, in the settings-lambda
 * style: `.forEach(items, factory, (s) => s.concurrency(3).continueOnItemFailure())`.
 * Sets the {@link ForEachSettings.concurrency | concurrency} cap and whether one
 * item's failure isolates it or stops the whole batch.
 */
export class ForEachSettings {
  /** Max item pipelines in flight at once; set by {@link concurrency}. */
  concurrency_?: number;
  /** Isolate a failed item from its siblings; set by {@link continueOnItemFailure}. */
  continueOnItemFailure_ = false;

  /**
   * Cap how many item pipelines run concurrently (default: the host CPU count).
   * Clamped to at least 1; `1` runs items one at a time.
   */
  concurrency(limit: number): this {
    this.concurrency_ = Math.max(1, Math.floor(limit));
    return this;
  }

  /**
   * Keep running the other items when one item's pipeline fails (the failed
   * item's later stages are still skipped). The fan-out target still fails at
   * the end if any item failed. Without this, the first item failure stops the
   * batch — the default.
   */
  continueOnItemFailure(on = true): this {
    this.continueOnItemFailure_ = on;
    return this;
  }
}

/**
 * Builds one item's ordered pipeline of sub-targets for {@link TargetBuilder.forEach}.
 * The returned record's keys are stage names and its values are targets; each
 * stage implicitly depends on the one declared before it, so an item's stages
 * run in insertion order.
 */
export type ForEachFactory<Item> = (
  item: Item,
  index: number,
) => Record<string, TargetBuilder>;

/** One materialised fan-out item: a unique label plus its pipeline stages. */
export interface ForEachItem {
  /** A label unique within the fan-out, used to name the item's sub-targets. */
  key: string;
  /** The item's ordered pipeline stages, keyed by stage name. */
  stages: Record<string, TargetBuilder>;
}

/**
 * The internal fan-out spec stored by {@link TargetBuilder.forEach}. Its
 * {@link ForEachSpec.materialize} closure captures the item type, so the runtime
 * list and factory are erased to concrete {@link ForEachItem}s the executor can
 * run without knowing the item type.
 */
export interface ForEachSpec {
  /** Produce the per-item sub-target pipelines from the runtime list. */
  materialize: () => ForEachItem[];
  /** Optional fan-out settings (concurrency, per-item failure isolation). */
  configure?: Configure<ForEachSettings>;
}

/** A stable label for a fan-out item: the value itself if scalar, else its index. */
function itemKey(item: unknown, index: number): string {
  if (typeof item === "string") return item;
  if (typeof item === "number" || typeof item === "boolean") {
    return String(item);
  }
  return String(index);
}

/**
 * A JSON-serialisable value — the only thing that may be persisted in a
 * target's {@link TargetStateHandle}, since run state is stored as JSON.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A target's durable, per-target metadata, surfaced on {@link TargetContext} as
 * `state`. Writes are persisted to the run's state store (see
 * {@link "./state/store.ts".StateStore}) and are visible to later runs — e.g. a
 * resuming process reading what a suspended target recorded. When no store is
 * configured, the handle is an in-memory no-op scoped to the current run.
 *
 * **Never store a secret here** — state is persisted in plain JSON and read
 * back by later runs and by `zuke runs show`.
 */
export interface TargetStateHandle {
  /** Merge a JSON patch into this target's persisted metadata (awaits the write). */
  set(patch: Record<string, JsonValue>): Promise<void>;
  /** Read this target's persisted metadata (from prior attempts/runs too). */
  get(): Record<string, JsonValue>;
}

/**
 * The context passed to every target body. Optional to receive — an existing
 * zero-argument `.executes(() => …)` stays valid, since a zero-argument
 * function is assignable to this one-parameter type — but a body that wants the
 * run's identity, a cancellation signal, or durable per-target state reads them
 * here.
 */
export interface TargetContext {
  /** Unique ID of this run, stable for every target in the run. */
  readonly runId: string;
  /** Dotted name of the executing target. */
  readonly target: string;
  /**
   * Aborted when the run is cancelled (see {@link "./executor.ts".ExecuteOptions}
   * `signal`). Pass it to a shell command's `.signal()` to have that command
   * terminated on cancellation; the executor also applies it as the shell's
   * ambient default, so a plain `$` in the body is terminated too.
   */
  readonly signal: AbortSignal;
  /**
   * Durable per-target metadata. Persisted to the run's state store when one is
   * configured (see {@link "./state/store.ts".StateStore}), and an in-memory
   * no-op otherwise. The carrier for state that must survive across a
   * suspend/resume boundary — do not put secrets in it.
   */
  readonly state: TargetStateHandle;
  /**
   * The durable state handle of **another target** in this run — the seam a body
   * reads a dependency's published metadata through (e.g. the result a
   * `.waitsFor(githubWorkflow(...))` gate recorded to its state). `stateOf(this
   * target)` is equivalent to {@link state}. It reads the run's **current**
   * record, so it sees writes a dependency made earlier in the run — including
   * across a suspend/resume, since the record is durable.
   */
  stateOf(target: string): TargetStateHandle;
  /**
   * Payloads of the external signals received so far, keyed by name (see
   * `.waitsFor(...)` and {@link "./wait.ts".externalSignal}). Empty until a
   * signal is delivered by `zuke resume <id> --signal <name>`.
   */
  readonly signals: ReadonlyMap<string, SignalRecord>;
  /** True when the run is a dry run (bodies do not execute under a dry run). */
  readonly dryRun: boolean;
}

/**
 * The executable body of a target. May be synchronous or asynchronous, and any
 * returned value is ignored — so a body can return a tool-wrapper call directly
 * (`.executes(() => DenoTasks.lint())`, which resolves to a `CommandOutput`)
 * without wrapping it in an `async` block just to discard the result. A single
 * returned promise is awaited before dependents run; a returned *array* of
 * promises is not (it is not a thenable), so `await Promise.all([...])` inside
 * the body when you fan work out, rather than returning the array.
 */
export type TargetFn = (ctx: TargetContext) => unknown | Promise<unknown>;

/** A predicate gating whether a target runs; may be synchronous or async. */
export type Condition = () => boolean | Promise<boolean>;

/** Context passed to a {@link Validation} when it runs. */
export interface ValidationContext {
  /** The name of the target the validation is attached to. */
  target: string;
}

/**
 * A check plugged into a target with {@link TargetBuilder.validateBefore} or
 * {@link TargetBuilder.validateAfter}. The target decides *when* it runs; the
 * validation decides *what* it checks. Throw from {@link Validation.validate} to
 * fail the target (and break the build). Implemented, for example, by the AI
 * reviewers in `@zuke/ai`, but any object with a `validate` method qualifies.
 */
export interface Validation {
  /** A name for diagnostics (optional). */
  name?: string;
  /** Run the check; throw to fail the target. May be async. */
  validate(context: ValidationContext): void | Promise<void>;
}

/** Context passed to a {@link Remediation} after a target body fails. */
export interface RemediationContext {
  /** The name of the failed target. */
  target: string;
  /** The 1-based recovery attempt (the body has already failed `attempt` times). */
  attempt: number;
  /**
   * The failure being remediated. When a target fails through the shell this is
   * a `CommandError` carrying the failed command and its captured `stderr`.
   */
  error: unknown;
}

/** The outcome of one {@link Remediation} attempt. */
export interface RemediationResult {
  /**
   * Re-run the target body after this remediation? `true` asks the executor to
   * retry (the remediation changed something — e.g. applied a fix); `false`
   * leaves the failure standing (e.g. a diagnose-only remediation that only
   * explained the failure).
   */
  retry: boolean;
  /** A one-line description of what was diagnosed or done, for diagnostics. */
  summary?: string;
}

/**
 * A recovery step plugged into a target with {@link TargetBuilder.recoverWith}.
 * It runs **only after the target body fails**, receives the failure, and may
 * attempt to repair it — returning `{ retry: true }` to ask the executor to
 * re-run the body (the real build command is the verifier). Implemented, for
 * example, by the AI fixer in `@zuke/ai`, but any object with a `remediate`
 * method qualifies.
 */
export interface Remediation {
  /** A name for diagnostics (optional). */
  name?: string;
  /** Inspect (and optionally repair) the failure; report whether to retry. */
  remediate(
    context: RemediationContext,
  ): RemediationResult | Promise<RemediationResult>;
}

/**
 * A parallel batch of targets, created with {@link group}. Targets join it via
 * {@link TargetBuilder.partOf}; its members run concurrently with one another
 * (each still awaiting its own dependencies) regardless of the global parallel
 * setting. Passing a group to {@link TargetBuilder.dependsOn} depends on every
 * member at once.
 */
export class Group {
  /** Members that declared themselves part of this group, in declaration order. */
  readonly members_: TargetBuilder[] = [];
  /** Property name, assigned during discovery. Undefined until then. */
  name_?: string;
}

/**
 * The fluent builder returned by {@link target}. All configuration methods are
 * chainable and return `this`. A body (via {@link TargetBuilder.executes}) is
 * required before a target can be executed.
 */
export class TargetBuilder {
  /** Human-readable summary shown in `--list`. */
  description_?: string;
  /** Hard prerequisites: these run (transitively) before this target. */
  readonly dependsOn_: TargetBuilder[] = [];
  /** Soft ordering: this runs before the listed targets if both are planned. */
  readonly before_: TargetBuilder[] = [];
  /** Soft ordering: this runs after the listed targets if both are planned. */
  readonly after_: TargetBuilder[] = [];
  /** The target body. */
  fn_?: TargetFn;
  /** Property name, assigned during discovery. Undefined until then. */
  name_?: string;
  /** The parallel batch this target belongs to, if any (set by {@link partOf}). */
  group_?: Group;
  /** Input files/directories whose contents key the cache (set by {@link inputs}). */
  readonly inputs_: string[] = [];
  /** Output files/directories that must exist for a cache hit (set by {@link outputs}). */
  readonly outputs_: string[] = [];
  /** Conditions gating execution; all must hold or the target is skipped. */
  readonly onlyWhen_: Condition[] = [];
  /** Targets pulled in and run after this one (set by {@link triggers}). */
  readonly triggers_: TargetBuilder[] = [];
  /** Parameters that must be set for this target (set by {@link requires}). */
  readonly requires_: AnyParameter[] = [];
  /** Continue the build if this target fails (set by {@link proceedAfterFailure}). */
  proceedAfterFailure_ = false;
  /** Run even after the build has failed (set by {@link always}). */
  always_ = false;
  /** Hide this target from `--list`/`--help` (set by {@link unlisted}). */
  unlisted_ = false;
  /** Advertise this target as query-only over MCP (set by {@link readOnly}). */
  readOnly_ = false;
  /** Run this target's body under `--dry-run` with `$` echoed (set by {@link dryRunnable}). */
  dryRunnable_ = false;
  /** Extra cache-key contributors beyond input files (set by {@link cacheKey}). */
  readonly cacheKeys_: Array<() => string | Promise<string>> = [];
  /** Artifact paths this target produces (set by {@link produces}). */
  readonly produces_: string[] = [];
  /** When skipped by a condition, also skip dependencies (set by {@link whenSkipped}). */
  skipDependencies_ = false;
  /** Per-attempt timeout in milliseconds, if set by {@link timeout}. */
  timeout_?: number;
  /** Number of extra attempts on failure, set by {@link retry}. */
  retries_ = 0;
  /** Delay between retry attempts in milliseconds. */
  retryDelay_ = 0;
  /** Validations run before the body (set by {@link validateBefore}). */
  readonly validateBefore_: Validation[] = [];
  /** Validations run after the body (set by {@link validateAfter}). */
  readonly validateAfter_: Validation[] = [];
  /** Remediations run after the body fails (set by {@link recoverWith}). */
  readonly recoverWith_: Remediation[] = [];
  /** Max fix-then-rerun cycles when the body fails (set by {@link recoverAttempts}). */
  recoverAttempts_ = 1;
  /** Cross-run lock settings lambda, set by {@link lock} and run after params resolve. */
  lock_?: Configure<LockSettings>;
  /** External-event wait settings lambda, set by {@link waitsFor} and run when reached. */
  waitsFor_?: Configure<WaitSettings>;
  /** Fan-out spec, set by {@link forEach}: materialises per-item sub-target pipelines. */
  forEach_?: ForEachSpec;
  /** Compensation thunk, set by {@link onCancel}: runs on cancel iff this target succeeded. */
  onCancel_?: () => TargetBuilder;

  /** Set the human-readable description shown in `zuke --list`. */
  description(text: string): this {
    this.description_ = text;
    return this;
  }

  /**
   * Declare hard prerequisites. References sibling targets via `this.x`, or a
   * {@link group} (which expands to every member that has joined it).
   */
  dependsOn(...targets: Array<TargetBuilder | Group>): this {
    for (const t of targets) {
      if (t instanceof Group) this.dependsOn_.push(...t.members_);
      else this.dependsOn_.push(t);
    }
    return this;
  }

  /**
   * Join a parallel {@link group}. Members of the same group run concurrently
   * with one another (each still awaiting its own dependencies) even when the
   * build is otherwise sequential. Declare the group before the targets that
   * join it.
   */
  partOf(group: Group): this {
    // A forward reference is `undefined` here; ignore it (the group field
    // should be declared above the targets that join it).
    if (group !== undefined) {
      this.group_ = group;
      group.members_.push(this);
    }
    return this;
  }

  /**
   * Declare input files or directories (directories are hashed recursively).
   * A target with inputs is *incremental*: it is skipped (reported `cached`)
   * when its inputs are unchanged since the last successful run and all its
   * {@link outputs} still exist. Repeatable.
   */
  inputs(...paths: PathLike[]): this {
    this.inputs_.push(...paths.map(String));
    return this;
  }

  /**
   * Declare output files or directories. A cache hit also requires every output
   * to still exist, so deleting an output forces a rebuild. Repeatable.
   */
  outputs(...paths: PathLike[]): this {
    this.outputs_.push(...paths.map(String));
    return this;
  }

  /**
   * Run only when `condition` holds; otherwise the target is skipped (and its
   * dependents still run). The predicate may be async and can read resolved
   * parameters or the environment. Repeatable — all conditions must hold.
   *
   * ```ts
   * deploy = target()
   *   .onlyWhen(() => this.environment.value === "production")
   *   .executes(...);
   * ```
   */
  onlyWhen(condition: Condition): this {
    this.onlyWhen_.push(condition);
    return this;
  }

  /** Set the target body. May be async. */
  executes(fn: TargetFn): this {
    this.fn_ = fn;
    return this;
  }

  /** Run before the listed targets if both are in the plan (soft ordering). */
  before(...targets: TargetBuilder[]): this {
    this.before_.push(...targets);
    return this;
  }

  /** Run after the listed targets if both are in the plan (soft ordering). */
  after(...targets: TargetBuilder[]): this {
    this.after_.push(...targets);
    return this;
  }

  /**
   * Pull the listed targets into the plan and run them *after* this one. The
   * inverse of {@link dependsOn}: running this target triggers the others.
   */
  triggers(...targets: TargetBuilder[]): this {
    this.triggers_.push(...targets);
    return this;
  }

  /**
   * Declare this target as a prerequisite of the listed targets — the reverse
   * of {@link dependsOn}: each listed target gains this one as a dependency,
   * so this runs before them. Declare the listed targets above this one.
   */
  dependentFor(...targets: TargetBuilder[]): this {
    for (const t of targets) if (t !== undefined) t.dependsOn_.push(this);
    return this;
  }

  /**
   * Require that the given parameters resolve to a value before this target
   * runs; otherwise the target fails with a message naming the missing one.
   * Use it when a target needs a parameter that is optional build-wide.
   */
  requires(...params: AnyParameter[]): this {
    this.requires_.push(...params);
    return this;
  }

  /**
   * Keep running the rest of the build even if this target fails. The build
   * still reports failure, and this target's own dependents are skipped.
   */
  proceedAfterFailure(): this {
    this.proceedAfterFailure_ = true;
    return this;
  }

  /** Hide this target from `--list` and `--help` (it can still be run by name). */
  unlisted(): this {
    this.unlisted_ = true;
    return this;
  }

  /**
   * Mark this target **query-only** for MCP: its `run:` tool advertises MCP's
   * `readOnlyHint` instead of the default `destructiveHint`, and it is exempt
   * from `--confirm-destructive`. A hint about intent only — the target still
   * runs its real body — so declare it on targets that inspect rather than
   * mutate (a status check, a report).
   */
  readOnly(): this {
    this.readOnly_ = true;
    return this;
  }

  /**
   * Run this target even after the build has failed — for cleanup/teardown that
   * must happen regardless. It still waits for its own dependencies to complete;
   * the build's overall result is unchanged. Repeatable conditions/inputs apply.
   */
  always(): this {
    this.always_ = true;
    return this;
  }

  /**
   * Run this target's **body under `--dry-run`** instead of skipping it, with the
   * `$` shell in **echo mode**: each command (awaited or `.spawn()`ed) prints its
   * resolved argv and returns an empty success **without starting a process**.
   * Opt-in, because Zuke can only intercept `$`/{@link "./shell.ts".Command} —
   * any *other* side effect a body performs (writing a file, calling an API
   * directly) still happens under a dry run. Use it for bodies that are
   * shell-command orchestration, to preview the exact commands a real run would
   * execute. Without it, a dry run skips the body entirely (the default).
   *
   * Because an echoed command returns **empty stdout and exit code 0**, a body
   * whose *control flow or command arguments* depend on a command's output
   * (`await $\`git rev-parse HEAD\`.text()`, a `.code()` loop) should branch on
   * the {@link "./executor.ts".TargetContext} `dryRun` flag rather than trust the
   * echoed result.
   */
  dryRunnable(): this {
    this.dryRunnable_ = true;
    return this;
  }

  /**
   * Contribute an extra value to this target's cache fingerprint, beyond its
   * input files — e.g. a parameter value, tool version, or git commit. The
   * target is up-to-date only when its inputs *and* every cache key are
   * unchanged. The function may be async. Repeatable.
   *
   * ```ts
   * compile = target()
   *   .inputs("src")
   *   .cacheKey(() => this.configuration.value)
   *   .executes(...);
   * ```
   */
  cacheKey(fn: () => string | Promise<string>): this {
    this.cacheKeys_.push(fn);
    return this;
  }

  /** Declare artifact files/directories this target produces (metadata). */
  produces(...paths: PathLike[]): this {
    this.produces_.push(...paths.map(String));
    return this;
  }

  /**
   * Depend on the listed targets and consume their artifacts: equivalent to
   * {@link dependsOn} for ordering, expressing that this target uses what they
   * {@link produces}.
   */
  consumes(...targets: Array<TargetBuilder | Group>): this {
    return this.dependsOn(...targets);
  }

  /**
   * When this target is skipped by an {@link onlyWhen} condition, also skip its
   * dependencies that no other planned target needs. Because the dependencies
   * would otherwise run first, the condition is evaluated up front, so it must
   * not depend on state produced by other targets during the run.
   */
  whenSkipped(behavior: "run-dependencies" | "skip-dependencies"): this {
    this.skipDependencies_ = behavior === "skip-dependencies";
    return this;
  }

  /** Fail the target if its body runs longer than `ms` milliseconds (per attempt). */
  timeout(ms: number): this {
    this.timeout_ = ms;
    return this;
  }

  /**
   * Retry the target body up to `times` more attempts on failure, optionally
   * pausing `delayMs` between attempts. Combined with {@link timeout}, each
   * attempt is bounded by the timeout.
   */
  retry(times: number, delayMs = 0): this {
    this.retries_ = Math.max(0, Math.floor(times));
    this.retryDelay_ = Math.max(0, delayMs);
    return this;
  }

  /**
   * Run one or more {@link Validation}s *before* the target body. Each runs in
   * declaration order; the first to throw fails the target and the body never
   * runs. Repeatable. A cached/skipped target runs no validations.
   *
   * ```ts
   * deploy = target()
   *   .validateBefore(this.securityReview) // gate before deploying
   *   .executes(...);
   * ```
   */
  validateBefore(...validations: Validation[]): this {
    this.validateBefore_.push(...validations);
    return this;
  }

  /**
   * Run one or more {@link Validation}s *after* the target body completes
   * successfully. Each runs in declaration order; the first to throw fails the
   * target. Repeatable.
   */
  validateAfter(...validations: Validation[]): this {
    this.validateAfter_.push(...validations);
    return this;
  }

  /**
   * Attach one or more {@link Remediation}s that run **only if the body fails**.
   * Each is given the failure; if any returns `{ retry: true }`, the executor
   * re-runs the body and, when it now passes, the target succeeds. This is the
   * hook the AI fixer in `@zuke/ai` uses for self-healing builds. Repeatable.
   *
   * ```ts
   * test = target()
   *   .executes(() => DenoTasks.test((s) => s.allowAll()))
   *   .recoverWith(aiFixer((f) => f.provider("claude").apiKey(this.key)));
   * ```
   */
  recoverWith(...remediations: Remediation[]): this {
    this.recoverWith_.push(...remediations);
    return this;
  }

  /**
   * The maximum number of fix-then-rerun cycles attempted when the body fails
   * and {@link recoverWith} remediations are configured (default 1). Each cycle
   * runs every remediation, then re-runs the body once; the count bounds how
   * many times that repeats before the failure is final. Clamped to at least 1.
   */
  recoverAttempts(times: number): this {
    this.recoverAttempts_ = Math.max(1, Math.floor(times));
    return this;
  }

  /**
   * Hold a **cross-run lock** while this target runs: only one run may hold
   * `key` at a time, so a second run that tries to acquire it fails with a
   * {@link "./state/lock.ts".LockConflictError} naming the current holder. The
   * lock is released when the target settles — success, failure, or
   * cancellation — and expires after `options.ttl` as a backstop should the
   * holder be killed (a live holder renews it as it runs).
   *
   * `key` may be a thunk, evaluated after parameters resolve, so it can depend
   * on `this.<param>.value`; compose composite keys with
   * {@link "./state/lock.ts".lockKey}. Requires a state store (a build that
   * uses `.lock()` gets a `.zuke/runs` filesystem store by default).
   *
   * ```ts
   * promote = target()
   *   .lock((s) =>
   *     s.lockKey("deploy", this.repo.value)
   *       .withTtl("4h")
   *       .onConflict((h) =>
   *         `${this.repo.value} is being deployed by ${h.actor} (run ${h.runId}).`))
   *   .executes(...);
   * ```
   */
  lock(configure: Configure<LockSettings>): this {
    this.lock_ = configure;
    return this;
  }

  /**
   * Suspend the run at this target until an external event occurs, then let the
   * run be resumed later (in a different process) — a settings lambda in the
   * same style as {@link lock}. The target is a **gate** (no body): when its
   * trigger is already satisfied it passes and dependents run; otherwise the
   * run's state is saved, the run is marked suspended, its independent branches
   * finish, and the process exits 0. Requires a state store.
   *
   * ```ts
   * awaitApproval = target()
   *   .dependsOn(this.deploy)
   *   .waitsFor((s) =>
   *     s.on(externalSignal("testing-approved"))
   *       .timeout("72h")
   *       .onTimeout(() => this.rollback));
   * ```
   */
  waitsFor(configure: Configure<WaitSettings>): this {
    this.waitsFor_ = configure;
    return this;
  }

  /**
   * Register a **compensation** target that undoes this target's effect when the
   * run is later cancelled (via `zuke cancel <run-id>`, an MCP `cancel_run`, or a
   * timed-out wait). The compensation runs **iff this target succeeded** — a
   * target that never ran, was skipped, or failed has nothing to undo. On
   * cancellation, compensations run in **reverse order** of the targets that
   * succeeded, so later work is unwound before the work it built on.
   *
   * `compensation` is a sibling target, or a thunk returning one (use the thunk
   * form to reference a target declared *below* this one — class fields
   * initialise top-to-bottom). The compensation body receives a normal
   * {@link TargetContext} whose `state` exposes **this target's** persisted
   * metadata, so a deploy that recorded `{ slot: "sit-7" }` in `ctx.state` can be
   * rolled back from exactly that slot. Compensation failures are recorded but do
   * not stop the walk (cleanup is maximal). Requires a state store.
   *
   * On a {@link forEach} **sub-target**, the compensation is per item: cancel
   * runs it for every item that had succeeded (or was still in-flight), each with
   * its own item-scoped context — see the fan-out section of
   * `docs/orchestration.md`.
   *
   * ```ts
   * deploy = target()
   *   .executes((ctx) => ctx.state.set({ slot: "sit-7" }))
   *   .onCancel(() => this.rollback);
   * rollback = target()
   *   .executes((ctx) => tearDown(ctx.state.get().slot)); // reads deploy's meta
   * ```
   */
  onCancel(compensation: OnCancel): this {
    this.onCancel_ = typeof compensation === "function"
      ? compensation
      : () => compensation;
    return this;
  }

  /**
   * Fan out over a **runtime list**: for each item, build an ordered pipeline of
   * sub-targets and run them with per-item failure isolation and bounded
   * concurrency. `items` is a thunk (evaluated when the target runs, so it can
   * read `this.<param>.value`); `factory` returns a record of sub-targets per
   * item, each implicitly depending on the one before it. Items run
   * concurrently, each item's stages sequentially — the pipeline model.
   *
   * The sub-targets are materialised at run time (named
   * `parent[item].stage`) — `--list`/`graph` show only the one fan-out node —
   * and each is a first-class target with its own status in the summary and the
   * run record. The fan-out target fails if any item's pipeline fails.
   *
   * A fan-out cannot contain a **wait gate**: neither the fan-out target itself
   * nor any stage may use {@link waitsFor} — a materialised sub-target has no
   * resume path, so the gate would be silently swallowed. Combining them fails
   * the target with guidance. Gate a fan-out by putting the wait on a separate
   * target that the fan-out `.dependsOn(...)`.
   *
   * ```ts
   * deployBatch = target()
   *   .forEach(
   *     () => this.repos.value, // string[]
   *     (repo) => ({
   *       checks: target().executes(() => checkDeployable(repo)),
   *       deploy: target().executes((ctx) => applyToSit(repo, ctx)),
   *     }),
   *     (s) => s.concurrency(3).continueOnItemFailure(),
   *   );
   * ```
   */
  forEach<Item>(
    items: () => readonly Item[],
    factory: ForEachFactory<Item>,
    configure?: Configure<ForEachSettings>,
  ): this {
    this.forEach_ = {
      // Capture the item type entirely: the closure yields concrete
      // ForEachItems (string keys, TargetBuilder stages), so no `Item` escapes
      // into the non-generic stored spec.
      materialize: () => {
        // A wait gate has no coherent place inside a fan-out: a fan-out
        // sub-target is materialised per run and never listed by the resume
        // sweep, so a "waiting" gate — on the parent or on any stage — would be
        // silently swallowed (the run finishes "succeeded" while a durable row
        // is stranded "waiting" forever). Reject both loudly; put the wait on a
        // separate target the fan-out `.dependsOn(...)` instead.
        const self = this.name_ ?? "<unnamed>";
        if (this.waitsFor_ !== undefined) {
          throw new Error(
            `Target "${self}" combines .forEach() with .waitsFor(): a wait gate ` +
              `on a fan-out target has no resume path and would be silently ` +
              `skipped. Put the wait on a separate target that this fan-out ` +
              `.dependsOn(...).`,
          );
        }
        const seen = new Map<string, number>();
        return items().map((item, index) => {
          const base = itemKey(item, index);
          const count = seen.get(base) ?? 0;
          seen.set(base, count + 1);
          // Disambiguate duplicate keys so sub-target names stay unique.
          const key = count === 0 ? base : `${base}#${index}`;
          const stages = factory(item, index);
          for (const [stage, sub] of Object.entries(stages)) {
            if (sub.waitsFor_ !== undefined) {
              throw new Error(
                `Fan-out target "${self}" stage "${stage}" uses .waitsFor(): a ` +
                  `wait gate inside a fan-out has no resume path (the resume ` +
                  `sweep can't reach a materialised sub-target), so it would be ` +
                  `silently swallowed. Put the wait on a separate target that ` +
                  `the fan-out .dependsOn(...).`,
              );
            }
          }
          return { key, stages };
        });
      },
      configure,
    };
    return this;
  }
}

/**
 * A configured target. Alias of {@link TargetBuilder} — the same object both
 * builds and represents the target. Exposed as `Target` for use in signatures.
 */
export type Target = TargetBuilder;

/** Create a new, empty target builder. */
export function target(): TargetBuilder {
  return new TargetBuilder();
}

/**
 * Create a parallel {@link Group}. Targets join it with
 * {@link TargetBuilder.partOf}, and a downstream target can depend on the whole
 * batch by passing the group to {@link TargetBuilder.dependsOn}.
 *
 * ```ts
 * checks = group();
 * lint = target().partOf(this.checks).executes(...);
 * format = target().partOf(this.checks).executes(...);
 * deploy = target().dependsOn(this.checks).executes(...);
 * ```
 */
export function group(): Group {
  return new Group();
}
