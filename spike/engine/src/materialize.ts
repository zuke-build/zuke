// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Turn a worker's manifest into a `Build` subclass the engine can run: one
 * `target()` field per manifest target, each body forwarding to the worker,
 * plus the parameters, groups and build-wide settings it declares.
 *
 * @module
 */

import {
  type AnyParameter,
  Build,
  type BuildResult,
  group,
  type Parameter,
  parameter,
  target,
  type TargetBuilder,
  type TargetContext,
} from "@zuke/core";
import type { WorkerHost } from "./host.ts";
import type {
  ConfigureParams,
  Manifest,
  ManifestParameter,
} from "./protocol.ts";

/** What a materialised build needs from its host. */
export interface TargetRunner {
  /** Tell the worker the run's id, dry-run flag and parameter values. */
  configure: WorkerHost["configure"];
  /** Run the named target's body; reject when it fails. */
  runTarget: WorkerHost["runTarget"];
  /** Tell the worker the run is over. */
  finish: WorkerHost["finish"];
}

function scalarOrList<E extends string | number>(
  param: Parameter<E, E | undefined>,
  p: { required: boolean; array: boolean; default?: E },
): AnyParameter {
  if (p.array) return p.required ? param.required().array() : param.array();
  if (p.required) return param.required();
  return p.default === undefined ? param : param.default(p.default);
}

function declareParameter(p: ManifestParameter): AnyParameter {
  let base = parameter(p.description);
  if (p.flag !== undefined) base = base.flag(p.flag);
  if (p.env !== undefined) base = base.env(p.env);
  if (p.secret) base = base.secret();
  switch (p.kind) {
    case "string":
      return scalarOrList(
        p.options.length > 0 ? base.options(...p.options) : base,
        p,
      );
    case "number":
      return scalarOrList(base.number(), p);
    case "boolean": {
      const flag = base.boolean();
      if (p.required) return flag.required();
      return p.default === undefined ? flag : flag.default(p.default);
    }
  }
}

/** The fields a materialised build declares, each name used once. */
class Fields {
  readonly #declared = new Set<string>();
  constructor(private readonly build: Build) {}

  define(name: string, value: unknown): void {
    if (this.#declared.has(name)) {
      throw new Error(`manifest: "${name}" is declared twice`);
    }
    this.#declared.add(name);
    Object.defineProperty(this.build, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

/** Look a name up in `known`, naming the manifest field that used it if absent. */
function lookup<T>(
  known: ReadonlyMap<string, T>,
  name: string,
  where: string,
): T {
  const found = known.get(name);
  if (found === undefined) {
    throw new Error(
      `manifest: ${where} names "${name}", which is not declared`,
    );
  }
  return found;
}

/**
 * Build the class. Dependencies must be declared before the targets that use
 * them, mirroring the forward-reference rule of a `zuke.ts` build; a violation
 * throws from the constructor with the offending target named. The ordering
 * hints, triggers, compensations and group members may name any target.
 */
export function materialize(
  manifest: Manifest,
  runner: TargetRunner,
): new () => Build {
  return class RemoteBuild extends Build {
    readonly #params = new Map<string, AnyParameter>();
    readonly #unforceable: TargetBuilder[];
    #configured: Promise<void> | undefined;

    constructor() {
      super();
      const fields = new Fields(this);
      for (const p of manifest.parameters) {
        const declared = declareParameter(p);
        this.#params.set(p.name, declared);
        fields.define(p.name, declared);
      }
      const builders = new Map<string, TargetBuilder>();
      for (const t of manifest.targets) {
        const deps = t.dependsOn.map((dep) => {
          const builder = builders.get(dep);
          if (builder === undefined) {
            throw new Error(
              `manifest: target "${t.name}" depends on "${dep}", which is ` +
                `not declared before it`,
            );
          }
          return builder;
        });
        const builder = target().description(t.description).dependsOn(...deps)
          .inputs(...t.inputs).outputs(...t.outputs).produces(...t.produces)
          .retry(t.retry.times, t.retry.delayMs)
          .executes((ctx) => this.#run(t.name, ctx));
        if (t.unlisted) builder.unlisted();
        if (t.timeoutMs !== undefined) builder.timeout(t.timeoutMs);
        if (t.proceedAfterFailure) builder.proceedAfterFailure();
        if (t.always) builder.always();
        if (t.dryRunnable) builder.dryRunnable();
        builders.set(t.name, builder);
        fields.define(t.name, builder);
      }
      for (const t of manifest.targets) {
        const builder = lookup(builders, t.name, "the target list");
        const named = (field: string, names: readonly string[]) =>
          names.map((n) =>
            lookup(builders, n, `target "${t.name}"'s "${field}"`)
          );
        builder.before(...named("before", t.before))
          .after(...named("after", t.after))
          .triggers(...named("triggers", t.triggers))
          .requires(
            ...t.requires.map((n) =>
              lookup(this.#params, n, `target "${t.name}"'s "requires"`)
            ),
          );
        if (t.onCancel !== undefined) {
          builder.onCancel(
            lookup(builders, t.onCancel, `target "${t.name}"'s "onCancel"`),
          );
        }
        const disposition = t.onFailure;
        if (disposition === "fail" || disposition === "cancel-run") {
          builder.onFailure(() => disposition);
        } else if (disposition !== undefined) {
          // shortcut: a target literally named "fail" or "cancel-run" cannot be
          // a compensation; split the field if an SDK ever needs that.
          const compensation = lookup(
            builders,
            disposition,
            `target "${t.name}"'s "onFailure"`,
          );
          builder.onFailure(() => compensation);
        }
      }
      for (const g of manifest.groups) {
        const batch = group();
        for (const m of g.members) {
          lookup(builders, m, `group "${g.name}"`).partOf(batch);
        }
        fields.define(g.name, batch);
      }
      this.#unforceable = manifest.config.unforceable.map((n) =>
        lookup(builders, n, '"unforceable"')
      );
    }

    override deadline(): string | number | undefined {
      return manifest.config.deadline;
    }

    override unforceable(): TargetBuilder[] {
      return this.#unforceable;
    }

    override onFinish(result: BuildResult): Promise<void> {
      return runner.finish(result.ok ? 0 : 1);
    }

    /** Configure the worker once, before the first body, then run the body. */
    async #run(name: string, ctx: TargetContext): Promise<void> {
      this.#configured ??= runner.configure(this.#configuration(ctx));
      await this.#configured;
      await runner.runTarget(name, ctx);
    }

    #configuration(ctx: TargetContext): ConfigureParams {
      const parameters: Record<string, string | null> = {};
      for (const [name, p] of this.#params) {
        parameters[name] = p.stringValue_() ?? null;
      }
      return { runId: ctx.runId, dryRun: ctx.dryRun, parameters };
    }
  };
}
