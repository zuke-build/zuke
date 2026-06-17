/**
 * `HelmTasks` — typed task functions for the [Helm](https://helm.sh) CLI, in
 * the settings-lambda style: configure a fluent settings object in a lambda,
 * and the task function builds the command line and executes it.
 *
 * ```ts
 * import { HelmTasks } from "jsr:@zuke/helm";
 *
 * await HelmTasks.upgrade((s) =>
 *   s.release("api").chart("./charts/api").install().namespace("prod")
 *     .set("image.tag", "1.4").wait()
 * );
 * ```
 *
 * Every subcommand shares the cluster-targeting flags `--namespace`,
 * `--kube-context`, and `--kubeconfig` (from the {@link HelmSettings} base).
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
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
 * Base for all `helm` subcommand settings: the binary is `helm`, and the
 * cluster-targeting flags (`--namespace`, `--kube-context`, `--kubeconfig`) are
 * shared by every subcommand.
 */
abstract class HelmSettings extends ToolSettings {
  #namespace?: string;
  #kubeContext?: string;
  #kubeconfig?: string;

  protected override defaultTool(): string {
    return "helm";
  }

  /** Target a namespace (`--namespace`). */
  namespace(name: string): this {
    this.#namespace = name;
    return this;
  }

  /** Use a named kube context (`--kube-context`). */
  kubeContext(name: string): this {
    this.#kubeContext = name;
    return this;
  }

  /** Use an explicit kubeconfig file (`--kubeconfig`). */
  kubeconfig(path: PathLike): this {
    this.#kubeconfig = String(path);
    return this;
  }

  /** The cluster-targeting flags shared by every subcommand. */
  protected globalArgs(): string[] {
    const argv: string[] = [];
    if (this.#namespace !== undefined) {
      argv.push("--namespace", this.#namespace);
    }
    if (this.#kubeContext !== undefined) {
      argv.push("--kube-context", this.#kubeContext);
    }
    if (this.#kubeconfig !== undefined) {
      argv.push("--kubeconfig", this.#kubeconfig);
    }
    return argv;
  }
}

/** Base for value-bearing commands (install/upgrade/template). */
abstract class HelmValuesSettings extends HelmSettings {
  #valueFiles: string[] = [];
  #sets: Array<[string, string]> = [];
  #version?: string;

  /** Add a values file (`--values`/`-f`); repeatable. */
  values(path: PathLike): this {
    this.#valueFiles.push(String(path));
    return this;
  }

  /** Override a single value (`--set name=value`); repeatable. */
  set(name: string, value: string): this {
    this.#sets.push([name, value]);
    return this;
  }

  /** Pin the chart version (`--version`). */
  version(value: string): this {
    this.#version = value;
    return this;
  }

  /** The shared value/version arguments. */
  protected valueArgs(): string[] {
    const argv: string[] = [];
    for (const f of this.#valueFiles) argv.push("--values", f);
    for (const [name, value] of this.#sets) {
      argv.push("--set", `${name}=${value}`);
    }
    if (this.#version !== undefined) argv.push("--version", this.#version);
    return argv;
  }
}

/** Settings for `helm install`. */
export class HelmInstallSettings extends HelmValuesSettings {
  #release?: string;
  #chart?: string;
  #createNamespace = false;
  #wait = false;
  #atomic = false;
  #timeout?: string;
  #dryRun = false;

  /** The release name (required). */
  release(name: string): this {
    this.#release = name;
    return this;
  }

  /** The chart reference or path (required). */
  chart(ref: string): this {
    this.#chart = ref;
    return this;
  }

  /** Create the release namespace if absent (`--create-namespace`). */
  createNamespace(): this {
    this.#createNamespace = true;
    return this;
  }

  /** Wait until resources are ready (`--wait`). */
  wait(): this {
    this.#wait = true;
    return this;
  }

  /** Roll back on failure (`--atomic`). */
  atomic(): this {
    this.#atomic = true;
    return this;
  }

  /** Operation timeout, e.g. `5m` (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  /** Simulate the install (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#release === undefined || this.#chart === undefined) {
      throw new Error(
        "HelmTasks.install: .release() and .chart() are required.",
      );
    }
    const argv = ["install", this.#release, this.#chart, ...this.globalArgs()];
    argv.push(...this.valueArgs());
    if (this.#createNamespace) argv.push("--create-namespace");
    if (this.#wait) argv.push("--wait");
    if (this.#atomic) argv.push("--atomic");
    if (this.#timeout !== undefined) argv.push("--timeout", this.#timeout);
    if (this.#dryRun) argv.push("--dry-run");
    return argv;
  }
}

/** Settings for `helm upgrade`. */
export class HelmUpgradeSettings extends HelmValuesSettings {
  #release?: string;
  #chart?: string;
  #install = false;
  #createNamespace = false;
  #wait = false;
  #atomic = false;
  #timeout?: string;

  /** The release name (required). */
  release(name: string): this {
    this.#release = name;
    return this;
  }

  /** The chart reference or path (required). */
  chart(ref: string): this {
    this.#chart = ref;
    return this;
  }

  /** Install the release if it does not exist (`--install`). */
  install(): this {
    this.#install = true;
    return this;
  }

  /** Create the release namespace if absent (`--create-namespace`). */
  createNamespace(): this {
    this.#createNamespace = true;
    return this;
  }

  /** Wait until resources are ready (`--wait`). */
  wait(): this {
    this.#wait = true;
    return this;
  }

  /** Roll back on failure (`--atomic`). */
  atomic(): this {
    this.#atomic = true;
    return this;
  }

  /** Operation timeout, e.g. `5m` (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#release === undefined || this.#chart === undefined) {
      throw new Error(
        "HelmTasks.upgrade: .release() and .chart() are required.",
      );
    }
    const argv = ["upgrade", this.#release, this.#chart, ...this.globalArgs()];
    argv.push(...this.valueArgs());
    if (this.#install) argv.push("--install");
    if (this.#createNamespace) argv.push("--create-namespace");
    if (this.#wait) argv.push("--wait");
    if (this.#atomic) argv.push("--atomic");
    if (this.#timeout !== undefined) argv.push("--timeout", this.#timeout);
    return argv;
  }
}

/** Settings for `helm uninstall`. */
export class HelmUninstallSettings extends HelmSettings {
  #release?: string;
  #keepHistory = false;
  #wait = false;

  /** The release name to uninstall (required). */
  release(name: string): this {
    this.#release = name;
    return this;
  }

  /** Retain release history (`--keep-history`). */
  keepHistory(): this {
    this.#keepHistory = true;
    return this;
  }

  /** Wait until removal completes (`--wait`). */
  wait(): this {
    this.#wait = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#release === undefined) {
      throw new Error("HelmTasks.uninstall: .release() is required.");
    }
    const argv = ["uninstall", this.#release, ...this.globalArgs()];
    if (this.#keepHistory) argv.push("--keep-history");
    if (this.#wait) argv.push("--wait");
    return argv;
  }
}

/** Settings for `helm template` (render manifests locally). */
export class HelmTemplateSettings extends HelmValuesSettings {
  #release?: string;
  #chart?: string;
  #outputDir?: string;

  /** The release name (required). */
  release(name: string): this {
    this.#release = name;
    return this;
  }

  /** The chart reference or path (required). */
  chart(ref: string): this {
    this.#chart = ref;
    return this;
  }

  /** Write rendered manifests to a directory (`--output-dir`). */
  outputDir(path: PathLike): this {
    this.#outputDir = String(path);
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#release === undefined || this.#chart === undefined) {
      throw new Error(
        "HelmTasks.template: .release() and .chart() are required.",
      );
    }
    const argv = ["template", this.#release, this.#chart, ...this.globalArgs()];
    argv.push(...this.valueArgs());
    if (this.#outputDir !== undefined) {
      argv.push("--output-dir", this.#outputDir);
    }
    return argv;
  }
}

/** Settings for `helm lint`. */
export class HelmLintSettings extends HelmSettings {
  #chart?: string;
  #valueFiles: string[] = [];
  #strict = false;

  /** The chart path to lint (required). */
  chart(path: PathLike): this {
    this.#chart = String(path);
    return this;
  }

  /** Add a values file (`--values`); repeatable. */
  values(path: PathLike): this {
    this.#valueFiles.push(String(path));
    return this;
  }

  /** Treat warnings as errors (`--strict`). */
  strict(): this {
    this.#strict = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#chart === undefined) {
      throw new Error("HelmTasks.lint: .chart() is required.");
    }
    const argv = ["lint", this.#chart, ...this.globalArgs()];
    for (const f of this.#valueFiles) argv.push("--values", f);
    if (this.#strict) argv.push("--strict");
    return argv;
  }
}

/** Settings for `helm dependency update`. */
export class HelmDependencyUpdateSettings extends HelmSettings {
  #chart?: string;

  /** The chart path whose dependencies to update (required). */
  chart(path: PathLike): this {
    this.#chart = String(path);
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#chart === undefined) {
      throw new Error("HelmTasks.dependencyUpdate: .chart() is required.");
    }
    return ["dependency", "update", this.#chart, ...this.globalArgs()];
  }
}

/** Settings for `helm repo add`. */
export class HelmRepoAddSettings extends HelmSettings {
  #name?: string;
  #url?: string;

  /** The repository name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** The repository URL (required). */
  url(value: string): this {
    this.#url = value;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#name === undefined || this.#url === undefined) {
      throw new Error("HelmTasks.repoAdd: .name() and .url() are required.");
    }
    return ["repo", "add", this.#name, this.#url, ...this.globalArgs()];
  }
}

/** Settings for `helm package`. */
export class HelmPackageSettings extends HelmSettings {
  #chart?: string;
  #destination?: string;
  #version?: string;
  #appVersion?: string;

  /** The chart path to package (required). */
  chart(path: PathLike): this {
    this.#chart = String(path);
    return this;
  }

  /** Output directory for the packaged chart (`--destination`). */
  destination(path: PathLike): this {
    this.#destination = String(path);
    return this;
  }

  /** Set the chart version (`--version`). */
  version(value: string): this {
    this.#version = value;
    return this;
  }

  /** Set the chart appVersion (`--app-version`). */
  appVersion(value: string): this {
    this.#appVersion = value;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#chart === undefined) {
      throw new Error("HelmTasks.package: .chart() is required.");
    }
    const argv = ["package", this.#chart, ...this.globalArgs()];
    if (this.#destination !== undefined) {
      argv.push("--destination", this.#destination);
    }
    if (this.#version !== undefined) argv.push("--version", this.#version);
    if (this.#appVersion !== undefined) {
      argv.push("--app-version", this.#appVersion);
    }
    return argv;
  }
}

/** The shape of {@link HelmTasks}. */
export interface HelmTasksApi {
  /** Install a chart: `helm install`. */
  install(configure?: Configure<HelmInstallSettings>): Promise<CommandOutput>;
  /** Upgrade (or install) a release: `helm upgrade`. */
  upgrade(configure?: Configure<HelmUpgradeSettings>): Promise<CommandOutput>;
  /** Uninstall a release: `helm uninstall`. */
  uninstall(
    configure?: Configure<HelmUninstallSettings>,
  ): Promise<CommandOutput>;
  /** Render manifests locally: `helm template`. */
  template(configure?: Configure<HelmTemplateSettings>): Promise<CommandOutput>;
  /** Lint a chart: `helm lint`. */
  lint(configure?: Configure<HelmLintSettings>): Promise<CommandOutput>;
  /** Update chart dependencies: `helm dependency update`. */
  dependencyUpdate(
    configure?: Configure<HelmDependencyUpdateSettings>,
  ): Promise<CommandOutput>;
  /** Add a chart repository: `helm repo add`. */
  repoAdd(configure?: Configure<HelmRepoAddSettings>): Promise<CommandOutput>;
  /** Package a chart: `helm package`. */
  package(configure?: Configure<HelmPackageSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `helm` CLI. */
export const HelmTasks: HelmTasksApi = {
  install(configure?: Configure<HelmInstallSettings>): Promise<CommandOutput> {
    return runSettings(new HelmInstallSettings(), configure);
  },
  upgrade(configure?: Configure<HelmUpgradeSettings>): Promise<CommandOutput> {
    return runSettings(new HelmUpgradeSettings(), configure);
  },
  uninstall(
    configure?: Configure<HelmUninstallSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new HelmUninstallSettings(), configure);
  },
  template(
    configure?: Configure<HelmTemplateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new HelmTemplateSettings(), configure);
  },
  lint(configure?: Configure<HelmLintSettings>): Promise<CommandOutput> {
    return runSettings(new HelmLintSettings(), configure);
  },
  dependencyUpdate(
    configure?: Configure<HelmDependencyUpdateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new HelmDependencyUpdateSettings(), configure);
  },
  repoAdd(configure?: Configure<HelmRepoAddSettings>): Promise<CommandOutput> {
    return runSettings(new HelmRepoAddSettings(), configure);
  },
  package(configure?: Configure<HelmPackageSettings>): Promise<CommandOutput> {
    return runSettings(new HelmPackageSettings(), configure);
  },
};
