# Canary releases — `@zuke/canary`

A canary release puts a new version beside the stable one, exposes it to a small
share of traffic, watches it, and either widens the exposure step by step until
it is promoted or rolls it back. `@zuke/canary` builds that whole chain from one
settings lambda. Every way the rollout can go wrong runs **one** rollback:

- a failed analysis;
- a failed step;
- an approval that times out;
- `zuke cancel`.

```ts
import { canary, httpProbe, prometheus } from "@zuke/canary";

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(cloudRun) // anything implementing CanaryPlatform
      .steps(10, 25, 50) // exposure after each step; promotion is the 100 %
      .bake("10m") // per step; .bakeStep(3, "30m") overrides one
      .analysis(
        httpProbe((h) => h.url(HEALTH_URL).samples(30).maxFailures(0)),
        prometheus((p) => p.url(PROMETHEUS).query(ERROR_RATIO).max(0.01)),
      )
      .approval("canary-approved") // optional gate before promotion
      .approvalTimeout("24h") // and how long it waits
      .lock((l) => l.lockKey("deploy", "api").withTtl("24h"))
  );

  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}
```

## The targets

`canary(...)` is a [component](./authoring.md#reusable-components), so its
targets are named under the field it is assigned to:

| Target                  | What it does                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rollout.stage`         | Puts the candidate in place at 0 %. Takes the lock for the whole run. A stage that fails part-way, or is cancelled, rolls back what it left before it fails.                     |
| `rollout.stepN.expose`  | Sets the exposure of step N. Exposure is absolute, and the summary shows what the platform achieved: `Exposure: 12.5% (requested 10%)`.                                          |
| `rollout.stepN.bake`    | Waits out the step's bake. Inline bakes run the analyses on an interval while they wait; durable ones suspend the run (see below).                                               |
| `rollout.stepN.analyze` | Runs every analysis once more at the end of the step.                                                                                                                            |
| `rollout.approve`       | Waits for the approval signal (`zuke resume <run-id> --signal canary-approved`). A timeout rolls the canary back.                                                                |
| `rollout.promote`       | Sends everything to the candidate. It is an [effect](./orchestration.md), so a resume re-drives one that was interrupted.                                                        |
| `rollout.abort`         | The rollback. It runs as `stage`'s compensation whenever the run is cancelled or a step fails with `cancel-run`, unless the release was already promoted. It can be run by hand. |

A target only exists when it has something to do: a step with no bake has no
`bake`, and a canary with no analyses has no `analyze`. A canary with no steps,
on a release-channel platform for example, gets a single `rollout.soak` phase
when it bakes or analyses.

A canary **needs a state store**. Rolling back means knowing which targets
succeeded, and the platform's handles have to survive a suspend, so a build with
state disabled is refused when the rollout starts.

## The platform seam

The engine never talks to Cloud Run, Kubernetes or anything else directly. It
calls a `CanaryPlatform`:

| Member                 | Contract                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `exposure`             | `"traffic"` (an exact split), `"replicas"` (quantised to whole instances) or `"channel"` (a release channel, no steps). |
| `describe()`           | A short name for the summary.                                                                                           |
| `stage(ctx)`           | Candidate in place at 0 %. Record what a rollback needs in `ctx.state`.                                                 |
| `expose(percent, ctx)` | Set exposure to `percent` (absolute) and return the exposure achieved. Repeating it is harmless.                        |
| `promote(ctx)`         | Send everything to the candidate. Idempotent.                                                                           |
| `abort(ctx)`           | Return everything to the stable version. Idempotent, and must cope with empty state (see below).                        |

Every call gets the same `ctx.state`, the rollout's durable platform state, so
`abort` can read what `stage` wrote even in another process after a resume.
**Never put a secret in it**: it is persisted in plain JSON and shown by
`zuke runs show`. `ctx.signal` aborts when the run is cancelled; pass it to
network calls.

Adapters for specific platforms belong in their wrapper packages; see
[Cloud Run](#cloud-run), [Kubernetes](#kubernetes), [Helm](#helm) and
[Docker Compose](#docker-compose) below. Until one exists for yours, a platform
is a plain object in the build:

<!-- check -->

```ts
import { Build, run, target } from "@zuke/core";
import { $ } from "@zuke/core/shell";
import { canary, type CanaryPlatform, httpProbe } from "@zuke/canary";

// Two Docker Compose services behind a weighted proxy, scripted by hand.
const compose: CanaryPlatform = {
  exposure: "replicas",
  describe: () => "compose service api",
  async stage(ctx) {
    await $`docker compose up -d --scale api-canary=1 api-canary`;
    await ctx.state.set({ stable: "api", candidate: "api-canary" });
  },
  async expose(percent) {
    const canaries = Math.round(percent / 25);
    await $`docker compose up -d --scale api-canary=${canaries} api-canary`;
    return canaries * 25;
  },
  async promote() {
    await $`docker compose up -d api`;
    await $`docker compose rm -sf api-canary`;
  },
  async abort() {
    // Needs no state: the stable service is fixed by configuration.
    await $`docker compose rm -sf api-canary`;
  },
};

class Deploy extends Build {
  rollout = canary((c) =>
    c.platform(compose)
      .steps(25, 50)
      .bake("5m")
      .analysis(httpProbe((h) => h.url("http://localhost:8080/healthz")))
  );
  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

### Cloud Run

`cloudRunCanary` from `@zuke/gcloud` is a Cloud Run service as a platform:

<!-- check -->

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";
import { cloudRunCanary } from "@zuke/gcloud";

class Deploy extends Build {
  image = parameter("Container image to roll out").required();

  rollout = canary((c) =>
    c.platform(
      cloudRunCanary((r) =>
        r.service("api").region("europe-west1").image(this.image.value)
          .gcloud((g) => g.project("my-project"))
      ),
    )
      .steps(10, 25, 50)
      .bake("10m")
      .analysis(httpProbe((h) => h.url("https://api.example.com/healthz")))
  );
  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

Its lambda runs on every call, so it may read resolved parameters. Every traffic
move goes through the candidate's tag (`canary` unless you set `.tag(...)`):

| Call      | gcloud                                                                                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`   | `run services describe <service> --format 'value(metadata.uid)'`, then `run services update <service> --image <image> --tag canary --no-traffic`, then records the service, region, tag, gcloud flags and uid, and the new revision. `services update` never creates a service, so the service must exist. |
| `expose`  | The record check, then `run services update-traffic <service> --to-tags canary=<n>`. gcloud spreads the rest over the revisions already serving, in proportion and in whole percents, so an earlier split is kept only approximately. Whole percents only.                                                 |
| `promote` | The record check, then checks that the latest revision is still the staged candidate, then `update-traffic --to-latest`. A revision someone deployed mid-rollout is refused, which rolls back.                                                                                                             |
| `abort`   | Mid-rollout: the record check, then `update-traffic --to-tags canary=0`. Run by hand (no recorded state): no check, `update-traffic --to-revisions <stable>=100`, to the revision set with `.stable(...)`, and it refuses without one.                                                                     |

The record check compares the service, region, tag and gcloud flags this call is
configured with to the ones `stage` recorded, before any command, then reads the
service's `metadata.uid` again and compares it to the recorded one, before
anything changes.

A hand-run `zuke rollout.abort` is a fresh run with no record of the rollout,
and the release it undoes has usually been promoted, so the tag's route is
already at 0 %. Name the revision to go back to with `.stable("api-00041-xyz")`;
without it the abort refuses instead of reporting a rollback it did not do. For
a rollout that is still running or parked, use `zuke cancel <run-id>`.

After an abort the candidate revision still exists, with no traffic and still
carrying the tag, so its tagged URL reaches it until the next rollout moves the
tag. Promote checks the latest revision and then moves traffic in a second call,
so a deploy that lands in the seconds between the two is not caught. Global
flags such as `--project` and `--account` go in `.gcloud(...)`.

`stage` records the service, the region (or that none was set), the tag and the
global flags `.gcloud(...)` gives every command — as argv only: what it passes
with `.env(...)` may be a secret and is not recorded, and neither is which
gcloud binary runs. A later `expose`, `promote` or rollback — in a resumed
process, or a `zuke cancel` — configured with any other value refuses, naming
both, and changes nothing rather than move traffic on, or promote, a service the
rollout never staged. The flags are compared as written, in order, so two
spellings of one project are refused too, as is a changed `--verbosity`. A
record with a part missing is refused as damaged, before any command — and so is
a rollout parked by an earlier `@zuke/gcloud`, which recorded none of this: take
its traffic back by hand with `update-traffic --to-tags canary=0`, plus the
`--project` and `--account` flags the rollout used.

The `.gcloud(...)` lambda runs once for each command, and every command is
refused before it runs unless the lambda gave it exactly the flags the call
resolved and checked, so a lambda that resolves differently between two runs —
it reads a clock, or something it closes over changes — cannot send one command
to another project.

The flags cannot see everything that chooses the service: gcloud's active
project also comes from `CLOUDSDK_CORE_PROJECT`, `gcloud config set project` and
the active configuration, and its default region from `run/region`. So `stage`
also records the service's `metadata.uid`, which Cloud Run sets when the service
is created and keeps until it is deleted, and every later call reads it again
before changing anything. A service of the same name in another project or
region, or one deleted and created again, has another uid and is refused. The
uid read and the traffic move are two gcloud calls, so a change landing in the
seconds between them is not caught.

A refusal changes nothing, but the run stops, and its rollback refuses the same
way — so the candidate keeps the share it had, and a resume or `zuke cancel`
will not roll it back. To recover, set the configuration and gcloud's active
project back to what the rollout started with, and run the uid check the refusal
gives — a `run services describe` of the recorded service — to see that it
prints the recorded uid (a rollback run by hand has no record to check it
against). Then run the `run services update-traffic … --to-tags canary=0`
command it gives, built from the recorded service, region, tag and flags. Prefer
it: it returns the tag's share to the revisions already serving, keeping their
split. Running `zuke rollout.abort` by hand with `.stable(...)` instead sends
all traffic to that one revision, collapsing any earlier split; the
`run revisions list` command the refusal gives lists the revisions to choose
from. A rollback run by hand with no record uses the configuration as it is.

### Kubernetes

`kubectlCanary` from `@zuke/kubectl` is a pair of Deployments as a platform: the
stable one, and a canary Deployment that sits at 0 replicas between rollouts.

<!-- check -->

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";
import { kubectlCanary } from "@zuke/kubectl";

class Deploy extends Build {
  image = parameter("Container image to roll out").required();

  rollout = canary((c) =>
    c.platform(
      kubectlCanary((k) =>
        k.stable("api").canary("api-canary").container("api")
          .image(this.image.value).replicas(10).namespace("prod")
          .kubectl((s) => s.context("prod"))
      ),
    )
      .steps(10, 30, 50)
      .bake("10m")
      .analysis(httpProbe((h) => h.url("https://api.example.com/healthz")))
  );
  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

It assumes **one Service selects the pods of both Deployments** (give them a
shared label the Service selects, and each Deployment a label of its own for its
selector). The Service spreads connections over every ready pod, so the
candidate's share of traffic follows its share of replicas. Exposure is
`"replicas"`: quantised, and `expose` returns the share it reached. Its lambda
runs on every call, so it may read resolved parameters.

| Call      | kubectl                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`   | Records that it started, then reads single values with `get deployment/<d> -o jsonpath={…}`: the stable image for the container, both Deployments' `.spec.paused`, and the canary's `.spec.replicas`. It refuses a paused Deployment and a canary not at 0 replicas, then runs `set image deployment/<canary> <container>=<image>` and records the stable image, the candidate image, `replicas`, and the Deployments, container and namespace it changed. |
| `expose`  | canary = `round(replicas × n / 100)`, at most `replicas − 1` for a step; a step asking for less than half a replica is refused, naming the `replicas` it needs. `scale deployment/<canary>`, `rollout status deployment/<canary> --timeout=<timeout>`, then `scale deployment/<stable>` to the rest. The canary grows and is ready before stable shrinks, so a step never drops capacity.                                                                  |
| `promote` | `set image deployment/<stable> <container>=<staged image>`, `scale deployment/<stable>` to the recorded `replicas`, `rollout status deployment/<stable>`, then `scale deployment/<canary> --replicas=0`. It promotes the image `stage` recorded, whatever the lambda says now; the canary is emptied only once stable is ready.                                                                                                                            |
| `abort`   | Mid-rollout: `set image` the recorded stable image back on stable (a no-op unless a promote got part of the way), scale it to the recorded `replicas`, `rollout status`, then scale the canary to 0 — even if that wait fails. Run by hand: the same with the image from `.stableImage(...)`, and it refuses without one.                                                                                                                                  |

A hand-run `zuke rollout.abort` is a fresh run with no record of the rollout,
and the release it undoes has usually been promoted, so the stable Deployment
already runs the candidate: moving replicas alone would change nothing. Name the
image to go back to with `.stableImage("reg/api@sha256:…")`; without it the
abort refuses instead of reporting a rollback it did not do. A rollback after a
`stage` that failed before recording the candidate runs nothing — the canary had
no replicas and stable was never touched.

Limits worth knowing:

- A Service balances **connections**, not requests: with keep-alive or HTTP/2
  clients the candidate's real share can differ a lot from its replica share.
  For an exact request split use a traffic platform (a mesh or Cloud Run).
- `.replicas(n)` is the stable Deployment's size at rest; `stage` records it,
  and promote and abort restore the recorded value. Nothing else may own either
  Deployment during a rollout: suspend a HorizontalPodAutoscaler, and the sync
  and self-heal of a GitOps controller that manages their replicas or image. A
  step needs at least half a replica and `replicas` of at least 2.
- Only `expose` guarantees capacity. Promote and abort `set image` on the stable
  Deployment, which rolls out by its own strategy — give it `maxUnavailable: 0`.
- `stage` refuses a canary Deployment that is not at 0 replicas: it is left from
  an earlier rollout. Roll that back with `zuke cancel <run-id>`, or scale the
  canary to 0 by hand once stable is back at full size. It also refuses a paused
  Deployment, which would not roll out the new image.
- Growing before shrinking means up to `replicas` + canary pods run at once; a
  namespace near its quota can stall the canary's `rollout status`, which times
  out (`.timeout(...)`, from `1ms` to `24h`, default `5m`) and rolls back.
- Prefer a digest for `.image(...)`: promote sets the same reference on the
  stable Deployment, and a mutable tag can move in between.
- Global flags (`--context`, `--kubeconfig`, a `.toolPath(...)`) go in
  `.kubectl(...)`.
- A rollout must be finished or cancelled with the configuration it started
  with. `stage` records the Deployments, container and namespace, and `expose`,
  `promote` and `abort` refuse — changing nothing — when the lambda names
  others. The kube context and kubeconfig cannot be recorded, so they must not
  change mid-rollout either: a resume or `zuke cancel` pointed at another
  cluster would act on the same-named Deployments there. A refusal leaves the
  run cancelled with its rollback failed, so roll back by hand: set the
  configuration back, then run the rollout's `<field>.abort` target (e.g.
  `zuke rollout.abort`) with `.stableImage(...)` set to the image the refusal
  names. `expose` and `promote` also refuse a rollout `stage` did not record.

### Helm

`helmCanary` makes a pair of releases a platform for a
[`@zuke/canary`](https://jsr.io/@zuke/canary) rollout. The candidate runs as a
second release (`<stable>-canary` unless you name it with
`.canaryRelease(...)`), and exposure is the share of the replicas it holds:

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";
import { helmCanary } from "@zuke/helm";

class Deploy extends Build {
  tag = parameter("Image tag to roll out").required();

  rollout = canary((c) =>
    c.platform(
      helmCanary((h) =>
        h.chart("./charts/api").stableRelease("api").namespace("prod")
          .image(this.tag.value).replicas(10).values("values-prod.yaml")
          .helm((s) => s.kubeContext("prod"))
      ),
    )
      .steps(10, 50)
      .bake("10m")
      .analysis(httpProbe((p) => p.url("https://api.example.com/healthz")))
  );
  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

Every upgrade passes `--reset-then-reuse-values`, and every command on the
stable release `--history-max 0`:

| Call      | helm                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stage`   | `get all <stable> --template '{{.Release.Version}} {{.Release.Info.Status}} {{.Release.Info.FirstDeployed.UnixNano}}'` — refused unless `deployed`, else the revision and first-deployed time are recorded; `get all <canary>` — refused if the canary release already exists; then `upgrade <canary> <chart> --set replicaCount=0 --set-string image.tag=<image> --install --wait`. |
| `expose`  | `get all <stable> --template '{{.Release.Info.FirstDeployed.UnixNano}}'` — refused unless it is the recorded time; then `upgrade <canary> <chart> --set replicaCount=<n> --wait`, then `upgrade <stable> <stable chart> --set replicaCount=<total-n>`. `n` is rounded, at least 1 above 0 %; returns `n / total`.                                                                    |
| `promote` | The same first-deployed check, then `upgrade <stable> <chart> --set replicaCount=<total> --set-string image.tag=<image> --wait`, then `uninstall <canary> --ignore-not-found`.                                                                                                                                                                                                       |
| `abort`   | The same first-deployed check, then `rollback <stable> <recorded revision> --wait`, then `uninstall <canary> --ignore-not-found` (only the check and the uninstall when the canary install was under way). Run by hand there is no record, so no check: the revision is set with `.stableRevision(n)`; without one it refuses.                                                       |

`stage` records the image, the total replica count, the charts and their
versions, the values files and the image and replica keys, and `expose` and
`promote` use what it recorded — so a resumed process configured with another
image or chart still promotes the one that was analysed. Every command's exit
code is checked, so a `.helm((s) => s.noThrow())` or a runner that returns a
failed output cannot make a failed install look staged or a failed rollback look
done. A rollback is `helm rollback` to the exact revision `stage` read, so it
restores the stable image, values and replica count even after a promotion that
failed half-way; a stage that failed before installing anything runs no rollback
at all.

`stage` also records the stable release, the canary release and the namespace. A
later `expose`, `promote` or rollback configured with any other value refuses,
naming both, and changes nothing rather than act on either set: the kube context
and kubeconfig in `.helm(...)` cannot be recorded, so **do not change them, the
release names or the namespace mid-rollout**. If they did change, the run is
left cancelled with the canary release in place and the stable release scaled
down. To recover, set the configuration back to what the rollout started with,
then run the rollout's `<field>.abort` target by hand (`zuke rollout.abort`)
with `.stableRevision(n)` — the refusal names the revision `stage` recorded. A
rollback run by hand with no record uses the configuration as it is.

`stage` also records when the stable release was first deployed — a time helm
sets once, at install, and carries through every upgrade and rollback — and
every later `expose`, `promote` and rollback, and a resumed `stage`, reads it
again before changing anything. A stable release uninstalled and installed again
under the same name has a new one, so it is refused rather than rolled back to a
revision its history does not hold. The kube context still cannot be recorded,
but one that now points at another cluster refuses rather than act, because that
cluster's release will not have been first deployed at the same nanosecond — a
strong check, not a proof. The refusal names both times and changes nothing, but
the run is left cancelled with the canary release in place, so a resume or
`zuke cancel` will not roll it back. To recover, point the kube context back at
the cluster the rollout started on, check with `helm status <stable>` that it
reaches the release that was staged (a rollback run by hand has no record to
check it against), then run the rollout's `<field>.abort` target by hand with
`.stableRevision(n)` — the refusal names the revision `stage` recorded. If the
release really was reinstalled, that revision is not in its history: check
`helm history <stable>` and clean up by hand, uninstalling the canary release
once the stable one is as it should be.

What it relies on, and cannot check:

- **The stable release's Service must select the canary release's pods too.** A
  chart scaffolded by `helm create` selects on
  `app.kubernetes.io/instance: <release>`, so its canary pods would take no
  requests at all and every analysis would pass on the stable version alone. Use
  a chart whose selector spans both releases.
- **The canary release inherits nothing from the stable one.** It is the chart's
  defaults plus `.values(...)`, so those files must reproduce the stable
  release's whole configuration — values only ever set by hand on the stable
  release are not in what the canary ran.
- **A second release of the chart must coexist with the first.** Names that are
  hard-coded or set by `fullnameOverride`, a duplicated Ingress host,
  cluster-scoped objects, and hooks that run again on install all collide or
  misbehave.
- **The chart must honour the replica key** (`replicaCount` by default, set with
  `.replicasKey(...)`): an enabled autoscaler ignores it.
- **The image key defaults to `image.tag`**, so `.image(...)` is the tag alone
  (a `@sha256:` digest after it is fine); point `.imageKey(...)` at a key that
  takes a full reference to pass one.
- **Every replica move re-renders the stable release.** Without
  `.stableChart(...)` it renders `.chart(...)`, so a candidate that changes the
  chart changes every stable pod's templates at the first step. Name the chart
  the stable release runs with `.stableChart(...)` / `.stableVersion(...)`, or
  keep the chart and version identical for both. A chart that is not a local
  path (`./…`, `../…`, `/…` or a Windows `C:\…`) must be pinned — `.chart(...)`
  with `.version(...)`, and `.stableChart(...)` with `.stableVersion(...)` — and
  `stage` refuses it otherwise, since an unpinned repository or `oci://` chart
  would render its latest version at every step and the promotion could install
  a chart that was never analysed.
- **A local chart is recorded by its path, not its content.** Editing the chart
  directory mid-rollout means the later steps and the promotion render a chart
  that was not the one analysed; leave it alone until the rollout finishes, or
  roll out a packaged, versioned chart instead.
- **Capacity can dip briefly.** The canary release scales up first, but `--wait`
  counts a Deployment ready at `replicas - maxUnavailable`, and the stable
  release scales down without waiting.
- **A rollback returns the stable release to the revision `stage` recorded**, so
  a deploy someone else made to it mid-rollout is rolled back too. The adapter's
  own commands keep every revision (`--history-max 0`), but another upgrade of
  the stable release mid-rollout (default `HELM_MAX_HISTORY`, 10) can still
  prune it; the rollback then fails rather than guess.
- Requires Helm 3.14 or later in the 3.x line (`--reset-then-reuse-values`,
  `uninstall --ignore-not-found`).

### Docker Compose

`dockerComposeCanary` from `@zuke/docker-compose` is a Compose project as a
platform. The project runs the release as two services, a stable one and a
canary one, behind a proxy that balances requests across the containers of both:
Traefik's Docker provider, or nginx/HAProxy over a shared network alias
(re-resolving it, since Docker's DNS hands out one address per container).
Exposure is `"replicas"`: the canary's share of a fixed total, so it comes in
whole replicas and the achieved share is what `expose` reports.

Compose has no command that sets a service's image, so each service's `image:`
must be a whole variable, and the platform sets it on every command it runs:

```yaml
services:
  app: &app
    image: ${APP_IMAGE}
    scale: 4 # the platform's .replicas(...)
    networks:
      default:
        aliases: [backend] # the proxy balances over every "backend" container
  app-canary:
    <<: *app # identical but for the image and the scale
    image: ${APP_CANARY_IMAGE:-${APP_IMAGE}}
    scale: 0
```

<!-- check -->

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";
import { dockerComposeCanary } from "@zuke/docker-compose";

class Deploy extends Build {
  image = parameter("Container image to roll out").required();

  rollout = canary((c) =>
    c.platform(
      dockerComposeCanary((d) =>
        d.service("app").canaryService("app-canary").replicas(4)
          .image(this.image.value)
          .stableImageVariable("APP_IMAGE")
          .canaryImageVariable("APP_CANARY_IMAGE")
          .compose((s) => s.file("compose.yml").projectName("shop"))
      ),
    )
      .steps(25, 50)
      .bake("10m")
      .analysis(httpProbe((h) => h.url("https://shop.example.com/healthz")))
      .lock((l) => l.lockKey("deploy", "shop").withTtl("24h"))
  );
  ship = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

Its lambda runs on every call, so it may read resolved parameters. Every call
after `stage` checks the project first (see below). Every move is
`up -d --no-deps --scale <service>=<n> <service>`, with `--wait` when `n` is not
0, run with the image variables set:

| Call      | Compose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`   | Records the marker first, so a stage its own settings refuse is rolled back as a no-op. `ps --format {{.Image}} <stable>` reads the image the stable replicas run (it refuses no replicas, replicas on different images, a truncated capture, or a line that is not an image reference), `images --quiet <stable>` their one image ID, and `ps -a --format '{{.Label "com.docker.compose.project"}}' <stable>` the one project they are in; `pull --policy missing <canary>`; then records the rollout — both services, the replicas, both variables, both images, the stable ID, which every later stable move uses as `sha256:<id>`, the global flags `.compose(...)` gives and that project — which every later call acts on whatever the lambda resolves to then. Then the stable service to every replica (`--no-recreate`) and the canary service to none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `expose`  | Refuses before any command unless `.compose(...)` gives the recorded global flags, then reads `ps -a --format '{{.Label "com.docker.compose.project"}}' <stable> <canary>` and refuses, before any other command, unless it reports exactly the recorded project. The canary service to its share of the recorded replicas (the nearest whole replica, but at least one on each side for any share strictly between 0 and 100) and the stable service, `--no-recreate`, to the rest. Whichever grows goes first, so the total never dips. Once the canary has replicas, `ps` must show every one on the candidate (by reference or by ID) and `images --quiet` must resolve them to one ID: the first step records it, later ones refuse another. Returns the share reached.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `promote` | Refuses before any command unless `.compose(...)` gives the recorded global flags, then reads `ps -a --format '{{.Label "com.docker.compose.project"}}' <stable> <canary>` and refuses, before any other command, unless it reports exactly the recorded project. The canary service to every replica; the stable service recreated with the stable variable set to the candidate's pinned image ID (pinned here, with `ps` and `images --quiet` on the canary, if no step ran); `images --quiet` must then resolve every stable replica to that ID (a stable `image:` that does not read the variable is refused before the promotion is recorded); the canary service to none. The total briefly doubles and never dips. Idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `abort`   | With a record, refuses before any command unless `.compose(...)` gives the recorded global flags, then reads `ps -a --format '{{.Label "com.docker.compose.project"}}' <stable> <canary>` and refuses, before any other command, unless it reports exactly the recorded project. `images --quiet` reads the stable replicas' IDs, stopped ones included (run by hand, `ps` the running ones' references and `ps -a` every container's). Three courses: if they resolve to exactly the recorded ID (run by hand, at least one runs and every container, stopped and created ones included, shows the `.stable(...)` reference — a scale that keeps them would start a stopped one on another image as stable; mid-rollout they do), the stable service back to every replica with `--no-recreate`. If none is running (no stable replica at all, as after a step to 100 %, or none that `ps` shows running), the stable service first, recreated onto the stable image, while the canary keeps serving untouched — recreating it first would take every serving container down at once. Otherwise (some running on another image, after a promotion, finished or part-way) Compose would recreate every stable replica at once, so the canary service first goes to every replica on the stable image, then the stable service is recreated on it. The stable replicas are then read again the same way and must be on the stable image, or it refuses with the canary still serving. Then the canary service to none. Run by hand (no record): the `.stable(...)` image and the configured services; it refuses without one. After a `stage` that changed nothing, nothing runs. |

**A promotion is an override, not a deployment record.** Compose keeps no state
of its own: the stable service's image is whatever `${APP_IMAGE}` resolves to
when Compose next runs. The platform sets it for its own commands only, so until
the candidate is written where the variable comes from (the `.env` file, or the
environment of whatever runs `docker compose up` next), a plain
`docker compose up` puts the stable service back on the old image. The build
summary says so after a promotion and after a hand-run rollback, as
`Persist: set APP_IMAGE=<image> and keep scale: <replicas>`. Persist the image
after `rollout.promote` (a target that depends on it can write the `.env` file),
or always run Compose with the variable set. The platform itself does not depend
on that: the next rollout's `stage` records what the stable replicas actually
run, so its rollback returns to the image that was serving, whatever the `.env`
file says.

A hand-run `zuke rollout.abort` is a fresh run with no record of the rollout,
and the release it undoes has usually been promoted, so re-scaling the stable
service would change nothing. Name the image to go back to with
`.stable("registry.example.com/app:1.4.0")`. Without it the abort refuses
instead of reporting a rollback it did not do. That rollback is an override too,
in the same way as a promotion. For a rollout that is still running or parked,
use `zuke cancel <run-id>`.

**The project is part of the record.** The services are named inside a Compose
project, so `stage` records the global flags `.compose(...)` gives (`-f`, `-p`,
`--profile`, `--project-directory`, `--env-file`) as argv, never what its
`.env(...)` passes, which may be a secret. `expose`, `promote` and a recorded
`abort` compare the flags the lambda gives now with the recorded ones before
running any command, reads included, since a read of another project would
inform the next move, and refuse on any difference: as written, in order, so
`-f a.yml -f b.yml` and `-f b.yml -f a.yml` differ too. A record with no usable
flags is refused as damaged. Without this, a resumed or cancelling process whose
`.projectName(this.env.value)` resolves to another value would scale and
recreate same-named services in a project the rollout never staged. The lambda
also runs once per command, and a command it gives other flags than the call
resolved at its start (a lambda reading a clock or a counter) is refused before
it runs.

Flags are not all that selects a project: `COMPOSE_PROJECT_NAME` in the
environment, a `.env` or `--env-file` that sets it, the lambda's `.env(...)` and
`.cwd(...)`, and the working directory a default name comes from do too. So
`stage` also records the project Compose reports the stable replicas in
(`ps -a --format '{{.Label "com.docker.compose.project"}}' <stable>`, which
prints each container's project label; `.Label` is in Compose 2.21 and later),
and after the flag check every later call reads the same with
`<stable> <canary>` before any other command. Compose resolves the project from
all of those and lists only that project's containers, so the call refuses
unless the output is exactly the recorded project. `-a` counts stopped
containers, so a daemon restart that stopped them does not block the rollback; a
call that finds no container of either service, running or stopped, refuses: a
live rollout always has some, since the total never dips. A record without the
project is refused as damaged.

Either refusal says the call changed nothing and names both projects, or both
sets of flags; the project refusal also names what can change the project. Since
`expose` and `promote` cancel the run on failure, and the rollback that
cancellation runs refuses for the same reason, the run is left cancelled with
the rollout's services as they are: a resume answers that the run is not
suspended, and `zuke cancel` that it is already cancelled. The recovery the
message names is the one that works: set the configuration and environment back
to what the rollout started with, check with `docker compose ps` that it reaches
the project that was staged (a rollback run by hand has no record to check
against), then run the rollout's abort target by hand (`zuke rollout.abort`)
with `.stable("sha256:<id>")` set to the stable image ID the message names, the
one the rollout recorded. The message names the tag as well, but a tag can move,
so use it only if it still resolves to that ID. A rollback by ID passes
`--pull never`, and it also undoes a promotion that failed part-way. A hand-run
abort has no record, so it acts on whatever project the lambda selects.

Limits worth knowing:

- The project check compares the project Compose itself reports, so it covers
  whatever selects the project: the flags, `COMPOSE_PROJECT_NAME`, a `.env` or
  `--env-file`, the lambda's `.env(...)` and `.cwd(...)`, the working directory.
  It does not cover another daemon: a Docker context, `DOCKER_HOST` or
  `.toolPath(...)` that reaches a daemon running the same project name with the
  same services on the same images is not told apart. Nor does it compare the
  services' definitions, so a `COMPOSE_FILE` or env-file change that keeps the
  project but changes them goes unnoticed — as does, with an explicit `-p` and
  no `-f`, a working directory or `.cwd(...)` that loads another `compose.yml`
  under the same project name. The lambda's `.env(...)` and `.cwd(...)` are
  checked only at each call's project read, and later commands re-check only its
  flags, so it must give the same ones every time it runs. The recorded image
  IDs are a partial guard against another daemon: after `stage` every move
  passes `--pull never`, so one that creates a container fails on a daemon that
  lacks its image (the recorded stable ID, or the candidate), while one that
  only removes containers needs no image and goes ahead; and the reads compare
  IDs, so a rollback finds stable replicas on another image and a later step a
  canary on another candidate.
- Exposure is a share of **containers**. It is a share of requests only if the
  proxy balances evenly, so sticky sessions or uneven connection reuse skew it.
- The two services must be identical except for the image and the scale (a YAML
  anchor, as above). The analysis judged the candidate under the canary
  service's configuration, and promote runs it under the stable service's.
- Do not run `docker compose up` on the project by hand during a rollout, and
  take a `.lock(...)`. A plain `up` applies the `scale:` values and the `.env`
  images: it takes the canary service back to none and the stable service to the
  file's image, behind the rollout's back.
- Give the stable service `scale:` equal to `.replicas(...)` and the canary
  service `scale: 0` in the file: a plain `docker compose up` sets every service
  back to its `scale:`, replica count included.
- `pull --policy missing` does not refresh a mutable tag that is already present
  locally. Roll out immutable tags or digests.
- The first step that runs a canary replica pins the candidate's image ID
  (`images --quiet`); later steps run the canary by that ID and refuse one that
  resolves to another, and promote installs that ID on the stable service and
  checks it there by ID. A candidate tag moved after the analysis therefore
  cannot promote an image nobody judged. The Persist summary names the reference
  and the ID it must still resolve to.
- Abort decides whether the stable replicas need recreating by ID: only when
  `images --quiet <stable>` resolves to exactly the recorded ID does it keep
  them; a tag `ps` shows is not evidence of the image.
- Every move that sets a variable to an image ID passes `--pull never`, which
  overrides a service's `pull_policy: always` (an ID cannot be pulled).
- `images` counts stopped replicas and one-off `docker compose run` containers
  as well as running ones, so one left on another image makes `stage` refuse
  until it is removed (`docker compose rm`; use `run --rm`).
- After moving the stable service, abort reads it again (by ID, or by reference
  when run by hand) and refuses, leaving the canary serving, if a literal stable
  `image:` kept it off the stable image.
- `stage` records the stable replicas' image ID (`images --quiet`), and every
  later command that may create a stable replica sets the stable variable to
  `sha256:<id>` rather than the tag. A tag moved by a local pull or build
  mid-rollout therefore cannot bring a never-analysed image into the stable
  service; a rollback accepts replicas shown by tag or by that ID.
- Image variables may not be names Docker, Compose or the process read as
  settings (`DOCKER_*`, `COMPOSE_*`, `BUILDKIT_*`, `BUILDX_*`, `XDG_*`, `LD_*`,
  `DYLD_*`, `*_PROXY`, `PATH`, `PATHEXT`, `HOME`, `USERPROFILE`, `SystemRoot`,
  `TMPDIR`, `TEMP`, `TMP`, `SSH_AUTH_SOCK`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, in
  any case), and the two must differ in more than case.
- Promote recreates the stable replicas. That is not a rolling update, but the
  canary service holds every replica's worth of the candidate while it happens.
- Requires Compose 2.21 or later (`docker compose`). The project check's
  `{{.Label "com.docker.compose.project"}}` template is not in earlier releases,
  and `--wait`, `pull --policy` and `ps --format` with a Go template are not in
  the v1 `docker-compose` binary.
- `--wait` has no timeout. Bound each command with
  `.compose((s) => s.killAfter(600_000))` if a replica that never becomes
  healthy must not hold the rollout indefinitely.

Global flags such as `-f`, `-p` and `--env-file` go in `.compose(...)`. The
image variables are applied after it, so an `.env(...)` there cannot override
them. A command that exits non-zero fails the call even under `.noThrow()`, and
trailing `.args(...)` there are refused, since they would follow the service
operand of every command — a guard against accidents, not a security boundary.

## Bakes: inline or durable

By default a bake is **inline**: the bake target sleeps in the process while
core's [`.validateDuring`](./authoring.md) runs the analyses every
`.analysisInterval(...)` (default `"1m"`). The first failing check stops the
bake at once and rolls back. `zuke cancel` or Ctrl-C ends the bake too.

`.durable()` makes each bake a **gate** instead. The run suspends at it, so no
process is alive during the bake. The gate records when the bake started in its
durable state, and `zuke resume --check` (from a cron, say) reopens it once the
time is up. A durable bake runs no in-flight analyses, since nothing is there to
run them. Each step's final `analyze` still runs, in whichever process resumes
the run. An inline bake is a timer, so it can be at most about 24 days; a
durable one has no such limit. Use durable bakes when a bake is long, or when
the CI job that started the rollout should not stay alive for it.

## Analyses

An analysis is anything with a `validate(ctx)` that throws to fail. Any core
`Validation` works unchanged, an `@zuke/ai` review included. A canary-aware one
also reads where the rollout stands: `ctx.step`, `ctx.requested` and
`ctx.exposure`, alongside the core context's `target`, `redact` and `signal`.

The package ships three; [`@zuke/aws`](#cloudwatch) adds one for CloudWatch,
[`@zuke/az`](#azure-monitor) one for Azure Monitor and
[`@zuke/gcloud`](#cloud-monitoring) one for Cloud Monitoring:

| Analysis                                                  | Fails when                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `httpProbe((h) => h.url(u).samples(30).maxFailures(1))`   | More than `maxFailures` of `samples` requests fail: a status outside `expectStatus(...)` (any 2xx by default), a timeout, or a connection error.        |
| `prometheus((p) => p.url(u).query(q).max(0.01))`          | Any sample of the instant query is out of bounds, or the query cannot be read. An empty result fails: append `or vector(0)` when no data means healthy. |
| `metricThreshold((m) => m.name("p99").read(fn).max(0.5))` | The number your reader returns is out of bounds.                                                                                                        |

Each analysis's lambda runs on every check, so it may read resolved parameters.
Failure messages pass through the run's redactor, so a secret parameter in a URL
or a query is masked before it reaches a log or a pull request. Any URL in a
failure message then goes through core's `redactUrls`, which strips its
`user:password@` and masks credential-bearing parameters such as `token` or
`api_key`, because that is where hard-coded tokens tend to live.

A ratio query over a window with no traffic is `0/0`, which Prometheus reports
as `NaN`, and a `NaN` sample fails the analysis. Guard such a query so that
quiet means healthy, for example `… and on() sum(rate(requests_total[5m])) > 0`
or `… or vector(0)`.

`prometheus(...)` queries through
[`@zuke/prometheus`](../packages/prometheus/README.md), the same client a build
uses for its own metrics, so it shares that client's rules. A URL the query
sends a credential to must be `https:` unless it is loopback (set
`ZUKE_ALLOW_INSECURE_URL` for a plaintext endpoint on a network you trust). A
credential is any of:

- an `Authorization`, `Proxy-Authorization` or `Cookie` header;
- a header whose name looks like a credential's — `X-API-Key`, `X-Auth-Token`,
  any name core's URL redactor treats as credential-bearing (containing `key`,
  `token`, `secret`, `auth`, `pass` and the like);
- `user:password@`, or a credential parameter such as `?access_token=`, in the
  URL;
- anything configured through `connection(...)`: a `secretHeader(...)`, or the
  managed services' `google()`, `azure()` and `sigv4()`.

An unauthenticated in-cluster URL such as
`http://prometheus.monitoring.svc:9090` is queried as it is, and so is one sent
only a plain header like a Mimir or Cortex tenant's `X-Scope-OrgID`. Redirects
are not followed, an answer larger than 64 MiB fails, and a header value of
eight or more characters never appears in a failure message. The query is still
sent as a `GET`, so a proxy that only passes `GET` keeps working. For anything
beyond bounds on one instant query — a range, a rule's state, the firing alerts
— read it with `PrometheusTasks` and judge it in a `metricThreshold(...)`
reader.

`connection(...)` hands the rest of the connection to `@zuke/prometheus`'s own
settings — applied after `url`, `header`, `timeout` and `fetch`, so a request
signer set there signs the headers set before it. It is how a canary reads a
managed Prometheus with the cloud's own credentials, with no `gcloud`, `az` or
`aws` CLI on the runner:

```ts
import { prometheus } from "@zuke/canary";

const ERROR_RATIO =
  'sum(rate(http_requests_total{rev="canary",code=~"5.."}[5m])) / ' +
  'sum(rate(http_requests_total{rev="canary"}[5m]))';

// Amazon Managed Service for Prometheus, signed with SigV4.
export const amp = prometheus((p) =>
  p.name("error ratio")
    .url("https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-1234")
    .query(ERROR_RATIO).max(0.01)
    .connection((c) => c.sigv4((a) => a.region("us-east-1")))
);

// Google Cloud Managed Service for Prometheus, through Application Default
// Credentials; `c.azure()` does the same for Azure Monitor.
export const gmp = prometheus((p) =>
  p.name("error ratio")
    .url(
      "https://monitoring.googleapis.com/v1/projects/my-project/location/global/prometheus",
    )
    .query(ERROR_RATIO).max(0.01)
    .connection((c) => c.google())
);
```

### CloudWatch

`cloudwatch` from [`@zuke/aws`](../packages/aws/README.md) reads a CloudWatch
metric with `aws cloudwatch get-metric-data` and fails the canary when any
datapoint in the window is out of bounds — the same name, `min`/`max` and
failure wording as `prometheus(...)`:

<!-- check -->

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";
import { cloudwatch } from "@zuke/aws";

class Deploy extends Build {
  targetGroup = parameter("The canary's ALB target group").required();

  rollout = canary((c) =>
    c.platform({
      exposure: "traffic",
      describe: () => "ALB weighted target groups",
      async stage() {},
      async expose(percent) {
        return percent;
      },
      async promote() {},
      async abort() {},
    })
      .steps(10, 50)
      .bake("10m")
      .analysis(httpProbe((h) => h.url("https://api.example.com/health")))
      .analysis(cloudwatch((m) =>
        m.name("canary 5xx").namespace("AWS/ApplicationELB")
          .metricName("HTTPCode_Target_5XX_Count")
          .dimension("TargetGroup", this.targetGroup.value)
          .stat("Sum").window("10m").max(5).missingDataAs(0)
          .aws((a) => a.region("eu-west-1"))
      ))
  );

  release = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

| Setting                                        | Meaning                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `namespace`, `metricName`, `dimension`, `stat` | The metric, queried as `m1`. `stat` is `Sum`, `Average`, `Maximum`, `Minimum`, `SampleCount`, `IQM`, or a percentile such as `p99`.         |
| `period(seconds)`                              | What each datapoint covers (default 60). Every datapoint is judged, so `.max(5)` on a per-minute `Sum` means no minute with more than five. |
| `window(duration)`                             | How far back to read (default `5m`). It ends at the last period boundary, so the period still being written is not judged.                  |
| `metricStat(id, (m) => …)`, `expression(text)` | Judge metric math instead: add the inputs by id, and `expression("100 * errors / requests")` is what is judged; the inputs are not.         |
| `min(value)`, `max(value)`                     | The bounds, inclusive. At least one is required.                                                                                            |
| `missingDataAs(value)`                         | What no datapoints means. CloudWatch publishes nothing for a minute with no events, so for an error count, `0`; by default no data fails.   |
| `aws((a) => …)`, `now(clock)`                  | The CLI's global options — `profile`, `region`, a `runner` a test answers through — and the clock the window is read against.               |

CloudWatch publishes a datapoint a little after its period ends, so the newest
period in the window can still be short of data. That only lowers a `Sum` or a
`SampleCount` — harmless for a `max`, but a `min` on such a statistic can fail
on the lag rather than on the candidate; widen the period or judge an `Average`.

The `aws` CLI must be installed and authenticated on the runner — the analysis
runs it like any other `AwsTasks` call. Failure messages pass through the run's
redactor. `@zuke/canary` is not a dependency of `@zuke/aws`: the analysis has
the shape `c.analysis(...)` accepts, so the two packages stay independent.

### Azure Monitor

`azureMonitor` from [`@zuke/az`](../packages/az/README.md) reads an Azure
Monitor metric with `az monitor metrics list` and fails the canary when any
datapoint in the window is out of bounds — the same name, `min`/`max` and
failure wording as `prometheus(...)`:

<!-- check -->

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";
import { azureMonitor } from "@zuke/az";

class Deploy extends Build {
  appInsights = parameter("The Application Insights component's resource id")
    .required();

  rollout = canary((c) =>
    c.platform({
      exposure: "traffic",
      describe: () => "Container Apps revision weights",
      async stage() {},
      async expose(percent) {
        return percent;
      },
      async promote() {},
      async abort() {},
    })
      .steps(10, 50)
      .bake("10m")
      .analysis(httpProbe((h) => h.url("https://api.example.com/health")))
      .analysis(azureMonitor((m) =>
        m.name("canary failures").resource(this.appInsights.value)
          .metric("requests/failed").aggregation("Count")
          .dimension("cloud/roleName", "api-canary")
          .window("10m").max(5).missingDataAs(0)
          .az((a) => a.subscription("prod"))
      ))
  );

  release = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

| Setting                             | Meaning                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resource`, `metric`, `aggregation` | The metric: a full resource id, the metric's name, and `Total`, `Count`, `Average`, `Maximum` or `Minimum`. `namespace` when it is ambiguous.                |
| `dimension(name, value)`            | Narrow the series to a dimension value — rendered as `--filter "name eq 'value'"`; repeatable.                                                               |
| `interval(grain)`                   | What each datapoint covers (default `PT1M`). Every datapoint is judged, so `.max(5)` on a per-minute `Count` means no minute above five.                     |
| `window(duration)`                  | How far back to read (default `5m`), no shorter than the interval. It ends at the last interval boundary, so the interval still being written is not judged. |
| `top(count)`                        | The most series to read (default 10). A dimension filter can match several; an answer that reaches the limit fails rather than be judged in part.            |
| `kql(workspace, query)`             | Judge a Log Analytics query that returns one row with one number instead (needs the CLI's `log-analytics` extension).                                        |
| `min(value)`, `max(value)`          | The bounds, inclusive. At least one is required.                                                                                                             |
| `missingDataAs(value)`              | What no data means. Azure Monitor reports an interval with no events without a value, so for an error count, `0`; by default it fails.                       |
| `az((a) => …)`, `now(clock)`        | The CLI's global options — `subscription`, a `runner` a test answers through — and the clock the window is read against.                                     |

Azure Monitor publishes a datapoint a little after its interval ends, so the
newest interval in the window can still be short of data. That only lowers a
`Total` or a `Count` — harmless for a `max`, but a `min` on such an aggregation
can fail on the lag rather than on the candidate; widen the interval or judge an
`Average`.

The `az` CLI must be installed and signed in on the runner — the analysis runs
it like any other `AzTasks` call. Failure messages pass through the run's
redactor. `@zuke/canary` is not a dependency of `@zuke/az`: the analysis has the
shape `c.analysis(...)` accepts.

### Cloud Monitoring

`cloudMonitoring` from [`@zuke/gcloud`](../packages/gcloud/README.md) reads a
Cloud Monitoring metric over its REST API (`projects.timeSeries.list` — gcloud
has no command that reads time series) and fails the canary when any aligned
point in the window is out of bounds — the same name, `min`/`max` and failure
wording as `prometheus(...)`. Here it gates a Cloud Run rollout on the 5xx
responses of the canary revision itself:

<!-- check -->

```ts
import { Build, parameter, run, target } from "@zuke/core";
import { canary, httpProbe } from "@zuke/canary";
import { cloudMonitoring, cloudRunCanary } from "@zuke/gcloud";

class Deploy extends Build {
  image = parameter("Container image to roll out").required();

  rollout = canary((c) =>
    c.platform(
      cloudRunCanary((r) =>
        r.service("api").region("europe-west1").image(this.image.value)
          .gcloud((g) => g.project("my-project"))
      ),
    )
      .steps(10, 50)
      .bake("10m")
      .analysis(httpProbe((h) => h.url("https://api.example.com/healthz")))
      .analysis(cloudMonitoring((m) =>
        m.name("canary 5xx").project("my-project")
          .metricType("run.googleapis.com/request_count")
          .resourceType("cloud_run_revision")
          .cloudRunCandidate("api", "europe-west1")
          .metricLabel("response_code_class", "5xx")
          .alignmentPeriod("60s").perSeriesAligner("ALIGN_SUM")
          .crossSeriesReducer("REDUCE_SUM")
          .window("5m").max(5).missingDataAs(0)
      ))
  );

  release = target().dependsOn(this.rollout.promote).executes(() => {});
}

await run(Deploy);
```

| Setting                                                        | Meaning                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metricType`, `resourceType`, `resourceLabel`, `metricLabel`   | The metric, built into a Monitoring filter: each value quoted, and refused when it holds a `"` or `\`, which the filter language documents no escape for. `filter(text)` adds raw text, joined by `AND`.                                                                                                               |
| `cloudRunCandidate(service, region)`                           | Before each check, read the service's latest created revision — the one `cloudRunCanary` staged — in the analysis's `project`, and narrow the read to it by `service_name`, `revision_name` and, with a region, `location`.                                                                                            |
| `alignmentPeriod`, `perSeriesAligner`, `crossSeriesReducer`    | The aggregation. Every aligned point is judged, so `.max(5)` on a per-minute `ALIGN_SUM` means no minute with more than five. A reducer needs an aligner, and an aligner needs a period (60 s or more). A `CUMULATIVE` metric is refused unless `ALIGN_DELTA` or `ALIGN_RATE` turns its running totals into increases. |
| `window(duration)`, `delay(duration)`                          | How far back to read (default `5m`, no shorter than the alignment period), ending `delay` before now (default `2m`) and then at the last period boundary.                                                                                                                                                              |
| `maxPages(n)`                                                  | The most pages to read (default 100). A read with pages left over fails rather than be judged in part.                                                                                                                                                                                                                 |
| `logEntries((l) => …)`                                         | Judge the number of log entries a Cloud Logging filter matches over the window instead, read with `gcloud logging read` — ids only, no payloads — counting at most `.limit(n)` (default 1000). The metric-only settings are refused beside it.                                                                         |
| `min(value)`, `max(value)`                                     | The bounds, inclusive. At least one is required.                                                                                                                                                                                                                                                                       |
| `missingDataAs(value)`                                         | What no data means. By default no data fails. See below before setting `0`.                                                                                                                                                                                                                                            |
| `project`, `token`, `tokenProvider`, `gcloud((g) => …)`, `now` | Where and as whom: the project, the bearer token (by default `gcloud auth print-access-token`, run with the `.gcloud(...)` flags, which also run the revision and log reads), and the clock.                                                                                                                           |

Google's metrics list says Cloud Run's request metrics are sampled every 60
seconds and "not visible for up to 120 seconds" after that, so the window ends
two minutes back by default (`.delay(...)` changes it): judging the minutes that
have not arrived yet would judge nothing, and the newest one could hold only
part of its requests.

**No data passes with `.missingDataAs(0)`.** Cloud Monitoring writes no point
for a minute with no 5xx responses, so an error count needs it — but a candidate
that served no traffic in the window, or a filter that matches nothing, has no
points either, and passes the same way. Keep the window inside the time the
candidate has had traffic: bake for at least the window plus the delay before
each analysis, and pair the check with one that fails on no traffic — an
`httpProbe`, or a second `cloudMonitoring` on the candidate's total
`request_count` with a `.min(...)` and no `missingDataAs`.

`.cloudRunCandidate(...)` reads the latest created revision, which is the
candidate while the rollout runs; a revision someone else deploys mid-rollout
would be read instead, and `cloudRunCanary`'s promote refuses that case before
moving any traffic. In log mode the read runs in the analysis's `project` when
one is set, and otherwise in gcloud's configured project; a metric read falls
back to `GOOGLE_CLOUD_PROJECT` instead.

The default token comes from `gcloud`, which must be installed and authenticated
on the runner. Failure messages pass through the run's redactor, and none
carries the token. `@zuke/canary` is not a dependency of `@zuke/gcloud`: the
analysis has the shape `c.analysis(...)` accepts.

## The lock

`.lock((l) => l.lockKey("deploy", "api").withTtl("24h"))` takes a core lock with
[`holdForRun()`](./locks.md#holding-a-lock-for-the-whole-run). It is held from
staging until the run settles, across every bake and approval wait, so a second
rollout of the same service is refused until the first is promoted or rolled
back. Set the TTL to cover the longest the run can stay parked: it is how long a
parked rollout keeps the lock with no process alive.

## Rolling back

There is one rollback, `rollout.abort`, and every path reaches it:

| What happened                             | How it reaches `abort`                                      |
| ----------------------------------------- | ----------------------------------------------------------- |
| An analysis or an in-flight check failed  | the step's `.onFailure("cancel-run")` cancels the run       |
| `expose` or `promote` failed              | the same                                                    |
| `stage` failed part-way, or was cancelled | `stage` calls the platform's `abort` itself before it fails |
| The approval timed out                    | the gate's `.onTimeout("cancel-run")`                       |
| `zuke cancel <run-id>`                    | the cancellation walk runs `stage`'s compensation           |

When `abort` runs as a rollback, `ctx.state` holds everything `stage` and the
later calls recorded.

Two cases deliberately **do not** roll back:

- **Another rollout lost the lock.** A second rollout refused the lock fails
  before its `stage` body runs, so it touches nothing. The candidate it would
  have rolled back belongs to the rollout holding the lock.
- **The release was already promoted.** `promote` records that it finished, so a
  cancellation later in the same run, such as a downstream target with
  `.onFailure("cancel-run")`, leaves the promoted release alone instead of
  returning traffic to a version promotion already retired.

**Running `zuke rollout.abort` by hand is different.** It starts a fresh run,
which has no recorded state from the rollout, so `ctx.state` is empty. That is
why the platform contract says `abort` must work from its own configuration
alone. When the rollout declares a lock, a hand-run `abort` takes it too, so it
is refused while a rollout holds the service. To stop a rollout that is still
running or parked, use `zuke cancel <run-id>` instead: it rolls back with the
recorded state, and it releases the rollout's lock.
