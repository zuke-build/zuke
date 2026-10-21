// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/dart` — typed `DartTasks` wrappers for the [Dart](https://dart.dev)
 * CLI, for use in Zuke builds: analyze, format, fix and test Dart code,
 * compile it to every target, generate docs, scaffold and run programs, and
 * manage pub dependencies.
 *
 * ```ts
 * import { DartTasks } from "@zuke/dart";
 *
 * await DartTasks.pubGet((s) => s.enforceLockfile());
 * await DartTasks.analyze((s) => s.fatalInfos());
 * await DartTasks.format((s) => s.setExitIfChanged().output("none"));
 * await DartTasks.test((s) => s.coverage("coverage").reporter("github"));
 * await DartTasks.compileExe((s) =>
 *   s.entry("bin/main.dart").output("build/app")
 * );
 * ```
 *
 * @module
 */

export { DartAnalyzeSettings } from "./src/analyze.ts";
export {
  DartCompileSettings,
  type DartCompileTarget,
  type DartTargetOs,
} from "./src/compile.ts";
export { DartFormatSettings } from "./src/format.ts";
export {
  DartCreateSettings,
  type DartCreateTemplate,
  DartDocSettings,
  DartFixSettings,
  DartInfoSettings,
  DartVersionSettings,
} from "./src/project.ts";
export {
  DartPubDepsSettings,
  DartPubDowngradeSettings,
  DartPubGetSettings,
  DartPubOutdatedSettings,
  DartPubPackagesSettings,
  DartPubPublishSettings,
  DartPubUpgradeSettings,
} from "./src/pub.ts";
export { DartRunSettings } from "./src/run.ts";
export { DartSettings, DartVmSettings } from "./src/settings.ts";
export {
  type DartCompileTask,
  DartTasks,
  type DartTasksApi,
} from "./src/tasks.ts";
export { DartTestSettings } from "./src/test_settings.ts";
