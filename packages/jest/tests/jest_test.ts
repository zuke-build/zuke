import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { JestSettings, JestTasks } from "../src/jest.ts";

Deno.test("the default binary is jest", () => {
  assertEquals(new JestSettings().argv(), ["jest"]);
});

Deno.test("jest: every option renders, patterns last", () => {
  const argv = new JestSettings()
    .config("jest.config.js").coverage().watch().watchAll().ci().runInBand()
    .maxWorkers("50%").updateSnapshot().bail(2).verbose().silent()
    .testNamePattern("renders").onlyChanged().passWithNoTests()
    .detectOpenHandles().selectProjects("web", "api")
    .reporters("default", "jest-junit").paths("src/", "test/").argv();
  assertEquals(argv, [
    "jest",
    "-c",
    "jest.config.js",
    "--coverage",
    "--watch",
    "--watchAll",
    "--ci",
    "-i",
    "--maxWorkers",
    "50%",
    "-u",
    "--bail",
    "2",
    "--verbose",
    "--silent",
    "-t",
    "renders",
    "-o",
    "--passWithNoTests",
    "--detectOpenHandles",
    "--selectProjects=web",
    "--selectProjects=api",
    "--reporters=default",
    "--reporters=jest-junit",
    "src/",
    "test/",
  ]);
});

Deno.test("jest: array flags use = form so positional patterns survive", () => {
  // Space-separated array flags let jest's yargs parser greedily swallow the
  // trailing `src/` into --reporters; the `=` form binds one value per flag so
  // the positional test-path pattern survives.
  assertEquals(
    new JestSettings().reporters("default", "jest-junit").paths("src/").argv(),
    ["jest", "--reporters=default", "--reporters=jest-junit", "src/"],
  );
  assertEquals(
    new JestSettings().selectProjects("web", "api").paths("test/").argv(),
    ["jest", "--selectProjects=web", "--selectProjects=api", "test/"],
  );
});

Deno.test("jest: bail defaults to one suite", () => {
  assertEquals(new JestSettings().bail().argv(), ["jest", "--bail", "1"]);
});

Deno.test("jest: minimal invocation is bare", () => {
  assertEquals(new JestSettings().argv(), ["jest"]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-jest-zz");
};

Deno.test("JestTasks.run reaches execution", async () => {
  await assertRejects(() => JestTasks.run(missing), ToolNotFoundError);
});
