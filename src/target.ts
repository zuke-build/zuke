/**
 * Target authoring API: the `target()` fluent builder and the `Target` type.
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
 */

/** The executable body of a target. May be synchronous or asynchronous. */
export type TargetFn = () => void | Promise<void>;

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

  /** Set the human-readable description shown in `zuke --list`. */
  description(text: string): this {
    this.description_ = text;
    return this;
  }

  /** Declare hard prerequisites. References sibling targets via `this.x`. */
  dependsOn(...targets: TargetBuilder[]): this {
    this.dependsOn_.push(...targets);
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
