import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  NestBuildSettings,
  NestGenerateSettings,
  NestInfoSettings,
  NestNewSettings,
  NestStartSettings,
  NestTasks,
} from "../src/nest.ts";

Deno.test("the default binary is nest and the subcommand follows", () => {
  assertEquals(new NestInfoSettings().argv(), ["nest", "info"]);
});

Deno.test("nest: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/nest`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new NestInfoSettings();
    s.os_ = "linux";
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});

Deno.test("new renders every option and requires a name", () => {
  assertEquals(new NestNewSettings().name("my-app").argv(), [
    "nest",
    "new",
    "my-app",
  ]);
  assertEquals(
    new NestNewSettings()
      .name("my-app")
      .directory("apps/api")
      .skipInstall()
      .skipGit()
      .strict()
      .dryRun()
      .packageManager("pnpm")
      .language("ts")
      .argv(),
    [
      "nest",
      "new",
      "my-app",
      "--directory",
      "apps/api",
      "--skip-install",
      "--skip-git",
      "--strict",
      "--dry-run",
      "--package-manager",
      "pnpm",
      "--language",
      "ts",
    ],
  );
  assertThrows(() => new NestNewSettings().argv(), Error, ".name()");
});

Deno.test("generate renders every option and requires a schematic", () => {
  assertEquals(new NestGenerateSettings().schematic("module").argv(), [
    "nest",
    "generate",
    "module",
  ]);
  assertEquals(
    new NestGenerateSettings()
      .schematic("service")
      .name("users")
      .project("api")
      .collection("@nestjs/schematics")
      .flat()
      .spec()
      .noSpec()
      .skipImport()
      .dryRun()
      .argv(),
    [
      "nest",
      "generate",
      "service",
      "users",
      "--project",
      "api",
      "--collection",
      "@nestjs/schematics",
      "--flat",
      "--spec",
      "--no-spec",
      "--skip-import",
      "--dry-run",
    ],
  );
  assertThrows(
    () => new NestGenerateSettings().argv(),
    Error,
    ".schematic()",
  );
});

Deno.test("build renders every option with the app positional last", () => {
  assertEquals(new NestBuildSettings().argv(), ["nest", "build"]);
  assertEquals(
    new NestBuildSettings()
      .config("nest-cli.json")
      .path("tsconfig.build.json")
      .watch()
      .webpack()
      .tsc()
      .builder("swc")
      .preserveWatchOutput()
      .app("api")
      .argv(),
    [
      "nest",
      "build",
      "--config",
      "nest-cli.json",
      "--path",
      "tsconfig.build.json",
      "--watch",
      "--webpack",
      "--tsc",
      "--builder",
      "swc",
      "--preserveWatchOutput",
      "api",
    ],
  );
});

Deno.test("start renders every option with the app positional last", () => {
  assertEquals(new NestStartSettings().argv(), ["nest", "start"]);
  assertEquals(
    new NestStartSettings()
      .config("nest-cli.json")
      .path("tsconfig.build.json")
      .watch()
      .debug()
      .preserveWatchOutput()
      .exec("node")
      .builder("swc")
      .app("api")
      .argv(),
    [
      "nest",
      "start",
      "--config",
      "nest-cli.json",
      "--path",
      "tsconfig.build.json",
      "--watch",
      "--debug",
      "--preserveWatchOutput",
      "--exec",
      "node",
      "--builder",
      "swc",
      "api",
    ],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-nest-zz");
};

Deno.test("NestTasks.new reaches execution", async () => {
  await assertRejects(
    () => NestTasks.new((s) => missing(s.name("my-app"))),
    ToolNotFoundError,
  );
});

Deno.test("NestTasks.generate reaches execution", async () => {
  await assertRejects(
    () => NestTasks.generate((s) => missing(s.schematic("module"))),
    ToolNotFoundError,
  );
});

Deno.test("NestTasks.build reaches execution", async () => {
  await assertRejects(() => NestTasks.build(missing), ToolNotFoundError);
});

Deno.test("NestTasks.start reaches execution", async () => {
  await assertRejects(() => NestTasks.start(missing), ToolNotFoundError);
});

Deno.test("NestTasks.info reaches execution", async () => {
  await assertRejects(() => NestTasks.info(missing), ToolNotFoundError);
});
