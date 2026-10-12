// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `ChocoTasks` — typed task functions for the
 * [Chocolatey](https://chocolatey.org) `choco` CLI (v2), in the
 * settings-lambda style of every Zuke tool wrapper.
 *
 * ```ts
 * import { ChocoTasks } from "@zuke/chocolatey";
 *
 * await ChocoTasks.pack((s) => s.nuspec("app.nuspec").outputDirectory("dist"));
 * await ChocoTasks.install((s) =>
 *   s.packages("app").source("dist").version("1.2.3").yes().noProgress()
 * );
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a shell string — so
 * a package id cannot become a second command, and an operand choco would read
 * as a switch is refused rather than passed.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { ChocoSettings } from "./choco_settings.ts";
import {
  ChocoApikeySettings,
  ChocoInstallSettings,
  ChocoPackSettings,
  ChocoPushSettings,
  ChocoUninstallSettings,
} from "./choco_commands.ts";

/** The shape of {@link ChocoTasks}. */
export interface ChocoTasksApi {
  /** Run any `choco` command, built with `.command(...)`/`.flag(...)`. */
  run(configure?: Configure<ChocoSettings>): Promise<CommandOutput>;
  /** Build a `.nupkg` from a `.nuspec` (`choco pack`). */
  pack(configure?: Configure<ChocoPackSettings>): Promise<CommandOutput>;
  /** Upload a `.nupkg` to a source (`choco push`); the API key is masked. */
  push(configure?: Configure<ChocoPushSettings>): Promise<CommandOutput>;
  /** Install packages (`choco install`). */
  install(configure: Configure<ChocoInstallSettings>): Promise<CommandOutput>;
  /** Uninstall packages (`choco uninstall`). */
  uninstall(
    configure: Configure<ChocoUninstallSettings>,
  ): Promise<CommandOutput>;
  /** List, save or remove a source's API key (`choco apikey`). */
  apikey(configure?: Configure<ChocoApikeySettings>): Promise<CommandOutput>;
}

/** Typed task functions for the Chocolatey `choco` CLI. */
export const ChocoTasks: ChocoTasksApi = {
  run(configure?: Configure<ChocoSettings>): Promise<CommandOutput> {
    return runSettings(new ChocoSettings(), configure);
  },
  pack(configure?: Configure<ChocoPackSettings>): Promise<CommandOutput> {
    return runSettings(new ChocoPackSettings(), configure);
  },
  push(configure?: Configure<ChocoPushSettings>): Promise<CommandOutput> {
    return runSettings(new ChocoPushSettings(), configure);
  },
  install(configure: Configure<ChocoInstallSettings>): Promise<CommandOutput> {
    return runSettings(new ChocoInstallSettings(), configure);
  },
  uninstall(
    configure: Configure<ChocoUninstallSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new ChocoUninstallSettings(), configure);
  },
  apikey(configure?: Configure<ChocoApikeySettings>): Promise<CommandOutput> {
    return runSettings(new ChocoApikeySettings(), configure);
  },
};
