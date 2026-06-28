import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  TsdownBuildSettings,
  TsdownMigrateSettings,
  TsdownTasks,
} from "../src/tsdown.ts";

Deno.test("the default binary is tsdown (build)", () => {
  assertEquals(new TsdownBuildSettings().argv(), ["tsdown"]);
});

Deno.test("the default binary is tsdown (migrate)", () => {
  assertEquals(new TsdownMigrateSettings().argv(), ["tsdown", "migrate"]);
});

Deno.test("build: every option renders", () => {
  assertEquals(
    new TsdownBuildSettings()
      .entry("src/index.ts", "src/cli.ts")
      .format("esm", "cjs")
      .dts()
      .minify()
      .sourcemap()
      .clean()
      .watch()
      .outDir("dist")
      .target("es2022")
      .tsconfig("tsconfig.build.json")
      .config("tsdown.config.ts")
      .platform("node")
      .treeshake()
      .argv()
      .slice(1),
    [
      "src/index.ts",
      "src/cli.ts",
      "--format",
      "esm,cjs",
      "--dts",
      "--minify",
      "--sourcemap",
      "--clean",
      "--watch",
      "--out-dir",
      "dist",
      "--target",
      "es2022",
      "--tsconfig",
      "tsconfig.build.json",
      "--config",
      "tsdown.config.ts",
      "--platform",
      "node",
      "--treeshake",
    ],
  );
});

Deno.test("build: entry-only is minimal argv", () => {
  assertEquals(
    new TsdownBuildSettings().entry("src/index.ts").argv().slice(1),
    ["src/index.ts"],
  );
});

Deno.test("migrate: every option renders", () => {
  assertEquals(
    new TsdownMigrateSettings()
      .from("tsup")
      .dryRun()
      .argv()
      .slice(1),
    ["migrate", "--from", "tsup", "--dry-run"],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-tsdown-zz");
};

Deno.test("TsdownTasks.build reaches execution", async () => {
  await assertRejects(() => TsdownTasks.build(missing), ToolNotFoundError);
});

Deno.test("TsdownTasks.migrate reaches execution", async () => {
  await assertRejects(() => TsdownTasks.migrate(missing), ToolNotFoundError);
});
