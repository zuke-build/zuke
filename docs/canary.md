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
[Cloud Run](#cloud-run) and [Kubernetes](#kubernetes) below. Until one exists
for yours, a platform is a plain object in the build:

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

| Call      | gcloud                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`   | `run services update <service> --image <image> --tag canary --no-traffic`, then records the new revision. `services update` never creates a service, so the service must exist.                                                     |
| `expose`  | `run services update-traffic <service> --to-tags canary=<n>`. gcloud spreads the rest over the revisions already serving, in proportion and in whole percents, so an earlier split is kept only approximately. Whole percents only. |
| `promote` | Checks that the latest revision is still the staged candidate, then `update-traffic --to-latest`. A revision someone deployed mid-rollout is refused, which rolls back.                                                             |
| `abort`   | Mid-rollout: `update-traffic --to-tags canary=0`. Run by hand (no recorded state): `update-traffic --to-revisions <stable>=100`, to the revision set with `.stable(...)`, and it refuses without one.                               |

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

The package ships three, all over plain HTTP with no dependencies:

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
