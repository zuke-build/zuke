// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link ChocolateyVerifyJobSettings} and `ChocolateyTasks.verifyJob`: the CI
 * job that runs a package-verifying target on Windows runners.
 *
 * ```ts
 * class Release extends Build {
 *   verifyPackage = target().executes(() =>
 *     ChocolateyTasks.verify((s) =>
 *       s.package(pkg).binary("app").command("--version").expectVersion()
 *     )
 *   );
 *   releaseWorkflow = cicd({
 *     invokes: [ChocolateyTasks.verifyJob((s) => s.target(this.verifyPackage))],
 *   });
 * }
 * ```
 *
 * GitHub's Windows runners ship with Chocolatey on `PATH` and run elevated,
 * which is what `choco install` needs, so the job adds no setup step. It
 * returns a plain `CiInvocation`, so anything the pipeline decides — a
 * timeout, an egress allowlist — is added by spreading it:
 * `{ ...ChocolateyTasks.verifyJob(…), timeoutMinutes: 20 }`.
 *
 * @module
 */

import type { CiInvocation, TargetBuilder } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";

/** The runners a package is verified on unless told otherwise. */
const DEFAULT_RUNNERS = ["windows-latest"];

/** Settings for the package-verification CI job. */
export class ChocolateyVerifyJobSettings {
  /** The target the job runs. Set by {@link target}. */
  target_?: TargetBuilder;
  /** The runner labels the job fans out over. Set by {@link runners}. */
  runners_: string[] = [...DEFAULT_RUNNERS];

  /**
   * The target to run (required) — one that calls `ChocolateyTasks.verify`,
   * or otherwise installs, checks and uninstalls the package.
   */
  target(value: TargetBuilder): this {
    this.target_ = value;
    return this;
  }

  /**
   * The runner labels to verify on, replacing the default `windows-latest` —
   * e.g. `"windows-2022", "windows-2025"` to cover both images. Each must be
   * a Windows runner with Chocolatey installed.
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
  configure: Configure<ChocolateyVerifyJobSettings>,
): CiInvocation {
  const settings = configure(new ChocolateyVerifyJobSettings());
  const target = settings.target_;
  if (target === undefined) {
    throw new Error(
      "the Chocolatey verification job requires .target(...).",
    );
  }
  if (settings.runners_.length === 0) {
    throw new Error(
      "the Chocolatey verification job requires at least one .runners(...) " +
        "label.",
    );
  }
  return {
    target,
    name: "Verify Chocolatey package (${{ matrix.os }})",
    matrix: { os: [...settings.runners_] },
    // Let every runner report: cancelling the others would hide whether a
    // failure is specific to one image, which is what the matrix answers.
    failFast: false,
  };
}
