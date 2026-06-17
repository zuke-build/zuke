/**
 * `TofuTasks` — typed task functions for the OpenTofu CLI (`tofu`), in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { TofuTasks } from "jsr:@zuke/tofu";
 * await TofuTasks.init((s) => s.upgrade());
 * await TofuTasks.apply((s) => s.autoApprove().var("env", "prod"));
 * ```
 *
 * OpenTofu mirrors Terraform's command surface and its single-dash flags
 * (`-out`, `-var`). Each `-var` is emitted as `-var=name=value`, a single argv
 * entry, so values are never re-split by a shell. On Windows the shared tooling
 * base retries through `cmd /c` automatically when direct spawning fails.
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Base for all `tofu` subcommand settings: binary is `tofu`. */
abstract class TofuSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "tofu";
  }
}

/** Render `-var=name=value` argv entries from collected pairs. */
function varArgs(vars: Array<[string, string]>): string[] {
  return vars.map(([name, value]) => `-var=${name}=${value}`);
}

/** Settings for `tofu init`. */
export class TofuInitSettings extends TofuSettings {
  #upgrade = false;
  #reconfigure = false;
  #noBackend = false;
  #noInput = false;

  /** Upgrade modules and plugins to the latest versions (`-upgrade`). */
  upgrade(): this {
    this.#upgrade = true;
    return this;
  }

  /** Reconfigure the backend, ignoring saved config (`-reconfigure`). */
  reconfigure(): this {
    this.#reconfigure = true;
    return this;
  }

  /** Disable backend initialization (`-backend=false`). */
  noBackend(): this {
    this.#noBackend = true;
    return this;
  }

  /** Do not prompt for input (`-input=false`). */
  noInput(): this {
    this.#noInput = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["init"];
    if (this.#upgrade) argv.push("-upgrade");
    if (this.#reconfigure) argv.push("-reconfigure");
    if (this.#noBackend) argv.push("-backend=false");
    if (this.#noInput) argv.push("-input=false");
    return argv;
  }
}

/** Settings for `tofu validate`. */
export class TofuValidateSettings extends TofuSettings {
  #json = false;

  /** Emit machine-readable JSON output (`-json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["validate"];
    if (this.#json) argv.push("-json");
    return argv;
  }
}

/** Settings for `tofu plan`. */
export class TofuPlanSettings extends TofuSettings {
  #out?: string;
  #vars: Array<[string, string]> = [];
  #varFiles: string[] = [];
  #destroy = false;
  #noInput = false;

  /** Write the plan to a file (`-out=`). */
  out(path: string): this {
    this.#out = path;
    return this;
  }

  /** Set an input variable (`-var=name=value`); repeatable. */
  var(name: string, value: string): this {
    this.#vars.push([name, value]);
    return this;
  }

  /** Load variables from a file (`-var-file=`); repeatable. */
  varFile(path: string): this {
    this.#varFiles.push(path);
    return this;
  }

  /** Plan a destroy run (`-destroy`). */
  destroy(): this {
    this.#destroy = true;
    return this;
  }

  /** Do not prompt for input (`-input=false`). */
  noInput(): this {
    this.#noInput = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["plan"];
    if (this.#out !== undefined) argv.push(`-out=${this.#out}`);
    if (this.#destroy) argv.push("-destroy");
    if (this.#noInput) argv.push("-input=false");
    argv.push(...varArgs(this.#vars));
    for (const f of this.#varFiles) argv.push(`-var-file=${f}`);
    return argv;
  }
}

/** Settings for `tofu apply`. */
export class TofuApplySettings extends TofuSettings {
  #autoApprove = false;
  #vars: Array<[string, string]> = [];
  #varFiles: string[] = [];
  #noInput = false;
  #planFile?: string;

  /** Apply without an interactive approval prompt (`-auto-approve`). */
  autoApprove(): this {
    this.#autoApprove = true;
    return this;
  }

  /** Set an input variable (`-var=name=value`); repeatable. */
  var(name: string, value: string): this {
    this.#vars.push([name, value]);
    return this;
  }

  /** Load variables from a file (`-var-file=`); repeatable. */
  varFile(path: string): this {
    this.#varFiles.push(path);
    return this;
  }

  /** Do not prompt for input (`-input=false`). */
  noInput(): this {
    this.#noInput = true;
    return this;
  }

  /** Apply a previously saved plan file (positional argument). */
  planFile(path: string): this {
    this.#planFile = path;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["apply"];
    if (this.#autoApprove) argv.push("-auto-approve");
    if (this.#noInput) argv.push("-input=false");
    argv.push(...varArgs(this.#vars));
    for (const f of this.#varFiles) argv.push(`-var-file=${f}`);
    if (this.#planFile !== undefined) argv.push(this.#planFile);
    return argv;
  }
}

/** Settings for `tofu destroy`. */
export class TofuDestroySettings extends TofuSettings {
  #autoApprove = false;
  #vars: Array<[string, string]> = [];
  #varFiles: string[] = [];

  /** Destroy without an interactive approval prompt (`-auto-approve`). */
  autoApprove(): this {
    this.#autoApprove = true;
    return this;
  }

  /** Set an input variable (`-var=name=value`); repeatable. */
  var(name: string, value: string): this {
    this.#vars.push([name, value]);
    return this;
  }

  /** Load variables from a file (`-var-file=`); repeatable. */
  varFile(path: string): this {
    this.#varFiles.push(path);
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["destroy"];
    if (this.#autoApprove) argv.push("-auto-approve");
    argv.push(...varArgs(this.#vars));
    for (const f of this.#varFiles) argv.push(`-var-file=${f}`);
    return argv;
  }
}

/** Settings for `tofu fmt`. */
export class TofuFmtSettings extends TofuSettings {
  #check = false;
  #recursive = false;
  #diff = false;

  /** Check formatting without writing changes (`-check`). */
  check(): this {
    this.#check = true;
    return this;
  }

  /** Also process nested directories (`-recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Show a diff of formatting changes (`-diff`). */
  diff(): this {
    this.#diff = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["fmt"];
    if (this.#check) argv.push("-check");
    if (this.#recursive) argv.push("-recursive");
    if (this.#diff) argv.push("-diff");
    return argv;
  }
}

/** Settings for `tofu output`. */
export class TofuOutputSettings extends TofuSettings {
  #json = false;
  #raw = false;
  #name?: string;

  /** Emit machine-readable JSON output (`-json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Emit a single value with no quotes (`-raw`); requires a name. */
  raw(): this {
    this.#raw = true;
    return this;
  }

  /** Read a single named output (positional argument). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["output"];
    if (this.#json) argv.push("-json");
    if (this.#raw) argv.push("-raw");
    if (this.#name !== undefined) argv.push(this.#name);
    return argv;
  }
}

/** The shape of {@link TofuTasks}. */
export interface TofuTasksApi {
  /** Initialize a working directory: `tofu init`. */
  init(configure?: Configure<TofuInitSettings>): Promise<CommandOutput>;
  /** Validate the configuration: `tofu validate`. */
  validate(configure?: Configure<TofuValidateSettings>): Promise<CommandOutput>;
  /** Create an execution plan: `tofu plan`. */
  plan(configure?: Configure<TofuPlanSettings>): Promise<CommandOutput>;
  /** Apply the changes: `tofu apply`. */
  apply(configure?: Configure<TofuApplySettings>): Promise<CommandOutput>;
  /** Destroy managed infrastructure: `tofu destroy`. */
  destroy(configure?: Configure<TofuDestroySettings>): Promise<CommandOutput>;
  /** Format configuration files: `tofu fmt`. */
  fmt(configure?: Configure<TofuFmtSettings>): Promise<CommandOutput>;
  /** Read output values: `tofu output`. */
  output(configure?: Configure<TofuOutputSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the OpenTofu CLI. */
export const TofuTasks: TofuTasksApi = {
  /** Initialize a working directory: `tofu init`. */
  init(configure?: Configure<TofuInitSettings>): Promise<CommandOutput> {
    return runSettings(new TofuInitSettings(), configure);
  },
  /** Validate the configuration: `tofu validate`. */
  validate(
    configure?: Configure<TofuValidateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new TofuValidateSettings(), configure);
  },
  /** Create an execution plan: `tofu plan`. */
  plan(configure?: Configure<TofuPlanSettings>): Promise<CommandOutput> {
    return runSettings(new TofuPlanSettings(), configure);
  },
  /** Apply the changes: `tofu apply`. */
  apply(configure?: Configure<TofuApplySettings>): Promise<CommandOutput> {
    return runSettings(new TofuApplySettings(), configure);
  },
  /** Destroy managed infrastructure: `tofu destroy`. */
  destroy(configure?: Configure<TofuDestroySettings>): Promise<CommandOutput> {
    return runSettings(new TofuDestroySettings(), configure);
  },
  /** Format configuration files: `tofu fmt`. */
  fmt(configure?: Configure<TofuFmtSettings>): Promise<CommandOutput> {
    return runSettings(new TofuFmtSettings(), configure);
  },
  /** Read output values: `tofu output`. */
  output(configure?: Configure<TofuOutputSettings>): Promise<CommandOutput> {
    return runSettings(new TofuOutputSettings(), configure);
  },
};
