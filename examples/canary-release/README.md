# canary-release

A canary rollout you can run on your own machine with nothing but Deno — no
cloud account, no cluster, no CLI. [`zuke.ts`](./zuke.ts) rolls `v2` of a tiny
HTTP service out beside `v1` through [`@zuke/canary`](../../docs/canary.md):

```
rollout.stage ─▶ step1 (10 %): expose ─▶ bake ─▶ analyze
              ─▶ step2 (50 %): expose ─▶ bake ─▶ analyze ─▶ rollout.promote ─▶ ship
```

```sh
zuke ship          # 10 % → 50 % → promoted
zuke ship --broken # v2 answers 500: the probe fails, rolled back
zuke --list        # every target the rollout makes
```

The platform is [`local_router.ts`](./local_router.ts): both versions behind one
weighted router on `http://127.0.0.1:8080/` (`--port` picks another; `0` a free
one). Each step bakes for two seconds while an `httpProbe` analysis sends twenty
requests through the router every second; at 10 % two of them reach the
candidate. A healthy candidate is promoted. A broken one fails the probe in the
first bake, and the stage's compensation — `rollout.abort` — sends every request
back to `v1`:

```
✘ rollout.step1.bake failed in 1.1s
  httpProbe: 2 of 20 requests to http://127.0.0.1:8080/ failed (at most 0 allowed): HTTP 500 ×2
rollout.step1.bake failed and its .onFailure(...) cancels the run — rolling back run <id>.
↩ compensating rollout.stage → rollout.abort
```

What to notice:

- **The platform is the only part that knows where the service runs.** The
  router implements `CanaryPlatform` — `stage`, `expose`, `promote`, `abort` —
  in a few dozen lines. Swap `c.platform(this.router)` for a real one and the
  steps, bakes, analyses and rollback stay exactly as they are:
  `cloudRunCanary(...)` from `@zuke/gcloud`, `kubectlCanary(...)` from
  `@zuke/kubectl`, `helmCanary(...)` from `@zuke/helm`,
  `dockerComposeCanary(...)` from `@zuke/docker-compose`, `lambdaCanary(...)`
  from `@zuke/aws` or `containerAppCanary(...)` from `@zuke/az`. Point the probe
  at your service's URL, and add a metric analysis such as `prometheus(...)` —
  [docs/canary.md](../../docs/canary.md) has each one.
- **Every failure runs one rollback.** A failed probe, a failed step, Ctrl-C,
  `zuke cancel <run-id>` — each ends in `rollout.abort`. Run it by hand with
  `zuke rollout.abort`.
- **A rollout keeps durable state.** The run record lands in `.zuke/` beside the
  build, and `zuke runs list` lists it. That is what lets a real rollout park at
  an `.approval(...)` gate, or bake for hours with `.durable()`, and be resumed
  by another process. This router lives inside the build's own process, so the
  example runs start to finish in one go; a real platform has no such limit.
