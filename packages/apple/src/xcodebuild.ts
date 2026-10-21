// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `XcodebuildTasks` — typed task functions for `xcodebuild`, to build, test,
 * archive and export iOS (and other Apple platform) apps.
 *
 * ```ts
 * import { XcodebuildTasks } from "@zuke/apple";
 *
 * await XcodebuildTasks.archive((s) =>
 *   s.workspace("App.xcworkspace").scheme("App").configuration("Release")
 *     .destination("generic/platform=iOS").archivePath("build/App.xcarchive")
 * );
 * await XcodebuildTasks.writeExportOptions("build/ExportOptions.plist", (o) =>
 *   o.method("app-store-connect").teamId("ABCDE12345")
 * );
 * await XcodebuildTasks.exportArchive((s) =>
 *   s.archivePath("build/App.xcarchive").exportPath("build/ipa")
 *     .exportOptionsPlist("build/ExportOptions.plist")
 * );
 * ```
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { type Configure, type PathLike, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { ExportOptionsSettings } from "./export_options.ts";
import {
  XcodebuildActionSettings,
  XcodebuildArchiveSettings,
  type XcodebuildPlainAction,
  XcodebuildShowBuildSettings,
  type XcodebuildTestAction,
  XcodebuildTestSettings,
} from "./xcodebuild_actions.ts";
import { XcodebuildExportArchiveSettings } from "./xcodebuild_export.ts";

/** A task that runs a flag-free `xcodebuild` action. */
export type XcodebuildActionTask = (
  configure?: Configure<XcodebuildActionSettings>,
) => Promise<CommandOutput>;

/** A task that runs an `xcodebuild` test action. */
export type XcodebuildTestTask = (
  configure?: Configure<XcodebuildTestSettings>,
) => Promise<CommandOutput>;

/** The shape of {@link XcodebuildTasks}. */
export interface XcodebuildTasksApi {
  /** Build a scheme: `xcodebuild build`. */
  build: XcodebuildActionTask;
  /** Remove build products: `xcodebuild clean`. */
  clean: XcodebuildActionTask;
  /** Run the static analyzer: `xcodebuild analyze`. */
  analyze: XcodebuildActionTask;
  /** Build for a later test run: `xcodebuild build-for-testing`. */
  buildForTesting: XcodebuildActionTask;
  /** Resolve Swift package dependencies: `xcodebuild -resolvePackageDependencies`. */
  resolvePackageDependencies: XcodebuildActionTask;
  /** Build and run the tests: `xcodebuild test`. */
  test: XcodebuildTestTask;
  /** Run tests already built: `xcodebuild test-without-building`. */
  testWithoutBuilding: XcodebuildTestTask;
  /** Build an `.xcarchive`: `xcodebuild archive`. */
  archive(
    configure: Configure<XcodebuildArchiveSettings>,
  ): Promise<CommandOutput>;
  /** Export an archive to an `.ipa`, or upload it: `xcodebuild -exportArchive`. */
  exportArchive(
    configure: Configure<XcodebuildExportArchiveSettings>,
  ): Promise<CommandOutput>;
  /** Print the resolved build settings: `xcodebuild -showBuildSettings`. */
  showBuildSettings(
    configure?: Configure<XcodebuildShowBuildSettings>,
  ): Promise<CommandOutput>;
  /**
   * Write an `ExportOptions.plist` for {@link exportArchive} to `path`. Runs
   * no subprocess.
   */
  writeExportOptions(
    path: PathLike,
    configure: Configure<ExportOptionsSettings>,
  ): Promise<void>;
}

/** An {@link XcodebuildActionTask} for `action`. */
function actionTask(
  action: XcodebuildPlainAction,
): XcodebuildActionTask {
  return (configure) =>
    runSettings(new XcodebuildActionSettings(action), configure);
}

/** An {@link XcodebuildTestTask} for `action`. */
function testTask(
  action: XcodebuildTestAction,
): XcodebuildTestTask {
  return (configure) =>
    runSettings(new XcodebuildTestSettings(action), configure);
}

/** Typed task functions for `xcodebuild`. */
export const XcodebuildTasks: XcodebuildTasksApi = {
  build: actionTask("build"),
  clean: actionTask("clean"),
  analyze: actionTask("analyze"),
  buildForTesting: actionTask("build-for-testing"),
  resolvePackageDependencies: actionTask("-resolvePackageDependencies"),
  test: testTask("test"),
  testWithoutBuilding: testTask("test-without-building"),
  archive: (configure) =>
    runSettings(new XcodebuildArchiveSettings(), configure),
  exportArchive: (configure) =>
    runSettings(new XcodebuildExportArchiveSettings(), configure),
  showBuildSettings: (configure) =>
    runSettings(new XcodebuildShowBuildSettings(), configure),
  writeExportOptions: (path, configure) =>
    FileTasks.writeText(path, configure(new ExportOptionsSettings()).render()),
};
