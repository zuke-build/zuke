/**
 * `TerraformTasks` — typed task functions for the `terraform` CLI, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { TerraformTasks } from "jsr:@zuke/terraform";
 * await TerraformTasks.init((s) => s.upgrade());
 * await TerraformTasks.apply((s) => s.autoApprove().var("env", "prod"));
 * ```
 *
 * Terraform uses single-dash flags (`-out`, `-var`); the wrappers below build
 * them exactly. Each `-var` is emitted as `-var=name=value`, a single argv
 * entry, so values are never re-split by a shell. On Windows the shared tooling
 * base retries through `cmd /c` automatically when direct spawning fails.
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Base for all `terraform` subcommand settings: binary is `terraform`. */
export abstract class TerraformSettings extends ToolSettings {
  /** The invoked binary: `terraform`. */
  protected override defaultTool(): string {
    return "terraform";
  }
}

/** Render `-var=name=value` argv entries from collected pairs. */
function varArgs(vars: Array<[string, string]>): string[] {
  return vars.map(([name, value]) => `-var=${name}=${value}`);
}

/** Settings for `terraform init`. */
export class TerraformInitSettings extends TerraformSettings {
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

  /** Assemble the `terraform init` argv. */
  protected override buildArgs(): string[] {
    const argv = ["init"];
    if (this.#upgrade) argv.push("-upgrade");
    if (this.#reconfigure) argv.push("-reconfigure");
    if (this.#noBackend) argv.push("-backend=false");
    if (this.#noInput) argv.push("-input=false");
    return argv;
  }
}

/** Settings for `terraform validate`. */
export class TerraformValidateSettings extends TerraformSettings {
  #json = false;

  /** Emit machine-readable JSON output (`-json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Assemble the `terraform validate` argv. */
  protected override buildArgs(): string[] {
    const argv = ["validate"];
    if (this.#json) argv.push("-json");
    return argv;
  }
}

/** Settings for `terraform plan`. */
export class TerraformPlanSettings extends TerraformSettings {
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

  /** Assemble the `terraform plan` argv. */
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

/** Settings for `terraform apply`. */
export class TerraformApplySettings extends TerraformSettings {
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

  /** Assemble the `terraform apply` argv. */
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

/** Settings for `terraform destroy`. */
export class TerraformDestroySettings extends TerraformSettings {
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

  /** Assemble the `terraform destroy` argv. */
  protected override buildArgs(): string[] {
    const argv = ["destroy"];
    if (this.#autoApprove) argv.push("-auto-approve");
    argv.push(...varArgs(this.#vars));
    for (const f of this.#varFiles) argv.push(`-var-file=${f}`);
    return argv;
  }
}

/** Settings for `terraform fmt`. */
export class TerraformFmtSettings extends TerraformSettings {
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

  /** Assemble the `terraform fmt` argv. */
  protected override buildArgs(): string[] {
    const argv = ["fmt"];
    if (this.#check) argv.push("-check");
    if (this.#recursive) argv.push("-recursive");
    if (this.#diff) argv.push("-diff");
    return argv;
  }
}

/** Settings for `terraform output`. */
export class TerraformOutputSettings extends TerraformSettings {
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

  /** Assemble the `terraform output` argv. */
  protected override buildArgs(): string[] {
    const argv = ["output"];
    if (this.#json) argv.push("-json");
    if (this.#raw) argv.push("-raw");
    if (this.#name !== undefined) argv.push(this.#name);
    return argv;
  }
}

/** The shape of {@link TerraformTasks}. */
export interface TerraformTasksApi {
  /** Initialize a working directory: `terraform init`. */
  init(configure?: Configure<TerraformInitSettings>): Promise<CommandOutput>;
  /** Validate the configuration: `terraform validate`. */
  validate(
    configure?: Configure<TerraformValidateSettings>,
  ): Promise<CommandOutput>;
  /** Create an execution plan: `terraform plan`. */
  plan(configure?: Configure<TerraformPlanSettings>): Promise<CommandOutput>;
  /** Apply the changes: `terraform apply`. */
  apply(configure?: Configure<TerraformApplySettings>): Promise<CommandOutput>;
  /** Destroy managed infrastructure: `terraform destroy`. */
  destroy(
    configure?: Configure<TerraformDestroySettings>,
  ): Promise<CommandOutput>;
  /** Format configuration files: `terraform fmt`. */
  fmt(configure?: Configure<TerraformFmtSettings>): Promise<CommandOutput>;
  /** Read output values: `terraform output`. */
  output(
    configure?: Configure<TerraformOutputSettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for the `terraform` CLI. */
export const TerraformTasks: TerraformTasksApi = {
  /** Initialize a working directory: `terraform init`. */
  init(configure?: Configure<TerraformInitSettings>): Promise<CommandOutput> {
    return runSettings(new TerraformInitSettings(), configure);
  },
  /** Validate the configuration: `terraform validate`. */
  validate(
    configure?: Configure<TerraformValidateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new TerraformValidateSettings(), configure);
  },
  /** Create an execution plan: `terraform plan`. */
  plan(configure?: Configure<TerraformPlanSettings>): Promise<CommandOutput> {
    return runSettings(new TerraformPlanSettings(), configure);
  },
  /** Apply the changes: `terraform apply`. */
  apply(configure?: Configure<TerraformApplySettings>): Promise<CommandOutput> {
    return runSettings(new TerraformApplySettings(), configure);
  },
  /** Destroy managed infrastructure: `terraform destroy`. */
  destroy(
    configure?: Configure<TerraformDestroySettings>,
  ): Promise<CommandOutput> {
    return runSettings(new TerraformDestroySettings(), configure);
  },
  /** Format configuration files: `terraform fmt`. */
  fmt(configure?: Configure<TerraformFmtSettings>): Promise<CommandOutput> {
    return runSettings(new TerraformFmtSettings(), configure);
  },
  /** Read output values: `terraform output`. */
  output(
    configure?: Configure<TerraformOutputSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new TerraformOutputSettings(), configure);
  },
};
