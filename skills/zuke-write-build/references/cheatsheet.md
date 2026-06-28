# Zuke authoring cheatsheet

A quick map for writing targets. **Always confirm exact signatures** against
`llms-full.txt` (repo root) or `deno doc jsr:@zuke/<package>` — this is a
summary, not the source of truth.

## `target()` — the fluent builder

Everything is optional except a body (`.executes`).

| Method | Purpose |
| --- | --- |
| `.description(text)` | Summary shown in `--list`. |
| `.dependsOn(...t)` | Hard prerequisites; run first, transitively. Pass `this.<field>`. |
| `.executes(fn)` | The body. Sync or async. **Required.** |
| `.before(...t)` / `.after(...t)` | Soft ordering — only reorders targets already in the plan; never pulls new ones in. |
| `.triggers(...t)` | Pull targets into the plan and run them *after* this one. |
| `.dependentFor(...t)` | Reverse of `dependsOn`: make this a prerequisite of others. |
| `.inputs(...p)` / `.outputs(...p)` | Incremental cache: skip when inputs unchanged and outputs exist. |
| `.cacheKey(fn)` | Add a non-file value (version, git sha, param) to the cache fingerprint. |
| `.onlyWhen(cond)` | Run only when the (possibly async) predicate holds, else skip. |
| `.requires(...params)` | Fail unless the listed parameters resolved to a value. |
| `.retry(times, delayMs?)` | Retry the body on failure. |
| `.timeout(ms)` | Fail the body if it runs longer than `ms` (per attempt). |
| `.proceedAfterFailure()` | Keep the build going if this target fails. |
| `.always()` | Run even after the build failed (cleanup/teardown). |
| `.unlisted()` | Hide from `--list`/`--help`; still runnable by name. |
| `.validateBefore(...v)` / `.validateAfter(...v)` | Run `Validation` checks around the body; a throw fails the target. |
| `.recoverWith(...r)` / `.recoverAttempts(n)` | Run `Remediation`s if the body fails (self-healing); re-run when one asks to. See AI section. |
| `.partOf(group)` | Join a parallel batch (see `group()`). |
| `.produces(...p)` / `.consumes(...t)` | Declare and consume artifact paths. |

## `group()` — parallel batches

```ts
checks = group();

clean = target().executes(/* ... */);
lint = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);
format = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);

ship = target().dependsOn(this.checks).executes(/* ... */); // waits for all members
```

Members of a group run concurrently with each other (each still awaiting its own
deps), no `--parallel` flag needed. Declare the group field above its members.

## Components — reusable target bundles

A component is a function returning related targets; discovery names them with a
dotted path (`release.publish`).

```ts
function releasable(opts: { registry: string }) {
  const pack = target().executes(/* ... */);
  const publish = target().dependsOn(pack).executes(/* ... */);
  return { pack, publish };
}

class MyBuild extends Build {
  release = releasable({ registry: "https://registry.npmjs.org" });
  deploy = target().dependsOn(this.release.publish).executes(/* ... */);
}
```

## Parameters — typed build inputs

```ts
import { Build, parameter, target } from "jsr:@zuke/core";

class MyBuild extends Build {
  apiKey = parameter("Anthropic API key").secret().required();
  env = parameter("Target environment"); // optional

  deploy = target()
    .requires(this.apiKey)
    .onlyWhen(() => this.env.value === "production")
    .executes(() => {/* use this.apiKey.value */});
}
```

Secrets are masked in CI output. Read a resolved value with `this.x.value`.

## Tool wrappers — the settings-lambda style

Every external tool is a `*Tasks` object; each task takes `(s) => s.…` mirroring
the real CLI's flags. A non-exhaustive map (run `deno doc jsr:@zuke/<pkg>` for
the full task list and settings methods of each):

| Package | Object | Typical tasks |
| --- | --- | --- |
| `@zuke/core` | `FileTasks`, `AnnounceTasks` | copy/move/remove files; Slack/Teams/Discord posts |
| `@zuke/deno` | `DenoTasks` | `check`, `test`, `fmt`, `lint`, `cache`, `doc`, `run`, `publish` |
| `@zuke/npm` | `NpmTasks` | `ci`, `install`, `run`, `exec`, `publish`, `version` |
| `@zuke/cmd` | `CmdTasks` | `exec` — generic fallback for any CLI |
| `@zuke/docker`, `@zuke/docker-compose` | `DockerTasks`, ... | build/run/compose |
| `@zuke/git`, `@zuke/gh` | `GitTasks`, `GhTasks` | git and GitHub CLI |
| `@zuke/cspell`, `@zuke/eslint`, `@zuke/oxlint`, `@zuke/biome`, `@zuke/dprint` | `*Tasks` | lint/format/spell |
| `@zuke/jest`, `@zuke/vitest`, `@zuke/playwright`, `@zuke/cypress` | `*Tasks` | test runners |
| `@zuke/kubectl`, `@zuke/helm`, `@zuke/terraform`, `@zuke/tofu`, `@zuke/gcloud` | `*Tasks` | infra/deploy |
| `@zuke/claude`, `@zuke/codex`, `@zuke/gemini` | `ClaudeTasks`, ... | headless AI CLIs |
| `@zuke/ai` | `securityReviewer`, ..., `aiFixer` | AI review gates + self-healing (see below) |

```ts
await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
await DenoTasks.fmt((s) => s.check().paths("mod.ts"));
await CmdTasks.exec("my-tool", (s) => s.args("--flag", "value")); // no wrapper? use cmd
```

## AI review & self-healing — `@zuke/ai`

A model becomes part of the build graph two ways. Only the provider
(`"claude"` | `"openai"` | `"gemini"`) and an API key (pass a `parameter().secret()`)
are required; everything else is defaulted.

**Review gate** — a reviewer is a `Validation`; attach with `.validateBefore` /
`.validateAfter`. It scores the diff and breaks the build past a threshold.

```ts
import { securityReviewer } from "jsr:@zuke/ai";

key = parameter("OpenAI API key").secret();
review = securityReviewer((r) =>
  r.provider("openai").apiKey(this.key).failWhen((g) => g.scoreAbove(8))
);
deploy = target().validateBefore(this.review).executes(() => {/* ... */});
```

Factories: `securityReviewer`, `secretsReviewer`, `correctnessReviewer`,
`licenseReviewer`, `genericReviewer`.

**Self-healing** — `aiFixer` is a `Remediation`; attach with `.recoverWith(...)`.
On a failing body it diagnoses the failure and (safe default) posts the
diagnosis + a committable, Copilot-style inline suggestion to the PR — writing
no files. The build re-runs the real command to verify any applied fix.

```ts
import { aiFixer } from "jsr:@zuke/ai";

// Per target:
test = target()
  .executes(() => DenoTasks.test((s) => s.allowAll()))
  .recoverWith(aiFixer((f) => f.provider("openai").apiKey(this.key)));

// Or globally — override recoverWith() to attach a fixer to EVERY target:
override recoverWith() {
  return [aiFixer((f) => f.provider("openai").apiKey(this.key))];
}
```

Both compose: a target's own `.recoverWith(...)` runs first, then the build-level
`recoverWith()`. Opt into changes with `.autoApply()` (path allowlist, file cap,
local-only unless `.allowCI()`) and `.commitFixes()`; `.diff((d) => d.fetchBase())`
fetches the PR base branch for context so CI needs no manual `git fetch`. Keys
ride through `parameter().secret()`, which Zuke masks in CI output.

## Helpers from `@zuke/core`

- `glob(pattern, { cwd? })` — expand a glob to sorted paths.
- `assert(cond, msg?)`, `assertExists(v, msg?)`, `fail(msg)`,
  `assertFileExists(path)` — fail a target fast with a clear message.
- `httpDownload(url, dest)`, `httpText(url)`, `httpJson(url)` — fetch helpers
  that throw `HttpError` on non-2xx.
- `$` from `jsr:@zuke/core/shell` — injection-safe tagged-template shell, only
  when no typed wrapper fits.

## Code-first CI — `cicd()`

```ts
ci = cicd({ provider: "github" }); // .github/workflows/ci.yml, push/PR to main
```

`provider` is the only required field (`"github"` / `"gitlab"` / `"azure"`).
Running any target regenerates the YAML; on CI it *verifies* the committed file
is current (`zuke generate-ci --check` is a dedicated gate).

## Run & inspect

```sh
./zuke --list                 # all targets
./zuke <target> --dry-run     # preview the plan, run nothing
./zuke <target>               # run it
```
