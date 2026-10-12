// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `HomebrewTasks` — shipping a prebuilt binary through a Homebrew tap: render
 * the formula, publish it to the tap, verify it installs, and the CI job that
 * runs the verification on macOS and Linux.
 *
 * @module
 */

import type { CiInvocation } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { type FormulaSettings, renderFormula } from "./formula.ts";
import {
  type HomebrewPublishResult,
  type HomebrewPublishSettings,
  publishFormula,
} from "./publish.ts";
import { type HomebrewVerifySettings, verifyFormula } from "./verify.ts";
import { type HomebrewVerifyJobSettings, verifyJob } from "./ci.ts";

/** The shape of {@link HomebrewTasks}. */
export interface HomebrewTasksApi {
  /**
   * The Ruby source of a formula that installs prebuilt binaries — one
   * archive per OS and CPU family. Pure: nothing is read or written.
   *
   * @throws {Error} naming the setter whose value is missing or invalid.
   */
  formula(configure: Configure<FormulaSettings>): string;
  /**
   * Write `Formula/<name>.rb` into a tap repository on GitHub, or leave it
   * alone — reporting `unchanged` — when the tap already holds exactly that
   * source.
   */
  publish(
    configure: Configure<HomebrewPublishSettings>,
  ): Promise<HomebrewPublishResult>;
  /**
   * Install a formula file through a throwaway local tap, run its test, then
   * uninstall it and remove the tap — the cleanup runs whether or not the
   * install and test succeeded.
   */
  verify(configure: Configure<HomebrewVerifySettings>): Promise<void>;
  /**
   * The CI job that runs a verifying target across macOS and Linux runners,
   * ready to list in `cicd({ invokes: [...] })`.
   */
  verifyJob(configure: Configure<HomebrewVerifyJobSettings>): CiInvocation;
}

/** Tasks for shipping a prebuilt binary through a Homebrew tap. */
export const HomebrewTasks: HomebrewTasksApi = {
  formula(configure: Configure<FormulaSettings>): string {
    return renderFormula(configure);
  },
  publish(
    configure: Configure<HomebrewPublishSettings>,
  ): Promise<HomebrewPublishResult> {
    return publishFormula(configure);
  },
  verify(configure: Configure<HomebrewVerifySettings>): Promise<void> {
    return verifyFormula(configure);
  },
  verifyJob(configure: Configure<HomebrewVerifyJobSettings>): CiInvocation {
    return verifyJob(configure);
  },
};
