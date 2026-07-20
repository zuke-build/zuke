/**
 * `BunTasks` — typed task functions for the `bun` CLI, in the settings-lambda
 * style: configure a fluent settings object in a lambda, and the task function
 * builds the command line and executes it.
 *
 * ```ts
 * import { BunTasks } from "jsr:@zuke/bun";
 * await BunTasks.install((s) => s.frozenLockfile());
 * await BunTasks.run((s) => s.script("build"));
 * ```
 *
 * On Windows, bun ships as `bun.exe`; the shared tooling base retries through
 * `cmd /c` automatically when direct spawning fails.
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Base for all `bun` subcommand settings: binary is `bun` from PATH. */
export abstract class BunSettings extends ToolSettings {
  /** The tool binary: `bun` on PATH. */
  protected override defaultTool(): string {
    return "bun";
  }
}

/** Settings for `bun install`. */
export class BunInstallSettings extends BunSettings {
  #production = false;
  #frozenLockfile = false;

  /** Install without devDependencies (`--production`). */
  production(): this {
    this.#production = true;
    return this;
  }

  /** Fail if the lockfile is out of date (`--frozen-lockfile`). */
  frozenLockfile(): this {
    this.#frozenLockfile = true;
    return this;
  }

  /** Assemble the `bun install` argv. */
  protected override buildArgs(): string[] {
    const argv = ["install"];
    if (this.#production) argv.push("--production");
    if (this.#frozenLockfile) argv.push("--frozen-lockfile");
    return argv;
  }
}

/** Settings for `bun add`. */
export class BunAddSettings extends BunSettings {
  #packages: string[] = [];
  #dev = false;
  #optional = false;
  #exact = false;
  #global = false;

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

  /** Add to optionalDependencies (`--optional`). */
  optional(): this {
    this.#optional = true;
    return this;
  }

  /** Pin the exact version (`--exact`). */
  exact(): this {
    this.#exact = true;
    return this;
  }

  /** Install globally (`--global`). */
  global(): this {
    this.#global = true;
    return this;
  }

  /** Assemble the `bun add` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error("BunTasks.add: .packages() requires at least one spec.");
    }
    const argv = ["add"];
    if (this.#dev) argv.push("--dev");
    if (this.#optional) argv.push("--optional");
    if (this.#exact) argv.push("--exact");
    if (this.#global) argv.push("--global");
    argv.push(...this.#packages);
    return argv;
  }
}

/** Settings for `bun remove`. */
export class BunRemoveSettings extends BunSettings {
  #packages: string[] = [];

  /** Package names to remove (required). */
  packages(...names: string[]): this {
    this.#packages.push(...names);
    return this;
  }

  /** Assemble the `bun remove` argv. */
  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        "BunTasks.remove: .packages() requires at least one name.",
      );
    }
    return ["remove", ...this.#packages];
  }
}

/** Settings for `bun run`. */
export class BunRunSettings extends BunSettings {
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

  /** Assemble the `bun run` argv. */
  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("BunTasks.run: .script() is required.");
    }
    return ["run", this.#script, ...this.#scriptArgs];
  }
}

/** Settings for `bun x` (the `bunx` package runner). */
export class BunXSettings extends BunSettings {
  #command?: string;
  #execArgs: string[] = [];

  /** The package binary to execute (required). */
  command(name: string): this {
    this.#command = name;
    return this;
  }

  /** Arguments forwarded to the command. */
  execArgs(...args: Array<string | number>): this {
    this.#execArgs.push(...args.map(String));
    return this;
  }

  /** Assemble the `bun x` argv. */
  protected override buildArgs(): string[] {
    if (this.#command === undefined) {
      throw new Error("BunTasks.x: .command() is required.");
    }
    return ["x", this.#command, ...this.#execArgs];
  }
}

/** Settings for `bun test`. */
export class BunTestSettings extends BunSettings {
  #paths: string[] = [];
  #coverage = false;
  #bail = false;

  /** Test file or directory patterns to run; omit to run all tests. */
  paths(...patterns: string[]): this {
    this.#paths.push(...patterns);
    return this;
  }

  /** Collect coverage (`--coverage`). */
  coverage(): this {
    this.#coverage = true;
    return this;
  }

  /** Stop after the first failure (`--bail`). */
  bail(): this {
    this.#bail = true;
    return this;
  }

  /** Assemble the `bun test` argv. */
  protected override buildArgs(): string[] {
    const argv = ["test"];
    if (this.#coverage) argv.push("--coverage");
    if (this.#bail) argv.push("--bail");
    argv.push(...this.#paths);
    return argv;
  }
}

/** The shape of {@link BunTasks}. */
export interface BunTasksApi {
  /** Install dependencies: `bun install`. */
  install(configure?: Configure<BunInstallSettings>): Promise<CommandOutput>;
  /** Add dependencies: `bun add`. */
  add(configure?: Configure<BunAddSettings>): Promise<CommandOutput>;
  /** Remove dependencies: `bun remove`. */
  remove(configure?: Configure<BunRemoveSettings>): Promise<CommandOutput>;
  /** Run a package.json script: `bun run`. */
  run(configure?: Configure<BunRunSettings>): Promise<CommandOutput>;
  /** Execute a package binary: `bun x` (bunx). */
  x(configure?: Configure<BunXSettings>): Promise<CommandOutput>;
  /** Run the test suite: `bun test`. */
  test(configure?: Configure<BunTestSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `bun` CLI. */
export const BunTasks: BunTasksApi = {
  /** Install dependencies: `bun install`. */
  install(configure?: Configure<BunInstallSettings>): Promise<CommandOutput> {
    return runSettings(new BunInstallSettings(), configure);
  },
  /** Add dependencies: `bun add`. */
  add(configure?: Configure<BunAddSettings>): Promise<CommandOutput> {
    return runSettings(new BunAddSettings(), configure);
  },
  /** Remove dependencies: `bun remove`. */
  remove(configure?: Configure<BunRemoveSettings>): Promise<CommandOutput> {
    return runSettings(new BunRemoveSettings(), configure);
  },
  /** Run a package.json script: `bun run`. */
  run(configure?: Configure<BunRunSettings>): Promise<CommandOutput> {
    return runSettings(new BunRunSettings(), configure);
  },
  /** Execute a package binary: `bun x` (bunx). */
  x(configure?: Configure<BunXSettings>): Promise<CommandOutput> {
    return runSettings(new BunXSettings(), configure);
  },
  /** Run the test suite: `bun test`. */
  test(configure?: Configure<BunTestSettings>): Promise<CommandOutput> {
    return runSettings(new BunTestSettings(), configure);
  },
};
