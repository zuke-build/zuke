// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `FlutterTasks` — typed task functions for the
 * [Flutter](https://flutter.dev) CLI, in the settings-lambda style: configure a
 * fluent settings object in a lambda, and the task function builds the command
 * line and executes it.
 *
 * ```ts
 * import { FlutterTasks } from "@zuke/flutter";
 * await FlutterTasks.pubGet((s) => s.enforceLockfile());
 * await FlutterTasks.test((s) => s.coverage());
 * await FlutterTasks.buildAppBundle((s) => s.release().buildNumber(42));
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { FlutterAnalyzeSettings } from "./analyze.ts";
import { FlutterBuildSettings, type FlutterBuildTarget } from "./build.ts";
import {
  FlutterDevicesSettings,
  FlutterDriveSettings,
  FlutterInstallSettings,
} from "./device.ts";
import { FlutterCommandSettings, FlutterCreateSettings } from "./project.ts";
import {
  FlutterPubDepsSettings,
  FlutterPubGetSettings,
  FlutterPubOutdatedSettings,
  FlutterPubPackagesSettings,
  FlutterPubUpgradeSettings,
} from "./pub.ts";
import {
  FlutterConfigSettings,
  FlutterDoctorSettings,
  FlutterPrecacheSettings,
  FlutterVersionSettings,
} from "./sdk.ts";
import { FlutterTestSettings } from "./test_settings.ts";

/** A task that runs `flutter build <target>`. */
export type FlutterBuildTask = (
  configure?: Configure<FlutterBuildSettings>,
) => Promise<CommandOutput>;

/** The shape of {@link FlutterTasks}. */
export interface FlutterTasksApi {
  /** Analyze the project's Dart code: `flutter analyze`. */
  analyze(
    configure?: Configure<FlutterAnalyzeSettings>,
  ): Promise<CommandOutput>;
  /** Run the unit and widget tests: `flutter test`. */
  test(configure?: Configure<FlutterTestSettings>): Promise<CommandOutput>;
  /**
   * Build an Android library: `flutter build aar`. It builds the debug, profile
   * and release variants unless told not to, so a single mode needs the others
   * turned off through `.args("--no-debug", "--no-profile")`.
   */
  buildAar: FlutterBuildTask;
  /** Build an Android APK: `flutter build apk`. */
  buildApk: FlutterBuildTask;
  /** Build an Android App Bundle: `flutter build appbundle`. */
  buildAppBundle: FlutterBuildTask;
  /** Build the iOS app: `flutter build ios`. */
  buildIos: FlutterBuildTask;
  /** Build an iOS archive and IPA: `flutter build ipa`. */
  buildIpa: FlutterBuildTask;
  /** Build the Linux desktop app: `flutter build linux`. */
  buildLinux: FlutterBuildTask;
  /** Build the macOS desktop app: `flutter build macos`. */
  buildMacos: FlutterBuildTask;
  /** Build the web app: `flutter build web`. */
  buildWeb: FlutterBuildTask;
  /** Build the Windows desktop app: `flutter build windows`. */
  buildWindows: FlutterBuildTask;
  /** Resolve dependencies: `flutter pub get`. */
  pubGet(configure?: Configure<FlutterPubGetSettings>): Promise<CommandOutput>;
  /** Upgrade dependencies: `flutter pub upgrade`. */
  pubUpgrade(
    configure?: Configure<FlutterPubUpgradeSettings>,
  ): Promise<CommandOutput>;
  /** List outdated dependencies: `flutter pub outdated`. */
  pubOutdated(
    configure?: Configure<FlutterPubOutdatedSettings>,
  ): Promise<CommandOutput>;
  /** Print the dependency graph: `flutter pub deps`. */
  pubDeps(
    configure?: Configure<FlutterPubDepsSettings>,
  ): Promise<CommandOutput>;
  /** Add dependencies to `pubspec.yaml`: `flutter pub add`. */
  pubAdd(
    configure: Configure<FlutterPubPackagesSettings>,
  ): Promise<CommandOutput>;
  /** Remove dependencies from `pubspec.yaml`: `flutter pub remove`. */
  pubRemove(
    configure: Configure<FlutterPubPackagesSettings>,
  ): Promise<CommandOutput>;
  /** Delete the build and `.dart_tool` directories: `flutter clean`. */
  clean(configure?: Configure<FlutterCommandSettings>): Promise<CommandOutput>;
  /** Scaffold a project: `flutter create`. */
  create(configure: Configure<FlutterCreateSettings>): Promise<CommandOutput>;
  /** Generate localizations from `l10n.yaml`: `flutter gen-l10n`. */
  genL10n(
    configure?: Configure<FlutterCommandSettings>,
  ): Promise<CommandOutput>;
  /** Run integration tests on a device: `flutter drive`. */
  drive(configure?: Configure<FlutterDriveSettings>): Promise<CommandOutput>;
  /** Install a built app on a device: `flutter install`. */
  install(
    configure?: Configure<FlutterInstallSettings>,
  ): Promise<CommandOutput>;
  /** List connected devices: `flutter devices`. */
  devices(
    configure?: Configure<FlutterDevicesSettings>,
  ): Promise<CommandOutput>;
  /** Check the toolchain: `flutter doctor`. */
  doctor(configure?: Configure<FlutterDoctorSettings>): Promise<CommandOutput>;
  /** Download platform artifacts: `flutter precache`. */
  precache(
    configure?: Configure<FlutterPrecacheSettings>,
  ): Promise<CommandOutput>;
  /** Change SDK settings: `flutter config`. */
  config(configure?: Configure<FlutterConfigSettings>): Promise<CommandOutput>;
  /** Print the Flutter, Dart and engine versions: `flutter --version`. */
  version(
    configure?: Configure<FlutterVersionSettings>,
  ): Promise<CommandOutput>;
}

/** A {@link FlutterBuildTask} for `target`. */
function buildTask(target: FlutterBuildTarget): FlutterBuildTask {
  return (configure) =>
    runSettings(new FlutterBuildSettings(target), configure);
}

/** Typed task functions for the `flutter` CLI. */
export const FlutterTasks: FlutterTasksApi = {
  analyze: (configure) => runSettings(new FlutterAnalyzeSettings(), configure),
  test: (configure) => runSettings(new FlutterTestSettings(), configure),
  buildAar: buildTask("aar"),
  buildApk: buildTask("apk"),
  buildAppBundle: buildTask("appbundle"),
  buildIos: buildTask("ios"),
  buildIpa: buildTask("ipa"),
  buildLinux: buildTask("linux"),
  buildMacos: buildTask("macos"),
  buildWeb: buildTask("web"),
  buildWindows: buildTask("windows"),
  pubGet: (configure) => runSettings(new FlutterPubGetSettings(), configure),
  pubUpgrade: (configure) =>
    runSettings(new FlutterPubUpgradeSettings(), configure),
  pubOutdated: (configure) =>
    runSettings(new FlutterPubOutdatedSettings(), configure),
  pubDeps: (configure) => runSettings(new FlutterPubDepsSettings(), configure),
  pubAdd: (configure) =>
    runSettings(new FlutterPubPackagesSettings("add"), configure),
  pubRemove: (configure) =>
    runSettings(new FlutterPubPackagesSettings("remove"), configure),
  clean: (configure) =>
    runSettings(new FlutterCommandSettings("clean"), configure),
  create: (configure) => runSettings(new FlutterCreateSettings(), configure),
  genL10n: (configure) =>
    runSettings(new FlutterCommandSettings("gen-l10n"), configure),
  drive: (configure) => runSettings(new FlutterDriveSettings(), configure),
  install: (configure) => runSettings(new FlutterInstallSettings(), configure),
  devices: (configure) => runSettings(new FlutterDevicesSettings(), configure),
  doctor: (configure) => runSettings(new FlutterDoctorSettings(), configure),
  precache: (configure) =>
    runSettings(new FlutterPrecacheSettings(), configure),
  config: (configure) => runSettings(new FlutterConfigSettings(), configure),
  version: (configure) => runSettings(new FlutterVersionSettings(), configure),
};
