import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  ViteBuildSettings,
  ViteDevSettings,
  VitePreviewSettings,
  ViteTasks,
} from "../src/vite.ts";

Deno.test("the default binary is vite", () => {
  assertEquals(new ViteDevSettings().argv()[0], "vite");
});

Deno.test("dev: bare and all options (shared config/mode + host/port/open)", () => {
  assertEquals(new ViteDevSettings().argv().slice(1), ["dev"]);
  assertEquals(
    new ViteDevSettings()
      .config("vite.config.ts")
      .mode("development")
      .host("0.0.0.0")
      .port(5173)
      .open()
      .argv()
      .slice(1),
    [
      "dev",
      "--config",
      "vite.config.ts",
      "--mode",
      "development",
      "--host",
      "0.0.0.0",
      "--port",
      "5173",
      "--open",
    ],
  );
});

Deno.test("build: bare and all options", () => {
  assertEquals(new ViteBuildSettings().argv().slice(1), ["build"]);
  assertEquals(
    new ViteBuildSettings()
      .mode("production")
      .base("/app/")
      .outDir("dist")
      .emptyOutDir()
      .sourcemap()
      .root("packages/web")
      .argv()
      .slice(1),
    [
      "build",
      "--mode",
      "production",
      "--base",
      "/app/",
      "--outDir",
      "dist",
      "--emptyOutDir",
      "--sourcemap",
      "packages/web",
    ],
  );
});

Deno.test("preview: bare and all options", () => {
  assertEquals(new VitePreviewSettings().argv().slice(1), ["preview"]);
  assertEquals(
    new VitePreviewSettings().host("localhost").port(4173).open().argv().slice(
      1,
    ),
    ["preview", "--host", "localhost", "--port", "4173", "--open"],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-vite-xyz");
};

Deno.test("every ViteTasks function reaches execution", async () => {
  await assertRejects(() => ViteTasks.dev(missing), ToolNotFoundError);
  await assertRejects(() => ViteTasks.build(missing), ToolNotFoundError);
  await assertRejects(() => ViteTasks.preview(missing), ToolNotFoundError);
});
