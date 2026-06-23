# @zuke/security

Typed task wrappers for free, open-source security scanners for
[Zuke](https://github.com/zuke-build/zuke#readme) builds. Wire supply-chain
scanning straight into your pipeline with the same fluent settings-lambda API as
the other tool wrappers — arguments stay a discrete argv array, so command
construction is injection-free.

| Task                      | Tool                                                 | Scans                           |
| ------------------------- | ---------------------------------------------------- | ------------------------------- |
| `zizmor`                  | [zizmor](https://github.com/woodruffw/zizmor)        | GitHub Actions workflows (SAST) |
| `actionlint`              | [actionlint](https://github.com/rhysd/actionlint)    | Workflow YAML & embedded shell  |
| `gitleaks`                | [gitleaks](https://github.com/gitleaks/gitleaks)     | Committed secrets               |
| `osvScanner`              | [osv-scanner](https://github.com/google/osv-scanner) | Known vulns in lockfiles        |
| `semgrep`                 | [semgrep](https://github.com/semgrep/semgrep)        | Source code (SAST)              |
| `trivyFs` / `trivyConfig` | [trivy](https://github.com/aquasecurity/trivy)       | Filesystem & IaC/config         |

The tools are not bundled (Zuke has no runtime dependencies); install the ones
you use and they are resolved on `PATH` (override with `.toolPath(...)`).

```ts
import { SecurityTasks } from "jsr:@zuke/security";

// Audit your workflows and fail the build on findings.
await SecurityTasks.zizmor((s) => s.paths(".github/workflows"));

// Check a supported lockfile against the OSV database (npm/cargo/go/etc.;
// osv-scanner has no extractor for Deno's deno.lock).
await SecurityTasks.osvScanner((s) => s.lockfile("package-lock.json"));

// Emit SARIF for GitHub code scanning.
await SecurityTasks.gitleaks((s) =>
  s.source(".").reportFormat("sarif").reportPath("gitleaks.sarif").redact()
);
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/security` — typed task wrappers for free, open-source security scanners
(zizmor, actionlint, gitleaks, osv-scanner, semgrep, trivy) for Zuke builds.

```ts
import { SecurityTasks } from "jsr:@zuke/security";

await SecurityTasks.zizmor((s) => s.paths(".github/workflows"));
await SecurityTasks.osvScanner((s) => s.lockfile("package-lock.json"));
await SecurityTasks.gitleaks((s) => s.source(".").redact());
```
@module

const SecurityTasks: SecurityTasksApi
  Task functions for running free, open-source security scanners.

class ActionlintSettings extends ToolSettings
  Settings for `actionlint` (https://github.com/rhysd/actionlint), a linter for
  GitHub Actions workflow files (and the shell embedded in `run:` steps).

  override protected defaultTool(): string
  files(...paths: PathLike[]): this
    Add an explicit workflow file to lint (positional); repeatable.
  format(template: string): this
    Output format template (`-format`), e.g. `'{{json .}}'`.
  color(): this
    Force colored output (`-color`).
  noColor(): this
    Disable colored output (`-no-color`).
  override protected buildArgs(): string[]

class GitleaksDetectSettings extends ToolSettings
  Settings for `gitleaks detect` (https://github.com/gitleaks/gitleaks), which
  scans a directory (and, by default, git history) for committed secrets.

  override protected defaultTool(): string
  source(path: PathLike): this
    Path to scan (`--source`).
  config(path: PathLike): this
    Use an explicit gitleaks config (`--config`).
  reportFormat(value: string): this
    Report format (`--report-format`), e.g. `json`, `sarif`, `csv`.
  reportPath(path: PathLike): this
    Write the report to a file (`--report-path`).
  redact(): this
    Redact secret values from the output (`--redact`).
  noGit(): this
    Treat the source as a plain directory, not a git repo (`--no-git`).
  verbose(): this
    Verbose output (`--verbose`).
  override protected buildArgs(): string[]

class OsvScannerSettings extends ToolSettings
  Settings for `osv-scanner` (https://github.com/google/osv-scanner), which
  matches lockfile entries against the OSV vulnerability database.

  override protected defaultTool(): string
  lockfile(path: PathLike): this
    Scan an explicit lockfile (`--lockfile`); repeatable.
  paths(...inputs: PathLike[]): this
    Add a directory to scan (positional); repeatable.
  format(value: string): this
    Output format (`--format`), e.g. `table`, `json`, `sarif`.
  output(path: PathLike): this
    Write the report to a file (`--output`).
  recursive(): this
    Recurse into subdirectories (`--recursive`).
  override protected buildArgs(): string[]

class SemgrepScanSettings extends ToolSettings
  Settings for `semgrep scan` (https://github.com/semgrep/semgrep), a static
  analysis engine for source code. Defaults to whatever rules `--config`
  selects (e.g. `auto` or `p/ci`).

  override protected defaultTool(): string
  config(value: string): this
    Add a rules config (`--config`), e.g. `auto`, `p/ci`; repeatable.
  paths(...inputs: PathLike[]): this
    Add a path to scan (positional); repeatable.
  sarif(): this
    Emit SARIF (`--sarif`).
  json(): this
    Emit JSON (`--json`).
  output(path: PathLike): this
    Write output to a file (`--output`).
  error(): this
    Exit non-zero when findings are present (`--error`).
  override protected buildArgs(): string[]

class TrivyConfigSettings extends TrivyReportSettings
  Settings for `trivy config` (https://github.com/aquasecurity/trivy), which
  scans IaC / configuration files (Dockerfiles, workflows, etc.) for
  misconfigurations.

  target(path: PathLike): this
    The path to scan (default `.`).
  override protected buildArgs(): string[]

class TrivyFsSettings extends TrivyReportSettings
  Settings for `trivy fs` (https://github.com/aquasecurity/trivy), which scans
  a filesystem path for vulnerabilities, secrets, and misconfigurations.

  target(path: PathLike): this
    The path to scan (default `.`).
  scanners(...values: string[]): this
    Enable specific scanners (`--scanners`), e.g. `vuln`, `secret`, `misconfig`.
  override protected buildArgs(): string[]

class ZizmorSettings extends ToolSettings
  Settings for `zizmor` (https://github.com/woodruffw/zizmor), a static analyzer
  for GitHub Actions workflows (detects unpinned actions, script injection,
  over-broad permissions, and more).

  override protected defaultTool(): string
  paths(...inputs: PathLike[]): this
    Add a workflow file or directory to audit (positional); repeatable.
  config(path: PathLike): this
    Use an explicit zizmor config file (`--config`).
  format(value: string): this
    Output format (`--format`), e.g. `plain`, `json`, or `sarif`.
  minSeverity(value: string): this
    Only report findings at or above this severity (`--min-severity`).
  persona(value: string): this
    Audit persona (`--persona`), e.g. `regular`, `pedantic`, `auditor`.
  offline(): this
    Do not perform any network access (`--offline`).
  override protected buildArgs(): string[]

interface SecurityTasksApi
  The shape of {@link SecurityTasks}.

  zizmor(configure?: Configure<ZizmorSettings>): Promise<CommandOutput>
    Audit GitHub Actions workflows with `zizmor`.
  actionlint(configure?: Configure<ActionlintSettings>): Promise<CommandOutput>
    Lint GitHub Actions workflows with `actionlint`.
  gitleaks(configure?: Configure<GitleaksDetectSettings>): Promise<CommandOutput>
    Scan for committed secrets with `gitleaks detect`.
  osvScanner(configure?: Configure<OsvScannerSettings>): Promise<CommandOutput>
    Scan lockfiles for known vulnerabilities with `osv-scanner`.
  semgrep(configure?: Configure<SemgrepScanSettings>): Promise<CommandOutput>
    Run source-code static analysis with `semgrep scan`.
  trivyFs(configure?: Configure<TrivyFsSettings>): Promise<CommandOutput>
    Scan a filesystem path with `trivy fs`.
  trivyConfig(configure?: Configure<TrivyConfigSettings>): Promise<CommandOutput>
    Scan configuration / IaC files with `trivy config`.
````

</details>

<!-- ZUKE:API:END -->
