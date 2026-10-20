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
  XcodebuildActionSettings,
  XcodebuildArchiveSettings,
  XcodebuildExportArchiveSettings,
  XcodebuildShowBuildSettings,
  XcodebuildTasks,
  XcodebuildTestSettings,
} from "../mod.ts";

/** The argv after the binary. */
function args(settings: { argv(): string[] }): string[] {
  return settings.argv().slice(1);
}

Deno.test("xcodebuild resolves its binary from PATH", async () => {
  await assertWrapperConformance(
    () => new XcodebuildActionSettings("build"),
    "xcodebuild",
    { resolution: "path" },
  );
});

Deno.test("build: project flags, the action, build settings, shared flags", () => {
  assertEquals(args(new XcodebuildActionSettings("build")), ["build"]);
  assertEquals(
    args(
      new XcodebuildActionSettings("build").workspace("App.xcworkspace")
        .scheme("App").configuration("Release").sdk("iphoneos")
        .destination("generic/platform=iOS")
        .destination("platform=iOS Simulator,name=iPhone 16")
        .derivedDataPath("-dd").clonedSourcePackagesDirPath("spm")
        .resultBundlePath("build/App.xcresult").xcconfig("ci.xcconfig")
        .buildSetting("DEVELOPMENT_TEAM", "ABCDE12345")
        .buildSetting("CODE_SIGN_IDENTITY[sdk=iphoneos*]", "Apple Distribution")
        .quietOutput().allowProvisioningUpdates()
        .authenticationKey("AuthKey_ABC.p8", "ABC", "issuer-uuid"),
    ),
    [
      "-workspace",
      "App.xcworkspace",
      "-scheme",
      "App",
      "-configuration",
      "Release",
      "-sdk",
      "iphoneos",
      "-destination",
      "generic/platform=iOS",
      "-destination",
      "platform=iOS Simulator,name=iPhone 16",
      "-derivedDataPath",
      "./-dd",
      "-clonedSourcePackagesDirPath",
      "spm",
      "-resultBundlePath",
      "build/App.xcresult",
      "-xcconfig",
      "ci.xcconfig",
      "build",
      "DEVELOPMENT_TEAM=ABCDE12345",
      "CODE_SIGN_IDENTITY[sdk=iphoneos*]=Apple Distribution",
      "-quiet",
      "-allowProvisioningUpdates",
      "-authenticationKeyPath",
      "AuthKey_ABC.p8",
      "-authenticationKeyID",
      "ABC",
      "-authenticationKeyIssuerID",
      "issuer-uuid",
    ],
  );
  assertEquals(
    args(
      new XcodebuildActionSettings("-resolvePackageDependencies").project(
        "App.xcodeproj",
      ),
    ),
    ["-project", "App.xcodeproj", "-resolvePackageDependencies"],
  );
});

Deno.test("build: scheme, configuration and sdk are single-valued", () => {
  assertEquals(
    args(
      new XcodebuildActionSettings("build").scheme("A").scheme("B")
        .configuration("Debug").configuration("Release").sdk("macosx")
        .sdk("iphoneos"),
    ),
    ["-scheme", "B", "-configuration", "Release", "-sdk", "iphoneos", "build"],
  );
});

Deno.test("build: one container, and only build setting names", () => {
  assertThrows(
    () => new XcodebuildActionSettings("build").workspace("a").project("b"),
    Error,
    "set one of .workspace() and .project(), not both.",
  );
  assertThrows(
    () => new XcodebuildActionSettings("build").buildSetting("-quiet", "x"),
    Error,
    "is not a build setting name",
  );
  assertThrows(
    () => new XcodebuildActionSettings("build").buildSetting("A=B", "x"),
    Error,
    "is not a build setting name",
  );
});

Deno.test("test: every test flag after the action", () => {
  assertEquals(
    args(
      new XcodebuildTestSettings("test").scheme("App")
        .destination("platform=iOS Simulator,name=iPhone 16")
        .testPlan("CI").onlyTesting("AppTests/LoginTests")
        .skipTesting("AppUITests").enableCodeCoverage()
        .parallelTestingEnabled(false).retryTestsOnFailure()
        .testIterations(3),
    ),
    [
      "-scheme",
      "App",
      "-destination",
      "platform=iOS Simulator,name=iPhone 16",
      "test",
      "-testPlan",
      "CI",
      "-only-testing:AppTests/LoginTests",
      "-skip-testing:AppUITests",
      "-enableCodeCoverage",
      "YES",
      "-parallel-testing-enabled",
      "NO",
      "-retry-tests-on-failure",
      "-test-iterations",
      "3",
    ],
  );
  assertEquals(
    args(
      new XcodebuildTestSettings("test-without-building")
        .xctestrun("build/App.xctestrun"),
    ),
    ["test-without-building", "-xctestrun", "build/App.xctestrun"],
  );
  assertThrows(
    () => new XcodebuildTestSettings("test").testIterations(0),
    Error,
    "takes a whole number from 1 up",
  );
});

Deno.test("archive: the archive path is required", () => {
  assertEquals(
    args(
      new XcodebuildArchiveSettings().scheme("App")
        .archivePath("build/App.xcarchive"),
    ),
    ["-scheme", "App", "archive", "-archivePath", "build/App.xcarchive"],
  );
  assertThrows(
    () => args(new XcodebuildArchiveSettings()),
    Error,
    "xcodebuild archive: .archivePath() is required.",
  );
});

Deno.test("exportArchive: three paths, all required", () => {
  assertEquals(
    args(
      new XcodebuildExportArchiveSettings().archivePath("App.xcarchive")
        .exportPath("ipa").exportOptionsPlist("-Export.plist")
        .allowProvisioningUpdates(),
    ),
    [
      "-exportArchive",
      "-archivePath",
      "App.xcarchive",
      "-exportPath",
      "ipa",
      "-exportOptionsPlist",
      "./-Export.plist",
      "-allowProvisioningUpdates",
    ],
  );
  assertThrows(
    () => args(new XcodebuildExportArchiveSettings()),
    Error,
    "xcodebuild -exportArchive: .archivePath(), .exportPath(), " +
      ".exportOptionsPlist() required.",
  );
  assertThrows(
    () => args(new XcodebuildExportArchiveSettings().archivePath("a")),
    Error,
    "xcodebuild -exportArchive: .exportPath(), .exportOptionsPlist() required.",
  );
  assertThrows(
    () =>
      args(
        new XcodebuildExportArchiveSettings().archivePath("a").exportPath("b"),
      ),
    Error,
    "xcodebuild -exportArchive: .exportOptionsPlist() required.",
  );
  assertThrows(
    () => args(new XcodebuildExportArchiveSettings().exportOptionsPlist("c")),
    Error,
    "xcodebuild -exportArchive: .archivePath(), .exportPath() required.",
  );
});

Deno.test("showBuildSettings: with and without -json", () => {
  assertEquals(args(new XcodebuildShowBuildSettings().scheme("App")), [
    "-scheme",
    "App",
    "-showBuildSettings",
  ]);
  assertEquals(args(new XcodebuildShowBuildSettings().json()), [
    "-showBuildSettings",
    "-json",
  ]);
});

Deno.test("XcodebuildTasks: every task reaches execution with its action", async () => {
  const seen: string[][] = [];
  const probe = <S extends { argv(): string[] }>(s: S): S => {
    seen.push(args(s));
    return s;
  };
  const tasks: Array<() => Promise<unknown>> = [
    () => XcodebuildTasks.build((s) => missingTool(probe(s))),
    () => XcodebuildTasks.clean((s) => missingTool(probe(s))),
    () => XcodebuildTasks.analyze((s) => missingTool(probe(s))),
    () => XcodebuildTasks.buildForTesting((s) => missingTool(probe(s))),
    () =>
      XcodebuildTasks.resolvePackageDependencies((s) => missingTool(probe(s))),
    () => XcodebuildTasks.test((s) => missingTool(probe(s))),
    () => XcodebuildTasks.testWithoutBuilding((s) => missingTool(probe(s))),
    () =>
      XcodebuildTasks.archive((s) => missingTool(probe(s.archivePath("a")))),
    () =>
      XcodebuildTasks.exportArchive((s) =>
        missingTool(
          probe(s.archivePath("a").exportPath("b").exportOptionsPlist("c")),
        )
      ),
    () => XcodebuildTasks.showBuildSettings((s) => missingTool(probe(s))),
  ];
  for (const task of tasks) await assertRejects(task, ToolNotFoundError);
  assertEquals(seen, [
    ["build"],
    ["clean"],
    ["analyze"],
    ["build-for-testing"],
    ["-resolvePackageDependencies"],
    ["test"],
    ["test-without-building"],
    ["archive", "-archivePath", "a"],
    [
      "-exportArchive",
      "-archivePath",
      "a",
      "-exportPath",
      "b",
      "-exportOptionsPlist",
      "c",
    ],
    ["-showBuildSettings"],
  ]);
});
