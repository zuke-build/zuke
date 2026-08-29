// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `DenoTasks` — typed task functions for the `deno` CLI, in the
 * settings-lambda style: configure a fluent settings object in a lambda, and
 * the task function builds the command line and executes it.
 *
 * ```ts
 * import { DenoTasks } from "jsr:@zuke/deno";
 * await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
 * ```
 *
 * The binary defaults to the currently running `deno` executable
 * (`Deno.execPath()`), so builds never depend on PATH lookup; override with
 * `.toolPath(...)`.
 */

import type { Configure } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { runSettings } from "@zuke/core/tooling";
import { enforceCoverage } from "./coverage.ts";
import {
  DenoEvalSettings,
  DenoRunSettings,
  DenoServeSettings,
  DenoTaskSettings,
} from "./execution.ts";
import {
  DenoBenchSettings,
  DenoCoverageSettings,
  DenoTestSettings,
} from "./testing.ts";
import {
  DenoCheckSettings,
  DenoDocSettings,
  DenoFmtSettings,
  DenoLintSettings,
} from "./quality.ts";
import {
  DenoAddSettings,
  DenoApproveScriptsSettings,
  DenoBumpVersionSettings,
  DenoCacheSettings,
  DenoCiSettings,
  DenoInstallSettings,
  DenoOutdatedSettings,
  DenoPackSettings,
  DenoPublishSettings,
  DenoRemoveSettings,
  DenoUninstallSettings,
  DenoWhySettings,
} from "./dependencies.ts";
import {
  DenoCleanSettings,
  DenoCompileSettings,
  DenoInfoSettings,
  DenoInitSettings,
  DenoUpgradeSettings,
} from "./toolchain.ts";
import {
  type DenoCacheInfo,
  type DenoModuleGraph,
  parseCacheInfo,
  parseModuleGraph,
} from "./module_json.ts";

/** The shape of {@link DenoTasks}. */
export interface DenoTasksApi {
  /** Run a script: `deno run`. */
  run(configure?: Configure<DenoRunSettings>): Promise<CommandOutput>;
  /** Run tests: `deno test`. */
  test(configure?: Configure<DenoTestSettings>): Promise<CommandOutput>;
  /** Type-check files: `deno check`. */
  check(configure?: Configure<DenoCheckSettings>): Promise<CommandOutput>;
  /** Format files: `deno fmt`. */
  fmt(configure?: Configure<DenoFmtSettings>): Promise<CommandOutput>;
  /** Lint files: `deno lint`. */
  lint(configure?: Configure<DenoLintSettings>): Promise<CommandOutput>;
  /** Generate documentation: `deno doc`. */
  doc(configure?: Configure<DenoDocSettings>): Promise<CommandOutput>;
  /** Warm the module cache: `deno cache`. */
  cache(configure?: Configure<DenoCacheSettings>): Promise<CommandOutput>;
  /** Report coverage: `deno coverage`. */
  coverage(configure?: Configure<DenoCoverageSettings>): Promise<CommandOutput>;
  /** Install a script or executable: `deno install`. */
  install(configure?: Configure<DenoInstallSettings>): Promise<CommandOutput>;
  /** Publish a package to JSR: `deno publish`. */
  publish(configure?: Configure<DenoPublishSettings>): Promise<CommandOutput>;
  /** Run a deno.json task: `deno task`. */
  task(configure?: Configure<DenoTaskSettings>): Promise<CommandOutput>;
  /** Run a server: `deno serve`. */
  serve(configure?: Configure<DenoServeSettings>): Promise<CommandOutput>;
  /** Evaluate a snippet: `deno eval`. */
  eval(configure?: Configure<DenoEvalSettings>): Promise<CommandOutput>;
  /** Run benchmarks: `deno bench`. */
  bench(configure?: Configure<DenoBenchSettings>): Promise<CommandOutput>;
  /** Build a self-contained executable: `deno compile`. */
  compile(configure?: Configure<DenoCompileSettings>): Promise<CommandOutput>;
  /** Remove the cache directory: `deno clean`. */
  clean(configure?: Configure<DenoCleanSettings>): Promise<CommandOutput>;
  /** Report on a module or the caches: `deno info`. */
  info(configure?: Configure<DenoInfoSettings>): Promise<CommandOutput>;
  /** Scaffold a new project: `deno init`. */
  init(configure?: Configure<DenoInitSettings>): Promise<CommandOutput>;
  /** Upgrade the deno executable: `deno upgrade`. */
  upgrade(configure?: Configure<DenoUpgradeSettings>): Promise<CommandOutput>;
  /** Add dependencies: `deno add`. */
  add(configure?: Configure<DenoAddSettings>): Promise<CommandOutput>;
  /** Remove dependencies: `deno remove`. */
  remove(configure?: Configure<DenoRemoveSettings>): Promise<CommandOutput>;
  /** Uninstall a dependency or global executable: `deno uninstall`. */
  uninstall(
    configure?: Configure<DenoUninstallSettings>,
  ): Promise<CommandOutput>;
  /** Report outdated dependencies: `deno outdated`. */
  outdated(configure?: Configure<DenoOutdatedSettings>): Promise<CommandOutput>;
  /** Explain why a package is installed: `deno why`. */
  why(configure?: Configure<DenoWhySettings>): Promise<CommandOutput>;
  /** Install strictly from the lockfile: `deno ci`. */
  ci(configure?: Configure<DenoCiSettings>): Promise<CommandOutput>;
  /** Approve npm lifecycle scripts: `deno approve-scripts`. */
  approveScripts(
    configure?: Configure<DenoApproveScriptsSettings>,
  ): Promise<CommandOutput>;
  /** Bump the version in the manifest: `deno bump-version`. */
  bumpVersion(
    configure?: Configure<DenoBumpVersionSettings>,
  ): Promise<CommandOutput>;
  /** Build an npm-compatible tarball: `deno pack`. */
  pack(configure?: Configure<DenoPackSettings>): Promise<CommandOutput>;
  /**
   * The module graph rooted at a file, parsed from `deno info --json`.
   *
   * A reader, not a gate: it returns the graph rather than printing it, so a
   * build can assert on what its entry point actually pulls in.
   */
  moduleGraph(
    configure?: Configure<DenoInfoSettings>,
  ): Promise<DenoModuleGraph>;
  /** The toolchain's cache locations, parsed from `deno info --json`. */
  cacheInfo(configure?: Configure<DenoInfoSettings>): Promise<DenoCacheInfo>;
}

/** Typed task functions for the `deno` CLI. */
export const DenoTasks: DenoTasksApi = {
  /** Run a script: `deno run`. */
  run(configure?: Configure<DenoRunSettings>): Promise<CommandOutput> {
    return runSettings(new DenoRunSettings(), configure);
  },
  /** Run tests: `deno test`. */
  test(configure?: Configure<DenoTestSettings>): Promise<CommandOutput> {
    return runSettings(new DenoTestSettings(), configure);
  },
  /** Type-check files: `deno check`. */
  check(configure?: Configure<DenoCheckSettings>): Promise<CommandOutput> {
    return runSettings(new DenoCheckSettings(), configure);
  },
  /** Format files: `deno fmt`. */
  fmt(configure?: Configure<DenoFmtSettings>): Promise<CommandOutput> {
    return runSettings(new DenoFmtSettings(), configure);
  },
  /** Lint files: `deno lint`. */
  lint(configure?: Configure<DenoLintSettings>): Promise<CommandOutput> {
    return runSettings(new DenoLintSettings(), configure);
  },
  /** Generate documentation: `deno doc`. */
  doc(configure?: Configure<DenoDocSettings>): Promise<CommandOutput> {
    return runSettings(new DenoDocSettings(), configure);
  },
  /** Warm the module cache: `deno cache`. */
  cache(configure?: Configure<DenoCacheSettings>): Promise<CommandOutput> {
    return runSettings(new DenoCacheSettings(), configure);
  },
  /**
   * Report coverage: `deno coverage`. When a threshold is configured
   * (`linesThreshold`/`branchesThreshold`/`threshold`), parse the lcov report
   * and enforce it — raising a {@link CoverageThresholdError} on a shortfall
   * unless `noThrow()` was set.
   */
  async coverage(
    configure?: Configure<DenoCoverageSettings>,
  ): Promise<CommandOutput> {
    const settings = new DenoCoverageSettings();
    const s = configure ? configure(settings) : settings;
    const { lines, branches, perFile } = s.thresholds;
    if (
      lines === undefined && branches === undefined && perFile === undefined
    ) {
      return await s.run(); // plain `deno coverage`, no gate
    }
    // Read the lcov from the output file when one is set, else capture it from
    // stdout (quietly, so the raw report doesn't flood the terminal).
    const output = s.outputPath;
    if (output === undefined) s.quiet();
    const result = await s.run();
    const lcov = output === undefined
      ? result.stdout
      : await Deno.readTextFile(output);
    enforceCoverage(lcov, { lines, branches, perFile }, s.throwsOnError);
    return result;
  },
  /** Install a script or executable: `deno install`. */
  install(configure?: Configure<DenoInstallSettings>): Promise<CommandOutput> {
    return runSettings(new DenoInstallSettings(), configure);
  },
  /** Publish a package to JSR: `deno publish`. */
  publish(configure?: Configure<DenoPublishSettings>): Promise<CommandOutput> {
    return runSettings(new DenoPublishSettings(), configure);
  },
  /** Run a deno.json task: `deno task`. */
  task(configure?: Configure<DenoTaskSettings>): Promise<CommandOutput> {
    return runSettings(new DenoTaskSettings(), configure);
  },
  /** Run a server: `deno serve`. */
  serve(configure?: Configure<DenoServeSettings>): Promise<CommandOutput> {
    return runSettings(new DenoServeSettings(), configure);
  },
  /** Evaluate a snippet: `deno eval`. */
  eval(configure?: Configure<DenoEvalSettings>): Promise<CommandOutput> {
    return runSettings(new DenoEvalSettings(), configure);
  },
  /** Run benchmarks: `deno bench`. */
  bench(configure?: Configure<DenoBenchSettings>): Promise<CommandOutput> {
    return runSettings(new DenoBenchSettings(), configure);
  },
  /** Build a self-contained executable: `deno compile`. */
  compile(configure?: Configure<DenoCompileSettings>): Promise<CommandOutput> {
    return runSettings(new DenoCompileSettings(), configure);
  },
  /** Remove the cache directory: `deno clean`. */
  clean(configure?: Configure<DenoCleanSettings>): Promise<CommandOutput> {
    return runSettings(new DenoCleanSettings(), configure);
  },
  /** Report on a module or the caches: `deno info`. */
  info(configure?: Configure<DenoInfoSettings>): Promise<CommandOutput> {
    return runSettings(new DenoInfoSettings(), configure);
  },
  /** Scaffold a new project: `deno init`. */
  init(configure?: Configure<DenoInitSettings>): Promise<CommandOutput> {
    return runSettings(new DenoInitSettings(), configure);
  },
  /** Upgrade the deno executable: `deno upgrade`. */
  upgrade(configure?: Configure<DenoUpgradeSettings>): Promise<CommandOutput> {
    return runSettings(new DenoUpgradeSettings(), configure);
  },
  /** Add dependencies: `deno add`. */
  add(configure?: Configure<DenoAddSettings>): Promise<CommandOutput> {
    return runSettings(new DenoAddSettings(), configure);
  },
  /** Remove dependencies: `deno remove`. */
  remove(configure?: Configure<DenoRemoveSettings>): Promise<CommandOutput> {
    return runSettings(new DenoRemoveSettings(), configure);
  },
  /** Uninstall a dependency or global executable: `deno uninstall`. */
  uninstall(
    configure?: Configure<DenoUninstallSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DenoUninstallSettings(), configure);
  },
  /** Report outdated dependencies: `deno outdated`. */
  outdated(
    configure?: Configure<DenoOutdatedSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DenoOutdatedSettings(), configure);
  },
  /** Explain why a package is installed: `deno why`. */
  why(configure?: Configure<DenoWhySettings>): Promise<CommandOutput> {
    return runSettings(new DenoWhySettings(), configure);
  },
  /** Install strictly from the lockfile: `deno ci`. */
  ci(configure?: Configure<DenoCiSettings>): Promise<CommandOutput> {
    return runSettings(new DenoCiSettings(), configure);
  },
  /** Approve npm lifecycle scripts: `deno approve-scripts`. */
  approveScripts(
    configure?: Configure<DenoApproveScriptsSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DenoApproveScriptsSettings(), configure);
  },
  /** Bump the version in the manifest: `deno bump-version`. */
  bumpVersion(
    configure?: Configure<DenoBumpVersionSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new DenoBumpVersionSettings(), configure);
  },
  /** Build an npm-compatible tarball: `deno pack`. */
  pack(configure?: Configure<DenoPackSettings>): Promise<CommandOutput> {
    return runSettings(new DenoPackSettings(), configure);
  },
  /**
   * The module graph rooted at a file, parsed from `deno info --json`.
   *
   * Forces `--json` and captures stdout quietly, so the caller gets the graph
   * rather than a wall of report text; a path is required, because `deno info`
   * without one reports the caches instead (see {@link DenoTasks.cacheInfo}).
   */
  async moduleGraph(
    configure?: Configure<DenoInfoSettings>,
  ): Promise<DenoModuleGraph> {
    const settings = new DenoInfoSettings();
    configure?.(settings);
    if (settings.modulePath === undefined) {
      throw new Error(
        "DenoTasks.moduleGraph: .path() is required — deno info without a " +
          "module reports the cache directories, not a graph. Use " +
          "DenoTasks.cacheInfo() for those.",
      );
    }
    const output = await settings.json().quiet().run();
    return parseModuleGraph(output.stdout);
  },
  /** The toolchain's cache locations, parsed from `deno info --json`. */
  async cacheInfo(
    configure?: Configure<DenoInfoSettings>,
  ): Promise<DenoCacheInfo> {
    const settings = new DenoInfoSettings();
    configure?.(settings);
    if (settings.modulePath !== undefined) {
      throw new Error(
        "DenoTasks.cacheInfo: .path() makes deno info report that module's " +
          "graph instead of the cache directories — drop it, or use " +
          "DenoTasks.moduleGraph().",
      );
    }
    const output = await settings.json().quiet().run();
    return parseCacheInfo(output.stdout);
  },
};
