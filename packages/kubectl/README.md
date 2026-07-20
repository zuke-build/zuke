# @zuke/kubectl

Typed `kubectl` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — deploy to and manage
Kubernetes from a pipeline.

Tasks: `apply`, `create`, `delete`, `get`, `describe`, `logs`, `exec`,
`rollout`, `scale`, `setImage`, `patch`, `portForward`, `wait`, `top`.

```ts
import { KubectlTasks } from "jsr:@zuke/kubectl";

// Deploy and roll forward.
await KubectlTasks.apply((s) => s.file("k8s/").namespace("prod"));
await KubectlTasks.setImage((s) =>
  s.resource("deployment/api").image("api", "api:1.4").namespace("prod")
);
await KubectlTasks.rollout((s) =>
  s.status().resource("deployment/api").namespace("prod").timeout("120s")
);
```

Every task shares the cluster-targeting flags `.namespace(...)`,
`.context(...)`, and `.kubeconfig(...)`. Arguments stay a discrete argv array
end-to-end — never a shell string — so command construction is injection-free.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/kubectl` — typed `kubectl` CLI task wrappers for Zuke builds, for
deploying to and managing Kubernetes from a pipeline.

```ts
import { KubectlTasks } from "jsr:@zuke/kubectl";

await KubectlTasks.apply((s) => s.file("k8s/").namespace("prod"));
await KubectlTasks.setImage((s) =>
  s.resource("deployment/api").image("api", "api:1.4").namespace("prod")
);
await KubectlTasks.rollout((s) =>
  s.status().resource("deployment/api").namespace("prod").timeout("120s")
);
```
@module

function parseNamespaces(json: string): KubernetesNamespace[]
  Parse the JSON text of `kubectl get namespaces -o json` — a `List`, or a
  single namespace object — into {@link KubernetesNamespace} records. Items
  without a `metadata.name` are skipped; empty input yields `[]`. Throws if the
  text is non-empty and not valid JSON.

const KubectlTasks: KubectlTasksApi
  Typed task functions for the `kubectl` CLI.

class KubectlAnnotateSettings extends KubectlSettings
  Settings for `kubectl annotate`.

  resource(...tokens: string[]): this
    Resource tokens, e.g. `("deploy", "api")` or `("pods", "-l", "app=web")`; repeatable.
  annotation(key: string, value: string): this
    Set an annotation as a `key=value` token; repeatable.
  remove(key: string): this
    Remove an annotation, rendered as kubectl's `key-` syntax; repeatable.
  overwrite(): this
    Overwrite existing annotations (`--overwrite`).
  all(): this
    Apply to all resources of the given type (`--all`).
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  override protected buildArgs(): string[]
    Assemble the `kubectl annotate` argv.

class KubectlApplySettings extends KubectlSettings
  Settings for `kubectl apply`.

  file(path: PathLike): this
    Apply a manifest file, directory, or URL (`-f`); repeatable.
  kustomize(dir: PathLike): this
    Apply a kustomization directory (`-k`).
  recursive(): this
    Recurse into directories given to `-f` (`-R`).
  prune(): this
    Prune resources not present in the applied set (`--prune`).
  serverSide(): this
    Apply server-side (`--server-side`).
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  force(): this
    Force apply by delete-and-recreate when needed (`--force`).
  override protected buildArgs(): string[]
    Assemble the `kubectl apply` argv.

class KubectlCreateSettings extends KubectlSettings
  Settings for `kubectl create`.

  file(path: PathLike): this
    Create from a manifest file, directory, or URL (`-f`); repeatable. For
    resource-form creation (`create secret …`), use the base `.args(...)`.
  recursive(): this
    Recurse into directories given to `-f` (`-R`).
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  output(format: string): this
    Output format, e.g. `yaml` or `json` (`-o`).
  saveConfig(): this
    Record the current resource in its annotation (`--save-config`).
  override protected buildArgs(): string[]
    Assemble the `kubectl create` argv.

class KubectlDeleteSettings extends KubectlSettings
  Settings for `kubectl delete`.

  file(path: PathLike): this
    Delete from a manifest file or directory (`-f`); repeatable.
  resource(...tokens: string[]): this
    Resource tokens, e.g. `("pod", "web")` or `("deployment/api")`; repeatable.
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  all(): this
    Delete all resources of the given type (`--all`).
  ignoreNotFound(): this
    Treat "not found" as a success (`--ignore-not-found`).
  force(): this
    Force immediate deletion (`--force`).
  gracePeriod(seconds: number): this
    Seconds to wait before forceful termination (`--grace-period`).
  recursive(): this
    Recurse into directories given to `-f` (`-R`).
  override protected buildArgs(): string[]
    Assemble the `kubectl delete` argv.

class KubectlDescribeSettings extends KubectlSettings
  Settings for `kubectl describe`.

  resource(...tokens: string[]): this
    Resource tokens, e.g. `("pod", "web")` or `("deployment/api")`; repeatable.
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  override protected buildArgs(): string[]
    Assemble the `kubectl describe` argv.

class KubectlExecSettings extends KubectlSettings
  Settings for `kubectl exec`.

  resource(name: string): this
    The pod (or `type/name`) to exec into (required).
  container(name: string): this
    Target a specific container (`-c`).
  stdin(): this
    Keep STDIN open (`-i`).
  tty(): this
    Allocate a TTY (`-t`).
  command(...args: Array<string | number>): this
    The command and arguments to run in the container (required).
  override protected buildArgs(): string[]
    Assemble the `kubectl exec` argv.

class KubectlGetSettings extends KubectlSettings
  Settings for `kubectl get`.

  resource(...tokens: string[]): this
    Resource tokens, e.g. `("pods")` or `("pod", "web")`; repeatable.
  output(format: string): this
    Output format, e.g. `wide`, `yaml`, `json`, `jsonpath=…` (`-o`).
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  fieldSelector(query: string): this
    Restrict by field selector (`--field-selector`).
  allNamespaces(): this
    List across all namespaces (`-A`).
  watch(on: boolean): this
    Watch for changes instead of returning once (`-w`); pass `false` to disable.
  showLabels(): this
    Include resource labels as columns (`--show-labels`).
  override protected buildArgs(): string[]
    Assemble the `kubectl get` argv.

class KubectlLabelSettings extends KubectlSettings
  Settings for `kubectl label`.

  resource(...tokens: string[]): this
    Resource tokens, e.g. `("deploy", "api")` or `("pods", "-l", "app=web")`; repeatable.
  label(key: string, value: string): this
    Set a label as a `key=value` token; repeatable.
  remove(key: string): this
    Remove a label, rendered as kubectl's `key-` syntax; repeatable.
  overwrite(): this
    Overwrite existing labels (`--overwrite`).
  all(): this
    Apply to all resources of the given type (`--all`).
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  override protected buildArgs(): string[]
    Assemble the `kubectl label` argv.

class KubectlLogsSettings extends KubectlSettings
  Settings for `kubectl logs`.

  resource(name: string): this
    The pod (or `type/name`) to read logs from.
  container(name: string): this
    Read from a specific container (`-c`).
  selector(query: string): this
    Select pods by label instead of naming one (`-l`).
  follow(): this
    Stream new log output (`-f`).
  previous(): this
    Read the previous container instance's logs (`--previous`).
  tail(lines: number): this
    Show only the last N lines (`--tail`).
  since(duration: string): this
    Only logs newer than a duration, e.g. `5m` (`--since`).
  allContainers(): this
    Include all containers in the pod (`--all-containers`).
  timestamps(): this
    Prefix each line with a timestamp (`--timestamps`).
  override protected buildArgs(): string[]
    Assemble the `kubectl logs` argv.

class KubectlPatchSettings extends KubectlSettings
  Settings for `kubectl patch`.

  resource(name: string): this
    The resource to patch, e.g. `deployment/api` (required).
  patch(content: string): this
    The patch document (`-p`, required).
  type(strategy: PatchType): this
    The patch strategy (`--type`).
  override protected buildArgs(): string[]
    Assemble the `kubectl patch` argv.

class KubectlPortForwardSettings extends KubectlSettings
  Settings for `kubectl port-forward`.

  resource(name: string): this
    The pod or service, e.g. `svc/api` (required).
  port(mapping: string): this
    A port mapping, e.g. `8080:80` or `8080`; repeatable, at least one.
  address(value: string): this
    The local address(es) to bind (`--address`).
  override protected buildArgs(): string[]
    Assemble the `kubectl port-forward` argv.

class KubectlRolloutSettings extends KubectlSettings
  Settings for `kubectl rollout`.

  status(): this
    Show rollout status (`rollout status`).
  restart(): this
    Restart a rollout (`rollout restart`).
  undo(): this
    Roll back to the previous revision (`rollout undo`).
  history(): this
    Show rollout history (`rollout history`).
  resource(name: string): this
    The resource, e.g. `deployment/api` (required).
  toRevision(revision: number): this
    With `undo`, the revision to roll back to (`--to-revision`).
  timeout(duration: string): this
    With `status`, how long to wait, e.g. `60s` (`--timeout`).
  override protected buildArgs(): string[]
    Assemble the `kubectl rollout <action>` argv.

class KubectlScaleSettings extends KubectlSettings
  Settings for `kubectl scale`.

  replicas(count: number): this
    Desired replica count (`--replicas`, required).
  resource(name: string): this
    The resource to scale, e.g. `deployment/api`.
  file(path: PathLike): this
    Scale a resource defined in a file (`-f`).
  currentReplicas(count: number): this
    Only scale if the current replica count matches (`--current-replicas`).
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  all(): this
    Scale all resources of the given type (`--all`).
  override protected buildArgs(): string[]
    Assemble the `kubectl scale` argv.

class KubectlSetImageSettings extends KubectlSettings
  Settings for `kubectl set image`.

  resource(name: string): this
    The resource to update, e.g. `deployment/api` (required).
  image(container: string, reference: string): this
    Set a container's image (`container=image`); repeatable, at least one.
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  all(): this
    Apply to all resources of the given type (`--all`).
  override protected buildArgs(): string[]
    Assemble the `kubectl set image` argv.

abstract class KubectlSettings extends ToolSettings
  Base for all `kubectl` subcommand settings: the binary is `kubectl`, and the
  cluster-targeting flags (`--namespace`, `--context`, `--kubeconfig`) are
  shared by every subcommand.

  override protected defaultTool(): string
    The tool binary invoked by every subcommand: `kubectl`.
  namespace(name: string): this
    Target a namespace (`--namespace`).
  context(name: string): this
    Use a named kubeconfig context (`--context`).
  kubeconfig(path: PathLike): this
    Use an explicit kubeconfig file (`--kubeconfig`).
  protected globalArgs(): string[]
    The cluster-targeting flags shared by every subcommand.

class KubectlTopSettings extends KubectlSettings
  Settings for `kubectl top`.

  pods(): this
    Report pod usage (`top pods`).
  nodes(): this
    Report node usage (`top nodes`).
  name(value: string): this
    Limit to a single named pod or node.
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  containers(): this
    Break pod usage down by container (`--containers`).
  allNamespaces(): this
    Report across all namespaces (`-A`).
  override protected buildArgs(): string[]
    Assemble the `kubectl top <pods|nodes>` argv.

class KubectlWaitSettings extends KubectlSettings
  Settings for `kubectl wait`.

  file(path: PathLike): this
    Wait on resources defined in a file (`-f`); repeatable.
  resource(...tokens: string[]): this
    Resource tokens, e.g. `("pod/web")` or `("pods")`; repeatable.
  forCondition(condition: string): this
    The condition to wait for, e.g. `condition=Available` or `delete`.
  timeout(duration: string): this
    How long to wait, e.g. `60s` (`--timeout`).
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  all(): this
    Wait on all resources of the given type (`--all`).
  override protected buildArgs(): string[]
    Assemble the `kubectl wait` argv.

interface KubectlTasksApi
  The shape of {@link KubectlTasks}.

  apply(configure?: Configure<KubectlApplySettings>): Promise<CommandOutput>
    Apply manifests: `kubectl apply`.
  create(configure?: Configure<KubectlCreateSettings>): Promise<CommandOutput>
    Create resources: `kubectl create`.
  delete(configure?: Configure<KubectlDeleteSettings>): Promise<CommandOutput>
    Delete resources: `kubectl delete`.
  get(configure?: Configure<KubectlGetSettings>): Promise<CommandOutput>
    List resources: `kubectl get`.
  getNamespaces(configure?: Configure<KubectlGetSettings>): Promise<KubernetesNamespace[]>
    List namespaces as typed {@link KubernetesNamespace} records: runs
    `kubectl get namespaces -o json` (forcing JSON output, quietly) and parses
    the result. Use the lambda for cluster flags or a label `.selector(...)`.
  describe(configure?: Configure<KubectlDescribeSettings>): Promise<CommandOutput>
    Describe resources: `kubectl describe`.
  logs(configure?: Configure<KubectlLogsSettings>): Promise<CommandOutput>
    Read logs: `kubectl logs`.
  exec(configure?: Configure<KubectlExecSettings>): Promise<CommandOutput>
    Exec into a container: `kubectl exec`.
  rollout(configure?: Configure<KubectlRolloutSettings>): Promise<CommandOutput>
    Manage rollouts: `kubectl rollout`.
  scale(configure?: Configure<KubectlScaleSettings>): Promise<CommandOutput>
    Scale a workload: `kubectl scale`.
  setImage(configure?: Configure<KubectlSetImageSettings>): Promise<CommandOutput>
    Update a container image: `kubectl set image`.
  annotate(configure?: Configure<KubectlAnnotateSettings>): Promise<CommandOutput>
    Annotate resources: `kubectl annotate`.
  label(configure?: Configure<KubectlLabelSettings>): Promise<CommandOutput>
    Label resources: `kubectl label`.
  patch(configure?: Configure<KubectlPatchSettings>): Promise<CommandOutput>
    Patch a resource: `kubectl patch`.
  portForward(configure?: Configure<KubectlPortForwardSettings>): Promise<CommandOutput>
    Forward local ports: `kubectl port-forward`.
  wait(configure?: Configure<KubectlWaitSettings>): Promise<CommandOutput>
    Wait for a condition: `kubectl wait`.
  top(configure?: Configure<KubectlTopSettings>): Promise<CommandOutput>
    Show resource usage: `kubectl top`.

interface KubernetesNamespace
  A Kubernetes namespace, parsed from `kubectl get namespaces -o json` — the
  typed result of {@link KubectlTasksApi.getNamespaces}.

  name: string
    The namespace name (`metadata.name`).
  status: string
    The lifecycle phase (`status.phase`), e.g. `"Active"` or `"Terminating"`;
    `""` when the field is absent.
  labels: Record<string, string>
    The namespace labels (`metadata.labels`), string-valued; `{}` when none.
  createdAt?: string
    When the namespace was created (`metadata.creationTimestamp`), if present.

type DryRunMode = "none" | "client" | "server"
  The `--dry-run` strategies kubectl accepts.

type PatchType = "strategic" | "merge" | "json"
  A patch strategy accepted by `kubectl patch --type`.

type RolloutAction = "status" | "restart" | "undo" | "history"
  A rollout sub-action: `kubectl rollout <action>`.
````

</details>

<!-- ZUKE:API:END -->
