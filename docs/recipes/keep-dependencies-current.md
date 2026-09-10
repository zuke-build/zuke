# Recipe: know when your dependencies fall behind

A build that pins its tools inline — `jsr:@zuke/git@^1` in `zuke.ts` and its
helper modules, rather than in a `deno.json` imports map — has no manifest for
`deno outdated` to read. The lock keeps resolving the versions recorded when the
build was written, and `--frozen` is perfectly content with that, because a
stale-but-valid lock is exactly what `--frozen` is for.

Nothing fails. The build stays green for months while a wrapper it depends on
grows the typed command the build is still hand-rolling. `zuke outdated` is the
signal that nothing else gives you; this recipe wires it up so it arrives on its
own schedule instead of when someone remembers to look.

## Do not put it in the gate

The obvious move is a line in the `ci` target. Resist it, for two reasons.

`outdated` needs the **network**, and the gate is deliberately hermetic — that
is what makes it reproducible and fast. And a dependency publishing a release
would turn a red X on a pull request that has nothing to do with it, blocking an
author who cannot fix the cause and did not create it. Freshness is a property
of the repository over time, not of a change.

So it gets its own pipeline, on a schedule.

## The wiring

<!-- check -->

```ts
import { Build, cicd, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class MyBuild extends Build {
  // The ordinary gate: hermetic, on every push and pull request.
  ci = cicd({
    pipeline: {
      name: "CI",
      triggers: { push: ["main"], pullRequest: ["main"] },
    },
  });

  // Freshness, on its own file and its own cadence.
  freshness = cicd({
    path: ".github/workflows/freshness.yml",
    pipeline: {
      name: "Dependency freshness",
      triggers: {
        // 06:00 Monday, in a real timezone (see below).
        schedule: [{ cron: "0 6 * * 1", tz: "Europe/Sofia" }],
        // So anyone can ask the question on demand.
        manual: true,
      },
      jobs: [{
        id: "outdated",
        name: "Are we current?",
        // `outdated` is a reserved command rather than a target, so the job
        // names it directly instead of invoking a target.
        steps: [{ name: "Check", run: "./zuke outdated --exit-code" }],
      }],
    },
  });

  test = target().executes(() => DenoTasks.test((s) => s.allowAll()));
}

await run(MyBuild);
```

```sh
./zuke generate-ci           # writes both workflow files
./zuke generate-ci --check   # the gate: fails if a committed file drifted
./zuke outdated              # ask right now, as a report
```

## What gets generated

The freshness workflow, as written by `generate-ci`:

```yaml
name: Dependency freshness
"on":
  workflow_dispatch: {}
  schedule:
    - cron: "0 4 * * 1"
    - cron: "0 3 * * 1"
permissions:
  contents: read
jobs:
  outdated:
    name: "Are we current?"
    runs-on: ubuntu-latest
    needs:
      - zuke-schedule-guard
    if: "${{ needs.zuke-schedule-guard.outputs.run == 'true' }}"
    steps:
      - name: Harden and check out with Zuke
        uses: zuke-build/zuke@… # pinned
        with:
          egress-policy: audit
          persist-credentials: "false"
      - name: Check
        run: ./zuke outdated --exit-code
  zuke-schedule-guard:
    # …resolves the local time and sets run=true only in the intended hour
```

**Two UTC crons for one schedule, and a guard job.** GitHub only understands UTC
cron, so a schedule in a daylight-saving zone contributes one UTC cron per
distinct offset — `0 4` for winter, `0 3` for summer here. Both fire on **every**
occurrence, so a bare pair of crons would run this job twice a week, once of them
at the wrong local hour. Zuke generates the `zuke-schedule-guard` job to compare
the real local time against the schedule and let the run proceed only on the
matching one. A fixed-offset zone, or plain UTC, needs no guard.

The guard is only generated for **GitHub**. On **Azure**, a daylight-saving zone
is a hard error at generation time — write the cron in UTC, or use a
fixed-offset zone, for that provider. **GitLab** and **Bitbucket** configure
schedules in the provider UI rather than in-file, so the field is ignored there.
See [schedules](../schedules.md) for the full matrix.

**Egress.** The default hardening policy is `audit`, which reports egress rather
than blocking it. If you tighten a job to `egress-policy: block`, this one needs
`jsr.io:443` on its allowed endpoints — it is the one job in the repository whose
whole purpose is to talk to the registry.

## What `--exit-code` treats as a failure

Without the flag, `outdated` is a report: being behind exits `0`. With it, the
command exits `1` when a package is **behind** *or* when a package **could not
be checked** — a private scope, a rename, a runner behind a proxy.

One case fails either way: with **no lock file** there are no resolved versions
to compare, and `outdated` reports that as an error and exits `1` with or
without the flag. If the scheduled job runs before anything has written a lock,
it goes red for that reason rather than for staleness.

That second half is the point of the gate. A run that reached nothing at all
would otherwise print that every package is at its latest release, which is the
confident wrong answer this command exists to prevent. A gate asking "are we
current?" has not been told yes by a run that never got an answer.

## When it fires

The output names each package and the version it is behind:

```text
@zuke/git     1.5.0  →  1.11.0
@zuke/gcloud  1.1.0  →  1.3.0
```

Refreshing the lock is the part that catches people out, because the obvious
commands do nothing. Measured against deno 2.9.5, on a stale entry for an inline
`jsr:` specifier:

| Command | Effect on the locked version |
| --- | --- |
| `deno cache --reload=jsr:` | unchanged — re-resolves from cached registry metadata |
| `deno cache --reload` | unchanged — re-downloads sources, keeps the locked resolution |
| `deno outdated --update` | unchanged — it reads manifests, and an inline specifier is in no manifest |
| delete the lock, then re-cache | **re-resolved** |

That last row is the one that works. `deno outdated --update` *is* the right tool
when the dependency is declared in a `deno.json` imports map — but then you would
not have needed `zuke outdated` to find it, which is the whole point of this
command.

And in a repository that also has a `package.json`, `deno cache` resolves the
whole npm tree and writes an `npm` section a jsr-only lock never had.

Review the lock diff and commit it in the same change, exactly as you would for
a deliberate dependency bump — the lock is part of the gate.

## See also

- [`zuke outdated`](../cli.md#zuke-outdated) — the full command reference.
- [Generate your CI](./generate-ci.md) — the `cicd` builder this recipe extends.
