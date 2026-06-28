import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  NodeEvalSettings,
  NodeRunSettings,
  NodeStartSettings,
  NodeTasks,
  NodeTestSettings,
} from "../src/node.ts";

Deno.test("the default binary is node", () => {
  assertEquals(new NodeTestSettings().argv(), ["node", "--test"]);
});

Deno.test("run renders every option in order", () => {
  const argv = new NodeRunSettings()
    .requireModule("a.cjs", "b.cjs")
    .importModule("a.mjs", "b.mjs")
    .conditions("development", "browser")
    .envFile(".env")
    .watch()
    .watchPath("src", "lib")
    .enableSourceMaps()
    .inspect()
    .inspectBrk()
    .maxOldSpaceSize(4096)
    .script("server.js")
    .scriptArgs("--port", 3000)
    .argv();
  assertEquals(argv, [
    "node",
    "--require",
    "a.cjs",
    "--require",
    "b.cjs",
    "--import",
    "a.mjs",
    "--import",
    "b.mjs",
    "--conditions",
    "development",
    "--conditions",
    "browser",
    "--env-file=.env",
    "--watch",
    "--watch-path",
    "src",
    "--watch-path",
    "lib",
    "--enable-source-maps",
    "--inspect",
    "--inspect-brk",
    "--max-old-space-size=4096",
    "server.js",
    "--port",
    "3000",
  ]);
});

Deno.test("run with only a script", () => {
  assertEquals(new NodeRunSettings().script("main.js").argv(), [
    "node",
    "main.js",
  ]);
});

Deno.test("run requires a script", () => {
  assertThrows(() => new NodeRunSettings().argv(), Error, ".script()");
});

Deno.test("start defaults to the start script", () => {
  assertEquals(new NodeStartSettings().argv(), ["node", "--run", "start"]);
});

Deno.test("start runs the named package.json script", () => {
  assertEquals(new NodeStartSettings().script("dev").argv(), [
    "node",
    "--run",
    "dev",
  ]);
});

Deno.test("eval renders every option and uses --eval by default", () => {
  const argv = new NodeEvalSettings()
    .requireModule("a.cjs")
    .importModule("a.mjs")
    .code("console.log(1)")
    .argv();
  assertEquals(argv, [
    "node",
    "--require",
    "a.cjs",
    "--import",
    "a.mjs",
    "--eval",
    "console.log(1)",
  ]);
});

Deno.test("eval print uses --print", () => {
  assertEquals(
    new NodeEvalSettings().code("1 + 1").print().argv(),
    ["node", "--print", "1 + 1"],
  );
});

Deno.test("eval requires code", () => {
  assertThrows(() => new NodeEvalSettings().argv(), Error, ".code()");
});

Deno.test("test renders every option in order", () => {
  const argv = new NodeTestSettings()
    .testNamePattern("login")
    .testReporter("tap")
    .testConcurrency(2)
    .only()
    .watch()
    .experimentalTestCoverage()
    .paths("test/", "spec/")
    .argv();
  assertEquals(argv, [
    "node",
    "--test",
    "--test-name-pattern",
    "login",
    "--test-reporter",
    "tap",
    "--test-concurrency",
    "2",
    "--test-only",
    "--watch",
    "--experimental-test-coverage",
    "test/",
    "spec/",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-node-zz");
};

Deno.test("NodeTasks.run reaches execution", async () => {
  await assertRejects(
    () => NodeTasks.run((s) => missing(s).script("main.js")),
    ToolNotFoundError,
  );
});

Deno.test("NodeTasks.start reaches execution", async () => {
  await assertRejects(
    () => NodeTasks.start((s) => missing(s)),
    ToolNotFoundError,
  );
});

Deno.test("NodeTasks.eval reaches execution", async () => {
  await assertRejects(
    () => NodeTasks.eval((s) => missing(s).code("1")),
    ToolNotFoundError,
  );
});

Deno.test("NodeTasks.test reaches execution", async () => {
  await assertRejects(
    () => NodeTasks.test((s) => missing(s)),
    ToolNotFoundError,
  );
});
