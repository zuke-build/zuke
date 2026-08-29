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
import { DenoRunSettings, DenoTaskSettings } from "./execution.ts";
import { DenoCoverageSettings, DenoTestSettings } from "./testing.ts";
import {
  DenoCheckSettings,
  DenoDocSettings,
  DenoFmtSettings,
  DenoLintSettings,
} from "./quality.ts";
import {
  DenoCacheSettings,
  DenoInstallSettings,
  DenoPublishSettings,
} from "./dependencies.ts";

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
};
