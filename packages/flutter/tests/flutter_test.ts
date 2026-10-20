// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  FlutterAnalyzeSettings,
  FlutterBuildSettings,
  FlutterCommandSettings,
  FlutterConfigSettings,
  FlutterCreateSettings,
  FlutterDevicesSettings,
  FlutterDoctorSettings,
  FlutterDriveSettings,
  FlutterInstallSettings,
  FlutterPrecacheSettings,
  FlutterPubDepsSettings,
  FlutterPubGetSettings,
  FlutterPubOutdatedSettings,
  FlutterPubPackagesSettings,
  FlutterPubUpgradeSettings,
  FlutterTasks,
  FlutterTestSettings,
  FlutterVersionSettings,
} from "../mod.ts";

Deno.test("flutter resolves its binary from PATH", async () => {
  await assertWrapperConformance(
    () => new FlutterAnalyzeSettings(),
    "flutter",
    {
      resolution: "path",
    },
  );
});

Deno.test("analyze: flags before path operands, dashed paths made safe", () => {
  assertEquals(new FlutterAnalyzeSettings().argv(), ["flutter", "analyze"]);
  assertEquals(
    new FlutterAnalyzeSettings().path("lib").path("-x").noFatalInfos()
      .noFatalWarnings().write("out.txt").argv(),
    [
      "flutter",
      "analyze",
      "--no-fatal-infos",
      "--no-fatal-warnings",
      "--write",
      "out.txt",
      "lib",
      "./-x",
    ],
  );
});

Deno.test("test: every flag renders, compile flags, then paths", () => {
  assertEquals(
    new FlutterTestSettings().path("test/a_test.dart").path("--update-goldens")
      .coverage().coveragePath("cov/lcov.info").mergeCoverage()
      .name("^a").plainName("b").tags("fast").excludeTags("slow")
      .concurrency(4).reporter("github").fileReporter("json:r.json")
      .updateGoldens().platform("chrome").randomizeOrderingSeed("random")
      .timeout("30s").shard(1, 3)
      .noPub().dartDefine("API", "x=1").dartDefineFromFile("env.json")
      .flavor("dev").argv(),
    [
      "flutter",
      "test",
      "--coverage",
      "--coverage-path",
      "cov/lcov.info",
      "--merge-coverage",
      "--name",
      "^a",
      "--plain-name",
      "b",
      "--tags",
      "fast",
      "--exclude-tags",
      "slow",
      "--concurrency",
      "4",
      "--reporter",
      "github",
      "--file-reporter",
      "json:r.json",
      "--update-goldens",
      "--platform",
      "chrome",
      "--test-randomize-ordering-seed",
      "random",
      "--timeout",
      "30s",
      "--total-shards",
      "3",
      "--shard-index",
      "1",
      "--no-pub",
      "--dart-define=API=x=1",
      "--dart-define-from-file=env.json",
      "--flavor",
      "dev",
      "test/a_test.dart",
      "./--update-goldens",
    ],
  );
});

Deno.test("test: concurrency and shard numbers are validated", () => {
  assertThrows(
    () => new FlutterTestSettings().concurrency(0),
    Error,
    "whole number from 1 up",
  );
  assertThrows(
    () => new FlutterTestSettings().concurrency(1.5),
    Error,
    "whole number from 1 up",
  );
  assertThrows(
    () => new FlutterTestSettings().shard(0, 0),
    Error,
    "whole number from 1 up",
  );
  assertThrows(
    () => new FlutterTestSettings().shard(-1, 2),
    Error,
    "whole number from 0 up",
  );
  assertThrows(
    () => new FlutterTestSettings().shard(2, 2),
    Error,
    "not below the total",
  );
});

Deno.test("build: target, mode, entry point, compile and target flags", () => {
  assertEquals(new FlutterBuildSettings("web").argv(), [
    "flutter",
    "build",
    "web",
  ]);
  assertEquals(
    new FlutterBuildSettings("apk").release().target("lib/main_prod.dart")
      .flavor("prod").dartDefine("ENV", "prod").buildName("1.4.0")
      .buildNumber(42).obfuscate().splitDebugInfo("build/symbols")
      .noTreeShakeIcons().splitPerAbi().targetPlatform("android-arm64")
      .targetPlatform("android-x64").argv(),
    [
      "flutter",
      "build",
      "apk",
      "--release",
      "--target",
      "lib/main_prod.dart",
      "--dart-define=ENV=prod",
      "--flavor",
      "prod",
      "--build-name",
      "1.4.0",
      "--build-number",
      "42",
      "--obfuscate",
      "--split-debug-info",
      "build/symbols",
      "--no-tree-shake-icons",
      "--split-per-abi",
      "--target-platform",
      "android-arm64,android-x64",
    ],
  );
  assertEquals(
    new FlutterBuildSettings("ipa").mode("profile").noCodesign()
      .exportMethod("ad-hoc").exportOptionsPlist("ios/Export.plist").argv()
      .slice(3),
    [
      "--profile",
      "--no-codesign",
      "--export-method",
      "ad-hoc",
      "--export-options-plist",
      "ios/Export.plist",
    ],
  );
  assertEquals(
    new FlutterBuildSettings("web").baseHref("/app/").wasm().sourceMaps()
      .output("dist").argv().slice(3),
    ["--base-href", "/app/", "--wasm", "--source-maps", "--output", "dist"],
  );
});

Deno.test("pub: get, upgrade, outdated, deps", () => {
  assertEquals(new FlutterPubGetSettings().argv(), ["flutter", "pub", "get"]);
  assertEquals(
    new FlutterPubGetSettings().offline().enforceLockfile().argv(),
    ["flutter", "pub", "get", "--offline", "--enforce-lockfile"],
  );
  assertEquals(
    new FlutterPubUpgradeSettings().package("http").majorVersions().tighten()
      .argv(),
    ["flutter", "pub", "upgrade", "--major-versions", "--tighten", "http"],
  );
  assertEquals(new FlutterPubUpgradeSettings().argv(), [
    "flutter",
    "pub",
    "upgrade",
  ]);
  assertEquals(
    new FlutterPubOutdatedSettings().json().showAll().argv(),
    ["flutter", "pub", "outdated", "--json", "--show-all"],
  );
  assertEquals(new FlutterPubOutdatedSettings().argv(), [
    "flutter",
    "pub",
    "outdated",
  ]);
  assertEquals(new FlutterPubDepsSettings().argv(), ["flutter", "pub", "deps"]);
  assertEquals(new FlutterPubDepsSettings().json().argv(), [
    "flutter",
    "pub",
    "deps",
    "--json",
  ]);
});

Deno.test("pub: add and remove need a package and refuse dashed names", () => {
  assertEquals(
    new FlutterPubPackagesSettings("add").package("http:^1.2.0")
      .package("dev:mocktail").argv(),
    ["flutter", "pub", "add", "http:^1.2.0", "dev:mocktail"],
  );
  assertThrows(
    () => new FlutterPubPackagesSettings("remove").argv(),
    Error,
    "FlutterTasks.pubRemove: at least one .package() is required.",
  );
  assertThrows(
    () => new FlutterPubPackagesSettings("add").package("--offline"),
    Error,
    "FlutterTasks.pubAdd:",
  );
  assertThrows(
    () => new FlutterPubUpgradeSettings().package("-h"),
    Error,
    "FlutterTasks.pubUpgrade:",
  );
});

Deno.test("create: flags, platforms joined, directory last and required", () => {
  assertEquals(
    new FlutterCreateSettings().org("com.example").projectName("demo")
      .description("A demo").template("app").empty().platform("android")
      .platform("web").dir("demo").argv(),
    [
      "flutter",
      "create",
      "--org",
      "com.example",
      "--project-name",
      "demo",
      "--description",
      "A demo",
      "--template",
      "app",
      "--empty",
      "--platforms",
      "android,web",
      "demo",
    ],
  );
  assertEquals(new FlutterCreateSettings().dir("-x").argv(), [
    "flutter",
    "create",
    "./-x",
  ]);
  assertThrows(
    () => new FlutterCreateSettings().argv(),
    Error,
    "FlutterTasks.create: .dir() is required.",
  );
});

Deno.test("clean and gen-l10n run flagless", () => {
  assertEquals(new FlutterCommandSettings("clean").argv(), [
    "flutter",
    "clean",
  ]);
  assertEquals(new FlutterCommandSettings("gen-l10n").argv(), [
    "flutter",
    "gen-l10n",
  ]);
});

Deno.test("drive, install and devices", () => {
  assertEquals(new FlutterDriveSettings().argv(), ["flutter", "drive"]);
  assertEquals(
    new FlutterDriveSettings().mode("profile")
      .target("integration_test/app_test.dart")
      .driver("test_driver/integration_test.dart").deviceId("chrome")
      .screenshot("shots").argv(),
    [
      "flutter",
      "drive",
      "--profile",
      "--target",
      "integration_test/app_test.dart",
      "--driver",
      "test_driver/integration_test.dart",
      "--device-id",
      "chrome",
      "--screenshot",
      "shots",
    ],
  );
  assertEquals(new FlutterInstallSettings().argv(), ["flutter", "install"]);
  assertEquals(
    new FlutterInstallSettings().mode("release").flavor("prod")
      .deviceId("emulator-5554").useApplicationBinary("app.apk")
      .uninstallOnly().argv(),
    [
      "flutter",
      "install",
      "--release",
      "--flavor",
      "prod",
      "--device-id",
      "emulator-5554",
      "--use-application-binary",
      "app.apk",
      "--uninstall-only",
    ],
  );
  assertEquals(new FlutterDevicesSettings().argv(), ["flutter", "devices"]);
  assertEquals(new FlutterDevicesSettings().machine().argv(), [
    "flutter",
    "devices",
    "--machine",
  ]);
});

Deno.test("doctor, precache, config and version", () => {
  assertEquals(new FlutterDoctorSettings().argv(), ["flutter", "doctor"]);
  assertEquals(new FlutterDoctorSettings().verbose().argv(), [
    "flutter",
    "doctor",
    "--verbose",
  ]);
  assertEquals(new FlutterPrecacheSettings().argv(), ["flutter", "precache"]);
  assertEquals(
    new FlutterPrecacheSettings().platform("android").platform("ios").force()
      .argv(),
    ["flutter", "precache", "--android", "--ios", "--force"],
  );
  assertEquals(
    new FlutterConfigSettings().enable("web").disable("linux-desktop")
      .androidSdk("/opt/android").noAnalytics().clearFeatures().argv(),
    [
      "flutter",
      "config",
      "--enable-web",
      "--no-enable-linux-desktop",
      "--android-sdk",
      "/opt/android",
      "--no-analytics",
      "--clear-features",
    ],
  );
  assertEquals(new FlutterVersionSettings().argv(), ["flutter", "--version"]);
  assertEquals(new FlutterVersionSettings().machine().argv(), [
    "flutter",
    "--version",
    "--machine",
  ]);
});

Deno.test("precache and config refuse names that are not flag names", () => {
  assertThrows(
    () => new FlutterPrecacheSettings().platform(""),
    Error,
    "FlutterTasks.precache:",
  );
  assertThrows(
    () => new FlutterConfigSettings().enable("-web"),
    Error,
    "FlutterTasks.config:",
  );
  assertThrows(
    () => new FlutterConfigSettings().disable("Web desktop"),
    Error,
    "is not a flag name",
  );
});

Deno.test("FlutterTasks: every task reaches execution with its subcommand", async () => {
  const seen: string[][] = [];
  // Records the argv each task built, then points it at a binary that cannot exist.
  const probe = <S extends { argv(): string[] }>(s: S): S => {
    seen.push(s.argv().slice(1));
    return s;
  };
  const tasks: Array<() => Promise<unknown>> = [
    () => FlutterTasks.analyze((s) => missingTool(probe(s))),
    () => FlutterTasks.test((s) => missingTool(probe(s))),
    () => FlutterTasks.buildAar((s) => missingTool(probe(s))),
    () => FlutterTasks.buildApk((s) => missingTool(probe(s))),
    () => FlutterTasks.buildAppBundle((s) => missingTool(probe(s))),
    () => FlutterTasks.buildIos((s) => missingTool(probe(s))),
    () => FlutterTasks.buildIpa((s) => missingTool(probe(s))),
    () => FlutterTasks.buildLinux((s) => missingTool(probe(s))),
    () => FlutterTasks.buildMacos((s) => missingTool(probe(s))),
    () => FlutterTasks.buildWeb((s) => missingTool(probe(s))),
    () => FlutterTasks.buildWindows((s) => missingTool(probe(s))),
    () => FlutterTasks.pubGet((s) => missingTool(probe(s))),
    () => FlutterTasks.pubUpgrade((s) => missingTool(probe(s))),
    () => FlutterTasks.pubOutdated((s) => missingTool(probe(s))),
    () => FlutterTasks.pubDeps((s) => missingTool(probe(s))),
    () => FlutterTasks.pubAdd((s) => missingTool(probe(s.package("http")))),
    () => FlutterTasks.pubRemove((s) => missingTool(probe(s.package("http")))),
    () => FlutterTasks.clean((s) => missingTool(probe(s))),
    () => FlutterTasks.create((s) => missingTool(probe(s.dir("app")))),
    () => FlutterTasks.genL10n((s) => missingTool(probe(s))),
    () => FlutterTasks.drive((s) => missingTool(probe(s))),
    () => FlutterTasks.install((s) => missingTool(probe(s))),
    () => FlutterTasks.devices((s) => missingTool(probe(s))),
    () => FlutterTasks.doctor((s) => missingTool(probe(s))),
    () => FlutterTasks.precache((s) => missingTool(probe(s))),
    () => FlutterTasks.config((s) => missingTool(probe(s))),
    () => FlutterTasks.version((s) => missingTool(probe(s))),
  ];
  for (const task of tasks) await assertRejects(task, ToolNotFoundError);
  assertEquals(seen, [
    ["analyze"],
    ["test"],
    ["build", "aar"],
    ["build", "apk"],
    ["build", "appbundle"],
    ["build", "ios"],
    ["build", "ipa"],
    ["build", "linux"],
    ["build", "macos"],
    ["build", "web"],
    ["build", "windows"],
    ["pub", "get"],
    ["pub", "upgrade"],
    ["pub", "outdated"],
    ["pub", "deps"],
    ["pub", "add", "http"],
    ["pub", "remove", "http"],
    ["clean"],
    ["create", "app"],
    ["gen-l10n"],
    ["drive"],
    ["install"],
    ["devices"],
    ["doctor"],
    ["precache"],
    ["config"],
    ["--version"],
  ]);
});
