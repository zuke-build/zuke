# @zuke/argo-rollouts

Typed [Argo Rollouts](https://argo-rollouts.readthedocs.io) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — the
`kubectl argo rollouts` plugin's `set image`, `promote`, `abort`, `status`,
`undo`, `get`, `list`, `create` and the rest, through an injection-free
settings-lambda API.

```ts
import { ArgoRolloutsTasks } from "@zuke/argo-rollouts";

await ArgoRolloutsTasks.setImage((s) =>
  s.name("api").image("api", "acme/api:1.4.0").namespace("prod")
);
await ArgoRolloutsTasks.status((s) => s.name("api").timeout("10m"));
await ArgoRolloutsTasks.promote((s) => s.name("api").full());
```

The wrapper runs the plugin binary, `kubectl-argo-rollouts`, which takes the
same subcommands as `kubectl argo rollouts`. Traffic weights are not set from
the command line: they come from the `setWeight` steps in the Rollout's own
manifest. A build starts a rollout with `setImage`, advances it past each pause
with `promote`, and backs it out with `abort`.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/argo-rollouts` — typed `ArgoRolloutsTasks` wrappers for the
Argo Rollouts (https://argo-rollouts.readthedocs.io) kubectl plugin
(`kubectl argo rollouts`), for use in Zuke builds.

```ts
import { ArgoRolloutsTasks } from "@zuke/argo-rollouts";

await ArgoRolloutsTasks.setImage((s) =>
  s.name("api").image("api", "acme/api:1.4.0").namespace("prod")
);
await ArgoRolloutsTasks.status((s) => s.name("api").timeout("10m"));
await ArgoRolloutsTasks.promote((s) => s.name("api").full());
```

Traffic weights are not set from the command line: they come from the
`setWeight` steps in the Rollout's own manifest. A build starts a rollout
with {@link ArgoRolloutsTasks.setImage}, advances it past each pause with
{@link ArgoRolloutsTasks.promote}, and backs it out with
{@link ArgoRolloutsTasks.abort}.
@module

const ArgoRolloutsTasks: ArgoRolloutsTasksApi
  Typed task functions for the Argo Rollouts kubectl plugin.

class ArgoRolloutsCreateAnalysisRunSettings extends ArgoRolloutsSettings
  Settings for `create analysisrun` — run an AnalysisTemplate (or, with
  {@link global}, a ClusterAnalysisTemplate) once, from the cluster or a file.

  from(template: string): this
    The template in the cluster to run (`--from`); this or {@link fromFile} is required.
  fromFile(path: PathLike): this
    A local template file to run (`--from-file`); this or {@link from} is required.
  global(): this
    Use a ClusterAnalysisTemplate instead of an AnalysisTemplate (`--global`).
  argument(name: string, value: string): this
    Pass a template argument as `name=value` (`--argument`); repeatable.
  name(value: string): this
    Name the run exactly (`--name`).
  generateName(prefix: string): this
    Let the cluster name the run from this prefix (`--generate-name`).
  instanceId(id: string): this
    The controller instance the run belongs to (`--instance-id`).
  override protected buildArgs(): string[]
    Assemble the `create analysisrun` argv.

class ArgoRolloutsCreateSettings extends ArgoRolloutsSettings
  Settings for `create` — create a Rollout or Experiment from files.

  filename(...paths: PathLike[]): this
    A manifest to create from (`--filename`); repeatable, at least one is required.
  watch(): this
    Keep printing live updates after creating (`--watch`).
  noColor(): this
    Print without colour (`--no-color`).
  override protected buildArgs(): string[]
    Assemble the `create` argv.

class ArgoRolloutsGetExperimentSettings extends ArgoRolloutsSettings
  Settings for `get experiment` — show an experiment's templates and analysis.

  name(value: string): this
    The experiment to show (required).
  watch(): this
    Keep printing live updates (`--watch`).
  noColor(): this
    Print without colour (`--no-color`).
  override protected buildArgs(): string[]
    Assemble the `get experiment <experiment>` argv.

class ArgoRolloutsGetRolloutSettings extends ArgoRolloutsSettings
  Settings for `get rollout` — show a rollout's steps, replica sets and analysis.

  name(value: string): this
    The rollout to show (required).
  watch(): this
    Keep printing live updates (`--watch`).
  noColor(): this
    Print without colour (`--no-color`).
  timeoutSeconds(seconds: number): this
    With {@link watch}, give up after this many seconds (`--timeout-seconds`).
  override protected buildArgs(): string[]
    Assemble the `get rollout <rollout>` argv.

class ArgoRolloutsLintSettings extends ArgoRolloutsSettings
  Settings for `lint` — validate a Rollout manifest without applying it.

  filename(path: PathLike): this
    The manifest to lint (`--filename`, required).
  override protected buildArgs(): string[]
    Assemble the `lint` argv.

class ArgoRolloutsListExperimentsSettings extends ArgoRolloutsSettings
  Settings for `list experiments`.

  allNamespaces(): this
    List across every namespace (`--all-namespaces`).
  watch(): this
    Keep printing changes (`--watch`).
  override protected buildArgs(): string[]
    Assemble the `list experiments` argv.

class ArgoRolloutsListRolloutsSettings extends ArgoRolloutsSettings
  Settings for `list rollouts`.

  allNamespaces(): this
    List across every namespace (`--all-namespaces`).
  name(value: string): this
    Only show the rollout with this name (`--name`).
  timestamps(): this
    With {@link watch}, print a timestamp on each update (`--timestamps`).
  watch(): this
    Keep printing changes (`--watch`).
  override protected buildArgs(): string[]
    Assemble the `list rollouts` argv.

class ArgoRolloutsNamedSettings extends ArgoRolloutsSettings
  Settings for the subcommands whose only operand is a resource name:
  `abort`, `pause`, `retry rollout`, `retry experiment`, `terminate analysisrun` and `terminate experiment`. They differ only in their leading
  tokens, so they share one implementation rather than six copies of it.

  constructor(command: readonly string[], task: string)
    Bind the settings to one subcommand: its leading `command` tokens (e.g.
    `["retry", "rollout"]`) and the `task` name used in error messages.
  name(value: string): this
    The rollout, experiment or analysis run to act on (required).
  override protected buildArgs(): string[]
    Assemble the `<command> <name>` argv.

class ArgoRolloutsPromoteSettings extends ArgoRolloutsSettings
  Settings for `promote` — advance a paused rollout to its next step, or with
  {@link full} skip every remaining step, pause and analysis.

  name(value: string): this
    The rollout to promote (required).
  full(): this
    Promote to the desired version outright, skipping analysis, pauses and steps (`--full`).
  override protected buildArgs(): string[]
    Assemble the `promote <rollout>` argv.

class ArgoRolloutsRestartSettings extends ArgoRolloutsSettings
  Settings for `restart` — restart a rollout's pods, now or after a delay.

  name(value: string): this
    The rollout whose pods to restart (required).
  in(duration: string): this
    Delay the restart, e.g. `"30s"`, `"5m"`, `"1h"` (`--in`).
  override protected buildArgs(): string[]
    Assemble the `restart <rollout>` argv.

class ArgoRolloutsSetImageSettings extends ArgoRolloutsSettings
  Settings for `set image` — point a container of the rollout at a new image,
  which starts a new rollout through the steps its manifest declares.

  name(value: string): this
    The rollout to update (required).
  image(container: string, reference: string): this
    The container and the image to set, as `CONTAINER=IMAGE` (required). Pass
    `"*"` as the container to update every container in the rollout.
  override protected buildArgs(): string[]
    Assemble the `set image <rollout> <container>=<image>` argv.

abstract class ArgoRolloutsSettings extends ToolSettings
  Base for all Argo Rollouts subcommand settings. The binary is the plugin
  itself, `kubectl-argo-rollouts`, which takes the same subcommands as
  `kubectl argo rollouts`; the cluster-targeting flags (`--namespace`,
  `--context`, `--kubeconfig`) are shared by every subcommand.

  override protected defaultTool(): string
    The plugin binary invoked by every subcommand: `kubectl-argo-rollouts`.
  namespace(name: string): this
    Target a namespace (`--namespace`).
  context(name: string): this
    Use a named kubeconfig context (`--context`).
  kubeconfig(path: PathLike): this
    Use an explicit kubeconfig file (`--kubeconfig`).
  protected globalArgs(): string[]
    The cluster-targeting flags shared by every subcommand.

class ArgoRolloutsStatusSettings extends ArgoRolloutsSettings
  Settings for `status` — report a rollout's status, by default watching until
  it completes or degrades.

  name(value: string): this
    The rollout to report on (required).
  timeout(duration: string): this
    How long to watch before giving up, e.g. `"10m"`; `"0"` waits forever (`--timeout`).
  noWatch(): this
    Print the current status once instead of watching it (`--watch=false`).
  override protected buildArgs(): string[]
    Assemble the `status <rollout>` argv.

class ArgoRolloutsUndoSettings extends ArgoRolloutsSettings
  Settings for `undo` — roll a rollout back to an earlier revision.

  name(value: string): this
    The rollout to roll back (required).
  toRevision(revision: number): this
    The revision to roll back to; the previous one when unset (`--to-revision`).
  override protected buildArgs(): string[]
    Assemble the `undo <rollout>` argv.

class ArgoRolloutsVersionSettings extends ArgoRolloutsSettings
  Settings for `version`.

  short(): this
    Print only the plugin's version number (`--short`).
  override protected buildArgs(): string[]
    Assemble the `version` argv.

interface ArgoRolloutsTasksApi
  The shape of {@link ArgoRolloutsTasks}.

  setImage(configure?: Configure<ArgoRolloutsSetImageSettings>): Promise<CommandOutput>
    Point a rollout's container at a new image, starting a rollout: `set image`.
  promote(configure?: Configure<ArgoRolloutsPromoteSettings>): Promise<CommandOutput>
    Advance a paused rollout, or promote it fully: `promote`.
  abort(configure?: Configure<ArgoRolloutsNamedSettings>): Promise<CommandOutput>
    Abort a rollout, returning traffic to the stable version: `abort`.
  pause(configure?: Configure<ArgoRolloutsNamedSettings>): Promise<CommandOutput>
    Pause a rollout where it is: `pause`.
  status(configure?: Configure<ArgoRolloutsStatusSettings>): Promise<CommandOutput>
    Report, or watch, a rollout's status: `status`.
  undo(configure?: Configure<ArgoRolloutsUndoSettings>): Promise<CommandOutput>
    Roll a rollout back to an earlier revision: `undo`.
  restart(configure?: Configure<ArgoRolloutsRestartSettings>): Promise<CommandOutput>
    Restart a rollout's pods: `restart`.
  retryRollout(configure?: Configure<ArgoRolloutsNamedSettings>): Promise<CommandOutput>
    Retry an aborted rollout: `retry rollout`.
  retryExperiment(configure?: Configure<ArgoRolloutsNamedSettings>): Promise<CommandOutput>
    Retry an experiment: `retry experiment`.
  terminateAnalysisRun(configure?: Configure<ArgoRolloutsNamedSettings>): Promise<CommandOutput>
    Terminate a running analysis run: `terminate analysisrun`.
  terminateExperiment(configure?: Configure<ArgoRolloutsNamedSettings>): Promise<CommandOutput>
    Terminate a running experiment: `terminate experiment`.
  getRollout(configure?: Configure<ArgoRolloutsGetRolloutSettings>): Promise<CommandOutput>
    Show a rollout: `get rollout`.
  getExperiment(configure?: Configure<ArgoRolloutsGetExperimentSettings>): Promise<CommandOutput>
    Show an experiment: `get experiment`.
  listRollouts(configure?: Configure<ArgoRolloutsListRolloutsSettings>): Promise<CommandOutput>
    List rollouts: `list rollouts`.
  listExperiments(configure?: Configure<ArgoRolloutsListExperimentsSettings>): Promise<CommandOutput>
    List experiments: `list experiments`.
  create(configure?: Configure<ArgoRolloutsCreateSettings>): Promise<CommandOutput>
    Create a Rollout or Experiment from files: `create`.
  createAnalysisRun(configure?: Configure<ArgoRolloutsCreateAnalysisRunSettings>): Promise<CommandOutput>
    Run an analysis template once: `create analysisrun`.
  lint(configure?: Configure<ArgoRolloutsLintSettings>): Promise<CommandOutput>
    Validate a Rollout manifest: `lint`.
  version(configure?: Configure<ArgoRolloutsVersionSettings>): Promise<CommandOutput>
    Print the plugin's version: `version`.
````

</details>

<!-- ZUKE:API:END -->
