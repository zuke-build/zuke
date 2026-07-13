# Authoring API

### `target()`

`target()` returns a chainable `TargetBuilder`. Everything is optional except a
body, which is required before the target can run.

| Method                      | Signature                                             | Purpose                                                                                            |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `.description(text)`        | `(s: string) => this`                                 | Summary shown in `--list`.                                                                         |
| `.dependsOn(...targets)`    | `(...t: Target[]) => this`                            | Hard prerequisites; run first, transitively.                                                       |
| `.executes(fn)`             | `(fn: () => void \| Promise<void>) => this`           | The body. May be async.                                                                            |
| `.before(...targets)`       | `(...t: Target[]) => this`                            | Soft ordering: run before these _if both are planned_.                                             |
| `.after(...targets)`        | `(...t: Target[]) => this`                            | Soft ordering: run after these _if both are planned_.                                              |
| `.triggers(...targets)`     | `(...t: Target[]) => this`                            | Pull these into the plan and run them _after_ this.                                                |
| `.dependentFor(...targets)` | `(...t: Target[]) => this`                            | Reverse of `dependsOn`: run this _before_ those.                                                   |
| `.inputs(...paths)`         | `(...p: PathLike[]) => this`                          | Cache inputs: skip the target when these are unchanged.                                            |
| `.outputs(...paths)`        | `(...p: PathLike[]) => this`                          | Cache outputs: a hit also requires these to still exist.                                           |
| `.onlyWhen(condition)`      | `(c: () => boolean \| Promise<boolean>) => this`      | Run only when the condition holds, else skip.                                                      |
| `.requires(...params)`      | `(...p: Parameter[]) => this`                         | Fail the target unless these parameters are set.                                                   |
| `.proceedAfterFailure()`    | `() => this`                                          | Keep the build going if this target fails.                                                         |
| `.always()`                 | `() => this`                                          | Run for cleanup even after the build has failed.                                                   |
| `.unlisted()`               | `() => this`                                          | Hide the target from `--list`/`--help`.                                                            |
| `.cacheKey(fn)`             | `(fn: () => string \| Promise<string>) => this`       | Extra (non-file) input to the cache fingerprint.                                                   |
| `.produces(...paths)`       | `(...p: PathLike[]) => this`                          | Declare artifact paths this target produces.                                                       |
| `.consumes(...targets)`     | `(...t: Target[]) => this`                            | Depend on targets and use their `produces` artifacts.                                              |
| `.whenSkipped(behavior)`    | `("run-dependencies" \| "skip-dependencies") => this` | On skip, also skip exclusive deps.                                                                 |
| `.timeout(ms)`              | `(ms: number) => this`                                | Fail the body if it runs longer than `ms` (per attempt).                                           |
| `.retry(times, delayMs?)`   | `(times: number, delayMs?: number) => this`           | Retry the body on failure, optionally pausing between.                                             |
| `.validateBefore(...v)`     | `(...v: Validation[]) => this`                        | Run checks before the body; a throw skips it and fails.                                            |
| `.validateAfter(...v)`      | `(...v: Validation[]) => this`                        | Run checks after a successful body; a throw fails it.                                              |
| `.recoverWith(...r)`        | `(...r: Remediation[]) => this`                       | On failure, hand it to a remediation that can re-run the body ([self-healing](./self-healing.md)). |
| `.recoverAttempts(n)`       | `(n: number) => this`                                 | Bound how many fix-then-rerun cycles are tried (default 1).                                        |

`dependsOn` pulls targets into the plan; `before`/`after` only reorder targets
that are _already_ in the plan — they never pull new targets in.

```ts
lint = target()
  .description("Lint sources")
  .after(this.restore) // if restore is in the plan, run after it
  .before(this.test) // if test is in the plan, run before it
  .executes(async () => {
    await DenoTasks.lint();
  });
```

### Validations — `.validateBefore()` / `.validateAfter()`

A **`Validation`** is any object with a `validate(ctx)` method; plug it into a
target to run a check before or after the body. A throw fails the target (and
breaks the build) — the target decides _when_ the check runs, the validation
decides _what_ it checks. `validateBefore` runs its checks before the body (a
throw skips the body); `validateAfter` runs them after a successful body. Both
are repeatable and order-preserving, and a cached/skipped target runs neither.

```ts
const noSecrets: Validation = {
  name: "no-secrets",
  validate: async () => {/* scan the diff; throw on a hit */},
};

deploy = target()
  .validateBefore(noSecrets) // gate before deploying
  .executes(async () => {/* … */});
```

[`@zuke/ai`](https://jsr.io/@zuke/ai) ships AI reviewers
(`securityReviewer(...)`, …) that implement `Validation` — define one fluently
and attach it the same way to gate the build on a model-assessed security score.

### `group()` and `.partOf()`

`group()` creates a parallel **batch**. A target joins it with `.partOf(group)`;
members of the same group run concurrently with one another — even when the
build is otherwise sequential — each still waiting for its own dependencies.
Pass the group to another target's `.dependsOn(...)` to depend on every member
at once.

```ts
checks = group();

clean = target().executes(/* ... */);
lint = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);
format = target().dependsOn(this.clean).partOf(this.checks).executes(/* ... */);
typecheck = target().dependsOn(this.clean).partOf(this.checks).executes(
  /* ... */
);

deploy = target()
  .dependsOn(this.checks) // waits for lint, format, and typecheck
  .executes(/* ... */);
```

Here `clean` runs first (all three depend on it), then `lint`/`format`/
`typecheck` run together, then `deploy`. Grouping is a property of the members,
so they batch whenever they run — no `--parallel` flag needed. Ungrouped targets
stay serialized unless you opt the whole build into `--parallel`. Declare the
group field above the targets that join it.

### Reusable components

A **component** is just a function that returns a bundle of related targets.
Assign it to a build field; discovery recurses into the bundle and names each
target with a dotted path (`release.publish`), runnable as
`zuke release.publish` and shown in the graph. Components compose, nest, and
take options.

```ts
// A shared, configurable component.
function releasable(opts: { registry: string }) {
  const pack = target().executes(/* ... */);
  const publish = target()
    .dependsOn(pack)
    .executes(async () => {
      await $`npm publish --registry ${opts.registry}`;
    });
  return { pack, publish };
}

class MyBuild extends Build {
  release = releasable({ registry: "https://registry.npmjs.org" });
  deploy = target().dependsOn(this.release.publish).executes(/* ... */);
}
```

Targets reference each other across components via the field
(`this.release.publish`), so declare a component field above anything that
depends on it. Components can also declare [parameters](./parameters.md) —
they're discovered under the same dotted path.

### Incremental caching — `.inputs()` / `.outputs()`

A target that declares **inputs** becomes incremental: Zuke fingerprints those
files/directories (SHA-256 of their contents, directories hashed recursively)
and **skips** the target — reporting it `cached` — when the fingerprint is
unchanged since the last successful run and every declared **output** still
exists. Otherwise it runs and refreshes the fingerprint.

```ts
compile = target()
  .inputs("src", "deno.json") // re-run only when these change…
  .outputs("dist") // …or when dist is missing
  .executes(async () => {
    await DenoTasks.run((s) => s.script("build.ts"));
  });
```

Fingerprints live in `<repo root>/.zuke/cache.json` (git-ignored). A target with
no inputs (and no cache keys) always runs. Pass `--no-cache` (or
`execute(..., { cache: false })`) to ignore the cache and rebuild everything. A
skipped/cached target counts as satisfied, so its dependents still run.

See the dedicated **[Caching](./caching.md)** page for the full picture — the
fingerprint algorithm, how adding or removing a file invalidates a target, the
`.cacheKey()` non-file input, the store's corrupt-file tolerance, and the
separate AI response cache.

### Conditional execution — `.onlyWhen()`

`.onlyWhen(condition)` runs the target only when the condition holds; otherwise
it is skipped (and its dependents still run). The predicate may be async and can
read resolved [parameters](./parameters.md) or the environment. Repeatable — all
conditions must hold.

```ts
deploy = target()
  .onlyWhen(() => this.environment.value === "production")
  .executes(/* ... */);
```

### More target options

- **`.triggers(...targets)`** — the inverse of `dependsOn`: running this target
  pulls the listed targets into the plan and runs them _after_ it (e.g. a
  `notify` target triggered by `deploy`).
- **`.dependentFor(...targets)`** — declare this target as a prerequisite of
  others without editing them: each listed target gains this one as a
  dependency. Declare the listed targets above this one.
- **`.requires(...params)`** — fail the target (with a message naming the
  parameter) unless each listed [parameter](./parameters.md) resolved to a
  value. Use it for a parameter that is optional build-wide but mandatory here.
- **`.proceedAfterFailure()`** — if this target fails, keep running the rest of
  the build instead of aborting. The build still reports failure, and this
  target's own dependents are skipped.
- **`.always()`** — run even after the build has already failed, for
  cleanup/teardown. It still waits for its own dependencies to complete.
- **`.unlisted()`** — hide a helper target from `--list`/`--help`; it can still
  be run by name or depended on.
- **`.cacheKey(fn)`** — add a non-file value (a parameter, tool version, git
  commit…) to the [cache](#incremental-caching-inputs--outputs) fingerprint, so
  the target also rebuilds when that value changes. Repeatable; may be async.
- **`.produces(...paths)`** / **`.consumes(...targets)`** — declare artifact
  paths a target produces, and (on a consumer) depend on the producers.
- **`.whenSkipped("skip-dependencies")`** — when this target is skipped by a
  condition, also skip dependencies that no other target needs. Its condition is
  evaluated up front, so it must not rely on state produced during the run.
- **`.timeout(ms)`** — fail the target if its body runs longer than `ms`
  milliseconds. The bound is **per attempt**, so it combines with `.retry(...)`.
  A timed-out body cannot be cancelled (JavaScript has no such primitive), so it
  keeps running in the background — but its result is ignored.
- **`.retry(times, delayMs?)`** — retry the body up to `times` more attempts on
  failure, optionally pausing `delayMs` between attempts. The last error
  propagates once the attempts are exhausted.

```ts
flaky = target()
  .timeout(30_000) // each attempt may take up to 30s…
  .retry(2, 1_000) // …retried twice, 1s apart, on failure
  .executes(async () => {
    await $`curl -fsSL https://example.com/health`;
  });
```

### Globbing inputs — `glob()`

`glob(pattern, { cwd? })` expands a pattern to the matching paths (relative to
`cwd`, sorted for determinism). It is dependency-free, walks from the pattern's
static prefix, and does not follow symlinked directories. Supported syntax: `*`
(any run of non-`/`), `**` (any run including `/`), `?` (a single non-`/`), and
brace alternation `{a,b}`.

```ts
import { glob } from "jsr:@zuke/core";

format = target().executes(async () => {
  const sources = await glob("src/**/*.ts");
  await DenoTasks.fmt((s) => s.check().paths(...sources));
});
```

To match a pattern without touching the filesystem, `globToRegExp(pattern)`
compiles the same syntax to a `RegExp` — handy for filtering an in-memory list
of paths.

### Dry runs — `--dry-run`

`zuke <target> --dry-run` resolves and prints every target that **would** run —
honouring `--skip` and `onlyWhen` conditions — without executing any body or
touching the [cache](#incremental-caching-inputs--outputs). Use it to preview a
plan before committing to it.

### Assertions — `assert()` / `assertExists()` / `fail()`

Fail a target fast with a clear message when an expectation does not hold.
`assert(condition, message?)` throws when the condition is falsy;
`assertExists(value, message?)` throws on `null`/`undefined` and returns the
value narrowed to its non-nullable type; `fail(message)` always throws. The
async `assertFileExists(path)` / `assertDirectoryExists(path)` check the
filesystem. All throw an `AssertionError`.

```ts
import { assert, assertExists, assertFileExists } from "jsr:@zuke/core";

const token = assertExists(Deno.env.get("TOKEN"), "TOKEN is required");
assert(this.environment.value !== "", "environment must be set");
await assertFileExists("dist/app.js");
```

### Filesystem — `FileTasks`

`FileTasks` groups the filesystem operations a `clean`/`package` target reaches
for — create, clean, remove, copy, move a path, and read/write its contents — as
a namespaced task object in the same shape as the [tool wrappers](./tools.md).
Unlike the CLI wrappers it runs no subprocess, so each method takes direct
arguments rather than a settings-lambda. Paths are [`PathLike`](./paths.md), so
an `absolutePath(...)` or a plain string both work.

```ts
import { FileTasks } from "jsr:@zuke/core";

await FileTasks.cleanDirectory("dist"); // empty it if it exists
await FileTasks.createDirectory("dist/assets"); // mkdir -p
await FileTasks.copy("static", "dist/static"); // recursive
```

| Method                                  | Purpose                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exists(path)`                          | Whether `path` exists.                                                                                                                                                                      |
| `createDirectory(path, { recursive? })` | Create a directory; parents by default (`recursive: true`). A recursive create over an existing directory is a no-op.                                                                       |
| `cleanDirectory(path)`                  | Empty a directory, leaving it in place. A no-op if `path` is missing (it is _not_ created).                                                                                                 |
| `remove(path, { recursive? })`          | Delete `path`, tolerating a missing target like `rm -f`. Returns `true` if something was removed, `false` if it was already absent. Pass `recursive: true` to remove a non-empty directory. |
| `copy(source, dest, { overwrite? })`    | Copy a file or directory tree (recursive). `overwrite` defaults to `true`.                                                                                                                  |
| `move(source, dest)`                    | Move (rename) a path.                                                                                                                                                                       |
| `readText(path)`                        | Read a file's UTF-8 content.                                                                                                                                                                |
| `writeText(path, content)`              | Write a file, creating or truncating it.                                                                                                                                                    |
| `readJson<T>(path)`                     | Read and `JSON.parse` a file, typed as `T`.                                                                                                                                                 |
| `homeDirectory()`                       | The current user's home directory (`$HOME`, or `$USERPROFILE` on Windows); throws a clear error if neither is set.                                                                          |

The mutating operations are deliberately **missing-target-tolerant**, so the
common `clean`/`package` sequence stays idempotent: `cleanDirectory` and
`remove` no-op on an absent path instead of throwing, and a recursive
`createDirectory` is safe to call repeatedly.

```ts
clean = target().executes(async () => {
  await FileTasks.remove("dist", { recursive: true }); // gone or already gone
  await FileTasks.createDirectory("dist");
});
```

### HTTP — `httpDownload()` / `httpText()` / `httpJson()`

Fetch over HTTP from a build script, built on the platform `fetch`.
`httpDownload(url, dest)` streams a URL to a file; `httpText(url)` and
`httpJson(url)` return the body. All accept `{ headers, fetch }` (the `fetch`
seam makes them unit-testable) and throw an `HttpError` (carrying `.status`) on
a non-2xx response.

```ts
import { httpDownload, httpJson } from "jsr:@zuke/core";

await httpDownload("https://example.com/tool.tar.gz", ".zuke/tool.tar.gz");
const release = await httpJson<{ tag_name: string }>(
  "https://api.github.com/repos/zuke-build/zuke/releases/latest",
);
```

### Announcements — `AnnounceTasks.slack()` / `.teams()` / `.discord()`

Post build status to a chat channel — "build passed", "package published",
"service deployed" — via each platform's incoming webhook. `AnnounceTasks`
follows the same **settings-lambda** shape as the tool wrappers, but runs no
subprocess: each task takes `(s) => s.…` and configures a fluent settings
object. Set the destination with `.webhook(url)` and the message with `.text()`,
`.title()`, a level (`.success()` / `.failure()` / `.warning()` / `.info()`, or
`.level(...)`), repeatable `.field(name, value)` details, and a
`.link(text,
url)` action. Each task POSTs the platform-native payload over
`fetch` (override it with `.fetch()` in tests) and throws an `HttpError` on a
non-2xx response.

A webhook URL embeds the secret that authorises posting, so source it from a
`parameter().secret()` build input rather than hard-coding it — Zuke masks the
resolved value in CI output.

```ts
import { AnnounceTasks, Build, parameter, target } from "jsr:@zuke/core";

class MyBuild extends Build {
  slack = parameter("Slack incoming-webhook URL").secret().required();

  deploy = target()
    .requires(this.slack)
    .executes(async () => {
      // ... deploy ...
      await AnnounceTasks.slack((s) =>
        s.webhook(this.slack.value)
          .title("Deploy")
          .text("Shipped api@1.4.0 to production.")
          .success()
          .field("Service", "api")
          .link("Release notes", "https://example.com/r/1.4.0")
      );
    });
}
```

Each platform also speaks an **API/bot mode** instead of a webhook, opted into
with `.bot()` (setting `.token()` alone implies it):

- **Slack** — `.token(t).channel(c)` posts through the Web API
  (`chat.postMessage`). The Web API answers `200` even on a logical failure, so
  Zuke checks the response and throws a `SlackApiError` (carrying Slack's
  `error` code, e.g. `channel_not_found`) when it reports `{ ok: false }`.
- **Discord** — `.token(t).channel(c)` posts through the REST API with a bot
  token (`Authorization: Bot …`); `channel` is the channel id.
- **Teams** — `.token(t).team(id).channel(c)` posts through Microsoft Graph with
  a bearer access token, rendering the announcement as HTML.

A non-2xx response throws an `HttpError` in every API mode.

```ts
await AnnounceTasks.slack((s) =>
  s.bot()
    .token(this.slackToken.value)
    .channel("#builds")
    .text("Published @acme/api@1.4.0")
    .success()
);

await AnnounceTasks.discord((s) =>
  s.token(this.discordToken.value).channel("123456789").text("Deployed")
    .success()
);

await AnnounceTasks.teams((s) =>
  s.token(this.graphToken.value)
    .team("team-id")
    .channel("19:abc@thread.tacv2")
    .text("Deployed")
    .success()
);
```

Announce a failure from `onFinish` to cover the whole pipeline:

```ts
override async onFinish(result) {
  if (!result.ok) {
    await AnnounceTasks.discord((s) =>
      s.webhook(this.discord.value).text("Build failed.").failure()
    );
  }
}
```

### Compression — `gzip()` / `tar()` / `createTarGzip()`

Pack build artifacts without any dependency. `gzip(bytes)`/`gunzip(bytes)` wrap
the platform `CompressionStream`; `tar(entries)`/`untar(archive)` read and write
the POSIX `ustar` format in memory; and the file helpers
`createTarGzip(files, dest, { cwd })` / `extractTarGzip(src, destDir)` produce
and unpack `.tar.gz` archives. Entry names are limited to 100 bytes and archives
use a fixed mtime, so output is reproducible.

```ts
import { createTarGzip } from "jsr:@zuke/core";

await createTarGzip(["dist/app.js", "README.md"], "artifact.tar.gz");
```

### Tool install — `installRelease()`

Prepare an environment by fetching a CLI one of Zuke's wrappers drives, then
point the wrapper at it. `installRelease({ name, url, destDir })` resolves a
per-platform URL (via the `({ os, arch }) => string` callback and
`hostPlatform()`), downloads it, and returns the installed binary's
`AbsolutePath` — ready for `.toolPath(...)`. Set `archive: "tar.gz"` to unpack a
tarball and take `binaryPath` from inside; the default `"raw"` installs the
download as the binary itself. The `download` seam keeps it unit-testable, and
on Windows the filename gains an `.exe` suffix. Zip archives are not yet
supported, so this targets the Unix runners where most release tarballs live.

Pass a **`checksum`** (the SHA-256 that release pages publish — the `.tar.gz`'s
hash for an archive, or the binary's for `"raw"`) to make the install both
**verified** and **cached**: the download is checked against it — a mismatch
throws and nothing is installed — and a prior install whose checksum matches is
reused without downloading again. Omit it and the tool is fetched every run and
left unverified, so pin a checksum for a hermetic, tamper-evident build.

```ts
import { installRelease } from "jsr:@zuke/core";
import { CmdTasks } from "jsr:@zuke/cmd";

const arches = { x86_64: "amd64", aarch64: "arm64" } as const;
const bin = await installRelease({
  name: "helm",
  destDir: ".zuke/bin",
  archive: "tar.gz",
  binaryPath: `${Deno.build.os}-${arches[Deno.build.arch]}/helm`,
  checksum: "f43e1c3…", // verify + cache
  url: ({ os, arch }) =>
    `https://get.helm.sh/helm-v3.14.0-${os}-${arches[arch]}.tar.gz`,
});
await CmdTasks.exec(String(bin), (s) => s.args("version"));
```

### Pinned toolchains — `toolchain()`

When a build needs several tools, `toolchain()` declares them all in one place
so the build file fully describes the environment it needs — no "install these
first" prose in a README, and nothing assumed to be on `PATH`. Add tools with
`.tool(spec)` (each an `installRelease` spec), then `install()` fetches them all
concurrently — pinned, checksum-verified, and cached — and returns a
`Map<name, AbsolutePath>` to hand to each wrapper's `.toolPath(...)`. Tools land
in `.zuke/tools` by default (override per-call with `destDir`, or per-tool on
the spec).

```ts
import { Build, target, toolchain } from "jsr:@zuke/core";
import { HelmTasks } from "jsr:@zuke/helm";
import { KubectlTasks } from "jsr:@zuke/kubectl";

class Deploy extends Build {
  tools = toolchain((t) =>
    t
      .tool({ name: "helm", archive: "tar.gz", checksum: "…", url: helmUrl })
      .tool({ name: "kubectl", checksum: "…", url: kubectlUrl })
  );

  deploy = target().executes(async () => {
    const bin = await this.tools.install();
    await HelmTasks.version((s) => s.toolPath(bin.get("helm")));
    await KubectlTasks.version((s) => s.toolPath(bin.get("kubectl")));
  });
}
```

Because a matching checksum is a cache hit, re-running `install()` (locally or
on CI) is a no-op once the tools are present — declaring a toolchain doesn't
slow a build down.

### CI config generation — `cicd()` and `generate-ci`

Generate your CI configuration **from the build** instead of hand-maintaining
YAML. Declare a pipeline as a build field with `cicd()`, binding a
provider-agnostic `CiPipeline` to an output path. The file is then kept in sync
with the definition: it is regenerated whenever you run the build, and
`zuke generate-ci` writes it on demand.

The provider is the only required field. `cicd({ provider: "github" })` declares
a workflow at `.github/workflows/ci.yml` that, on push/PR to `main`, runs a
single `build` job whose one step invokes the build through the `./zuke`
launcher (which bootstraps Deno itself — no separate setup step). Override only
what else you need:

```ts
import { Build, cicd, target } from "jsr:@zuke/core";

class MyBuild extends Build {
  ci = cicd({ provider: "github" }); // runs ./zuke on push/PR to main

  test = target().executes(async () => {/* … */});
}
```

The defaults: `path` follows the provider, the pipeline `name` is `CI`,
`triggers` are push/PR on `main`, a job's `id` is `build`, its `runsOn` is
`ubuntu-latest`, and its single step runs `./zuke`. Supply only the fields you
want to change:

```ts
ci = cicd({
  provider: "github", // or "gitlab" / "azure"
  pipeline: {
    jobs: [{
      matrix: { os: ["ubuntu-latest", "macos-latest"] },
      steps: [{ name: "Test", run: "./zuke test" }],
    }],
  },
});
```

- **`zuke generate-ci`** writes every declared file (creating parent dirs).
- **Running any target** regenerates the files too, so you can't forget to — and
  on CI (`isCI()`), the run instead _verifies_ the committed files are current
  and fails if they have drifted (use `zuke generate-ci --check` for a dedicated
  gate). `--dry-run` skips regeneration.

#### Fanned-out jobs — one CI job per target

Instead of one job that runs the whole build, `fanOut` turns **each target into
its own CI job**, wired together with `needs:` edges that mirror the targets'
`dependsOn`. Independent targets then run in parallel on the CI provider, and
the build's own dependency graph shapes the workflow — something a hand-written
YAML can't stay in sync with.

```ts
class CI extends Build {
  lint = target().inputs("src").outputs("dist/lint").executes(/* … */);
  test = target().dependsOn(this.lint).inputs("src").executes(/* … */);
  build = target().dependsOn(this.lint).inputs("src").outputs("dist").executes(
    /* … */
  );

  ci = cicd({
    provider: "github",
    fanOut: { env: { ZUKE_REMOTE_CACHE_DIR: "/mnt/zuke-cache" } },
  });
}
```

This emits a `lint` job and `test`/`build` jobs that each declare
`needs: [lint]`, so they wait for `lint` and then run concurrently. Each job
runs only its own target (`./zuke <target>`); its dependencies run in their own
jobs, so pair fan-out with the [remote cache](./cli.md#remote-cache) (configured
here via `env`) to restore their outputs instead of rebuilding them. Pass
`fanOut: true` for the defaults, or `FanOutOptions` to set the per-job
`command`, `setupSteps` (default: a checkout), `runsOn`, `env`, or
`includeUnlisted`. The `pipeline` field still supplies the workflow-level
`name`, `triggers`, `permissions`, and `concurrency`. Targets with no body, and
`unlisted` ones, are omitted. `fanOutPipeline(targets, base, options)` exposes
the same expansion directly.

The model is a portable subset: a `run` step (a shell command) maps to every
provider; a `uses` step (a GitHub Action) renders only for GitHub and is skipped
elsewhere, since GitLab and Azure check out the repo automatically. `runsOn` is
interpreted per provider (a runner label, a Docker image, or a `vmImage`); when
a matrix defines `os`, GitHub runs on it automatically.

For one-off rendering without the build wiring, `generateCi(pipeline, provider)`
returns the YAML string directly (pass an empty pipeline,
`generateCi({}, "github")`, to accept every default). Either way the emitted
YAML quotes any scalar that would otherwise be misread (a bare `on`, a
numeric-looking version), so the output is paste-ready.

### Host detection — `isCI()` / `ciHost()`

`isCI()` and `ciHost()` (e.g. `"github-actions"`, `"gitlab-ci"`, `"local"`) let
a build branch on where it runs — e.g. `deploy.onlyWhen(() => isCI())`.

### `Build`

The base class your build extends. It contributes no targets of its own.

- After construction, Zuke discovers targets by introspecting the instance's own
  enumerable properties (the class fields).
- Optional lifecycle hooks, overridable on your subclass:

```ts
class MyBuild extends Build {
  override onStart() {
    console.log("Build starting…");
  }
  override onFinish(result: BuildResult) {
    console.log(result.ok ? "All good" : "Something failed");
  }
  // …targets…
}
```

`BuildResult` is `{ ok: boolean; executed: string[]; error?: unknown }`.

A field literally named `default` is the **default target**, run when no target
is named on the command line.

### `run()`

```ts
run(
  BuildClass: new () => Build,
  options?: { args?: string[]; plugins?: Plugin[] },
): Promise<void>
```

Instantiates the build, discovers targets, validates the graph, parses CLI
arguments (`options.args`, defaulting to `Deno.args`), dispatches to the
executor with any registered `options.plugins`, and calls `Deno.exit` with `0`
on success or `1` on failure. This is the standard entry point at the bottom of
`zuke.ts`. See [Extending Zuke](./extending.md) for the plugin contract.

## Gotchas

- **Declaration order matters.** Because dependencies are `this.x` references
  and class fields initialise top-to-bottom, a target can only depend on
  siblings **declared above it**. A forward reference is `undefined` at runtime
  and reported as an error. TypeScript also flags it (`TS2729`).
- **A body is required.** Running a target whose `.executes(...)` was never set
  fails fast with a clear message.
- **`default` is a convention**, not a keyword — name a field `default` to opt
  in.
