// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `DartTasks` — typed task functions for the [Dart](https://dart.dev) CLI, in
 * the settings-lambda style: configure a fluent settings object in a lambda,
 * and the task function builds the command line and executes it.
 *
 * ```ts
 * import { DartTasks } from "@zuke/dart";
 * await DartTasks.pubGet((s) => s.enforceLockfile());
 * await DartTasks.format((s) => s.setExitIfChanged().output("none"));
 * await DartTasks.test((s) => s.reporter("github"));
 * await DartTasks.compileExe((s) => s.entry("bin/main.dart").output("app"));
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { DartAnalyzeSettings } from "./analyze.ts";
import { DartCompileSettings, type DartCompileTarget } from "./compile.ts";
import { DartFormatSettings } from "./format.ts";
import {
  DartCreateSettings,
  DartDocSettings,
  DartFixSettings,
  DartInfoSettings,
  DartVersionSettings,
} from "./project.ts";
import {
  DartPubDepsSettings,
  DartPubDowngradeSettings,
  DartPubGetSettings,
  DartPubOutdatedSettings,
  DartPubPackagesSettings,
  DartPubPublishSettings,
  DartPubUpgradeSettings,
} from "./pub.ts";
import { DartRunSettings } from "./run.ts";
import { DartTestSettings } from "./test_settings.ts";

/** A task that runs `dart compile <target>`; `.entry()` is required. */
export type DartCompileTask = (
  configure: Configure<DartCompileSettings>,
) => Promise<CommandOutput>;

/** The shape of {@link DartTasks}. */
export interface DartTasksApi {
  /** Analyze the project's Dart code: `dart analyze`. */
  analyze(configure?: Configure<DartAnalyzeSettings>): Promise<CommandOutput>;
  /** Format Dart code, or check it with `.setExitIfChanged()`: `dart format`. */
  format(configure?: Configure<DartFormatSettings>): Promise<CommandOutput>;
  /** Apply analyzer fixes: `dart fix`. */
  fix(configure?: Configure<DartFixSettings>): Promise<CommandOutput>;
  /** Run the tests: `dart test`. */
  test(configure?: Configure<DartTestSettings>): Promise<CommandOutput>;
  /** Run a Dart program or package executable: `dart run`. */
  run(configure?: Configure<DartRunSettings>): Promise<CommandOutput>;
  /** Compile to a self-contained executable: `dart compile exe`. */
  compileExe: DartCompileTask;
  /** Compile to an AOT snapshot for `dartaotruntime`: `dart compile aot-snapshot`. */
  compileAotSnapshot: DartCompileTask;
  /** Compile to a JIT snapshot: `dart compile jit-snapshot`. */
  compileJitSnapshot: DartCompileTask;
  /** Compile to a kernel binary: `dart compile kernel`. */
  compileKernel: DartCompileTask;
  /** Compile to JavaScript: `dart compile js`. */
  compileJs: DartCompileTask;
  /** Compile to WebAssembly: `dart compile wasm`. */
  compileWasm: DartCompileTask;
  /** Generate API documentation: `dart doc`. */
  doc(configure?: Configure<DartDocSettings>): Promise<CommandOutput>;
  /** Scaffold a project: `dart create`. */
  create(configure: Configure<DartCreateSettings>): Promise<CommandOutput>;
  /** Resolve dependencies: `dart pub get`. */
  pubGet(configure?: Configure<DartPubGetSettings>): Promise<CommandOutput>;
  /** Upgrade dependencies: `dart pub upgrade`. */
  pubUpgrade(
    configure?: Configure<DartPubUpgradeSettings>,
  ): Promise<CommandOutput>;
  /** Downgrade dependencies to their lowest allowed versions: `dart pub downgrade`. */
  pubDowngrade(
    configure?: Configure<DartPubDowngradeSettings>,
  ): Promise<CommandOutput>;
  /** List outdated dependencies: `dart pub outdated`. */
  pubOutdated(
    configure?: Configure<DartPubOutdatedSettings>,
  ): Promise<CommandOutput>;
  /** Print the dependency graph: `dart pub deps`. */
  pubDeps(configure?: Configure<DartPubDepsSettings>): Promise<CommandOutput>;
  /** Add dependencies to `pubspec.yaml`: `dart pub add`. */
  pubAdd(configure: Configure<DartPubPackagesSettings>): Promise<CommandOutput>;
  /** Remove dependencies from `pubspec.yaml`: `dart pub remove`. */
  pubRemove(
    configure: Configure<DartPubPackagesSettings>,
  ): Promise<CommandOutput>;
  /** Publish the package to pub.dev: `dart pub publish`. */
  pubPublish(
    configure?: Configure<DartPubPublishSettings>,
  ): Promise<CommandOutput>;
  /** Print diagnostic details about the SDK: `dart info`. */
  info(configure?: Configure<DartInfoSettings>): Promise<CommandOutput>;
  /** Print the Dart SDK version: `dart --version`. */
  version(configure?: Configure<DartVersionSettings>): Promise<CommandOutput>;
}

/** A {@link DartCompileTask} for `target`. */
function compileTask(target: DartCompileTarget): DartCompileTask {
  return (configure) => runSettings(new DartCompileSettings(target), configure);
}

/** Typed task functions for the `dart` CLI. */
export const DartTasks: DartTasksApi = {
  analyze: (configure) => runSettings(new DartAnalyzeSettings(), configure),
  format: (configure) => runSettings(new DartFormatSettings(), configure),
  fix: (configure) => runSettings(new DartFixSettings(), configure),
  test: (configure) => runSettings(new DartTestSettings(), configure),
  run: (configure) => runSettings(new DartRunSettings(), configure),
  compileExe: compileTask("exe"),
  compileAotSnapshot: compileTask("aot-snapshot"),
  compileJitSnapshot: compileTask("jit-snapshot"),
  compileKernel: compileTask("kernel"),
  compileJs: compileTask("js"),
  compileWasm: compileTask("wasm"),
  doc: (configure) => runSettings(new DartDocSettings(), configure),
  create: (configure) => runSettings(new DartCreateSettings(), configure),
  pubGet: (configure) => runSettings(new DartPubGetSettings(), configure),
  pubUpgrade: (configure) =>
    runSettings(new DartPubUpgradeSettings(), configure),
  pubDowngrade: (configure) =>
    runSettings(new DartPubDowngradeSettings(), configure),
  pubOutdated: (configure) =>
    runSettings(new DartPubOutdatedSettings(), configure),
  pubDeps: (configure) => runSettings(new DartPubDepsSettings(), configure),
  pubAdd: (configure) =>
    runSettings(new DartPubPackagesSettings("add"), configure),
  pubRemove: (configure) =>
    runSettings(new DartPubPackagesSettings("remove"), configure),
  pubPublish: (configure) =>
    runSettings(new DartPubPublishSettings(), configure),
  info: (configure) => runSettings(new DartInfoSettings(), configure),
  version: (configure) => runSettings(new DartVersionSettings(), configure),
};
