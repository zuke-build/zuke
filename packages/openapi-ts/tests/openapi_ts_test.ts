import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  OpenapiTsGenerateSettings,
  OpenapiTsTasks,
} from "../src/openapi_ts.ts";

Deno.test("the default binary is openapi-ts", () => {
  assertEquals(new OpenapiTsGenerateSettings().argv(), ["openapi-ts"]);
});

Deno.test("generate: every option renders", () => {
  const argv = new OpenapiTsGenerateSettings()
    .input("openapi.yaml").output("src/client").client("@hey-api/client-fetch")
    .file("openapi-ts.config.ts").dryRun().watch().silent().argv();
  assertEquals(argv, [
    "openapi-ts",
    "--input",
    "openapi.yaml",
    "--output",
    "src/client",
    "--client",
    "@hey-api/client-fetch",
    "--file",
    "openapi-ts.config.ts",
    "--dry-run",
    "--watch",
    "--silent",
  ]);
});

Deno.test("generate: minimal input and output", () => {
  const argv = new OpenapiTsGenerateSettings()
    .input("openapi.yaml").output("src/client").argv();
  assertEquals(argv, [
    "openapi-ts",
    "--input",
    "openapi.yaml",
    "--output",
    "src/client",
  ]);
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zz-no-such-openapi-ts-zz");
};

Deno.test("OpenapiTsTasks.generate reaches execution", async () => {
  await assertRejects(
    () => OpenapiTsTasks.generate(missing),
    ToolNotFoundError,
  );
});

Deno.test("openapi-ts: resolves its binary from node_modules by default", () => {
  const prevRes = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const bin = `${binDir}/openapi-ts`;
    Deno.writeTextFileSync(bin, "#!/bin/sh\n");
    const s = new OpenapiTsGenerateSettings();
    s.os_ = "linux";
    assertEquals(s.cwd(root).resolvedArgv()[0], bin.replace(/\\/g, "/"));
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (prevRes === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", prevRes);
  }
});
