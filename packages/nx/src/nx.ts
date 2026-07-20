/**
 * `NxTasks` — typed task functions for the [Nx](https://nx.dev) CLI, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { NxTasks } from "jsr:@zuke/nx";
 * await NxTasks.affected((s) => s.target("test").base("main").parallel(3));
 * await NxTasks.runMany((s) => s.target("build").projects("web", "api"));
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Base for all `nx` subcommand settings: the binary is `nx`. */
export abstract class NxSettings extends ToolSettings {
  /** The tool binary is `nx`. */
  protected override defaultTool(): string {
    return "nx";
  }
}

/** Settings for `nx run` (a single `project:target`). */
export class NxRunSettings extends NxSettings {
  #target?: string;
  #configuration?: string;

  /** The `project:target` to run, e.g. `web:build` (required). */
  target(spec: string): this {
    this.#target = spec;
    return this;
  }

  /** Use a named configuration (`--configuration`). */
  configuration(name: string): this {
    this.#configuration = name;
    return this;
  }

  /** Assemble the `nx run` argv. */
  protected override buildArgs(): string[] {
    if (this.#target === undefined) {
      throw new Error("NxTasks.run: .target() is required.");
    }
    const argv = ["run", this.#target];
    if (this.#configuration !== undefined) {
      argv.push(`--configuration=${this.#configuration}`);
    }
    return argv;
  }
}

/** Settings for `nx run-many`. */
export class NxRunManySettings extends NxSettings {
  #target?: string;
  #projects: string[] = [];
  #configuration?: string;
  #parallel?: number;
  #all = false;

  /** The target to run across projects (required). */
  target(name: string): this {
    this.#target = name;
    return this;
  }

  /** Limit to specific projects (`--projects`); repeatable. */
  projects(...names: string[]): this {
    this.#projects.push(...names);
    return this;
  }

  /** Use a named configuration (`--configuration`). */
  configuration(name: string): this {
    this.#configuration = name;
    return this;
  }

  /** Maximum number of tasks to run in parallel (`--parallel`). */
  parallel(count: number): this {
    this.#parallel = count;
    return this;
  }

  /** Run for every project (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Assemble the `nx run-many` argv. */
  protected override buildArgs(): string[] {
    if (this.#target === undefined) {
      throw new Error("NxTasks.runMany: .target() is required.");
    }
    const argv = ["run-many", `--target=${this.#target}`];
    if (this.#projects.length > 0) {
      argv.push(`--projects=${this.#projects.join(",")}`);
    }
    if (this.#configuration !== undefined) {
      argv.push(`--configuration=${this.#configuration}`);
    }
    if (this.#parallel !== undefined) argv.push(`--parallel=${this.#parallel}`);
    if (this.#all) argv.push("--all");
    return argv;
  }
}

/** Settings for `nx affected`. */
export class NxAffectedSettings extends NxSettings {
  #target?: string;
  #base?: string;
  #head?: string;
  #configuration?: string;
  #parallel?: number;

  /** The target to run on affected projects (required). */
  target(name: string): this {
    this.#target = name;
    return this;
  }

  /** The base ref to diff against (`--base`). */
  base(ref: string): this {
    this.#base = ref;
    return this;
  }

  /** The head ref to diff against (`--head`). */
  head(ref: string): this {
    this.#head = ref;
    return this;
  }

  /** Use a named configuration (`--configuration`). */
  configuration(name: string): this {
    this.#configuration = name;
    return this;
  }

  /** Maximum number of tasks to run in parallel (`--parallel`). */
  parallel(count: number): this {
    this.#parallel = count;
    return this;
  }

  /** Assemble the `nx affected` argv. */
  protected override buildArgs(): string[] {
    if (this.#target === undefined) {
      throw new Error("NxTasks.affected: .target() is required.");
    }
    const argv = ["affected", `--target=${this.#target}`];
    if (this.#base !== undefined) argv.push(`--base=${this.#base}`);
    if (this.#head !== undefined) argv.push(`--head=${this.#head}`);
    if (this.#configuration !== undefined) {
      argv.push(`--configuration=${this.#configuration}`);
    }
    if (this.#parallel !== undefined) argv.push(`--parallel=${this.#parallel}`);
    return argv;
  }
}

/** The shape of {@link NxTasks}. */
export interface NxTasksApi {
  /** Run a single `project:target`: `nx run`. */
  run(configure?: Configure<NxRunSettings>): Promise<CommandOutput>;
  /** Run a target across many projects: `nx run-many`. */
  runMany(configure?: Configure<NxRunManySettings>): Promise<CommandOutput>;
  /** Run a target on affected projects: `nx affected`. */
  affected(configure?: Configure<NxAffectedSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `nx` CLI. */
export const NxTasks: NxTasksApi = {
  run(configure?: Configure<NxRunSettings>): Promise<CommandOutput> {
    return runSettings(new NxRunSettings(), configure);
  },
  runMany(configure?: Configure<NxRunManySettings>): Promise<CommandOutput> {
    return runSettings(new NxRunManySettings(), configure);
  },
  affected(configure?: Configure<NxAffectedSettings>): Promise<CommandOutput> {
    return runSettings(new NxAffectedSettings(), configure);
  },
};
