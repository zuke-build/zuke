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
 * Related targets can be bundled into a {@link group}: a batch that runs its
 * members concurrently (even in an otherwise sequential build) and can be
 * depended on as a unit.
 *
 * ```ts
 * checks = group(this.lint, this.format, this.typecheck);
 * deploy = target().dependsOn(this.checks).executes(...); // waits for all three
 * ```
 */

/** The executable body of a target. May be synchronous or asynchronous. */
export type TargetFn = () => void | Promise<void>;

/**
 * A parallel batch of targets created with {@link group}. Its members run
 * concurrently with one another (subject to their own dependencies) regardless
 * of the global parallel setting, and the group can be passed to
 * {@link TargetBuilder.dependsOn} to depend on every member at once.
 */
export class Group {
  constructor(
    /** The grouped targets, in declaration order. */
    readonly members_: ReadonlyArray<TargetBuilder>,
  ) {}
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
  /** The parallel batch this target belongs to, if any (set by {@link group}). */
  group_?: Group;

  /** Set the human-readable description shown in `zuke --list`. */
  description(text: string): this {
    this.description_ = text;
    return this;
  }

  /**
   * Declare hard prerequisites. References sibling targets via `this.x`, or a
   * {@link group} (which expands to every member of the group).
   */
  dependsOn(...targets: Array<TargetBuilder | Group>): this {
    for (const t of targets) {
      if (t instanceof Group) this.dependsOn_.push(...t.members_);
      else this.dependsOn_.push(t);
    }
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
 * Bundle targets into a parallel {@link Group}: a batch whose members run
 * concurrently with each other — even when the build is otherwise sequential —
 * each still waiting for its own dependencies. Pass the group to
 * {@link TargetBuilder.dependsOn} to depend on all of its members at once.
 *
 * ```ts
 * checks = group(this.lint, this.format, this.typecheck);
 * deploy = target().dependsOn(this.checks).executes(...);
 * ```
 */
export function group(...targets: TargetBuilder[]): Group {
  const created = new Group(targets);
  for (const t of targets) {
    // A forward reference is `undefined` here; the graph reports it later.
    if (t !== undefined) t.group_ = created;
  }
  return created;
}
