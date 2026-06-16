/**
 * `SecurityTasks` — typed task wrappers for free, open-source security scanners,
 * in the same settings-lambda style as the other Zuke tool wrappers: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * The wrapped tools cover the supply-chain surface of a typical pipeline:
 *
 * | Task | Tool | Scans |
 * |------|------|-------|
 * | {@link SecurityTasksApi.zizmor} | [`zizmor`](https://github.com/woodruffw/zizmor) | GitHub Actions workflows (SAST) |
 * | {@link SecurityTasksApi.actionlint} | [`actionlint`](https://github.com/rhysd/actionlint) | Workflow YAML & embedded shell |
 * | {@link SecurityTasksApi.gitleaks} | [`gitleaks`](https://github.com/gitleaks/gitleaks) | Secrets in the tree / history |
 * | {@link SecurityTasksApi.osvScanner} | [`osv-scanner`](https://github.com/google/osv-scanner) | Known vulns in lockfiles |
 * | {@link SecurityTasksApi.semgrep} | [`semgrep`](https://github.com/semgrep/semgrep) | Source code (SAST) |
 * | {@link SecurityTasksApi.trivyFs} / {@link SecurityTasksApi.trivyConfig} | [`trivy`](https://github.com/aquasecurity/trivy) | Filesystem & IaC/config |
 *
 * ```ts
 * import { SecurityTasks } from "jsr:@zuke/security";
 *
 * await SecurityTasks.zizmor((s) => s.paths(".github/workflows").format("sarif"));
 * await SecurityTasks.gitleaks((s) => s.source(".").redact());
 * await SecurityTasks.osvScanner((s) => s.lockfile("package-lock.json"));
 * ```
 *
 * Each binary is resolved on `PATH` (override with `.toolPath(...)`), and every
 * interpolated value becomes a discrete argv entry — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/**
 * Settings for [`zizmor`](https://github.com/woodruffw/zizmor), a static analyzer
 * for GitHub Actions workflows (detects unpinned actions, script injection,
 * over-broad permissions, and more).
 */
export class ZizmorSettings extends ToolSettings {
  #paths: string[] = [];
  #config?: string;
  #format?: string;
  #minSeverity?: string;
  #persona?: string;
  #offline = false;

  protected override defaultTool(): string {
    return "zizmor";
  }

  /** Add a workflow file or directory to audit (positional); repeatable. */
  paths(...inputs: PathLike[]): this {
    this.#paths.push(...inputs.map(String));
    return this;
  }

  /** Use an explicit zizmor config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Output format (`--format`), e.g. `plain`, `json`, or `sarif`. */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Only report findings at or above this severity (`--min-severity`). */
  minSeverity(value: string): this {
    this.#minSeverity = value;
    return this;
  }

  /** Audit persona (`--persona`), e.g. `regular`, `pedantic`, `auditor`. */
  persona(value: string): this {
    this.#persona = value;
    return this;
  }

  /** Do not perform any network access (`--offline`). */
  offline(): this {
    this.#offline = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#format !== undefined) argv.push("--format", this.#format);
    if (this.#minSeverity !== undefined) {
      argv.push("--min-severity", this.#minSeverity);
    }
    if (this.#persona !== undefined) argv.push("--persona", this.#persona);
    if (this.#offline) argv.push("--offline");
    argv.push(...this.#paths);
    return argv;
  }
}

/**
 * Settings for [`actionlint`](https://github.com/rhysd/actionlint), a linter for
 * GitHub Actions workflow files (and the shell embedded in `run:` steps).
 */
export class ActionlintSettings extends ToolSettings {
  #files: string[] = [];
  #format?: string;
  #color = false;
  #noColor = false;

  protected override defaultTool(): string {
    return "actionlint";
  }

  /** Add an explicit workflow file to lint (positional); repeatable. */
  files(...paths: PathLike[]): this {
    this.#files.push(...paths.map(String));
    return this;
  }

  /** Output format template (`-format`), e.g. `'{{json .}}'`. */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Force colored output (`-color`). */
  color(): this {
    this.#color = true;
    return this;
  }

  /** Disable colored output (`-no-color`). */
  noColor(): this {
    this.#noColor = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv: string[] = [];
    if (this.#format !== undefined) argv.push("-format", this.#format);
    if (this.#color) argv.push("-color");
    if (this.#noColor) argv.push("-no-color");
    argv.push(...this.#files);
    return argv;
  }
}

/**
 * Settings for [`gitleaks detect`](https://github.com/gitleaks/gitleaks), which
 * scans a directory (and, by default, git history) for committed secrets.
 */
export class GitleaksDetectSettings extends ToolSettings {
  #source?: string;
  #config?: string;
  #reportFormat?: string;
  #reportPath?: string;
  #redact = false;
  #noGit = false;
  #verbose = false;

  protected override defaultTool(): string {
    return "gitleaks";
  }

  /** Path to scan (`--source`). */
  source(path: PathLike): this {
    this.#source = String(path);
    return this;
  }

  /** Use an explicit gitleaks config (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Report format (`--report-format`), e.g. `json`, `sarif`, `csv`. */
  reportFormat(value: string): this {
    this.#reportFormat = value;
    return this;
  }

  /** Write the report to a file (`--report-path`). */
  reportPath(path: PathLike): this {
    this.#reportPath = String(path);
    return this;
  }

  /** Redact secret values from the output (`--redact`). */
  redact(): this {
    this.#redact = true;
    return this;
  }

  /** Treat the source as a plain directory, not a git repo (`--no-git`). */
  noGit(): this {
    this.#noGit = true;
    return this;
  }

  /** Verbose output (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["detect"];
    if (this.#source !== undefined) argv.push("--source", this.#source);
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#reportFormat !== undefined) {
      argv.push("--report-format", this.#reportFormat);
    }
    if (this.#reportPath !== undefined) {
      argv.push("--report-path", this.#reportPath);
    }
    if (this.#redact) argv.push("--redact");
    if (this.#noGit) argv.push("--no-git");
    if (this.#verbose) argv.push("--verbose");
    return argv;
  }
}

/**
 * Settings for [`osv-scanner`](https://github.com/google/osv-scanner), which
 * matches lockfile entries against the OSV vulnerability database.
 */
export class OsvScannerSettings extends ToolSettings {
  #lockfiles: string[] = [];
  #paths: string[] = [];
  #format?: string;
  #output?: string;
  #recursive = false;

  protected override defaultTool(): string {
    return "osv-scanner";
  }

  /** Scan an explicit lockfile (`--lockfile`); repeatable. */
  lockfile(path: PathLike): this {
    this.#lockfiles.push(String(path));
    return this;
  }

  /** Add a directory to scan (positional); repeatable. */
  paths(...inputs: PathLike[]): this {
    this.#paths.push(...inputs.map(String));
    return this;
  }

  /** Output format (`--format`), e.g. `table`, `json`, `sarif`. */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Write the report to a file (`--output`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Recurse into subdirectories (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv: string[] = [];
    for (const l of this.#lockfiles) argv.push("--lockfile", l);
    if (this.#format !== undefined) argv.push("--format", this.#format);
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#recursive) argv.push("--recursive");
    argv.push(...this.#paths);
    return argv;
  }
}

/**
 * Settings for [`semgrep scan`](https://github.com/semgrep/semgrep), a static
 * analysis engine for source code. Defaults to whatever rules `--config`
 * selects (e.g. `auto` or `p/ci`).
 */
export class SemgrepScanSettings extends ToolSettings {
  #configs: string[] = [];
  #paths: string[] = [];
  #sarif = false;
  #json = false;
  #output?: string;
  #error = false;

  protected override defaultTool(): string {
    return "semgrep";
  }

  /** Add a rules config (`--config`), e.g. `auto`, `p/ci`; repeatable. */
  config(value: string): this {
    this.#configs.push(value);
    return this;
  }

  /** Add a path to scan (positional); repeatable. */
  paths(...inputs: PathLike[]): this {
    this.#paths.push(...inputs.map(String));
    return this;
  }

  /** Emit SARIF (`--sarif`). */
  sarif(): this {
    this.#sarif = true;
    return this;
  }

  /** Emit JSON (`--json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Write output to a file (`--output`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Exit non-zero when findings are present (`--error`). */
  error(): this {
    this.#error = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["scan"];
    for (const c of this.#configs) argv.push("--config", c);
    if (this.#sarif) argv.push("--sarif");
    if (this.#json) argv.push("--json");
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#error) argv.push("--error");
    argv.push(...this.#paths);
    return argv;
  }
}

/** Shared options for `trivy` subcommands that produce a report. */
abstract class TrivyReportSettings extends ToolSettings {
  #format?: string;
  #output?: string;
  #severities: string[] = [];
  #exitCode?: number;

  protected override defaultTool(): string {
    return "trivy";
  }

  /** Report format (`--format`), e.g. `table`, `json`, `sarif`. */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Write the report to a file (`--output`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Restrict to these severities (`--severity`), e.g. `HIGH`, `CRITICAL`. */
  severity(...values: string[]): this {
    this.#severities.push(...values);
    return this;
  }

  /** Process exit code when issues are found (`--exit-code`). */
  exitCode(code: number): this {
    this.#exitCode = code;
    return this;
  }

  /** The report flags shared by every `trivy` subcommand, in stable order. */
  protected reportArgs(): string[] {
    const argv: string[] = [];
    if (this.#format !== undefined) argv.push("--format", this.#format);
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#severities.length > 0) {
      argv.push("--severity", this.#severities.join(","));
    }
    if (this.#exitCode !== undefined) {
      argv.push("--exit-code", String(this.#exitCode));
    }
    return argv;
  }
}

/**
 * Settings for [`trivy fs`](https://github.com/aquasecurity/trivy), which scans
 * a filesystem path for vulnerabilities, secrets, and misconfigurations.
 */
export class TrivyFsSettings extends TrivyReportSettings {
  #target = ".";
  #scanners: string[] = [];

  /** The path to scan (default `.`). */
  target(path: PathLike): this {
    this.#target = String(path);
    return this;
  }

  /** Enable specific scanners (`--scanners`), e.g. `vuln`, `secret`, `misconfig`. */
  scanners(...values: string[]): this {
    this.#scanners.push(...values);
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["fs"];
    if (this.#scanners.length > 0) {
      argv.push("--scanners", this.#scanners.join(","));
    }
    argv.push(...this.reportArgs());
    argv.push(this.#target);
    return argv;
  }
}

/**
 * Settings for [`trivy config`](https://github.com/aquasecurity/trivy), which
 * scans IaC / configuration files (Dockerfiles, workflows, etc.) for
 * misconfigurations.
 */
export class TrivyConfigSettings extends TrivyReportSettings {
  #target = ".";

  /** The path to scan (default `.`). */
  target(path: PathLike): this {
    this.#target = String(path);
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["config"];
    argv.push(...this.reportArgs());
    argv.push(this.#target);
    return argv;
  }
}

/** The shape of {@link SecurityTasks}. */
export interface SecurityTasksApi {
  /** Audit GitHub Actions workflows with `zizmor`. */
  zizmor(configure?: Configure<ZizmorSettings>): Promise<CommandOutput>;
  /** Lint GitHub Actions workflows with `actionlint`. */
  actionlint(
    configure?: Configure<ActionlintSettings>,
  ): Promise<CommandOutput>;
  /** Scan for committed secrets with `gitleaks detect`. */
  gitleaks(
    configure?: Configure<GitleaksDetectSettings>,
  ): Promise<CommandOutput>;
  /** Scan lockfiles for known vulnerabilities with `osv-scanner`. */
  osvScanner(
    configure?: Configure<OsvScannerSettings>,
  ): Promise<CommandOutput>;
  /** Run source-code static analysis with `semgrep scan`. */
  semgrep(configure?: Configure<SemgrepScanSettings>): Promise<CommandOutput>;
  /** Scan a filesystem path with `trivy fs`. */
  trivyFs(configure?: Configure<TrivyFsSettings>): Promise<CommandOutput>;
  /** Scan configuration / IaC files with `trivy config`. */
  trivyConfig(
    configure?: Configure<TrivyConfigSettings>,
  ): Promise<CommandOutput>;
}

/** Task functions for running free, open-source security scanners. */
export const SecurityTasks: SecurityTasksApi = {
  zizmor(configure?: Configure<ZizmorSettings>): Promise<CommandOutput> {
    return runSettings(new ZizmorSettings(), configure);
  },
  actionlint(
    configure?: Configure<ActionlintSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new ActionlintSettings(), configure);
  },
  gitleaks(
    configure?: Configure<GitleaksDetectSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new GitleaksDetectSettings(), configure);
  },
  osvScanner(
    configure?: Configure<OsvScannerSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new OsvScannerSettings(), configure);
  },
  semgrep(configure?: Configure<SemgrepScanSettings>): Promise<CommandOutput> {
    return runSettings(new SemgrepScanSettings(), configure);
  },
  trivyFs(configure?: Configure<TrivyFsSettings>): Promise<CommandOutput> {
    return runSettings(new TrivyFsSettings(), configure);
  },
  trivyConfig(
    configure?: Configure<TrivyConfigSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new TrivyConfigSettings(), configure);
  },
};
