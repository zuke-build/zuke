// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/homebrew` — ship a prebuilt binary through a
 * [Homebrew](https://brew.sh) tap from a Zuke build: `BrewTasks` wraps the
 * `brew` CLI, and `HomebrewTasks` renders a formula, publishes it to the tap,
 * verifies it installs, and declares the CI job that verifies it on macOS and
 * Linux.
 *
 * ```ts
 * import { HomebrewTasks } from "@zuke/homebrew";
 *
 * const ruby = HomebrewTasks.formula((s) =>
 *   s.name("app").description("Command-line tool for widgets")
 *     .homepage("https://example.com").license("MIT")
 *     .binary((b) => b.os("macos").arch("arm").url(macArmUrl).sha256(macArmSha))
 *     .binary((b) => b.os("linux").arch("intel").url(linuxUrl).sha256(linuxSha))
 *     .install("app")
 *     .test((t) => t.command("--version").expectVersion())
 * );
 * await HomebrewTasks.publish((s) =>
 *   s.tap("acme/tap").formula("app", ruby).token(tapToken).message("app 1.2.3")
 * );
 * ```
 *
 * @module
 */

export { BrewTasks, type BrewTasksApi } from "./src/brew.ts";
export { BrewCommandSettings, BrewSettings } from "./src/brew_settings.ts";
export {
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
} from "./src/brew_commands.ts";
export {
  type BrewFormulaInfo,
  type BrewFormulaVersions,
  type BrewInfo,
  BrewInfoSettings,
} from "./src/brew_info.ts";
export { HomebrewTasks, type HomebrewTasksApi } from "./src/homebrew.ts";
export { FormulaSettings } from "./src/formula.ts";
export {
  type FormulaArch,
  type FormulaBinary,
  FormulaBinarySettings,
  type FormulaOs,
} from "./src/formula_binary.ts";
export {
  type FormulaTestExpectation,
  FormulaTestSettings,
} from "./src/formula_test_block.ts";
export {
  type HomebrewPublishResult,
  HomebrewPublishSettings,
} from "./src/publish.ts";
export { HomebrewVerifySettings } from "./src/verify.ts";
export { HomebrewVerifyJobSettings } from "./src/ci.ts";
