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

import {
  type Configure,
  runSettings,
  SubcommandSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for a `gh` invocation. */
export class GhSettings extends SubcommandSettings {
  #repo?: string;

  /** The default executable name: `gh`. */
  protected override defaultTool(): string {
    return "gh";
  }

  /** Target repository as `OWNER/REPO` (`-R`/`--repo`). */
  repo(slug: string): this {
    this.#repo = slug;
    return this;
  }

  /** Emit `--repo <slug>` between the command path and the flags, when set. */
  protected override middleTokens(): string[] {
    return this.#repo !== undefined ? ["--repo", this.#repo] : [];
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
