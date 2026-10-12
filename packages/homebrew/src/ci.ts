// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link HomebrewVerifyJobSettings} and `HomebrewTasks.verifyJob`: the CI job
 * that runs a formula-verifying target on macOS and Linux runners.
 *
 * ```ts
 * class Release extends Build {
 *   verifyFormula = target().executes(() =>
 *     HomebrewTasks.verify((s) => s.formulaFile("dist/app.rb").name("app"))
 *   );
 *   releaseWorkflow = cicd({
 *     invokes: [HomebrewTasks.verifyJob((s) => s.target(this.verifyFormula))],
 *   });
 * }
 * ```
 *
 * It returns a plain `CiInvocation`, so the job is declared by the target it
 * runs like every other, and anything the pipeline decides — hardening, an
 * egress allowlist, a timeout — is added by spreading it:
 * `{ ...HomebrewTasks.verifyJob(…), timeoutMinutes: 20 }`.
 *
 * @module
 */

import type { CiInvocation, CiStep, TargetBuilder } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";

/** The runners a formula is verified on unless told otherwise. */
const DEFAULT_RUNNERS = ["macos-latest", "ubuntu-latest"];

/**
 * Put Homebrew on `PATH` on a GitHub Linux runner, where it is installed under
 * `/home/linuxbrew/.linuxbrew` but deliberately left off `PATH`. macOS runners
 * already have it, so the step only runs on Linux.
 */
const LINUXBREW_ON_PATH: CiStep = {
  name: "Put Homebrew on PATH",
  if: "runner.os == 'Linux'",
  run: 'echo "/home/linuxbrew/.linuxbrew/bin" >> "$GITHUB_PATH"',
};

/** Settings for the formula-verification CI job. */
export class HomebrewVerifyJobSettings {
  /** The target the job runs. Set by {@link target}. */
  target_?: TargetBuilder;
  /** The runner labels the job fans out over. Set by {@link runners}. */
  runners_: string[] = [...DEFAULT_RUNNERS];

  /**
   * The target to run (required) — one that calls `HomebrewTasks.verify`, or
   * otherwise installs, tests and uninstalls the formula.
   */
  target(value: TargetBuilder): this {
    this.target_ = value;
    return this;
  }

  /**
   * The runner labels to verify on, replacing the default `macos-latest` and
   * `ubuntu-latest` — e.g. `"macos-15", "macos-15-intel", "ubuntu-latest"` to
   * cover both Mac CPU families. GitHub's ARM Linux runners
   * (`ubuntu-24.04-arm`) ship without Homebrew, so they cannot verify a
   * formula without installing it first.
   */
  runners(...labels: string[]): this {
    this.runners_ = labels;
    return this;
  }
}

/**
 * Build the configured job.
 *
 * @throws {Error} when no target, or no runner, was given.
 */
export function verifyJob(
  configure: Configure<HomebrewVerifyJobSettings>,
): CiInvocation {
  const settings = configure(new HomebrewVerifyJobSettings());
  const target = settings.target_;
  if (target === undefined) {
    throw new Error("the formula verification job requires .target(...).");
  }
  if (settings.runners_.length === 0) {
    throw new Error(
      "the formula verification job requires at least one .runners(...) label.",
    );
  }
  return {
    target,
    name: "Verify formula (${{ matrix.os }})",
    matrix: { os: [...settings.runners_] },
    // Let every platform report: cancelling the others would hide whether a
    // failure is specific to one, which is what the matrix exists to answer.
    failFast: false,
    before: [{ ...LINUXBREW_ON_PATH }],
  };
}
