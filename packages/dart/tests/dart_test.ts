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
  DartAnalyzeSettings,
  DartCompileSettings,
  type DartCompileTarget,
  DartCreateSettings,
  DartDocSettings,
  DartFixSettings,
  DartFormatSettings,
  DartInfoSettings,
  DartPubDepsSettings,
  DartPubDowngradeSettings,
  DartPubGetSettings,
  DartPubOutdatedSettings,
  DartPubPackagesSettings,
  DartPubPublishSettings,
  DartPubUpgradeSettings,
  DartRunSettings,
  DartTasks,
  DartTestSettings,
  DartVersionSettings,
} from "../mod.ts";

Deno.test("dart resolves its binary from PATH", async () => {
  await assertWrapperConformance(() => new DartAnalyzeSettings(), "dart", {
    resolution: "path",
  });
});

Deno.test("analyze: flags before path operands, dashed paths made safe", () => {
  assertEquals(new DartAnalyzeSettings().argv(), ["dart", "analyze"]);
  assertEquals(
    new DartAnalyzeSettings().path("lib").path("-x").fatalInfos()
      .noFatalWarnings().format("json").packages(".packages").argv(),
    [
      "dart",
      "analyze",
      "--fatal-infos",
      "--no-fatal-warnings",
      "--format",
      "json",
      "--packages",
      ".packages",
      "lib",
      "./-x",
    ],
  );
});

Deno.test("format: every flag renders, then paths; no path means the current directory", () => {
  // Bare `dart format` reads stdin, which in CI is empty and passes vacuously.
  assertEquals(new DartFormatSettings().argv(), ["dart", "format", "."]);
  assertEquals(
    new DartFormatSettings().setExitIfChanged().output("none").argv(),
    ["dart", "format", "--set-exit-if-changed", "--output", "none", "."],
  );
  assertEquals(
    new DartFormatSettings().output("none").setExitIfChanged().lineLength(100)
      .show("all").summary("none").followLinks().languageVersion("3.3")
      .enableExperiment("macros").path("lib").path("-bin").argv(),
    [
      "dart",
      "format",
      "--output",
      "none",
      "--set-exit-if-changed",
      "--line-length",
      "100",
      "--show",
      "all",
      "--summary",
      "none",
      "--follow-links",
      "--language-version",
      "3.3",
      "--enable-experiment",
      "macros",
      "lib",
      "./-bin",
    ],
  );
  assertThrows(
    () => new DartFormatSettings().lineLength(0),
    Error,
    "DartTasks.format: .lineLength() takes a whole number from 1 up",
  );
});

Deno.test("test: every flag renders, then paths", () => {
  assertEquals(
    new DartTestSettings().path("test/a_test.dart").path("--fail-fast")
      .name("^a").plainName("b").tags("fast").excludeTags("slow")
      .preset("ci").runSkipped().failFast().platform("chrome")
      .compiler("dart2js").concurrency(4).timeout("30s")
      .coverage("coverage").reporter("github").fileReporter("json:r.json")
      .randomizeOrderingSeed("random").ignoreTimeouts().noColor().shard(1, 3)
      .argv(),
    [
      "dart",
      "test",
      "--name",
      "^a",
      "--plain-name",
      "b",
      "--tags",
      "fast",
      "--exclude-tags",
      "slow",
      "--preset",
      "ci",
      "--run-skipped",
      "--fail-fast",
      "--platform",
      "chrome",
      "--compiler",
      "dart2js",
      "--concurrency",
      "4",
      "--timeout",
      "30s",
      "--coverage=coverage",
      "--reporter",
      "github",
      "--file-reporter",
      "json:r.json",
      "--test-randomize-ordering-seed",
      "random",
      "--ignore-timeouts",
      "--no-color",
      "--total-shards",
      "3",
      "--shard-index",
      "1",
      "test/a_test.dart",
      "./--fail-fast",
    ],
  );
});

Deno.test("test: concurrency and shard numbers are validated", () => {
  assertThrows(
    () => new DartTestSettings().concurrency(0),
    Error,
    "whole number from 1 up",
  );
  assertThrows(
    () => new DartTestSettings().concurrency(1.5),
    Error,
    "whole number from 1 up",
  );
  assertThrows(
    () => new DartTestSettings().shard(0, 0),
    Error,
    "whole number from 1 up",
  );
  assertThrows(
    () => new DartTestSettings().shard(-1, 2),
    Error,
    "whole number from 0 up",
  );
  assertThrows(
    () => new DartTestSettings().shard(2, 2),
    Error,
    "not below the total",
  );
});

Deno.test("compile: target, flags, VM flags, then the required entry", () => {
  assertEquals(
    new DartCompileSettings("exe").output("build/app").targetOs("linux")
      .saveDebuggingInfo("build/app.sym").depfile("build/app.d")
      .define("ENV", "x=1").enableAsserts().enableExperiment("macros")
      .packages(".packages").verbosity("all").entry("bin/main.dart").argv(),
    [
      "dart",
      "compile",
      "exe",
      "--output",
      "build/app",
      "--target-os",
      "linux",
      "--save-debugging-info",
      "build/app.sym",
      "--depfile",
      "build/app.d",
      "--define=ENV=x=1",
      "--enable-asserts",
      "--enable-experiment=macros",
      "--packages=.packages",
      "--verbosity=all",
      "bin/main.dart",
    ],
  );
  assertEquals(
    new DartCompileSettings("js").optimize(4).entry("-main.dart").argv(),
    ["dart", "compile", "js", "-O4", "./-main.dart"],
  );
  assertEquals(
    new DartCompileSettings("wasm").optimize(0).entry("web/main.dart").argv()
      .slice(3),
    ["-O0", "web/main.dart"],
  );
  assertThrows(
    () => new DartCompileSettings("aot-snapshot").argv(),
    Error,
    "DartTasks.compileAotSnapshot: .entry() is required.",
  );
  assertThrows(
    () => new DartCompileSettings("js").optimize(5),
    Error,
    "DartTasks.compileJs: .optimize() takes a level from 0 to 4, not 5.",
  );
  assertThrows(
    () => new DartCompileSettings("wasm").optimize(-1),
    Error,
    "DartTasks.compileWasm: .optimize() takes a whole number from 0 up",
  );
});

Deno.test("compile: a setter the target's grammar lacks is refused", () => {
  // One rejected setter per target, from the SDK's own option tables.
  const rejected: Array<[DartCompileTarget, (s: DartCompileSettings) => void]> =
    [
      ["exe", (s) => s.optimize(2)],
      ["aot-snapshot", (s) => s.optimize(2)],
      ["jit-snapshot", (s) => s.targetOs("linux")],
      ["kernel", (s) => s.enableAsserts()],
      ["js", (s) => s.depfile("a.d")],
      ["wasm", (s) => s.verbosity("all")],
    ];
  for (const [target, apply] of rejected) {
    assertThrows(
      () => apply(new DartCompileSettings(target)),
      Error,
      `DartTasks.${TASK_NAME[target]}: .`,
    );
  }
  assertThrows(
    () => new DartCompileSettings("kernel").saveDebuggingInfo("x"),
    Error,
    "DartTasks.compileKernel: .saveDebuggingInfo() is not accepted by dart compile kernel.",
  );
  // The same setters are accepted where the grammar has them.
  assertEquals(
    new DartCompileSettings("kernel").depfile("a.d").verbosity("info")
      .entry("a.dart").argv().slice(3),
    ["--depfile", "a.d", "--verbosity=info", "a.dart"],
  );
  assertEquals(
    new DartCompileSettings("wasm").enableAsserts().depfile("a.d")
      .entry("a.dart").argv().slice(3),
    ["--depfile", "a.d", "--enable-asserts", "a.dart"],
  );
  assertEquals(
    new DartCompileSettings("js").enableAsserts().verbosity("error")
      .enableExperiment("x").packages("p").entry("a.dart").argv().slice(3),
    [
      "--enable-asserts",
      "--verbosity=error",
      "--enable-experiment=x",
      "--packages=p",
      "a.dart",
    ],
  );
});

/** Each target's task name, as the error messages spell it. */
const TASK_NAME: Record<DartCompileTarget, string> = {
  exe: "compileExe",
  "aot-snapshot": "compileAotSnapshot",
  "jit-snapshot": "compileJitSnapshot",
  kernel: "compileKernel",
  js: "compileJs",
  wasm: "compileWasm",
};

Deno.test("run: VM flags, then the entry; .args() lands after it", () => {
  assertEquals(new DartRunSettings().argv(), ["dart", "run"]);
  // --observe and --enable-vm-service take a value, so it is attached with
  // `=`: a bare flag would consume the entry point as its value.
  assertEquals(
    new DartRunSettings().observe().enableVmService("9000").define("A", "1")
      .enableAsserts().enableExperiment("macros").packages(".packages")
      .verbosity("error").entry("build_runner").args("build", "-d").argv(),
    [
      "dart",
      "run",
      "--observe=8181/localhost",
      "--enable-vm-service=9000",
      "--define=A=1",
      "--enable-asserts",
      "--enable-experiment=macros",
      "--packages=.packages",
      "--verbosity=error",
      "build_runner",
      "build",
      "-d",
    ],
  );
  assertEquals(new DartRunSettings().entry("-x.dart").argv(), [
    "dart",
    "run",
    "./-x.dart",
  ]);
});

Deno.test("pub: get, upgrade, downgrade, outdated, deps, publish", () => {
  assertEquals(new DartPubGetSettings().argv(), ["dart", "pub", "get"]);
  assertEquals(
    new DartPubGetSettings().offline().enforceLockfile().dryRun()
      .noPrecompile().argv(),
    [
      "dart",
      "pub",
      "get",
      "--offline",
      "--enforce-lockfile",
      "--dry-run",
      "--no-precompile",
    ],
  );
  assertEquals(new DartPubUpgradeSettings().argv(), [
    "dart",
    "pub",
    "upgrade",
  ]);
  assertEquals(
    new DartPubUpgradeSettings().package("http").offline().dryRun()
      .majorVersions().tighten().unlockTransitive().argv(),
    [
      "dart",
      "pub",
      "upgrade",
      "--offline",
      "--dry-run",
      "--major-versions",
      "--tighten",
      "--unlock-transitive",
      "http",
    ],
  );
  assertEquals(
    new DartPubDowngradeSettings().package("http").offline().dryRun().tighten()
      .argv(),
    [
      "dart",
      "pub",
      "downgrade",
      "--offline",
      "--dry-run",
      "--tighten",
      "http",
    ],
  );
  assertEquals(
    new DartPubOutdatedSettings().json().showAll().noDevDependencies()
      .noTransitive().prereleases().argv(),
    [
      "dart",
      "pub",
      "outdated",
      "--json",
      "--show-all",
      "--no-dev-dependencies",
      "--no-transitive",
      "--prereleases",
    ],
  );
  assertEquals(
    new DartPubDepsSettings().style("list").noDev().executables().json().argv(),
    [
      "dart",
      "pub",
      "deps",
      "--style",
      "list",
      "--no-dev",
      "--executables",
      "--json",
    ],
  );
  assertEquals(
    new DartPubPublishSettings().dryRun().force().skipValidation().argv(),
    ["dart", "pub", "publish", "--dry-run", "--force", "--skip-validation"],
  );
});

Deno.test("pub: add and remove need a package and refuse dashed names", () => {
  assertEquals(
    new DartPubPackagesSettings("add").offline().dryRun().package("http:^1.2.0")
      .package("dev:mocktail").argv(),
    [
      "dart",
      "pub",
      "add",
      "--offline",
      "--dry-run",
      "http:^1.2.0",
      "dev:mocktail",
    ],
  );
  assertThrows(
    () => new DartPubPackagesSettings("remove").argv(),
    Error,
    "DartTasks.pubRemove: at least one .package() is required.",
  );
  assertThrows(
    () => new DartPubPackagesSettings("add").package("--offline"),
    Error,
    "DartTasks.pubAdd:",
  );
  assertThrows(
    () => new DartPubUpgradeSettings().package("-h"),
    Error,
    "DartTasks.pubUpgrade:",
  );
  assertThrows(
    () => new DartPubDowngradeSettings().package("-h"),
    Error,
    "DartTasks.pubDowngrade:",
  );
});

Deno.test("create, doc and fix: flags, then the directory", () => {
  assertEquals(
    new DartCreateSettings().template("cli").noPub().force().dir("-app").argv(),
    ["dart", "create", "--template", "cli", "--no-pub", "--force", "./-app"],
  );
  assertThrows(
    () => new DartCreateSettings().argv(),
    Error,
    "DartTasks.create: .dir() is required.",
  );
  assertEquals(new DartDocSettings().argv(), ["dart", "doc"]);
  assertEquals(
    new DartDocSettings().output("public/api").validateLinks().dryRun()
      .dir("packages/x").argv(),
    [
      "dart",
      "doc",
      "--output",
      "public/api",
      "--validate-links",
      "--dry-run",
      "packages/x",
    ],
  );
  assertEquals(new DartFixSettings().argv(), ["dart", "fix"]);
  assertEquals(
    new DartFixSettings().apply().dryRun().code("unnecessary_new").dir("lib")
      .argv(),
    ["dart", "fix", "--apply", "--dry-run", "--code", "unnecessary_new", "lib"],
  );
});

Deno.test("info and version", () => {
  assertEquals(new DartInfoSettings().argv(), ["dart", "info"]);
  assertEquals(new DartInfoSettings().noRemoveFilePaths().argv(), [
    "dart",
    "info",
    "--no-remove-file-paths",
  ]);
  assertEquals(new DartVersionSettings().argv(), ["dart", "--version"]);
});

Deno.test("DartTasks: every task reaches execution with its subcommand", async () => {
  const seen: string[][] = [];
  // Records the argv each task built, then points it at a binary that cannot exist.
  const probe = <S extends { argv(): string[] }>(s: S): S => {
    seen.push(s.argv().slice(1));
    return s;
  };
  const tasks: Array<() => Promise<unknown>> = [
    () => DartTasks.analyze((s) => missingTool(probe(s))),
    () => DartTasks.format((s) => missingTool(probe(s))),
    () => DartTasks.fix((s) => missingTool(probe(s))),
    () => DartTasks.test((s) => missingTool(probe(s))),
    () => DartTasks.run((s) => missingTool(probe(s))),
    () => DartTasks.compileExe((s) => missingTool(probe(s.entry("a.dart")))),
    () =>
      DartTasks.compileAotSnapshot((s) =>
        missingTool(probe(s.entry("a.dart")))
      ),
    () =>
      DartTasks.compileJitSnapshot((s) =>
        missingTool(probe(s.entry("a.dart")))
      ),
    () => DartTasks.compileKernel((s) => missingTool(probe(s.entry("a.dart")))),
    () => DartTasks.compileJs((s) => missingTool(probe(s.entry("a.dart")))),
    () => DartTasks.compileWasm((s) => missingTool(probe(s.entry("a.dart")))),
    () => DartTasks.doc((s) => missingTool(probe(s))),
    () => DartTasks.create((s) => missingTool(probe(s.dir("app")))),
    () => DartTasks.pubGet((s) => missingTool(probe(s))),
    () => DartTasks.pubUpgrade((s) => missingTool(probe(s))),
    () => DartTasks.pubDowngrade((s) => missingTool(probe(s))),
    () => DartTasks.pubOutdated((s) => missingTool(probe(s))),
    () => DartTasks.pubDeps((s) => missingTool(probe(s))),
    () => DartTasks.pubAdd((s) => missingTool(probe(s.package("http")))),
    () => DartTasks.pubRemove((s) => missingTool(probe(s.package("http")))),
    () => DartTasks.pubPublish((s) => missingTool(probe(s))),
    () => DartTasks.info((s) => missingTool(probe(s))),
    () => DartTasks.version((s) => missingTool(probe(s))),
  ];
  for (const task of tasks) await assertRejects(task, ToolNotFoundError);
  assertEquals(seen, [
    ["analyze"],
    ["format", "."],
    ["fix"],
    ["test"],
    ["run"],
    ["compile", "exe", "a.dart"],
    ["compile", "aot-snapshot", "a.dart"],
    ["compile", "jit-snapshot", "a.dart"],
    ["compile", "kernel", "a.dart"],
    ["compile", "js", "a.dart"],
    ["compile", "wasm", "a.dart"],
    ["doc"],
    ["create", "app"],
    ["pub", "get"],
    ["pub", "upgrade"],
    ["pub", "downgrade"],
    ["pub", "outdated"],
    ["pub", "deps"],
    ["pub", "add", "http"],
    ["pub", "remove", "http"],
    ["pub", "publish"],
    ["info"],
    ["--version"],
  ]);
});
