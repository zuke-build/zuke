/**
 * `CypressTasks` — typed task functions for the [Cypress](https://cypress.io)
 * CLI, in the settings-lambda style: configure a fluent settings object in a
 * lambda, and the task function builds the command line and executes it.
 *
 * ```ts
 * import { CypressTasks } from "jsr:@zuke/cypress";
 * await CypressTasks.run((s) => s.e2e().browser("chrome").spec("cypress/e2e/**"));
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
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

/** Base for all `cypress` subcommand settings: the binary is `cypress`. */
export abstract class CypressSettings extends ToolSettings {
  /** The default tool binary: `cypress`. */
  protected override defaultTool(): string {
    return "cypress";
  }
}

/**
 * Base for the `run`/`open` commands, which share testing-type selection, a
 * browser, a config file, and a project path.
 */
export abstract class CypressTestingSettings extends CypressSettings {
  #e2e = false;
  #component = false;
  #browser?: string;
  #configFile?: string;
  #project?: string;

  /** Run end-to-end tests (`--e2e`). */
  e2e(): this {
    this.#e2e = true;
    return this;
  }

  /** Run component tests (`--component`). */
  component(): this {
    this.#component = true;
    return this;
  }

  /** Choose the browser, e.g. `chrome` or `electron` (`--browser`). */
  browser(name: string): this {
    this.#browser = name;
    return this;
  }

  /** Use an explicit config file (`--config-file`). */
  configFile(path: PathLike): this {
    this.#configFile = String(path);
    return this;
  }

  /** Run against a project at the given path (`--project`). */
  project(path: PathLike): this {
    this.#project = String(path);
    return this;
  }

  /** The testing-type/browser/config/project arguments shared by run and open. */
  protected sharedArgs(): string[] {
    const argv: string[] = [];
    if (this.#e2e) argv.push("--e2e");
    if (this.#component) argv.push("--component");
    if (this.#browser !== undefined) argv.push("--browser", this.#browser);
    if (this.#configFile !== undefined) {
      argv.push("--config-file", this.#configFile);
    }
    if (this.#project !== undefined) argv.push("--project", this.#project);
    return argv;
  }
}

/** Settings for `cypress run` (headless). */
export class CypressRunSettings extends CypressTestingSettings {
  #headed = false;
  #spec?: string;
  #record = false;
  #parallel = false;
  #tag?: string;
  #port?: number;

  /** Run in a headed browser (`--headed`). */
  headed(): this {
    this.#headed = true;
    return this;
  }

  /** Glob of spec files to run (`--spec`). */
  spec(pattern: string): this {
    this.#spec = pattern;
    return this;
  }

  /** Record the run to Cypress Cloud (`--record`). */
  record(): this {
    this.#record = true;
    return this;
  }

  /** Run in parallel across machines (`--parallel`). */
  parallel(): this {
    this.#parallel = true;
    return this;
  }

  /** Tag the recorded run (`--tag`). */
  tag(value: string): this {
    this.#tag = value;
    return this;
  }

  /** Override the server port (`--port`). */
  port(value: number): this {
    this.#port = value;
    return this;
  }

  /** Assemble the `cypress run` argv. */
  protected override buildArgs(): string[] {
    const argv = ["run", ...this.sharedArgs()];
    if (this.#headed) argv.push("--headed");
    if (this.#spec !== undefined) argv.push("--spec", this.#spec);
    if (this.#record) argv.push("--record");
    if (this.#parallel) argv.push("--parallel");
    if (this.#tag !== undefined) argv.push("--tag", this.#tag);
    if (this.#port !== undefined) argv.push("--port", String(this.#port));
    return argv;
  }
}

/** Settings for `cypress open` (interactive). */
export class CypressOpenSettings extends CypressTestingSettings {
  /** Assemble the `cypress open` argv. */
  protected override buildArgs(): string[] {
    return ["open", ...this.sharedArgs()];
  }
}

/** Settings for `cypress install` (the bundled binary). */
export class CypressInstallSettings extends CypressSettings {
  #force = false;

  /** Reinstall even if already present (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `cypress install` argv. */
  protected override buildArgs(): string[] {
    const argv = ["install"];
    if (this.#force) argv.push("--force");
    return argv;
  }
}

/** Settings for `cypress verify`. */
export class CypressVerifySettings extends CypressSettings {
  /** Assemble the `cypress verify` argv. */
  protected override buildArgs(): string[] {
    return ["verify"];
  }
}

/** Settings for `cypress info`. */
export class CypressInfoSettings extends CypressSettings {
  /** Assemble the `cypress info` argv. */
  protected override buildArgs(): string[] {
    return ["info"];
  }
}

/** The shape of {@link CypressTasks}. */
export interface CypressTasksApi {
  /** Run tests in headless mode: `cypress run`. */
  run(configure?: Configure<CypressRunSettings>): Promise<CommandOutput>;
  /** Open the interactive runner: `cypress open`. */
  open(configure?: Configure<CypressOpenSettings>): Promise<CommandOutput>;
  /** Install the bundled binary: `cypress install`. */
  install(
    configure?: Configure<CypressInstallSettings>,
  ): Promise<CommandOutput>;
  /** Verify the installation: `cypress verify`. */
  verify(configure?: Configure<CypressVerifySettings>): Promise<CommandOutput>;
  /** Print environment info: `cypress info`. */
  info(configure?: Configure<CypressInfoSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `cypress` CLI. */
export const CypressTasks: CypressTasksApi = {
  run(configure?: Configure<CypressRunSettings>): Promise<CommandOutput> {
    return runSettings(new CypressRunSettings(), configure);
  },
  open(configure?: Configure<CypressOpenSettings>): Promise<CommandOutput> {
    return runSettings(new CypressOpenSettings(), configure);
  },
  install(
    configure?: Configure<CypressInstallSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new CypressInstallSettings(), configure);
  },
  verify(configure?: Configure<CypressVerifySettings>): Promise<CommandOutput> {
    return runSettings(new CypressVerifySettings(), configure);
  },
  info(configure?: Configure<CypressInfoSettings>): Promise<CommandOutput> {
    return runSettings(new CypressInfoSettings(), configure);
  },
};
