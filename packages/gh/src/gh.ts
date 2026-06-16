/**
 * `GhTasks` — a typed wrapper for the `gh` GitHub CLI, in the same
 * settings-lambda style as the other Zuke tool wrappers.
 *
 * `gh` spans many command groups (`pr`, `release`, `issue`, `repo`, `workflow`,
 * `api`, …), so the wrapper is a flexible command builder rather than a
 * per-command API: name the command with `.command(...)`, set the common
 * `--repo` flag, and pass anything else with `.flag(...)` or the `.args(...)`
 * escape hatch.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.run((s) =>
 *   s.command("release", "create", "v1.2.3")
 *     .repo("acme/app").flag("title", "v1.2.3").flag("generate-notes")
 * );
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for a `gh` invocation. */
export class GhSettings extends ToolSettings {
  #command: string[] = [];
  #repo?: string;
  #flags: string[] = [];

  protected override defaultTool(): string {
    return "gh";
  }

  /** The command path and verb, e.g. `command("pr", "create")`. */
  command(...parts: Array<string | number>): this {
    this.#command.push(...parts.map(String));
    return this;
  }

  /** Target repository as `OWNER/REPO` (`-R`/`--repo`). */
  repo(slug: string): this {
    this.#repo = slug;
    return this;
  }

  /**
   * Add an arbitrary flag. With a value it renders `--name value`; without one
   * it renders the bare `--name`. Repeatable.
   */
  flag(name: string, value?: string | number): this {
    this.#flags.push(`--${name}`);
    if (value !== undefined) this.#flags.push(String(value));
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = [...this.#command];
    if (this.#repo !== undefined) argv.push("--repo", this.#repo);
    argv.push(...this.#flags);
    return argv;
  }
}

/** The shape of {@link GhTasks}. */
export interface GhTasksApi {
  /** Run a `gh` command. */
  run(configure?: Configure<GhSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `gh` GitHub CLI. */
export const GhTasks: GhTasksApi = {
  run(configure?: Configure<GhSettings>): Promise<CommandOutput> {
    return runSettings(new GhSettings(), configure);
  },
};
