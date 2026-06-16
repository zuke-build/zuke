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
