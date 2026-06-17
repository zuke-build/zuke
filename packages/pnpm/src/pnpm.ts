/**
 * `PnpmTasks` — typed task functions for the `pnpm` CLI, in the settings-lambda
 * style: configure a fluent settings object in a lambda, and the task function
 * builds the command line and executes it.
 *
 * ```ts
 * import { PnpmTasks } from "jsr:@zuke/pnpm";
 * await PnpmTasks.install((s) => s.frozenLockfile());
 * await PnpmTasks.run((s) => s.script("build").filter("app"));
 * ```
 *
 * On Windows, pnpm ships as a `.cmd` shim; the shared tooling base retries
 * through `cmd /c` automatically when direct spawning fails.
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** An access level accepted by pnpm's `--access` flag. */
export type PnpmAccess = "public" | "restricted";

/** Base for all `pnpm` subcommand settings: binary is `pnpm` from PATH. */
abstract class PnpmSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "pnpm";
  }
}

/** Settings for `pnpm install`. */
export class PnpmInstallSettings extends PnpmSettings {
  #frozenLockfile = false;
  #prod = false;

  /** Fail if the lockfile is out of date (`--frozen-lockfile`). */
  frozenLockfile(): this {
    this.#frozenLockfile = true;
    return this;
  }

  /** Install without devDependencies (`--prod`). */
  prod(): this {
    this.#prod = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["install"];
    if (this.#frozenLockfile) argv.push("--frozen-lockfile");
    if (this.#prod) argv.push("--prod");
    return argv;
  }
}

/** Settings for `pnpm add`. */
export class PnpmAddSettings extends PnpmSettings {
  #packages: string[] = [];
  #saveDev = false;
  #saveExact = false;
  #global = false;

  /** Package specs to add (required). */
  packages(...specs: string[]): this {
    this.#packages.push(...specs);
    return this;
  }

  /** Save to devDependencies (`--save-dev`). */
  saveDev(): this {
    this.#saveDev = true;
    return this;
  }

  /** Pin the exact version (`--save-exact`). */
  saveExact(): this {
    this.#saveExact = true;
    return this;
  }

  /** Install globally (`--global`). */
  global(): this {
    this.#global = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error("PnpmTasks.add: .packages() requires at least one spec.");
    }
    const argv = ["add"];
    if (this.#saveDev) argv.push("--save-dev");
    if (this.#saveExact) argv.push("--save-exact");
    if (this.#global) argv.push("--global");
    argv.push(...this.#packages);
    return argv;
  }
}

/** Settings for `pnpm remove`. */
export class PnpmRemoveSettings extends PnpmSettings {
  #packages: string[] = [];

  /** Package names to remove (required). */
  packages(...names: string[]): this {
    this.#packages.push(...names);
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#packages.length === 0) {
      throw new Error(
        "PnpmTasks.remove: .packages() requires at least one name.",
      );
    }
    return ["remove", ...this.#packages];
  }
}

/** Settings for `pnpm run`. */
export class PnpmRunSettings extends PnpmSettings {
  #script?: string;
  #filter?: string;
  #ifPresent = false;
  #scriptArgs: string[] = [];

  /** The package.json script to run (required). */
  script(name: string): this {
    this.#script = name;
    return this;
  }

  /** Restrict to matching workspace packages (`--filter`). */
  filter(pattern: string): this {
    this.#filter = pattern;
    return this;
  }

  /** Do not fail when the script is missing (`--if-present`). */
  ifPresent(): this {
    this.#ifPresent = true;
    return this;
  }

  /** Arguments forwarded to the script. */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("PnpmTasks.run: .script() is required.");
    }
    const argv = ["run"];
    if (this.#filter !== undefined) argv.push(`--filter=${this.#filter}`);
    if (this.#ifPresent) argv.push("--if-present");
    argv.push(this.#script, ...this.#scriptArgs);
    return argv;
  }
}

/** Settings for `pnpm dlx`. */
export class PnpmDlxSettings extends PnpmSettings {
  #command?: string;
  #package?: string;
  #execArgs: string[] = [];

  /** The command to execute (required). */
  command(name: string): this {
    this.#command = name;
    return this;
  }

  /** The package providing the command (`--package=`). */
  package(spec: string): this {
    this.#package = spec;
    return this;
  }

  /** Arguments forwarded to the command. */
  execArgs(...args: Array<string | number>): this {
    this.#execArgs.push(...args.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#command === undefined) {
      throw new Error("PnpmTasks.dlx: .command() is required.");
    }
    const argv = ["dlx"];
    if (this.#package !== undefined) argv.push(`--package=${this.#package}`);
    argv.push(this.#command, ...this.#execArgs);
    return argv;
  }
}

/** Settings for `pnpm publish`. */
export class PnpmPublishSettings extends PnpmSettings {
  #tag?: string;
  #access?: PnpmAccess;
  #noGitChecks = false;
  #dryRun = false;

  /** Publish under a dist-tag (`--tag=`). */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /** Set the package access level (`--access=`). */
  access(level: PnpmAccess): this {
    this.#access = level;
    return this;
  }

  /** Skip the clean-working-tree checks (`--no-git-checks`). */
  noGitChecks(): this {
    this.#noGitChecks = true;
    return this;
  }

  /** Report what would be published without uploading (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["publish"];
    if (this.#tag !== undefined) argv.push(`--tag=${this.#tag}`);
    if (this.#access !== undefined) argv.push(`--access=${this.#access}`);
    if (this.#noGitChecks) argv.push("--no-git-checks");
    if (this.#dryRun) argv.push("--dry-run");
    return argv;
  }
}

/** The shape of {@link PnpmTasks}. */
export interface PnpmTasksApi {
  /** Install dependencies: `pnpm install`. */
  install(configure?: Configure<PnpmInstallSettings>): Promise<CommandOutput>;
  /** Add dependencies: `pnpm add`. */
  add(configure?: Configure<PnpmAddSettings>): Promise<CommandOutput>;
  /** Remove dependencies: `pnpm remove`. */
  remove(configure?: Configure<PnpmRemoveSettings>): Promise<CommandOutput>;
  /** Run a package.json script: `pnpm run`. */
  run(configure?: Configure<PnpmRunSettings>): Promise<CommandOutput>;
  /** Download and execute a package binary: `pnpm dlx`. */
  dlx(configure?: Configure<PnpmDlxSettings>): Promise<CommandOutput>;
  /** Publish the package: `pnpm publish`. */
  publish(configure?: Configure<PnpmPublishSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `pnpm` CLI. */
export const PnpmTasks: PnpmTasksApi = {
  /** Install dependencies: `pnpm install`. */
  install(configure?: Configure<PnpmInstallSettings>): Promise<CommandOutput> {
    return runSettings(new PnpmInstallSettings(), configure);
  },
  /** Add dependencies: `pnpm add`. */
  add(configure?: Configure<PnpmAddSettings>): Promise<CommandOutput> {
    return runSettings(new PnpmAddSettings(), configure);
  },
  /** Remove dependencies: `pnpm remove`. */
  remove(configure?: Configure<PnpmRemoveSettings>): Promise<CommandOutput> {
    return runSettings(new PnpmRemoveSettings(), configure);
  },
  /** Run a package.json script: `pnpm run`. */
  run(configure?: Configure<PnpmRunSettings>): Promise<CommandOutput> {
    return runSettings(new PnpmRunSettings(), configure);
  },
  /** Download and execute a package binary: `pnpm dlx`. */
  dlx(configure?: Configure<PnpmDlxSettings>): Promise<CommandOutput> {
    return runSettings(new PnpmDlxSettings(), configure);
  },
  /** Publish the package: `pnpm publish`. */
  publish(configure?: Configure<PnpmPublishSettings>): Promise<CommandOutput> {
    return runSettings(new PnpmPublishSettings(), configure);
  },
};
