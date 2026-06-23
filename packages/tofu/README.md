# @zuke/tofu

Typed OpenTofu CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `init`, `validate`,
`plan`, `apply`, `destroy`, `fmt`, and `output`.

```ts
import { TofuTasks } from "jsr:@zuke/tofu";

await TofuTasks.init((s) => s.upgrade());
await TofuTasks.plan((s) => s.out("plan.tfplan").var("env", "prod"));
await TofuTasks.apply((s) => s.autoApprove().planFile("plan.tfplan"));
```

OpenTofu mirrors Terraform's command surface; each `-var` is emitted as a single
`-var=name=value` argv entry, so values are never re-split by a shell.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/tofu` — typed `TofuTasks` wrappers for the OpenTofu CLI (`tofu`), for
use in Zuke build targets (infrastructure-as-code workflows).

```ts
import { TofuTasks } from "jsr:@zuke/tofu";

await TofuTasks.init((s) => s.upgrade());
await TofuTasks.apply((s) => s.autoApprove().var("env", "prod"));
```
@module

const TofuTasks: TofuTasksApi
  Typed task functions for the OpenTofu CLI.

class TofuApplySettings extends TofuSettings
  Settings for `tofu apply`.

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

class TofuDestroySettings extends TofuSettings
  Settings for `tofu destroy`.

  autoApprove(): this
    Destroy without an interactive approval prompt (`-auto-approve`).
  var(name: string, value: string): this
    Set an input variable (`-var=name=value`); repeatable.
  varFile(path: string): this
    Load variables from a file (`-var-file=`); repeatable.
  override protected buildArgs(): string[]

class TofuFmtSettings extends TofuSettings
  Settings for `tofu fmt`.

  check(): this
    Check formatting without writing changes (`-check`).
  recursive(): this
    Also process nested directories (`-recursive`).
  diff(): this
    Show a diff of formatting changes (`-diff`).
  override protected buildArgs(): string[]

class TofuInitSettings extends TofuSettings
  Settings for `tofu init`.

  upgrade(): this
    Upgrade modules and plugins to the latest versions (`-upgrade`).
  reconfigure(): this
    Reconfigure the backend, ignoring saved config (`-reconfigure`).
  noBackend(): this
    Disable backend initialization (`-backend=false`).
  noInput(): this
    Do not prompt for input (`-input=false`).
  override protected buildArgs(): string[]

class TofuOutputSettings extends TofuSettings
  Settings for `tofu output`.

  json(): this
    Emit machine-readable JSON output (`-json`).
  raw(): this
    Emit a single value with no quotes (`-raw`); requires a name.
  name(value: string): this
    Read a single named output (positional argument).
  override protected buildArgs(): string[]

class TofuPlanSettings extends TofuSettings
  Settings for `tofu plan`.

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

class TofuValidateSettings extends TofuSettings
  Settings for `tofu validate`.

  json(): this
    Emit machine-readable JSON output (`-json`).
  override protected buildArgs(): string[]

interface TofuTasksApi
  The shape of {@link TofuTasks}.

  init(configure?: Configure<TofuInitSettings>): Promise<CommandOutput>
    Initialize a working directory: `tofu init`.
  validate(configure?: Configure<TofuValidateSettings>): Promise<CommandOutput>
    Validate the configuration: `tofu validate`.
  plan(configure?: Configure<TofuPlanSettings>): Promise<CommandOutput>
    Create an execution plan: `tofu plan`.
  apply(configure?: Configure<TofuApplySettings>): Promise<CommandOutput>
    Apply the changes: `tofu apply`.
  destroy(configure?: Configure<TofuDestroySettings>): Promise<CommandOutput>
    Destroy managed infrastructure: `tofu destroy`.
  fmt(configure?: Configure<TofuFmtSettings>): Promise<CommandOutput>
    Format configuration files: `tofu fmt`.
  output(configure?: Configure<TofuOutputSettings>): Promise<CommandOutput>
    Read output values: `tofu output`.
````

</details>

<!-- ZUKE:API:END -->
