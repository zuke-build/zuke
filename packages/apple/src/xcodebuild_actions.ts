// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the `xcodebuild` actions that build a project: build, clean,
 * analyze, the test actions, archive, package resolution and printing the
 * build settings.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { operand } from "./operand.ts";
import { XcodebuildProjectSettings } from "./xcodebuild_settings.ts";

/** An `xcodebuild` action that takes no flags of its own. */
export type XcodebuildPlainAction =
  | "analyze"
  | "build"
  | "build-for-testing"
  | "clean"
  | "-resolvePackageDependencies";

/**
 * Settings for `xcodebuild build`, `clean`, `analyze`, `build-for-testing` and
 * `-resolvePackageDependencies`.
 */
export class XcodebuildActionSettings extends XcodebuildProjectSettings {
  readonly #action: XcodebuildPlainAction;

  /** Settings for `xcodebuild <action>`. */
  constructor(action: XcodebuildPlainAction) {
    super();
    this.#action = action;
  }

  /** The action. */
  protected override actionArgs(): string[] {
    return [this.#action];
  }
}

/** An `xcodebuild` action that runs tests. */
export type XcodebuildTestAction = "test" | "test-without-building";

/** `YES` or `NO`, as `xcodebuild` spells a boolean. */
function yesNo(value: boolean): string {
  return value ? "YES" : "NO";
}

/** Settings for `xcodebuild test` and `test-without-building`. */
export class XcodebuildTestSettings extends XcodebuildProjectSettings {
  readonly #action: XcodebuildTestAction;
  #flags: string[] = [];

  /** Settings for `xcodebuild <action>`. */
  constructor(action: XcodebuildTestAction) {
    super();
    this.#action = action;
  }

  /**
   * Run the tests a `build-for-testing` run described, from its `.xctestrun`
   * file (`-xctestrun`), instead of a scheme — the usual way to run
   * `test-without-building`.
   */
  xctestrun(path: PathLike): this {
    this.#flags.push("-xctestrun", operand(path));
    return this;
  }

  /** The test plan to run (`-testPlan`). */
  testPlan(name: string): this {
    this.#flags.push("-testPlan", name);
    return this;
  }

  /**
   * Run only this test target, class or method, e.g. `AppTests/LoginTests`
   * (`-only-testing`); repeatable.
   */
  onlyTesting(identifier: string): this {
    this.#flags.push(`-only-testing:${identifier}`);
    return this;
  }

  /** Skip this test target, class or method (`-skip-testing`); repeatable. */
  skipTesting(identifier: string): this {
    this.#flags.push(`-skip-testing:${identifier}`);
    return this;
  }

  /** Turn code coverage on or off (`-enableCodeCoverage YES|NO`). */
  enableCodeCoverage(enabled = true): this {
    this.#flags.push("-enableCodeCoverage", yesNo(enabled));
    return this;
  }

  /** Turn parallel testing on or off (`-parallel-testing-enabled YES|NO`). */
  parallelTestingEnabled(enabled = true): this {
    this.#flags.push("-parallel-testing-enabled", yesNo(enabled));
    return this;
  }

  /** Re-run a failed test until it passes, up to the iteration limit (`-retry-tests-on-failure`). */
  retryTestsOnFailure(): this {
    this.#flags.push("-retry-tests-on-failure");
    return this;
  }

  /** How many times to run each test (`-test-iterations`). */
  testIterations(count: number): this {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error(
        `xcodebuild test: .testIterations() takes a whole number from 1 up, ` +
          `not ${count}.`,
      );
    }
    this.#flags.push("-test-iterations", String(count));
    return this;
  }

  /** The action and the test flags. */
  protected override actionArgs(): string[] {
    return [this.#action, ...this.#flags];
  }
}

/** Settings for `xcodebuild archive`. */
export class XcodebuildArchiveSettings extends XcodebuildProjectSettings {
  #archivePath?: string;

  /** Where to write the `.xcarchive` (`-archivePath`); required. */
  archivePath(path: PathLike): this {
    this.#archivePath = operand(path);
    return this;
  }

  /** `archive -archivePath <path>`. */
  protected override actionArgs(): string[] {
    if (this.#archivePath === undefined) {
      throw new Error("xcodebuild archive: .archivePath() is required.");
    }
    return ["archive", "-archivePath", this.#archivePath];
  }
}

/** Settings for `xcodebuild -showBuildSettings`. */
export class XcodebuildShowBuildSettings extends XcodebuildProjectSettings {
  #json = false;

  /** Print the settings as JSON (`-json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** `-showBuildSettings`, then `-json` when asked for. */
  protected override actionArgs(): string[] {
    return this.#json
      ? ["-showBuildSettings", "-json"]
      : ["-showBuildSettings"];
  }
}
