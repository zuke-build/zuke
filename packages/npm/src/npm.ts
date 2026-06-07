/**
 * `NpmTasks` — typed task functions for the `npm` CLI, in the NUKE
 * `DotNetTasks` style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 * await NpmTasks.run((s) => s.script("build").workspace("app"));
 * ```
 *
 * On Windows, npm ships as a `.cmd` shim; the shared tooling base retries
 * through `cmd /c` automatically when direct spawning fails.
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** A dependency group accepted by npm's `--omit` flag. */
export type NpmOmitType = "dev" | "optional" | "peer";

/** An access level accepted by npm's `--access` flag. */
export type NpmAccess = "public" | "restricted";

/** Base for all `npm` subcommand settings: binary is `npm` from PATH. */
abstract class NpmSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "npm";
  }
}

/** Settings for `npm install`. */
export class NpmInstallSettings extends NpmSettings {
  #packages: string[] = [];
  #saveDev = false;
  #saveExact = false;

  /** Package specs to install; omit to install from package.json. */
  packages(...specs: string[]): this {
    this.#packages.push(...specs);
    return this;
  }

  /** Save to devDependencies (`--save-dev`). */
  saveDev(): this {
    this.#saveDev = true;
    return this;
  }

  /** Pin exact versions (`--save-exact`). */
  saveExact(): this {
    this.#saveExact = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["install"];
    if (this.#saveDev) argv.push("--save-dev");
    if (this.#saveExact) argv.push("--save-exact");
    argv.push(...this.#packages);
    return argv;
  }
}

/** Settings for `npm ci`. */
export class NpmCiSettings extends NpmSettings {
  #omit: NpmOmitType[] = [];

  /** Skip a dependency group (`--omit=dev` etc.); repeatable. */
  omit(type: NpmOmitType): this {
    this.#omit.push(type);
    return this;
  }

  protected override buildArgs(): string[] {
    return ["ci", ...this.#omit.map((t) => `--omit=${t}`)];
  }
}

/** Settings for `npm run`. */
export class NpmRunSettings extends NpmSettings {
  #script?: string;
  #workspace?: string;
  #ifPresent = false;
  #scriptArgs: string[] = [];

  /** The package.json script to run (required). */
  script(name: string): this {
    this.#script = name;
    return this;
  }

  /** Run in a specific workspace (`--workspace=`). */
  workspace(name: string): this {
    this.#workspace = name;
    return this;
  }

  /** Do not fail when the script is missing (`--if-present`). */
  ifPresent(): this {
    this.#ifPresent = true;
    return this;
  }

  /** Arguments forwarded to the script (after `--`). */
  scriptArgs(...args: Array<string | number>): this {
    this.#scriptArgs.push(...args.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#script === undefined) {
      throw new Error("NpmTasks.run: .script() is required.");
    }
    const argv = ["run"];
    if (this.#workspace !== undefined) {
      argv.push(`--workspace=${this.#workspace}`);
    }
    if (this.#ifPresent) argv.push("--if-present");
    argv.push(this.#script);
    if (this.#scriptArgs.length > 0) argv.push("--", ...this.#scriptArgs);
    return argv;
  }
}

/** Settings for `npm exec`. */
export class NpmExecSettings extends NpmSettings {
  #command?: string;
  #package?: string;
  #yes = false;
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

  /** Skip the install prompt (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** Arguments forwarded to the command (after `--`). */
  execArgs(...args: Array<string | number>): this {
    this.#execArgs.push(...args.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#command === undefined) {
      throw new Error("NpmTasks.exec: .command() is required.");
    }
    const argv = ["exec"];
    if (this.#yes) argv.push("--yes");
    if (this.#package !== undefined) argv.push(`--package=${this.#package}`);
    argv.push(this.#command);
    if (this.#execArgs.length > 0) argv.push("--", ...this.#execArgs);
    return argv;
  }
}

/** Settings for `npm publish`. */
export class NpmPublishSettings extends NpmSettings {
  #tag?: string;
  #access?: NpmAccess;
  #dryRun = false;
  #otp?: string;

  /** Publish under a dist-tag (`--tag=`). */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /** Set the package access level (`--access=`). */
  access(level: NpmAccess): this {
    this.#access = level;
    return this;
  }

  /** Report what would be published without uploading (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Provide a one-time password (`--otp=`). */
  otp(code: string): this {
    this.#otp = code;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["publish"];
    if (this.#tag !== undefined) argv.push(`--tag=${this.#tag}`);
    if (this.#access !== undefined) argv.push(`--access=${this.#access}`);
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#otp !== undefined) argv.push(`--otp=${this.#otp}`);
    return argv;
  }
}

/** Settings for `npm version`. */
export class NpmVersionSettings extends NpmSettings {
  #bump?: string;
  #message?: string;
  #noGitTagVersion = false;

  /** The bump: `patch` | `minor` | `major` or an explicit semver (required). */
  bump(value: string): this {
    this.#bump = value;
    return this;
  }

  /** Commit message; `%s` expands to the new version (`--message`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Do not create a git commit and tag (`--no-git-tag-version`). */
  noGitTagVersion(): this {
    this.#noGitTagVersion = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#bump === undefined) {
      throw new Error("NpmTasks.version: .bump() is required.");
    }
    const argv = ["version", this.#bump];
    if (this.#message !== undefined) argv.push("--message", this.#message);
    if (this.#noGitTagVersion) argv.push("--no-git-tag-version");
    return argv;
  }
}

/** Typed task functions for the `npm` CLI. */
export const NpmTasks = {
  /** Install dependencies: `npm install`. */
  install(configure?: Configure<NpmInstallSettings>): Promise<CommandOutput> {
    return runSettings(new NpmInstallSettings(), configure);
  },
  /** Clean install from the lockfile: `npm ci`. */
  ci(configure?: Configure<NpmCiSettings>): Promise<CommandOutput> {
    return runSettings(new NpmCiSettings(), configure);
  },
  /** Run a package.json script: `npm run`. */
  run(configure?: Configure<NpmRunSettings>): Promise<CommandOutput> {
    return runSettings(new NpmRunSettings(), configure);
  },
  /** Execute a package binary: `npm exec`. */
  exec(configure?: Configure<NpmExecSettings>): Promise<CommandOutput> {
    return runSettings(new NpmExecSettings(), configure);
  },
  /** Publish the package: `npm publish`. */
  publish(configure?: Configure<NpmPublishSettings>): Promise<CommandOutput> {
    return runSettings(new NpmPublishSettings(), configure);
  },
  /** Bump the package version: `npm version`. */
  version(configure?: Configure<NpmVersionSettings>): Promise<CommandOutput> {
    return runSettings(new NpmVersionSettings(), configure);
  },
};
