# @zuke/codecov

Typed [Codecov](https://about.codecov.io/) CLI (`codecovcli`) task wrapper for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. `upload` runs `codecovcli upload-process` to send coverage
reports to Codecov. The upload token is read from `CODECOV_TOKEN` in the
environment, so it never lands in argv, and arguments stay a discrete argv
array, so command construction is injection-free.

```ts
import { CodecovTasks } from "jsr:@zuke/codecov";

// Upload an lcov report, tagged with a flag, and fail the build on error.
await CodecovTasks.upload((s) =>
  s.files("cov.lcov").flags("unit").failOnError()
);
```

The wrapper drives the `codecovcli` binary. In a Zuke build you don't need a
global install: fetch Codecov's standalone CLI with `installRelease` (from
`@zuke/core`) and hand the path to `.toolPath(...)` — the build owns its own
tooling, no separate CI step required.

```ts
import { installRelease } from "jsr:@zuke/core";

// Codecov publishes a standalone binary per platform (linux/macos/windows).
const bin = await installRelease({
  name: "codecov",
  destDir: ".zuke/tools",
  url: () => "https://cli.codecov.io/v11.2.8/linux/codecov",
});
await CodecovTasks.upload((s) => s.toolPath(bin).files("cov.lcov"));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/codecov` — a typed Codecov CLI (`codecovcli`) task wrapper for Zuke
builds.

`upload` runs `codecovcli upload-process` to send coverage reports to
Codecov; the token is read from `CODECOV_TOKEN` so it never lands in argv.

```ts
import { CodecovTasks } from "jsr:@zuke/codecov";
await CodecovTasks.upload((s) => s.files("cov.lcov").flags("unit"));
```
@module

const CodecovTasks: CodecovTasksApi
  Typed task functions for the Codecov CLI.

class CodecovUploadSettings extends ToolSettings
  Settings for `codecovcli upload-process`.

  override protected defaultTool(): string
  files(...paths: string[]): this
    A coverage report file to upload (`--file`). Repeatable.
  flags(...names: string[]): this
    Tag the uploaded reports with a flag (`--flag`). Repeatable.
  plugins(...names: string[]): this
    Run an upload plugin, e.g. `gcov` or `noop` (`--plugin`). Repeatable.
  token(value: string): this
    Repository upload token (`--token`); prefer the `CODECOV_TOKEN` env var.
  slug(value: string): this
    Repository slug as `OWNER/REPO` (`--slug`).
  sha(value: string): this
    Commit SHA the coverage belongs to (`--sha`).
  branch(value: string): this
    Branch the coverage belongs to (`--branch`).
  pullRequest(value: string | number): this
    Pull request number the coverage belongs to (`--pr`).
  gitService(value: string): this
    Git host the repo lives on, e.g. `github` (`--git-service`).
  name(value: string): this
    A custom display name for this upload (`--name`).
  dir(value: string): this
    Directory to search for coverage reports (`--dir`).
  networkRootFolder(value: string): this
    Root folder used to resolve report file paths (`--network-root-folder`).
  reportType(value: string): this
    Report kind: `coverage` (default) or `test_results` (`--report-type`).
  disableSearch(): this
    Upload only the named files, skipping the auto-search (`--disable-search`).
  failOnError(): this
    Exit non-zero when the upload fails (`--fail-on-error`).
  dryRun(): this
    Print what would be uploaded without sending anything (`--dry-run`).
  override protected buildArgs(): string[]

interface CodecovTasksApi
  The shape of {@link CodecovTasks}.

  upload(configure?: Configure<CodecovUploadSettings>): Promise<CommandOutput>
    Upload coverage reports: `codecovcli upload-process`.
````

</details>

<!-- ZUKE:API:END -->
