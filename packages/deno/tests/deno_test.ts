import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  DenoCacheSettings,
  DenoCheckSettings,
  DenoCoverageSettings,
  DenoDocSettings,
  DenoFmtSettings,
  DenoInstallSettings,
  DenoLintSettings,
  DenoPublishSettings,
  DenoRunSettings,
  DenoTasks,
  DenoTaskSettings,
  DenoTestSettings,
} from "../src/deno.ts";

Deno.test("run: script, permissions, config, reload, script args", () => {
  const argv = new DenoRunSettings()
    .allowAll()
    .config("deno.json")
    .reload()
    .script("main.ts")
    .scriptArgs("--port", 8080)
    .argv()
    .slice(1);
  assertEquals(argv, [
    "run",
    "--allow-all",
    "--config",
    "deno.json",
    "--reload",
    "main.ts",
    "--port",
    "8080",
  ]);
});

Deno.test("run: scoped permissions render as --allow-<perm>=<values>", () => {
  const argv = new DenoRunSettings()
    .allow("read", "a.txt", "b.txt")
    .allow("net")
    .script("main.ts")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "run",
    "--allow-read=a.txt,b.txt",
    "--allow-net",
    "main.ts",
  ]);
});

Deno.test("run: .script() is required", () => {
  assertThrows(
    () => new DenoRunSettings().argv(),
    Error,
    "DenoTasks.run: .script() is required",
  );
});

Deno.test("test: coverage, filter, parallel, fail-fast, paths", () => {
  const argv = new DenoTestSettings()
    .allowAll()
    .coverage("cov_profile")
    .filter("graph")
    .parallel()
    .failFast()
    .paths("tests/a_test.ts", "tests/b_test.ts")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "test",
    "--allow-all",
    "--coverage=cov_profile",
    "--filter",
    "graph",
    "--parallel",
    "--fail-fast",
    "tests/a_test.ts",
    "tests/b_test.ts",
  ]);
});

Deno.test("test: bare invocation is just `test`", () => {
  assertEquals(new DenoTestSettings().argv().slice(1), ["test"]);
});

Deno.test("check: paths are required", () => {
  assertThrows(
    () => new DenoCheckSettings().argv(),
    Error,
    "DenoTasks.check: at least one path is required",
  );
  assertEquals(new DenoCheckSettings().paths("mod.ts").argv().slice(1), [
    "check",
    "mod.ts",
  ]);
});

Deno.test("fmt: optional --check and paths", () => {
  assertEquals(new DenoFmtSettings().argv().slice(1), ["fmt"]);
  assertEquals(
    new DenoFmtSettings().check().paths("src/").argv().slice(1),
    ["fmt", "--check", "src/"],
  );
});

Deno.test("lint: optional --fix and paths", () => {
  assertEquals(new DenoLintSettings().argv().slice(1), ["lint"]);
  assertEquals(
    new DenoLintSettings().fix().paths("src/").argv().slice(1),
    ["lint", "--fix", "src/"],
  );
});

Deno.test("doc: bare invocation is just `doc`", () => {
  assertEquals(new DenoDocSettings().argv().slice(1), ["doc"]);
});

Deno.test("doc: flags precede the source paths", () => {
  assertEquals(
    new DenoDocSettings()
      .json()
      .private()
      .filter("MyClass.method")
      .paths("mod.ts", "src/extra.ts")
      .argv()
      .slice(1),
    [
      "doc",
      "--json",
      "--private",
      "--filter",
      "MyClass.method",
      "mod.ts",
      "src/extra.ts",
    ],
  );
});

Deno.test("doc: HTML output options", () => {
  assertEquals(
    new DenoDocSettings()
      .html()
      .name("My Lib")
      .output("docs/")
      .lint()
      .paths("mod.ts")
      .argv()
      .slice(1),
    [
      "doc",
      "--html",
      "--name",
      "My Lib",
      "--output",
      "docs/",
      "--lint",
      "mod.ts",
    ],
  );
});

Deno.test("cache: paths required, optional --reload", () => {
  assertThrows(
    () => new DenoCacheSettings().argv(),
    Error,
    "DenoTasks.cache: at least one path is required",
  );
  assertEquals(
    new DenoCacheSettings().reload().paths("mod.ts").argv().slice(1),
    ["cache", "--reload", "mod.ts"],
  );
});

Deno.test("coverage: dir, --lcov, --output, --exclude", () => {
  assertEquals(
    new DenoCoverageSettings()
      .dir("cov_profile")
      .lcov()
      .output("cov.lcov")
      .exclude("tests/")
      .argv()
      .slice(1),
    [
      "coverage",
      "cov_profile",
      "--lcov",
      "--output=cov.lcov",
      "--exclude=tests/",
    ],
  );
});

Deno.test("coverage: a threshold forces --lcov and stays off the argv", () => {
  const s = new DenoCoverageSettings().dir("cov_profile").threshold(95);
  // The threshold is enforced by the task, not a `deno coverage` flag.
  assertEquals(s.argv().slice(1), ["coverage", "cov_profile", "--lcov"]);
  assertEquals(s.thresholds, {
    lines: 95,
    branches: 95,
    perFile: undefined,
  });
});

Deno.test("coverage: line and branch thresholds can differ", () => {
  const s = new DenoCoverageSettings().linesThreshold(90).branchesThreshold(80);
  assertEquals(s.thresholds, { lines: 90, branches: 80, perFile: undefined });
  assertEquals(s.outputPath, undefined);
  assertEquals(s.argv().slice(1), ["coverage", "--lcov"]);
});

Deno.test("coverage: a per-file floor alone forces --lcov and is exposed", () => {
  const s = new DenoCoverageSettings().perFileThreshold(50);
  assertEquals(s.thresholds, {
    lines: undefined,
    branches: undefined,
    perFile: 50,
  });
  // A per-file floor still needs an lcov report to parse, so --lcov is forced.
  assertEquals(s.argv().slice(1), ["coverage", "--lcov"]);
});

Deno.test("task: name required, then task args", () => {
  assertThrows(
    () => new DenoTaskSettings().argv(),
    Error,
    "DenoTasks.task: .name() is required",
  );
  assertEquals(
    new DenoTaskSettings().name("test").taskArgs("--quiet").argv().slice(1),
    ["task", "test", "--quiet"],
  );
});

Deno.test("the default binary is the running deno executable", () => {
  assertEquals(new DenoTestSettings().argv()[0], Deno.execPath());
});

Deno.test("DenoTasks.run executes a script for real", async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/hello.ts`;
  try {
    await Deno.writeTextFile(file, "console.log('zuke-deno-ok');\n");
    const out = await DenoTasks.run((s) => s.script(file).quiet());
    assertEquals(out.code, 0);
    assertEquals(out.stdout.includes("zuke-deno-ok"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("DenoTasks.check executes against a real file", async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/ok.ts`;
  try {
    await Deno.writeTextFile(file, "export const n: number = 1;\n");
    const out = await DenoTasks.check((s) => s.paths(file).quiet());
    assertEquals(out.code, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("install: global executable from an npm module, with perms", () => {
  const argv = new DenoInstallSettings()
    .global()
    .force()
    .root(".zuke/tools")
    .name("cspell")
    .allow("read")
    .allow("env")
    .allow("sys")
    .module("npm:cspell@9")
    .moduleArgs("--version")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "install",
    "--allow-read",
    "--allow-env",
    "--allow-sys",
    "--global",
    "--force",
    "--root",
    ".zuke/tools",
    "--name",
    "cspell",
    "npm:cspell@9",
    "--version",
  ]);
});

Deno.test("install: bare run is just the subcommand", () => {
  assertEquals(new DenoInstallSettings().argv().slice(1), ["install"]);
});

Deno.test("publish: bare and all options", () => {
  assertEquals(new DenoPublishSettings().argv().slice(1), ["publish"]);
  assertEquals(
    new DenoPublishSettings()
      .allowDirty()
      .allowSlowTypes()
      .noCheck()
      .dryRun()
      .config("deno.json")
      .token("xyz")
      .argv()
      .slice(1),
    [
      "publish",
      "--allow-dirty",
      "--allow-slow-types",
      "--no-check",
      "--dry-run",
      "--config",
      "deno.json",
      "--token",
      "xyz",
    ],
  );
});

/**
 * Point a settings object at a guaranteed-missing binary with the shim
 * fallback disabled, so the task function reaches execution without running
 * anything real. Keeps the remaining DenoTasks functions covered, hermetic.
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-tool-xyz");
};

Deno.test("every remaining DenoTasks function reaches execution", async () => {
  await assertRejects(() => DenoTasks.test(missing), ToolNotFoundError);
  await assertRejects(() => DenoTasks.fmt(missing), ToolNotFoundError);
  await assertRejects(() => DenoTasks.lint(missing), ToolNotFoundError);
  await assertRejects(
    () => DenoTasks.cache((s) => missing(s).paths("x.ts")),
    ToolNotFoundError,
  );
  await assertRejects(() => DenoTasks.coverage(missing), ToolNotFoundError);
  await assertRejects(
    () => DenoTasks.install((s) => missing(s).module("npm:x")),
    ToolNotFoundError,
  );
  await assertRejects(() => DenoTasks.publish(missing), ToolNotFoundError);
  await assertRejects(
    () => DenoTasks.task((s) => missing(s).name("x")),
    ToolNotFoundError,
  );
});
