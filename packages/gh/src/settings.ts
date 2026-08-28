// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link GhSettings} — the base every `gh` invocation's settings extend: the
 * binary, the command builder inherited from
 * {@link "@zuke/core/tooling".SubcommandSettings}, and the `--repo` flag every
 * command accepts.
 *
 * It lives apart from the module that assembles `GhTasks` so a typed
 * subcommand in its own file can extend it without importing that module,
 * which imports the subcommands back — a cycle that leaves the base
 * uninitialised at the moment a subclass is declared.
 *
 * @module
 */

import { SubcommandSettings } from "@zuke/core/tooling";

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
