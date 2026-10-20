// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/flutter` — typed `FlutterTasks` wrappers for the
 * [Flutter](https://flutter.dev) CLI, for use in Zuke builds: analyze, test,
 * build every artifact, manage pub dependencies, and drive devices and the SDK.
 *
 * ```ts
 * import { FlutterTasks } from "@zuke/flutter";
 *
 * await FlutterTasks.pubGet((s) => s.enforceLockfile());
 * await FlutterTasks.analyze();
 * await FlutterTasks.test((s) => s.coverage());
 * await FlutterTasks.buildAppBundle((s) =>
 *   s.release().flavor("prod").buildNumber(42)
 * );
 * ```
 *
 * @module
 */

export { FlutterAnalyzeSettings } from "./src/analyze.ts";
export { FlutterBuildSettings, type FlutterBuildTarget } from "./src/build.ts";
export {
  FlutterDevicesSettings,
  FlutterDriveSettings,
  FlutterInstallSettings,
} from "./src/device.ts";
export {
  FlutterCommandSettings,
  FlutterCreateSettings,
  type FlutterPlainCommand,
} from "./src/project.ts";
export {
  FlutterPubDepsSettings,
  FlutterPubGetSettings,
  FlutterPubOutdatedSettings,
  FlutterPubPackagesSettings,
  FlutterPubUpgradeSettings,
} from "./src/pub.ts";
export {
  FlutterConfigSettings,
  FlutterDoctorSettings,
  FlutterPrecacheSettings,
  FlutterVersionSettings,
} from "./src/sdk.ts";
export {
  FlutterAppSettings,
  type FlutterBuildMode,
  FlutterCompileSettings,
  FlutterSettings,
} from "./src/settings.ts";
export {
  type FlutterBuildTask,
  FlutterTasks,
  type FlutterTasksApi,
} from "./src/tasks.ts";
export { FlutterTestSettings } from "./src/test_settings.ts";
