import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
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

Deno.test("vite: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new ViteDevSettings(), "vite", {
    resolution: "node_modules",
  });
});

Deno.test("every ViteTasks function reaches execution", async () => {
  await assertRejects(() => ViteTasks.dev(missingTool), ToolNotFoundError);
  await assertRejects(() => ViteTasks.build(missingTool), ToolNotFoundError);
  await assertRejects(() => ViteTasks.preview(missingTool), ToolNotFoundError);
});
