/**
 * `YarnTasks` — typed task functions for the `yarn` CLI, in the settings-lambda
 * style: configure a fluent settings object in a lambda, and the task function
 * builds the command line and executes it.
 *
 * ```ts
 * import { YarnTasks } from "jsr:@zuke/yarn";
 * await YarnTasks.install((s) => s.immutable());
 * await YarnTasks.run((s) => s.script("build"));
 * ```
 *
 * Yarn's CLI differs between Classic (v1) and Berry (v2+). Where the two
 * diverge, the option is named after the flag and its applicable line noted —
 * e.g. `.immutable()` is Berry's `--immutable` and `.frozenLockfile()` is
 * Classic's `--frozen-lockfile`; `dlx` is a Berry command. On Windows, yarn
 * ships as a `.cmd` shim; the shared tooling base retries through `cmd /c`
 * automatically when direct spawning fails.
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Base for all `yarn` subcommand settings: binary is `yarn` from PATH. */
export abstract class YarnSettings extends ToolSettings {
  /** The default binary: `yarn` resolved from PATH. */
  protected override defaultTool(): string {
    return "yarn";
  }
}

/** Settings for `yarn install`. */
export class YarnInstallSettings extends YarnSettings {
  #immutable = false;
  #frozenLockfile = false;

  /** Fail if the lockfile would change — `--immutable` (Yarn Berry). */
  immutable(): this {
    this.#immutable = true;
    return this;
  }

  /** Fail if the lockfile would change — `--frozen-lockfile` (Yarn Classic). */
  frozenLockfile(): this {
    this.#frozenLockfile = true;
    return this;
  }

  /** Assemble the `yarn install` argv. */
  protected override buildArgs(): string[] {
    const argv = ["install"];
    if (this.#immutable) argv.push("--immutable");
    if (this.#frozenLockfile) argv.push("--frozen-lockfile");
    return argv;
  }
}

/** Settings for `yarn add`. */
export class YarnAddSettings extends YarnSettings {
  #packages: string[] = [];
  #dev = false;
  #exact = false;

  /** Package specs to add (required). */
  packages(...specs: string[]): this {
    this.#packages.push(...specs);
    return this;
  }

  /** Add to devDependencies (`--dev`). */
  dev(): this {
    this.#dev = true;
    return this;
  }

  /** Pin the exact version (`--exact`). */
  exact(): this {
    this.#exact = true;
    return this;
  }

  /** Assemble the `yarn add` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error("YarnTasks.add: .packages() requires at least one spec.");
    }
    const argv = ["add"];
    if (this.#dev) argv.push("--dev");
    if (this.#exact) argv.push("--exact");
    argv.push(...this.#packages);
    return argv;
  }
}

/** Settings for `yarn remove`. */
export class YarnRemoveSettings extends YarnSettings {
  #packages: string[] = [];

  /** Package names to remove (required). */
  packages(...names: string[]): this {
    this.#packages.push(...names);
    return this;
  }

  /** Assemble the `yarn remove` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        "YarnTasks.remove: .packages() requires at least one name.",
      );
    }
    return ["remove", ...this.#packages];
  }
}

/** Settings for `yarn run`. */
export class YarnRunSettings extends YarnSettings {
  #script?: string;
  #scriptArgs: string[] = [];

  /** The package.json script to run (required). */
  script(name: string): this {
    this.#script = name;
    return this;
  }

  /** Arguments forwarded to the script. */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  /** Assemble the `yarn run` argv. */
  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("YarnTasks.run: .script() is required.");
    }
    return ["run", this.#script, ...this.#scriptArgs];
  }
}

/** Settings for `yarn dlx` (Yarn Berry's one-off package runner). */
export class YarnDlxSettings extends YarnSettings {
  #command?: string;
  #package?: string;
  #execArgs: string[] = [];

  /** The command to execute (required). */
  command(name: string): this {
    this.#command = name;
    return this;
  }

  /** An extra package to make available (`--package`). */
  package(spec: string): this {
    this.#package = spec;
    return this;
  }

  /** Arguments forwarded to the command. */
  execArgs(...args: Array<string | number>): this {
    this.#execArgs.push(...args.map(String));
    return this;
  }

  /** Assemble the `yarn dlx` argv. */
  protected override buildArgs(): string[] {
    if (this.#command === undefined) {
      throw new Error("YarnTasks.dlx: .command() is required.");
    }
    const argv = ["dlx"];
    if (this.#package !== undefined) argv.push("--package", this.#package);
    argv.push(this.#command, ...this.#execArgs);
    return argv;
  }
}

/** The shape of {@link YarnTasks}. */
export interface YarnTasksApi {
  /** Install dependencies: `yarn install`. */
  install(configure?: Configure<YarnInstallSettings>): Promise<CommandOutput>;
  /** Add dependencies: `yarn add`. */
  add(configure?: Configure<YarnAddSettings>): Promise<CommandOutput>;
  /** Remove dependencies: `yarn remove`. */
  remove(configure?: Configure<YarnRemoveSettings>): Promise<CommandOutput>;
  /** Run a package.json script: `yarn run`. */
  run(configure?: Configure<YarnRunSettings>): Promise<CommandOutput>;
  /** Download and execute a package binary: `yarn dlx` (Berry). */
  dlx(configure?: Configure<YarnDlxSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `yarn` CLI. */
export const YarnTasks: YarnTasksApi = {
  /** Install dependencies: `yarn install`. */
  install(configure?: Configure<YarnInstallSettings>): Promise<CommandOutput> {
    return runSettings(new YarnInstallSettings(), configure);
  },
  /** Add dependencies: `yarn add`. */
  add(configure?: Configure<YarnAddSettings>): Promise<CommandOutput> {
    return runSettings(new YarnAddSettings(), configure);
  },
  /** Remove dependencies: `yarn remove`. */
  remove(configure?: Configure<YarnRemoveSettings>): Promise<CommandOutput> {
    return runSettings(new YarnRemoveSettings(), configure);
  },
  /** Run a package.json script: `yarn run`. */
  run(configure?: Configure<YarnRunSettings>): Promise<CommandOutput> {
    return runSettings(new YarnRunSettings(), configure);
  },
  /** Download and execute a package binary: `yarn dlx` (Berry). */
  dlx(configure?: Configure<YarnDlxSettings>): Promise<CommandOutput> {
    return runSettings(new YarnDlxSettings(), configure);
  },
};
