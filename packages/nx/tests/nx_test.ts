import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  NxAffectedSettings,
  NxRunManySettings,
  NxRunSettings,
  NxTasks,
} from "../src/nx.ts";

Deno.test("the default binary is nx", () => {
  assertEquals(new NxRunSettings().target("web:build").argv()[0], "nx");
});

Deno.test("run: requires a target; configuration", () => {
  assertThrows(
    () => new NxRunSettings().argv(),
    Error,
    "NxTasks.run: .target() is required",
  );
  assertEquals(new NxRunSettings().target("web:build").argv().slice(1), [
    "run",
    "web:build",
  ]);
  assertEquals(
    new NxRunSettings().target("web:build").configuration("production").argv()
      .slice(1),
    ["run", "web:build", "--configuration=production"],
  );
});

Deno.test("runMany: requires a target; projects, configuration, parallel, all", () => {
  assertThrows(
    () => new NxRunManySettings().argv(),
    Error,
    "NxTasks.runMany: .target() is required",
  );
  assertEquals(new NxRunManySettings().target("build").argv().slice(1), [
    "run-many",
    "--target=build",
  ]);
  assertEquals(
    new NxRunManySettings()
      .target("build")
      .projects("web", "api")
      .configuration("ci")
      .parallel(3)
      .all()
      .argv()
      .slice(1),
    [
      "run-many",
      "--target=build",
      "--projects=web,api",
      "--configuration=ci",
      "--parallel=3",
      "--all",
    ],
  );
});

Deno.test("affected: requires a target; base, head, configuration, parallel", () => {
  assertThrows(
    () => new NxAffectedSettings().argv(),
    Error,
    "NxTasks.affected: .target() is required",
  );
  assertEquals(
    new NxAffectedSettings()
      .target("test")
      .base("main")
      .head("HEAD")
      .configuration("ci")
      .parallel(2)
      .argv()
      .slice(1),
    [
      "affected",
      "--target=test",
      "--base=main",
      "--head=HEAD",
      "--configuration=ci",
      "--parallel=2",
    ],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-nx-xyz");
};

Deno.test("every NxTasks function reaches execution", async () => {
  await assertRejects(
    () => NxTasks.run((s) => missing(s).target("web:build")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NxTasks.runMany((s) => missing(s).target("build")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NxTasks.affected((s) => missing(s).target("test")),
    ToolNotFoundError,
  );
});
