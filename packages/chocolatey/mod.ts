// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/chocolatey` — ship a prebuilt Windows binary through
 * [Chocolatey](https://chocolatey.org) from a Zuke build: `ChocoTasks` wraps
 * the `choco` CLI, and `ChocolateyTasks` renders a package for a zip hosted
 * on a release, verifies it installs, publishes it, and declares the CI job
 * that verifies it on Windows.
 *
 * ```ts
 * import { ChocolateyTasks } from "@zuke/chocolatey";
 *
 * const pkg = ChocolateyTasks.package((s) =>
 *   s.id("app").version("1.2.3").authors("Acme")
 *     .projectUrl("https://example.com")
 *     .licenseUrl("https://example.com/LICENSE")
 *     .description("Command-line tool that builds and ships widgets")
 *     .url64bit(winZipUrl).checksum64(winZipSha)
 * );
 * await ChocolateyTasks.verify((s) =>
 *   s.package(pkg).binary("app").command("--version").expectVersion()
 * );
 * await ChocolateyTasks.publish((s) => s.package(pkg).apiKey(chocoKey));
 * ```
 *
 * @module
 */

export { ChocoTasks, type ChocoTasksApi } from "./src/choco.ts";
export { ChocoCommandSettings, ChocoSettings } from "./src/choco_settings.ts";
export {
  type ChocoApikeyAction,
  ChocoApikeySettings,
  ChocoInstallSettings,
  ChocoPackSettings,
  ChocoPushSettings,
  ChocoUninstallSettings,
} from "./src/choco_commands.ts";
export { ChocolateyTasks, type ChocolateyTasksApi } from "./src/chocolatey.ts";
export {
  type ChocolateyPackage,
  ChocolateyPackageSettings,
} from "./src/package.ts";
export {
  type ChocolateyVerifyExpectation,
  ChocolateyVerifySettings,
} from "./src/verify.ts";
export {
  type ChocolateyPublishResult,
  ChocolateyPublishSettings,
} from "./src/publish.ts";
export { ChocolateyVerifyJobSettings } from "./src/ci.ts";
