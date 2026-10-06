# @zuke/kubectl

Typed `kubectl` CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — deploy to and manage
Kubernetes from a pipeline.

| Area                 | Tasks                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifests            | `apply`, `create`, `replace`, `delete`, `diff`, `diffHasChanges`, `kustomize`                                                                                      |
| Resources            | `get`, `getEntries`, `getNamespaces`, `describe`, `patch`, `annotate`, `label`, `explain`                                                                          |
| Workloads            | `rollout`, `scale`, `setImage`, `setEnv`, `setResources`, `run`, `expose`                                                                                          |
| Pods                 | `logs`, `exec`, `cp`, `portForward`                                                                                                                                |
| Diagnostics          | `wait`, `top`, `events`, `eventEntries`                                                                                                                            |
| Cluster & kubeconfig | `currentContext`, `contexts`, `useContext`, `setContext`, `configView`, `version`, `versionInfo`, `clusterInfo`, `apiResources`, `apiVersions`, `authCanI`, `canI` |
| Nodes                | `cordon`, `drain`, `taint`                                                                                                                                         |

```ts
import { KubectlTasks } from "@zuke/kubectl";

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

## The drift gate, and the two exit codes that are answers

`kubectl diff` exits **1 when it found differences** — a result, not a failure —
and `kubectl auth can-i` exits non-zero when the action is not allowed. Both
have a task that keeps the ordinary contract and a reader that hands back the
answer:

```ts
// Fails the target when the cluster has drifted, which is what a gate wants.
await KubectlTasks.diff((s) => s.file("k8s/").serverSide());

// Reads the same thing as a value, so the build can decide.
if (await KubectlTasks.diffHasChanges((s) => s.file("k8s/"))) {
  await KubectlTasks.apply((s) => s.file("k8s/"));
}

// Check the credentials before spending a rollout on them.
if (!await KubectlTasks.canI((s) => s.verb("create").resource("deployments"))) {
  throw new Error("the deploy credentials cannot create deployments");
}
```

An exit code above 1 means kubectl or its differ actually failed, and still
fails the build — the readers never turn a broken connection into a confident
"no differences".

## Choosing a cluster, and reading what it did

```ts
const context = await KubectlTasks.currentContext();
await KubectlTasks.useContext((s) => s.contextName("staging"));

// When a rollout stalls, this is what says why.
const events = await KubectlTasks.eventEntries((s) =>
  s.namespace("prod").forResource("deploy/api").types("Warning")
);

// Pause half way through a canary, then let it continue.
await KubectlTasks.rollout((s) => s.pause().resource("deploy/api"));
await KubectlTasks.rollout((s) => s.resume().resource("deploy/api"));

// Get the report out of the pod that produced it.
await KubectlTasks.cp((s) =>
  s.from("prod/api-0:/out/report.xml").to("reports/")
);
```

`.context(...)` is the global flag that points one command at a context;
`.contextName(...)` on `useContext` and `setContext` is the operand naming the
context to switch to or write. They are different things, and both render.

## Node lifecycle

`drain` evicts running pods and waits for them to go. The two flags that let it
proceed past pods it cannot safely move are the ones worth being deliberate
about, so neither is defaulted:

```ts
await KubectlTasks.cordon((s) => s.node("worker-1"));
await KubectlTasks.drain((s) =>
  s.node("worker-1").ignoreDaemonSets().deleteEmptyDirData().timeout("5m")
);
await KubectlTasks.cordon((s) => s.node("worker-1").uncordon());
```

`.deleteEmptyDirData()` destroys local data, and `.disableEviction()` bypasses
every PodDisruptionBudget an operator wrote down on purpose.

## Two names that differ from the CLI

Both are inherited-method collisions, not preferences. `ToolSettings.quiet()`
suppresses Zuke's own echo of the command, so kubectl's `--quiet` on
`auth can-i` is `.quietAnswer()`. `ToolSettings.env(...)` sets the environment
`kubectl` itself runs in, so `kubectl run --env` is `.envVar(key, value)`.

## Kubernetes canary platform

`kubectlCanary` is a pair of Deployments as a platform for
[`@zuke/canary`](https://jsr.io/@zuke/canary). This package does not depend on
`@zuke/canary`: the object it returns has the platform's shape, so
`c.platform(...)` accepts it as it is.

```ts
import { canary } from "@zuke/canary";
import { kubectlCanary } from "@zuke/kubectl";

rollout = canary((c) =>
  c.platform(
    kubectlCanary((k) =>
      k.stable("api").canary("api-canary").container("api")
        .image(this.image.value).replicas(10).namespace("prod")
        .stableImage("reg/api@sha256:…") // what a hand-run rollout.abort restores
        .kubectl((s) => s.context("prod"))
    ),
  )
    .steps(10, 30, 50)
    .bake("10m")
);
```

It assumes **one Service selects the pods of both Deployments**, so requests
spread over every ready pod and the candidate's share of traffic follows its
share of replicas. Exposure is therefore quantised: `expose` returns the share
it reached, a step between 0 and 100 always leaves at least one replica on each
side, and a step that asks for less than half a replica is refused.

- **`stage`** reads the stable image, both Deployments' `.spec.paused` and the
  canary's `.spec.replicas` (`get -o jsonpath=…`). It refuses a paused
  Deployment, and a canary that is not at 0 replicas — a leftover from an
  earlier rollout, to roll back with `zuke cancel <run-id>` or scale to 0 by
  hand. Then it sets the candidate image on the canary and records the stable
  image and `replicas`.
- **`expose`** scales the canary up, waits with `rollout status`, then scales
  the stable Deployment down, so a step never drops capacity below `replicas`.
- **`promote`** sets the staged image on the stable Deployment, scales it to the
  recorded `replicas`, waits, then scales the canary to 0.
- **`abort`** does the same with the stable image `stage` read. Run by hand, it
  restores the `.stableImage(...)` image, and refuses without one.

`stage` records the Deployments, container and namespace it changed, and
`expose`, `promote` and `abort` refuse when the lambda now names others: a
rollout must be finished or cancelled — resumed, or `zuke cancel`ed — with the
configuration it started with. The kube context and kubeconfig in
`.kubectl(...)` cannot be recorded, so do not change them mid-rollout either:
pointed at another cluster, a resume or cancellation would act on the
Deployments of the same name there. If a refusal leaves the run cancelled, roll
back by hand with the original configuration: `zuke rollout.abort` with
`.stableImage(...)` set to the image the refusal names.

The namespace needs room for `replicas` plus the canary's pods at once. Promote
and abort `set image` on the stable Deployment, which rolls out by its own
strategy — give it `maxUnavailable: 0` to keep capacity there too. A Service
balances connections, not requests, so with long-lived or HTTP/2 connections the
candidate's real share can differ from its replica share. Nothing else may own
either Deployment during a rollout: suspend a HorizontalPodAutoscaler, and the
sync and self-heal of a GitOps controller that manages their replicas or image.

See
[docs/canary.md](https://github.com/zuke-build/zuke/blob/master/docs/canary.md#kubernetes).

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/kubectl` — typed `kubectl` CLI task wrappers for Zuke builds, for
deploying to and managing Kubernetes from a pipeline.

```ts
import { KubectlTasks } from "@zuke/kubectl";

await KubectlTasks.apply((s) => s.file("k8s/").namespace("prod"));
await KubectlTasks.setImage((s) =>
  s.resource("deployment/api").image("api", "api:1.4").namespace("prod")
);
await KubectlTasks.rollout((s) =>
  s.status().resource("deployment/api").namespace("prod").timeout("120s")
);
```
@module

function kubectlCanary(configure: Configure<KubectlCanarySettings>): KubectlCanary
  Two Kubernetes Deployments behind one Service as a canary platform, for
  `@zuke/canary`:

  ```ts
  c.platform(kubectlCanary((k) =>
    k.stable("api").canary("api-canary").container("api")
      .image(this.image.value).replicas(10).namespace("prod")
      .kubectl((s) => s.context("prod"))
  ))
  ```

  The lambda runs on every call, so it may read resolved parameters.

  - stage — reads the stable image, both Deployments' `.spec.paused` and
    the canary's `.spec.replicas` (`get -o jsonpath=…`), refusing a paused
    Deployment or a canary that is not at 0, then
    `set image deployment/<canary> <container>=<image>`.
  - expose — `scale` the canary up, `rollout status` it, then `scale` the
    stable Deployment down.
  - promote — `set image` the candidate on the stable Deployment, `scale`
    it to the total, `rollout status` it, then `scale` the canary to 0.
  - abort — the same with the stable image: the one `stage` read, or, run
    by hand, the one set with `.stableImage(...)`.

  `stage` records the Deployments, container and namespace it changed, and
  the later calls refuse a lambda that names others. Keep them — and the kube
  context or kubeconfig in `.kubectl(...)`, which cannot be recorded —
  unchanged until the rollout is finished or cancelled.

function parseEvents(json: string): KubernetesEvent[]
  Parse the JSON text of `kubectl events -o json` into
  {@link KubernetesEvent} records. Items carrying neither a reason nor a
  message are skipped; empty input yields `[]`. Throws if the text is
  non-empty and not valid JSON.

function parseNamespaces(json: string): KubernetesNamespace[]
  Parse the JSON text of `kubectl get namespaces -o json` — a `List`, or a
  single namespace object — into {@link KubernetesNamespace} records. Items
  without a `metadata.name` are skipped; empty input yields `[]`. Throws if the
  text is non-empty and not valid JSON.

function parseResources(json: string): KubernetesResource[]
  Parse the JSON text of any `kubectl get … -o json` — a `List`, or a single
  object — into {@link KubernetesResource} records. Items without a
  `metadata.name` are skipped; empty input yields `[]`. Throws if the text is
  non-empty and not valid JSON.

function parseVersion(json: string): KubernetesVersion
  Parse the JSON text of `kubectl version -o json` into the two version
  strings. A payload that is not an object, or carries neither version,
  yields an empty record rather than throwing — the versions are advisory.

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

class KubectlApiResourcesSettings extends KubectlSettings
  Settings for `kubectl api-resources`.

  apiGroup(name: string): this
    Only resources in this API group (`--api-group`).
  namespaced(value: boolean): this
    Whether to list namespaced resources (`--namespaced`); kubectl's default
    is `true`, so pass `false` for the cluster-scoped ones.
  verbs(...names: string[]): this
    Only resources supporting these verbs (`--verbs`).
  categories(...names: string[]): this
    Only resources in these categories (`--categories`).
  sortBy(field: "name" | "kind"): this
    Sort by `name` or `kind` (`--sort-by`).
  output(format: string): this
    The output format (`-o`), e.g. `name` or `wide`.
  noHeaders(): this
    Leave the header row out (`--no-headers`).
  cached(): this
    Use the discovery cache rather than asking the server (`--cached`).
  override protected buildArgs(): string[]
    Assemble the `kubectl api-resources` argv.

class KubectlApiVersionsSettings extends KubectlSettings
  Settings for `kubectl api-versions`.

  override protected buildArgs(): string[]
    Assemble the `kubectl api-versions` argv.

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

class KubectlAuthCanISettings extends KubectlSettings
  Settings for `kubectl auth can-i`.

  The command answers through its exit status — 0 when the action is
  allowed and non-zero when it is not — so
  {@link "./kubectl.ts".KubectlTasksApi.canI} reads the code into a boolean
  rather than failing the build on a routine "no".

  verb(name: string): this
    The API verb to check, e.g. `create` (required unless {@link list}).
  resource(name: string): this
    The resource, e.g. `deployments` or `deployments/api`.
  subresource(name: string): this
    A subresource, e.g. `log` or `scale` (`--subresource`).
  allNamespaces(): this
    Check across every namespace (`--all-namespaces`).
  list(): this
    Print every allowed action instead of checking one (`--list`).
  quietAnswer(): this
    Print nothing and answer only through the exit code (kubectl's
    `--quiet`). Named apart from the inherited `.quiet()`, which suppresses
    Zuke's own echo of the command rather than kubectl's output.
  override protected buildArgs(): string[]
    Assemble the `kubectl auth can-i` argv.

class KubectlCanary
  Two Kubernetes Deployments behind one Service as a canary platform. Create
  one with {@link kubectlCanary}; hand it to `@zuke/canary`'s
  `c.platform(...)`.

  Exposure is a share of replicas, so it is quantised: `expose` returns the
  share it actually reached.

  constructor(configure: Configure<KubectlCanarySettings>)
    A platform whose settings `configure` produces, afresh on every call.
  readonly exposure: "replicas"
    Traffic follows ready pods, so exposure is a share of replicas.
  describe(): string
    `"Kubernetes deployment api (canary api-canary)"`, for the summary.
  async stage(ctx: KubectlCanaryContext): Promise<void>
    Read the image the stable Deployment runs, so a rollback can put it back;
    check that neither Deployment is paused and that the canary has no
    replicas; then set the candidate image on the canary. With no replicas,
    nothing runs the candidate yet.
  async expose(percent: number, ctx: KubectlCanaryContext): Promise<number>
    Move replicas so the canary Deployment holds about `percent` of the total.
    The canary grows first and is waited for with `rollout status`; only then
    does the stable Deployment shrink, so capacity never dips. A step between
    0 and 100 always leaves at least one replica on each side, and a step that
    asks for less than half a replica is refused rather than rounded up to a
    far larger share. The total is the one `stage` recorded, so a resumed
    process sizes the step the same way, and it refuses when the lambda now
    names other Deployments than `stage` changed. Returns the share reached,
    `canary / total × 100`.
  async promote(ctx: KubectlCanaryContext): Promise<void>
    Set the staged candidate image on the stable Deployment, scale it to the
    total and wait for it, then empty the canary Deployment — only once the
    wait succeeded. It promotes the image `stage` recorded — the one
    analysed — whatever the lambda says now, and refuses when the lambda
    names other Deployments than `stage` changed. Idempotent.
  async abort(ctx: KubectlCanaryContext): Promise<void>
    Return every replica to the stable Deployment, running the stable image.
    Idempotent. What it does depends on what this rollout recorded:

    - Staged (a rollback mid-rollout): the image `stage` read off the
      stable Deployment goes back on it — a no-op unless a promote got part of
      the way — the stable Deployment is scaled to the total `stage` recorded
      and waited for, and the canary is emptied, even when that wait fails.
      What `stage` recorded wins over the lambda's `stableImage` and
      `replicas`; a lambda naming other Deployments, container or namespace
      than `stage` recorded is refused.
    - `stage` failed before the candidate was on record: the canary had
      no replicas and the stable Deployment was not touched, so nothing runs.
    - Nothing recorded (`rollout.abort` run by hand, a fresh run): the
      same, with the image set by {@link KubectlCanarySettings.stableImage}.
      Without one this refuses: after a promote the stable Deployment runs the
      candidate, and moving replicas alone would report a rollback that
      changed nothing.

class KubectlCanarySettings
  How {@link kubectlCanary} reaches the two Deployments, configured through
  its lambda.

  stable_?: string
    The Deployment that serves the current release (set by {@link stable}).
  canary_?: string
    The Deployment that runs the candidate (set by {@link canary}).
  container_?: string
    The container whose image is rolled out (set by {@link container}).
  image_?: string
    The candidate's container image (set by {@link image}).
  stableImage_?: string
    The image a hand-run rollback restores (set by {@link stableImage}).
  replicas_?: number
    Replicas across both Deployments (set by {@link replicas}).
  namespace_?: string
    The namespace of both Deployments (set by {@link namespace}).
  timeout_: string
    How long each `rollout status` waits (set by {@link timeout}).
  kubectl_?: Configure<KubectlSettings>
    Global kubectl flags for every command (set by {@link kubectl}).
  runner_: KubectlSettingsRunner
    How each command is run (set by {@link runner}).
  stable(deployment: string): this
    The Deployment serving the current release. It must already exist, and
    its pods and the canary's must be selected by the same Service.
  canary(deployment: string): this
    The Deployment the candidate runs in — a second Deployment with the same
    pod labels the Service selects (plus one of its own, so its selector does
    not match the stable pods). It must already exist; at rest it has 0
    replicas.
  container(name: string): this
    The container, in both Deployments, whose image is rolled out.
  image(reference: string): this
    The candidate's container image, set on the canary Deployment by `stage`.
    Prefer a digest (`repo@sha256:…`) — a mutable tag can point at something
    else by the time `promote` sets it on the stable Deployment.
  stableImage(reference: string): this
    The image a `rollout.abort` run by hand puts back on the stable
    Deployment. Such a run is fresh, with no record of a rollout, and the
    release it undoes has usually been promoted — so the stable Deployment
    already runs the candidate, and moving replicas alone would change
    nothing. A rollback the engine runs mid-rollout does not use it: that one
    restores the image `stage` read off the stable Deployment.
  replicas(total: number): this
    The replicas the two Deployments run between them — the stable
    Deployment's size at rest. A whole number from 1 to 2147483647; a step
    needs enough that it asks for at least half a replica, and at least 2, so
    it can leave a replica on each side. `stage` records it, so a resumed or
    rolled-back rollout restores the size it started from.
  namespace(name: string): this
    The namespace both Deployments live in (`--namespace`).
  timeout(duration: string): this
    How long each `kubectl rollout status` waits for a Deployment to become
    ready, as a Go duration from `1ms` to `24h` (default `5m`). kubectl reads
    0 as "wait forever", so it is refused.
  kubectl(configure: Configure<KubectlSettings>): this
    Global flags for every kubectl command the platform runs —
    `(s) => s.context("prod").kubeconfig("~/.kube/prod")`, or a
    `.toolPath(...)` to a specific kubectl.
  runner(run: KubectlSettingsRunner): this
    Replace how each prepared command is run. The default runs it; this is
    for a test, or for a build that executes kubectl through something else.

class KubectlClusterInfoSettings extends KubectlSettings
  Settings for `kubectl cluster-info`.

  override protected buildArgs(): string[]
    Assemble the `kubectl cluster-info` argv.

class KubectlConfigCurrentContextSettings extends KubectlSettings
  Settings for `kubectl config current-context`.

  override protected buildArgs(): string[]
    Assemble the `kubectl config current-context` argv.

class KubectlConfigGetContextsSettings extends KubectlSettings
  Settings for `kubectl config get-contexts`.

  namesOnly(): this
    Print only the names (`-o name`), the one output format gh accepts here.
  noHeaders(): this
    Leave the header row out (`--no-headers`).
  override protected buildArgs(): string[]
    Assemble the `kubectl config get-contexts` argv.

class KubectlConfigSetContextSettings extends KubectlSettings
  Settings for `kubectl config set-context`.

  Note that `set-context` has its own `--namespace`, which sets the namespace
  recorded in the context entry rather than scoping one command. The
  inherited `.namespace(...)` renders that same flag, which is what a caller
  of this command wants.

  contextName(name: string): this
    The context to write (required unless {@link current} is set).
  current(): this
    Modify the current context rather than a named one (`--current`).
  cluster(name: string): this
    The cluster the context points at (`--cluster`).
  user(name: string): this
    The user the context authenticates as (`--user`).
  override protected buildArgs(): string[]
    Assemble the `kubectl config set-context` argv.

class KubectlConfigUseContextSettings extends KubectlSettings
  Settings for `kubectl config use-context`.

  contextName(name: string): this
    The context to switch to (required).
  override protected buildArgs(): string[]
    Assemble the `kubectl config use-context` argv.

class KubectlConfigViewSettings extends KubectlSettings
  Settings for `kubectl config view`.

  minify(): this
    Keep only what the current context uses (`--minify`).
  flatten(): this
    Inline the referenced files, for a portable kubeconfig (`--flatten`).
  raw(): this
    Print the credentials in the clear (`--raw`). kubectl redacts them by
    default; anything this prints belongs in a `parameter().secret()`, not in
    a build's log.
  output(format: string): this
    The output format (`-o`), e.g. `json`; kubectl's default is `yaml`.
  override protected buildArgs(): string[]
    Assemble the `kubectl config view` argv.

class KubectlCordonSettings extends KubectlSettings
  Settings for `kubectl cordon` and `kubectl uncordon` — marking a node
  unschedulable, and letting it take pods again.

  node(name: string): this
    The node to act on; required unless a {@link selector} picks them.
  uncordon(): this
    Make the node schedulable again instead — `kubectl uncordon`.
  selector(query: string): this
    Act on every node matching a label selector (`-l`).
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  override protected buildArgs(): string[]
    Assemble the `kubectl cordon`/`uncordon` argv.

class KubectlCpSettings extends KubectlSettings
  Settings for `kubectl cp` — copying files into and out of a container.

  This is how a build gets a report out of a pod that produced it. Each side
  is either a local path or a `[namespace/]pod:path` spec, and kubectl takes
  exactly one of each.

  from(spec: string): this
    Where to copy from: a local path, or `pod:path` / `namespace/pod:path`.
  to(spec: string): this
    Where to copy to, in the same two forms.
  container(name: string): this
    Which container of the pod (`-c`).
  noPreserve(): this
    Do not carry ownership and permissions across (`--no-preserve`).
  retries(count: number): this
    Retry a copy out of a container this many times (`--retries`).
  override protected buildArgs(): string[]
    Assemble the `kubectl cp` argv.

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

class KubectlDiffSettings extends KubectlSettings
  Settings for `kubectl diff` — what an apply would change, without changing
  it.

  `diff` reports its answer through the exit status: 0 when there is no
  difference and 1 when there is, with anything above 1 meaning kubectl or
  the differ failed. {@link "./kubectl.ts".KubectlTasksApi.diff} keeps the
  ordinary contract, so a build that wants the printed diff and a failed
  target on drift gets both;
  {@link "./kubectl.ts".KubectlTasksApi.diffHasChanges} is the reader that
  turns the code into a boolean.

  file(path: PathLike): this
    Diff a manifest file, directory, or URL (`-f`); repeatable.
  kustomize(dir: PathLike): this
    Diff a kustomization directory (`-k`).
  recursive(): this
    Recurse into directories given to `-f` (`-R`).
  serverSide(): this
    Diff the server-side apply (`--server-side`).
  forceConflicts(): this
    Take ownership of conflicting fields (`--force-conflicts`).
  prune(): this
    Include what a prune would delete (`--prune`).
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  showManagedFields(): this
    Include the managed fields, which are otherwise hidden (`--show-managed-fields`).
  concurrency(count: number): this
    How many objects to diff in parallel (`--concurrency`).
  override protected buildArgs(): string[]
    Assemble the `kubectl diff` argv.

class KubectlDrainSettings extends KubectlSettings
  Settings for `kubectl drain`.

  kubectl refuses to drain a node whose pods it cannot safely move, and the
  two flags that override that refusal are exactly the ones worth being
  deliberate about: `--ignore-daemonsets` and `--delete-emptydir-data`, the
  second of which destroys local data. Neither is defaulted here.

  node(name: string): this
    The node to drain; required unless a {@link selector} picks them.
  force(): this
    Evict pods no controller manages, which nothing will recreate (`--force`).
  ignoreDaemonSets(): this
    Proceed past DaemonSet-managed pods, which drain never deletes (`--ignore-daemonsets`).
  deleteEmptyDirData(): this
    Proceed past pods using emptyDir, destroying that data (`--delete-emptydir-data`).
  disableEviction(): this
    Delete rather than evict (`--disable-eviction`), which bypasses every
    PodDisruptionBudget — the guardrail an operator wrote down on purpose.
  gracePeriod(seconds: number): this
    Seconds each pod gets to terminate (`--grace-period`).
  timeout(duration: string): this
    How long to wait for the drain overall, e.g. `5m` (`--timeout`).
  podSelector(query: string): this
    Only drain pods matching this label selector (`--pod-selector`).
  selector(query: string): this
    Drain every node matching this label selector (`-l`).
  skipWaitForDeleteTimeout(seconds: number): this
    Stop waiting on pods already deleting this long (`--skip-wait-for-delete-timeout`).
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  override protected buildArgs(): string[]
    Assemble the `kubectl drain` argv.

class KubectlEventsSettings extends KubectlSettings
  Settings for `kubectl events` — the first thing to read when a rollout
  stalls and `rollout status` will not say why.

  forResource(reference: string): this
    Only events about this resource, as `TYPE/NAME` (`--for`).
  types(...names: string[]): this
    Only events of these types, e.g. `Warning` (`--types`).
  allNamespaces(): this
    Across every namespace (`-A`).
  watch(): this
    Keep watching after the listing (`--watch`). A target that watches blocks
    until something stops it, so pair it with `.killAfter(...)` unless the
    wait is the point.
  noHeaders(): this
    Leave the header row out (`--no-headers`).
  output(format: string): this
    The output format (`-o`), e.g. `json`.
  override protected buildArgs(): string[]
    Assemble the `kubectl events` argv.

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

class KubectlExplainSettings extends KubectlSettings
  Settings for `kubectl explain` — the schema of a resource type.

  type(name: string): this
    The type to explain, e.g. `pods` or `deployments.spec.replicas`.
  recursive(): this
    Print nested fields too (`-R`).
  maxDepth(depth: number): this
    Cap how deep {@link recursive} goes (`--max-depth`).
  apiVersion(value: string): this
    Explain a particular API group/version (`--api-version`).
  output(format: string): this
    How to render the schema (`-o`): `plaintext` or `plaintext-openapiv2`.
  override protected buildArgs(): string[]
    Assemble the `kubectl explain` argv.

class KubectlExposeSettings extends KubectlSettings
  Settings for `kubectl expose` — a service in front of an existing workload.

  resource(reference: string): this
    The workload to expose, e.g. `deployment/api`.
  file(path: PathLike): this
    Expose the workload a manifest identifies instead (`-f`); repeatable.
  port(value: string | number): this
    The port the service serves on (`--port`).
  targetPort(value: string | number): this
    The container port traffic goes to (`--target-port`).
  type(value: string): this
    The service type (`--type`), e.g. `LoadBalancer`.
  name(value: string): this
    The new service's name (`--name`).
  protocol(value: string): this
    The protocol (`--protocol`), e.g. `TCP`.
  selector(query: string): this
    The selector the service routes by (`--selector`). kubectl infers it from
    the exposed resource when it is omitted, and only equality-based
    requirements are supported here.
  labels(value: string): this
    Labels for the created service (`--labels`), comma-separated.
  sessionAffinity(value: "None" | "ClientIP"): this
    Session affinity (`--session-affinity`): `None` or `ClientIP`.
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  override protected buildArgs(): string[]
    Assemble the `kubectl expose` argv.

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

class KubectlKustomizeSettings extends KubectlSettings
  Settings for `kubectl kustomize` — rendering a kustomization to stdout.

  dir(path: PathLike): this
    The kustomization directory or repository URL; kubectl assumes `.`.
  output(path: PathLike): this
    Write the rendered output to a file instead of stdout (`-o`).
  enableHelm(): this
    Allow the Helm chart inflator generator (`--enable-helm`).
  loadRestrictor(value: string): this
    Relax where a kustomization may load files from (`--load-restrictor`).
  override protected buildArgs(): string[]
    Assemble the `kubectl kustomize` argv.

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

class KubectlReplaceSettings extends KubectlSettings
  Settings for `kubectl replace`.

  file(path: PathLike): this
    Replace from a manifest file, directory, or URL (`-f`); repeatable.
  kustomize(dir: PathLike): this
    Replace from a kustomization directory (`-k`).
  recursive(): this
    Recurse into directories given to `-f` (`-R`).
  force(): this
    Delete and recreate rather than update (`--force`). This is not a retry
    knob: the resource genuinely goes away first, so anything depending on it
    sees it missing.
  gracePeriod(seconds: number): this
    Seconds each object gets to terminate (`--grace-period`).
  timeout(duration: string): this
    How long to wait on the delete half, e.g. `60s` (`--timeout`).
  cascade(strategy: "background" | "orphan" | "foreground"): this
    The cascading strategy for dependents (`--cascade`).
  wait(): this
    Wait for the resources to be gone before returning (`--wait`).
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  override protected buildArgs(): string[]
    Assemble the `kubectl replace` argv.

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
  pause(): this
    Stop the rollout where it is (`rollout pause`) — half of a canary. A
    paused workload takes no further updates until {@link resume}.
  resume(): this
    Let a paused rollout continue (`rollout resume`).
  resource(name: string): this
    The resource, e.g. `deployment/api` (required).
  toRevision(revision: number): this
    With `undo`, the revision to roll back to (`--to-revision`).
  timeout(duration: string): this
    With `status`, how long to wait, e.g. `60s` (`--timeout`).
  override protected buildArgs(): string[]
    Assemble the `kubectl rollout <action>` argv.

class KubectlRunSettings extends KubectlSettings
  Settings for `kubectl run` — one pod, imperatively.

  This is for a one-off: a migration job, a debug shell. A workload a build
  owns belongs in a manifest and goes through
  {@link "./manifests.ts".KubectlApplySettings}, which is declarative and can
  be diffed.

  name(value: string): this
    The pod's name (required).
  image(reference: string): this
    The image to run (`--image`, required).
  restart(policy: "Always" | "OnFailure" | "Never"): this
    The restart policy (`--restart`).
  envVar(key: string, value: string): this
    An environment variable for the container (`--env KEY=VALUE`);
    repeatable. Named apart from the inherited `.env(...)`, which sets the
    environment `kubectl` itself runs in.
  labels(value: string): this
    Labels for the pod (`--labels`), comma-separated.
  port(value: string | number): this
    The port the container exposes (`--port`).
  overrides(json: string): this
    An inline JSON override for the generated pod (`--overrides`).
  expose(): this
    Also create a ClusterIP service (`--expose`), which needs {@link port}.
  command(first: string, ...rest: string[]): this
    The command and arguments to run, after kubectl's `--` separator. Passing
    any also sets `--command`, so they replace the image's entrypoint rather
    than being appended to it.
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  override protected buildArgs(): string[]
    Assemble the `kubectl run` argv.

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

class KubectlSetEnvSettings extends KubectlSetSettings
  Settings for `kubectl set env`.

  override protected readonly taskName: string
    The task this settings class backs.
  set(key: string, value: string): this
    Set a variable (`-e KEY=VALUE`); repeatable.
  remove(key: string): this
    Remove a variable, which kubectl spells `KEY-` (`-e KEY-`); repeatable.
  from(reference: string): this
    Inject every key of a ConfigMap or Secret (`--from`), e.g. `secret/db`.
  keys(...names: string[]): this
    Only these keys of the {@link from} resource (`--keys`).
  prefix(value: string): this
    Prefix the injected variable names (`--prefix`).
  list(): this
    Print the environment instead of changing it (`--list`).
  resolve(): this
    Show what the references resolve to when listing (`--resolve`).
  overwrite(value: boolean): this
    Whether an existing variable may be replaced (`--overwrite`).
  override protected setSubcommand(): string
    The `set` subcommand: `env`.
  override protected setFlags(): string[]
    Assemble the `kubectl set env` flags.

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

class KubectlSetResourcesSettings extends KubectlSetSettings
  Settings for `kubectl set resources`.

  override protected readonly taskName: string
    The task this settings class backs.
  limit(resource: string, quantity: string): this
    A resource limit, e.g. `.limit("cpu", "500m")`; repeatable.
  request(resource: string, quantity: string): this
    A resource request, e.g. `.request("memory", "256Mi")`; repeatable.
  override protected setSubcommand(): string
    The `set` subcommand: `resources`.
  override protected setFlags(): string[]
    Assemble the `kubectl set resources` flags.

abstract class KubectlSetSettings extends KubectlSettings
  Base for the `kubectl set` subcommands that change a pod template in place:
  they share the target (a resource, a manifest, or everything in the
  namespace) and the container selection.

  abstract protected readonly taskName: string
    The task name a refusal names, e.g. `setEnv`.
  resource(...names: string[]): this
    The resource to change, e.g. `deployment/api`; repeatable.
  file(path: PathLike): this
    Change the resource identified by a manifest instead (`-f`); repeatable.
  all(): this
    Change every resource of the named types in the namespace (`--all`).
  containers(pattern: string): this
    Which containers to change (`-c`); kubectl's default is every one.
  selector(query: string): this
    Restrict to resources matching a label selector (`-l`).
  local(): this
    Rewrite the local manifest without contacting the server (`--local`).
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  abstract protected setSubcommand(): string
    The `set` subcommand's own name, e.g. `env`.
  abstract protected setFlags(): string[]
    The subcommand's own flags, rendered after the target.
  protected targetArgs(task: string): string[]
    The target flags, after refusing a target kubectl cannot resolve.
  override protected buildArgs(): string[]
    Assemble the `kubectl set <subcommand>` argv.

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

class KubectlTaintSettings extends KubectlSettings
  Settings for `kubectl taint`.

  node(...names: string[]): this
    A node to taint; repeatable.
  taint(key: string, value: string, effect: TaintEffect): this
    Add a taint, as `key=value:effect`; repeatable.
  removeTaint(key: string, effect?: TaintEffect): this
    Remove a taint, which kubectl spells with a trailing `-`; repeatable.
  all(): this
    Taint every node in the cluster (`--all`).
  overwrite(): this
    Replace a taint of the same key rather than failing (`--overwrite`).
  selector(query: string): this
    Taint every node matching a label selector (`-l`).
  dryRun(mode: DryRunMode): this
    Preview without persisting (`--dry-run=`; defaults to `client`).
  override protected buildArgs(): string[]
    Assemble the `kubectl taint` argv.

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

class KubectlVersionSettings extends KubectlSettings
  Settings for `kubectl version`.

  clientOnly(): this
    Report the client's version without reaching a cluster (`--client`).
  output(format: "json" | "yaml"): this
    The output format (`-o`): `json` or `yaml`.
  override protected buildArgs(): string[]
    Assemble the `kubectl version` argv.

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

interface KubectlCanaryContext
  The part of the canary engine's context the Kubernetes platform uses: the
  rollout's durable state, where `stage` records what a rollback needs, and
  the build summary. The engine hands a richer context; this is the narrow
  view.

  readonly state: TargetStateHandle
    The rollout's durable platform state, shared by every call.
  reportSummary(pairs: SummaryPairs): void
    Add key/value pairs to the calling target's row in the build summary.

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
  diff(configure?: Configure<KubectlDiffSettings>): Promise<CommandOutput>
    Show what an apply would change: `kubectl diff`. The command exits 1 when
    it finds differences, so this task fails the target on drift — which is
    what a gate wants. Use {@link KubectlTasksApi.diffHasChanges} to read the
    answer as a value instead.
  diffHasChanges(configure?: Configure<KubectlDiffSettings>): Promise<boolean>
    Whether an apply would change anything: `true` when `kubectl diff` reports
    differences, `false` when it reports none. An exit code above 1 means
    kubectl or its differ failed and still fails the build.
  replace(configure?: Configure<KubectlReplaceSettings>): Promise<CommandOutput>
    Replace a resource wholesale: `kubectl replace`.
  getEntries(configure?: Configure<KubectlGetSettings>): Promise<KubernetesResource[]>
    Every matching resource as typed {@link KubernetesResource} records: runs
    `kubectl get … -o json` and parses the common metadata, whatever the kind.
  explain(configure?: Configure<KubectlExplainSettings>): Promise<CommandOutput>
    Show a resource type's schema: `kubectl explain`.
  setEnv(configure?: Configure<KubectlSetEnvSettings>): Promise<CommandOutput>
    Change environment variables on a pod template: `kubectl set env`.
  setResources(configure?: Configure<KubectlSetResourcesSettings>): Promise<CommandOutput>
    Change requests and limits on a pod template: `kubectl set resources`.
  run(configure?: Configure<KubectlRunSettings>): Promise<CommandOutput>
    Run one pod imperatively: `kubectl run`.
  expose(configure?: Configure<KubectlExposeSettings>): Promise<CommandOutput>
    Put a service in front of a workload: `kubectl expose`.
  cp(configure?: Configure<KubectlCpSettings>): Promise<CommandOutput>
    Copy files into or out of a container: `kubectl cp`.
  events(configure?: Configure<KubectlEventsSettings>): Promise<CommandOutput>
    Report cluster events: `kubectl events`.
  eventEntries(configure?: Configure<KubectlEventsSettings>): Promise<KubernetesEvent[]>
    The events as typed {@link KubernetesEvent} records — what a build reads
    when a rollout stalls and `rollout status` will not say why.
  currentContext(configure?: Configure<KubectlConfigCurrentContextSettings>): Promise<string>
    The name of the current kubeconfig context: `kubectl config current-context`.
  contexts(configure?: Configure<KubectlConfigGetContextsSettings>): Promise<string[]>
    The available context names: `kubectl config get-contexts -o name`.
  useContext(configure?: Configure<KubectlConfigUseContextSettings>): Promise<CommandOutput>
    Switch the current context: `kubectl config use-context`.
  setContext(configure?: Configure<KubectlConfigSetContextSettings>): Promise<CommandOutput>
    Write a context entry: `kubectl config set-context`.
  configView(configure?: Configure<KubectlConfigViewSettings>): Promise<CommandOutput>
    Show the merged kubeconfig: `kubectl config view`.
  version(configure?: Configure<KubectlVersionSettings>): Promise<CommandOutput>
    Print the client and server versions: `kubectl version`.
  versionInfo(configure?: Configure<KubectlVersionSettings>): Promise<KubernetesVersion>
    The client and server versions, parsed from `kubectl version -o json`.
  clusterInfo(configure?: Configure<KubectlClusterInfoSettings>): Promise<CommandOutput>
    Show where the cluster's services live: `kubectl cluster-info`.
  apiResources(configure?: Configure<KubectlApiResourcesSettings>): Promise<CommandOutput>
    List the server's API resources: `kubectl api-resources`.
  apiVersions(configure?: Configure<KubectlApiVersionsSettings>): Promise<CommandOutput>
    List the server's API versions: `kubectl api-versions`.
  authCanI(configure?: Configure<KubectlAuthCanISettings>): Promise<CommandOutput>
    Check a permission: `kubectl auth can-i`.
  canI(configure?: Configure<KubectlAuthCanISettings>): Promise<boolean>
    Whether the action is allowed. `kubectl auth can-i` answers through its
    exit status, so this reads the code rather than failing the build on a
    routine "no".
  kustomize(configure?: Configure<KubectlKustomizeSettings>): Promise<CommandOutput>
    Render a kustomization to stdout: `kubectl kustomize`.
  cordon(configure?: Configure<KubectlCordonSettings>): Promise<CommandOutput>
    Mark a node unschedulable, or schedulable again: `kubectl cordon`/`uncordon`.
  drain(configure?: Configure<KubectlDrainSettings>): Promise<CommandOutput>
    Evict a node's pods before maintenance: `kubectl drain`.
  taint(configure?: Configure<KubectlTaintSettings>): Promise<CommandOutput>
    Add or remove node taints: `kubectl taint`.

interface KubernetesEvent
  One event of {@link "./kubectl.ts".KubectlTasksApi.eventEntries} — what the
  cluster reports about a resource, which is the first thing to read when a
  rollout stalls.

  type: string
    `Normal` or `Warning` (`type`); `""` when the field is absent.
  reason: string
    The short machine-readable cause (`reason`).
  message: string
    The human-readable detail (`message`).
  regarding?: string
    What the event is about, as `Kind/name` (`regarding`/`involvedObject`).
  count?: number
    How many times it has repeated (`series.count` or `count`).
  lastSeen?: string
    When it was last seen, ISO 8601, when the payload carries a time.

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

interface KubernetesResource
  One resource of {@link "./kubectl.ts".KubectlTasksApi.getEntries} — the
  fields every Kubernetes object carries, whatever its kind.

  name: string
    The object's name (`metadata.name`).
  kind: string
    Its kind, e.g. `Pod` (`kind`); `""` when the field is absent.
  namespace?: string
    Its namespace (`metadata.namespace`), absent for a cluster-scoped object.
  labels: Record<string, string>
    Its labels (`metadata.labels`), string-valued; `{}` when none.
  createdAt?: string
    When it was created (`metadata.creationTimestamp`), if present.

interface KubernetesVersion
  The client and server versions {@link parseVersion} reads.

  client?: string
    The `kubectl` binary's version, e.g. `v1.31.2`.
  server?: string
    The API server's version, absent when only the client was asked for.

type DryRunMode = "none" | "client" | "server"
  The `--dry-run` strategies kubectl accepts.

type KubectlSettingsRunner = (settings: KubectlSettings) => Promise<CommandOutput>
  Runs one prepared `kubectl` command and returns its output. The default runs
  it; a test or a build that executes kubectl some other way injects its own
  with {@link KubectlCanarySettings.runner}.

type PatchType = "strategic" | "merge" | "json"
  A patch strategy accepted by `kubectl patch --type`.

type RolloutAction = "status" | "restart" | "undo" | "history" | "pause" | "resume"
  A rollout sub-action: `kubectl rollout <action>`.

type TaintEffect = "NoSchedule" | "PreferNoSchedule" | "NoExecute"
  What a taint does to pods that do not tolerate it.
````

</details>

<!-- ZUKE:API:END -->
