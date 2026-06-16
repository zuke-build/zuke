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

/** The executable body of a target. May be synchronous or asynchronous. */
export type TargetFn = () => void | Promise<void>;

/** A predicate gating whether a target runs; may be synchronous or async. */
export type Condition = () => boolean | Promise<boolean>;

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
