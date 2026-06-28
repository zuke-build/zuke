/**
 * `NestTasks` — typed task functions for the NestJS CLI (`nest`), in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { NestTasks } from "jsr:@zuke/nest";
 * await NestTasks.new((s) => s.name("my-app").skipGit());
 * await NestTasks.generate((s) => s.schematic("service").name("users"));
 * await NestTasks.build((s) => s.webpack());
 * ```
 *
 * Each command is a subcommand of `nest` (`new`, `generate`, `build`, `start`,
 * `info`). Arguments stay a discrete argv array end-to-end — never a
 * concatenated shell string — so command construction is injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Shared base for every `nest` subcommand: the binary and argv assembly. */
abstract class NestSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "nest";
  }

  /** The subcommand argv (the verb and its arguments). */
  protected abstract subcommandArgs(): string[];

  protected override buildArgs(): string[] {
    return this.subcommandArgs();
  }
}

/** Settings for `nest new` — scaffold a new NestJS application. */
export class NestNewSettings extends NestSettings {
  #name?: string;
  #directory?: string;
  #skipInstall = false;
  #skipGit = false;
  #strict = false;
  #dryRun = false;
  #packageManager?: string;
  #language?: string;

  /** The application name (positional, required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Generate into this directory (`--directory <p>`). */
  directory(path: PathLike): this {
    this.#directory = String(path);
    return this;
  }

  /** Skip package installation (`--skip-install`). */
  skipInstall(): this {
    this.#skipInstall = true;
    return this;
  }

  /** Skip git repository initialization (`--skip-git`). */
  skipGit(): this {
    this.#skipGit = true;
    return this;
  }

  /** Enable TypeScript strict mode in the generated project (`--strict`). */
  strict(): this {
    this.#strict = true;
    return this;
  }

  /** Report what would be generated without writing files (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Package manager to use, e.g. `npm`/`yarn`/`pnpm` (`--package-manager <v>`). */
  packageManager(value: string): this {
    this.#packageManager = value;
    return this;
  }

  /** Programming language, e.g. `ts`/`js` (`--language <v>`). */
  language(value: string): this {
    this.#language = value;
    return this;
  }

  protected override subcommandArgs(): string[] {
    if (this.#name === undefined) {
      throw new Error("NestTasks.new: .name() is required.");
    }
    const argv = ["new", this.#name];
    if (this.#directory !== undefined) {
      argv.push("--directory", this.#directory);
    }
    if (this.#skipInstall) argv.push("--skip-install");
    if (this.#skipGit) argv.push("--skip-git");
    if (this.#strict) argv.push("--strict");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#packageManager !== undefined) {
      argv.push("--package-manager", this.#packageManager);
    }
    if (this.#language !== undefined) argv.push("--language", this.#language);
    return argv;
  }
}

/** Settings for `nest generate` — generate code from a schematic. */
export class NestGenerateSettings extends NestSettings {
  #schematic?: string;
  #name?: string;
  #project?: string;
  #collection?: string;
  #flat = false;
  #spec = false;
  #noSpec = false;
  #skipImport = false;
  #dryRun = false;

  /** The schematic to generate, e.g. `module`/`service` (positional, required). */
  schematic(value: string): this {
    this.#schematic = value;
    return this;
  }

  /** The name passed to the schematic (positional, optional). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Target project in a monorepo (`--project <v>`). */
  project(value: string): this {
    this.#project = value;
    return this;
  }

  /** Schematics collection to use (`--collection <v>`). */
  collection(value: string): this {
    this.#collection = value;
    return this;
  }

  /** Generate files without a dedicated directory (`--flat`). */
  flat(): this {
    this.#flat = true;
    return this;
  }

  /** Force generation of a spec file (`--spec`). */
  spec(): this {
    this.#spec = true;
    return this;
  }

  /** Disable generation of a spec file (`--no-spec`). */
  noSpec(): this {
    this.#noSpec = true;
    return this;
  }

  /** Skip importing the generated element into its module (`--skip-import`). */
  skipImport(): this {
    this.#skipImport = true;
    return this;
  }

  /** Report what would be generated without writing files (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  protected override subcommandArgs(): string[] {
    if (this.#schematic === undefined) {
      throw new Error("NestTasks.generate: .schematic() is required.");
    }
    const argv = ["generate", this.#schematic];
    if (this.#name !== undefined) argv.push(this.#name);
    if (this.#project !== undefined) argv.push("--project", this.#project);
    if (this.#collection !== undefined) {
      argv.push("--collection", this.#collection);
    }
    if (this.#flat) argv.push("--flat");
    if (this.#spec) argv.push("--spec");
    if (this.#noSpec) argv.push("--no-spec");
    if (this.#skipImport) argv.push("--skip-import");
    if (this.#dryRun) argv.push("--dry-run");
    return argv;
  }
}

/** Settings for `nest build` — compile a NestJS application. */
export class NestBuildSettings extends NestSettings {
  #app?: string;
  #config?: string;
  #path?: string;
  #watch = false;
  #webpack = false;
  #tsc = false;
  #builder?: string;
  #preserveWatchOutput = false;

  /** The application/project to build (positional, optional). */
  app(value: string): this {
    this.#app = value;
    return this;
  }

  /** Path to the Nest CLI configuration file (`--config <p>`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Path to the `tsconfig` file (`--path <p>`). */
  path(path: PathLike): this {
    this.#path = String(path);
    return this;
  }

  /** Rebuild on file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Use the webpack builder (`--webpack`). */
  webpack(): this {
    this.#webpack = true;
    return this;
  }

  /** Use the `tsc` builder (`--tsc`). */
  tsc(): this {
    this.#tsc = true;
    return this;
  }

  /** Builder to use, e.g. `tsc`/`webpack`/`swc` (`--builder <v>`). */
  builder(value: string): this {
    this.#builder = value;
    return this;
  }

  /** Keep prior console output between watch rebuilds (`--preserveWatchOutput`). */
  preserveWatchOutput(): this {
    this.#preserveWatchOutput = true;
    return this;
  }

  protected override subcommandArgs(): string[] {
    const argv = ["build"];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#path !== undefined) argv.push("--path", this.#path);
    if (this.#watch) argv.push("--watch");
    if (this.#webpack) argv.push("--webpack");
    if (this.#tsc) argv.push("--tsc");
    if (this.#builder !== undefined) argv.push("--builder", this.#builder);
    if (this.#preserveWatchOutput) argv.push("--preserveWatchOutput");
    if (this.#app !== undefined) argv.push(this.#app);
    return argv;
  }
}

/** Settings for `nest start` — build and run a NestJS application. */
export class NestStartSettings extends NestSettings {
  #app?: string;
  #config?: string;
  #path?: string;
  #watch = false;
  #debug = false;
  #preserveWatchOutput = false;
  #exec?: string;
  #builder?: string;

  /** The application/project to start (positional, optional). */
  app(value: string): this {
    this.#app = value;
    return this;
  }

  /** Path to the Nest CLI configuration file (`--config <p>`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Path to the `tsconfig` file (`--path <p>`). */
  path(path: PathLike): this {
    this.#path = String(path);
    return this;
  }

  /** Rebuild and restart on file changes (`--watch`). */
  watch(): this {
    this.#watch = true;
    return this;
  }

  /** Start in debug mode (`--debug`). */
  debug(): this {
    this.#debug = true;
    return this;
  }

  /** Keep prior console output between watch rebuilds (`--preserveWatchOutput`). */
  preserveWatchOutput(): this {
    this.#preserveWatchOutput = true;
    return this;
  }

  /** Binary used to run the compiled output (`--exec <v>`). */
  exec(value: string): this {
    this.#exec = value;
    return this;
  }

  /** Builder to use, e.g. `tsc`/`webpack`/`swc` (`--builder <v>`). */
  builder(value: string): this {
    this.#builder = value;
    return this;
  }

  protected override subcommandArgs(): string[] {
    const argv = ["start"];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#path !== undefined) argv.push("--path", this.#path);
    if (this.#watch) argv.push("--watch");
    if (this.#debug) argv.push("--debug");
    if (this.#preserveWatchOutput) argv.push("--preserveWatchOutput");
    if (this.#exec !== undefined) argv.push("--exec", this.#exec);
    if (this.#builder !== undefined) argv.push("--builder", this.#builder);
    if (this.#app !== undefined) argv.push(this.#app);
    return argv;
  }
}

/** Settings for `nest info` — print Nest CLI and project information. */
export class NestInfoSettings extends NestSettings {
  protected override subcommandArgs(): string[] {
    return ["info"];
  }
}

/** The shape of {@link NestTasks}. */
export interface NestTasksApi {
  /** Scaffold a new application: `nest new`. */
  "new"(configure?: Configure<NestNewSettings>): Promise<CommandOutput>;
  /** Generate code from a schematic: `nest generate`. */
  generate(
    configure?: Configure<NestGenerateSettings>,
  ): Promise<CommandOutput>;
  /** Compile an application: `nest build`. */
  build(configure?: Configure<NestBuildSettings>): Promise<CommandOutput>;
  /** Build and run an application: `nest start`. */
  start(configure?: Configure<NestStartSettings>): Promise<CommandOutput>;
  /** Print CLI and project information: `nest info`. */
  info(configure?: Configure<NestInfoSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the NestJS CLI (`nest`). */
export const NestTasks: NestTasksApi = {
  new(configure) {
    return runSettings(new NestNewSettings(), configure);
  },
  generate: (c) => runSettings(new NestGenerateSettings(), c),
  build: (c) => runSettings(new NestBuildSettings(), c),
  start: (c) => runSettings(new NestStartSettings(), c),
  info: (c) => runSettings(new NestInfoSettings(), c),
};
