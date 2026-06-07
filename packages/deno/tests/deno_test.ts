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
  DenoFmtSettings,
  DenoLintSettings,
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
      .exclude("(tests|scripts)/")
      .argv()
      .slice(1),
    [
      "coverage",
      "cov_profile",
      "--lcov",
      "--output=cov.lcov",
      "--exclude=(tests|scripts)/",
    ],
  );
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
    () => DenoTasks.task((s) => missing(s).name("x")),
    ToolNotFoundError,
  );
});
