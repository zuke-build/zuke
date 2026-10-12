// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `BrewTasks` — typed task functions for the [Homebrew](https://brew.sh) `brew`
 * CLI, in the settings-lambda style of every Zuke tool wrapper.
 *
 * ```ts
 * import { BrewTasks } from "@zuke/homebrew";
 *
 * await BrewTasks.install((s) => s.formula().formulae("acme/tap/app"));
 * const info = await BrewTasks.info((s) => s.formulae("app"));
 * console.log(info.formulae[0]?.installed);
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a shell string — so
 * a formula name cannot become a second command, and an operand that starts
 * with `-` is refused rather than read as a flag.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { BrewSettings } from "./brew_settings.ts";
import {
  BrewAuditSettings,
  BrewInstallSettings,
  BrewLivecheckSettings,
  BrewRepositorySettings,
  BrewStyleSettings,
  BrewTapNewSettings,
  BrewTapSettings,
  BrewTestSettings,
  BrewUninstallSettings,
  BrewUntapSettings,
} from "./brew_commands.ts";
import { type BrewInfo, BrewInfoSettings, parseBrewInfo } from "./brew_info.ts";

/** The shape of {@link BrewTasks}. */
export interface BrewTasksApi {
  /** Run any `brew` command, built with `.command(...)`/`.flag(...)`. */
  run(configure?: Configure<BrewSettings>): Promise<CommandOutput>;
  /** Install formulae (`brew install`). */
  install(configure: Configure<BrewInstallSettings>): Promise<CommandOutput>;
  /** Uninstall formulae (`brew uninstall`). */
  uninstall(
    configure: Configure<BrewUninstallSettings>,
  ): Promise<CommandOutput>;
  /** Run installed formulae's `test do` blocks (`brew test`). */
  test(configure: Configure<BrewTestSettings>): Promise<CommandOutput>;
  /** Audit formulae against Homebrew's rules (`brew audit`). */
  audit(configure?: Configure<BrewAuditSettings>): Promise<CommandOutput>;
  /** Check formulae against Homebrew's RuboCop style (`brew style`). */
  style(configure?: Configure<BrewStyleSettings>): Promise<CommandOutput>;
  /** Look for newer upstream versions (`brew livecheck`). */
  livecheck(
    configure?: Configure<BrewLivecheckSettings>,
  ): Promise<CommandOutput>;
  /** Add a tap (`brew tap`). */
  tap(configure: Configure<BrewTapSettings>): Promise<CommandOutput>;
  /** Remove taps (`brew untap`). */
  untap(configure: Configure<BrewUntapSettings>): Promise<CommandOutput>;
  /** Generate a new local tap (`brew tap-new`). */
  tapNew(configure: Configure<BrewTapNewSettings>): Promise<CommandOutput>;
  /**
   * The directory of Homebrew's repository, or of a tap
   * (`brew --repository [tap]`), as a path with the trailing newline removed.
   */
  repository(configure?: Configure<BrewRepositorySettings>): Promise<string>;
  /**
   * Describe formulae (`brew info --json=v2`), parsed into a {@link BrewInfo}:
   * names, versions and the installed versions.
   */
  info(configure: Configure<BrewInfoSettings>): Promise<BrewInfo>;
}

/** Typed task functions for the Homebrew `brew` CLI. */
export const BrewTasks: BrewTasksApi = {
  run(configure?: Configure<BrewSettings>): Promise<CommandOutput> {
    return runSettings(new BrewSettings(), configure);
  },
  install(configure: Configure<BrewInstallSettings>): Promise<CommandOutput> {
    return runSettings(new BrewInstallSettings(), configure);
  },
  uninstall(
    configure: Configure<BrewUninstallSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new BrewUninstallSettings(), configure);
  },
  test(configure: Configure<BrewTestSettings>): Promise<CommandOutput> {
    return runSettings(new BrewTestSettings(), configure);
  },
  audit(configure?: Configure<BrewAuditSettings>): Promise<CommandOutput> {
    return runSettings(new BrewAuditSettings(), configure);
  },
  style(configure?: Configure<BrewStyleSettings>): Promise<CommandOutput> {
    return runSettings(new BrewStyleSettings(), configure);
  },
  livecheck(
    configure?: Configure<BrewLivecheckSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new BrewLivecheckSettings(), configure);
  },
  tap(configure: Configure<BrewTapSettings>): Promise<CommandOutput> {
    return runSettings(new BrewTapSettings(), configure);
  },
  untap(configure: Configure<BrewUntapSettings>): Promise<CommandOutput> {
    return runSettings(new BrewUntapSettings(), configure);
  },
  tapNew(configure: Configure<BrewTapNewSettings>): Promise<CommandOutput> {
    return runSettings(new BrewTapNewSettings(), configure);
  },
  async repository(
    configure?: Configure<BrewRepositorySettings>,
  ): Promise<string> {
    const output = await runSettings(
      new BrewRepositorySettings().quiet(),
      configure,
    );
    return output.stdout.trim();
  },
  async info(configure: Configure<BrewInfoSettings>): Promise<BrewInfo> {
    const output = await runSettings(new BrewInfoSettings().quiet(), configure);
    return parseBrewInfo(output.stdout);
  },
};
