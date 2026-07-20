# @zuke/terraform

Typed Terraform CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `init`, `validate`,
`plan`, `apply`, `destroy`, `fmt`, and `output`.

```ts
import { TerraformTasks } from "jsr:@zuke/terraform";

await TerraformTasks.init((s) => s.upgrade());
await TerraformTasks.plan((s) => s.out("plan.tfplan").var("env", "prod"));
await TerraformTasks.apply((s) => s.autoApprove().planFile("plan.tfplan"));
```

Each `-var` is emitted as a single `-var=name=value` argv entry, so values are
never re-split by a shell.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/terraform` — typed `TerraformTasks` wrappers for the `terraform` CLI,
for use in Zuke build targets (infrastructure-as-code workflows).

```ts
import { TerraformTasks } from "jsr:@zuke/terraform";

await TerraformTasks.init((s) => s.upgrade());
await TerraformTasks.apply((s) => s.autoApprove().var("env", "prod"));
```
@module

const TerraformTasks: TerraformTasksApi
  Typed task functions for the `terraform` CLI.

class TerraformApplySettings extends TerraformSettings
  Settings for `terraform apply`.

  autoApprove(): this
    Apply without an interactive approval prompt (`-auto-approve`).
  var(name: string, value: string): this
    Set an input variable (`-var=name=value`); repeatable.
  varFile(path: string): this
    Load variables from a file (`-var-file=`); repeatable.
  noInput(): this
    Do not prompt for input (`-input=false`).
  planFile(path: string): this
    Apply a previously saved plan file (positional argument).
  override protected buildArgs(): string[]
    Assemble the `terraform apply` argv.

class TerraformDestroySettings extends TerraformSettings
  Settings for `terraform destroy`.

  autoApprove(): this
    Destroy without an interactive approval prompt (`-auto-approve`).
  var(name: string, value: string): this
    Set an input variable (`-var=name=value`); repeatable.
  varFile(path: string): this
    Load variables from a file (`-var-file=`); repeatable.
  override protected buildArgs(): string[]
    Assemble the `terraform destroy` argv.

class TerraformFmtSettings extends TerraformSettings
  Settings for `terraform fmt`.

  check(): this
    Check formatting without writing changes (`-check`).
  recursive(): this
    Also process nested directories (`-recursive`).
  diff(): this
    Show a diff of formatting changes (`-diff`).
  override protected buildArgs(): string[]
    Assemble the `terraform fmt` argv.

class TerraformInitSettings extends TerraformSettings
  Settings for `terraform init`.

  upgrade(): this
    Upgrade modules and plugins to the latest versions (`-upgrade`).
  reconfigure(): this
    Reconfigure the backend, ignoring saved config (`-reconfigure`).
  noBackend(): this
    Disable backend initialization (`-backend=false`).
  noInput(): this
    Do not prompt for input (`-input=false`).
  override protected buildArgs(): string[]
    Assemble the `terraform init` argv.

class TerraformOutputSettings extends TerraformSettings
  Settings for `terraform output`.

  json(): this
    Emit machine-readable JSON output (`-json`).
  raw(): this
    Emit a single value with no quotes (`-raw`); requires a name.
  name(value: string): this
    Read a single named output (positional argument).
  override protected buildArgs(): string[]
    Assemble the `terraform output` argv.

class TerraformPlanSettings extends TerraformSettings
  Settings for `terraform plan`.

  out(path: string): this
    Write the plan to a file (`-out=`).
  var(name: string, value: string): this
    Set an input variable (`-var=name=value`); repeatable.
  varFile(path: string): this
    Load variables from a file (`-var-file=`); repeatable.
  destroy(): this
    Plan a destroy run (`-destroy`).
  noInput(): this
    Do not prompt for input (`-input=false`).
  override protected buildArgs(): string[]
    Assemble the `terraform plan` argv.

abstract class TerraformSettings extends ToolSettings
  Base for all `terraform` subcommand settings: binary is `terraform`.

  override protected defaultTool(): string
    The invoked binary: `terraform`.

class TerraformValidateSettings extends TerraformSettings
  Settings for `terraform validate`.

  json(): this
    Emit machine-readable JSON output (`-json`).
  override protected buildArgs(): string[]
    Assemble the `terraform validate` argv.

interface TerraformTasksApi
  The shape of {@link TerraformTasks}.

  init(configure?: Configure<TerraformInitSettings>): Promise<CommandOutput>
    Initialize a working directory: `terraform init`.
  validate(configure?: Configure<TerraformValidateSettings>): Promise<CommandOutput>
    Validate the configuration: `terraform validate`.
  plan(configure?: Configure<TerraformPlanSettings>): Promise<CommandOutput>
    Create an execution plan: `terraform plan`.
  apply(configure?: Configure<TerraformApplySettings>): Promise<CommandOutput>
    Apply the changes: `terraform apply`.
  destroy(configure?: Configure<TerraformDestroySettings>): Promise<CommandOutput>
    Destroy managed infrastructure: `terraform destroy`.
  fmt(configure?: Configure<TerraformFmtSettings>): Promise<CommandOutput>
    Format configuration files: `terraform fmt`.
  output(configure?: Configure<TerraformOutputSettings>): Promise<CommandOutput>
    Read output values: `terraform output`.
````

</details>

<!-- ZUKE:API:END -->
