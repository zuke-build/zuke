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

Adapters for specific platforms belong in their wrapper packages. Until one
exists for yours, a platform is a plain object in the build:

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
failure message is also cut down to its origin and path, because a URL's
`user:password@` and query string are where hard-coded tokens tend to live.

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
