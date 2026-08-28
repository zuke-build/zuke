// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The bases the typed `gh` subcommand settings share.
 *
 * All three build on the package's existing {@link "./settings.ts".GhSettings}, so a
 * typed command keeps `.repo()`, and keeps `.command(...)`/`.flag(...)` as
 * escape hatches for anything not yet modelled. What they add is the shape
 * every group repeats: a command path with its operand, the read flags gh
 * offers on every listing and view (`--json`, `--jq`, `--template`, `--web`),
 * and the `--body`/`--body-file` pair the writing commands share.
 *
 * Holding those here is what keeps twenty command classes from carrying
 * twenty copies of the same four methods.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { GhSettings } from "./settings.ts";

/**
 * Base for a typed `gh` subcommand: it contributes the command path (the
 * group, the verb, and any operand) and its own flags, and inherits
 * everything else from {@link "./settings.ts".GhSettings}.
 */
export abstract class GhCommandSettings extends GhSettings {
  /** The command path — group, verb, then any positional operand. */
  protected abstract commandPath(): string[];

  /** This command's own flags, rendered after `--repo`. */
  protected abstract commandFlags(): string[];

  /** The command path leads the argv, before anything `.command(...)` added. */
  protected override leadingTokens(): string[] {
    return this.commandPath();
  }

  /** `--repo` first, as the package already renders it, then this command's flags. */
  protected override middleTokens(): string[] {
    return [...super.middleTokens(), ...this.commandFlags()];
  }
}

/**
 * Base for the commands that can print JSON: `pr list`, `pr view`,
 * `pr checks`, `issue list`, `issue view`, `release list`, `release view`.
 *
 * gh requires an explicit field list for `--json`, which is why the
 * value-returning tasks pin one rather than leaving it to the caller.
 *
 * A `…ListEntries` reader parses the array `--json` prints, so `.jq(...)` and
 * `.template(...)` — which replace that array with whatever they render —
 * belong on the plain `…List` task instead.
 */
export abstract class GhReadSettings extends GhCommandSettings {
  #json?: string;
  #jq?: string;
  #template?: string;

  /**
   * Emit JSON with these fields (`--json`), which gh requires by name — there
   * is no "all fields" form.
   */
  json(...fields: string[]): this {
    this.#json = fields.join(",");
    return this;
  }

  /** Filter the JSON with a jq expression (`--jq`). */
  jq(expression: string): this {
    this.#jq = expression;
    return this;
  }

  /** Format the JSON through a Go template (`--template`). */
  template(text: string): this {
    this.#template = text;
    return this;
  }

  /** The read flags, for a subclass to place among its own. */
  protected readFlags(): string[] {
    const argv: string[] = [];
    if (this.#json !== undefined) argv.push("--json", this.#json);
    if (this.#jq !== undefined) argv.push("--jq", this.#jq);
    if (this.#template !== undefined) argv.push("--template", this.#template);
    return argv;
  }
}

/**
 * Base for the read commands that also take `--web`: every one of them except
 * `release list`, which gh gives no browser view. Keeping `.web()` here rather
 * than on {@link GhReadSettings} is what stops a build offering a flag gh
 * would reject.
 */
export abstract class GhWebReadSettings extends GhReadSettings {
  #web = false;

  /**
   * Open the result in a browser instead of printing it (`--web`). A build
   * has no browser, so this is for a developer running the target by hand.
   */
  web(): this {
    this.#web = true;
    return this;
  }

  /** The read flags, with `--web` last as gh's own help lists it. */
  protected override readFlags(): string[] {
    const argv = super.readFlags();
    if (this.#web) argv.push("--web");
    return argv;
  }
}

/**
 * Base for the commands that take message text: `pr create`, `pr comment`,
 * `pr edit`, `issue create`, `issue comment`.
 *
 * gh spells it `--body` for the text and `--body-file` for a file, with `-`
 * meaning standard input — the same pair on every one of them.
 */
export abstract class GhBodySettings extends GhCommandSettings {
  #body?: string;
  #bodyFile?: string;

  /** The message text (`--body`). */
  body(text: string): this {
    this.#body = text;
    return this;
  }

  /** Read the message from a file (`--body-file`); `-` reads standard input. */
  bodyFile(path: PathLike): this {
    this.#bodyFile = String(path);
    return this;
  }

  /**
   * The body flags, after refusing both at once: gh takes one source for the
   * text, and silently preferring one would hide which text was posted.
   */
  protected bodyFlags(task: string): string[] {
    if (this.#body !== undefined && this.#bodyFile !== undefined) {
      throw new Error(
        `GhTasks.${task}: .body(...) and .bodyFile(...) are two sources for ` +
          `the same text — pick one.`,
      );
    }
    const argv: string[] = [];
    if (this.#body !== undefined) argv.push("--body", this.#body);
    if (this.#bodyFile !== undefined) argv.push("--body-file", this.#bodyFile);
    return argv;
  }
}
