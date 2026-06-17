import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  KustomizeBuildSettings,
  KustomizeEditSetImageSettings,
  KustomizeTasks,
} from "../src/kustomize.ts";

Deno.test("the default binary is kustomize", () => {
  assertEquals(new KustomizeBuildSettings().argv()[0], "kustomize");
});

Deno.test("build: bare and all options", () => {
  assertEquals(new KustomizeBuildSettings().argv().slice(1), ["build"]);
  assertEquals(
    new KustomizeBuildSettings()
      .dir("overlays/prod")
      .output("out.yaml")
      .enableHelm()
      .loadRestrictor("LoadRestrictionsNone")
      .argv()
      .slice(1),
    [
      "build",
      "overlays/prod",
      "--output",
      "out.yaml",
      "--enable-helm",
      "--load-restrictor",
      "LoadRestrictionsNone",
    ],
  );
});

Deno.test("editSetImage: requires an image; renders name=ref pairs", () => {
  assertThrows(
    () => new KustomizeEditSetImageSettings().argv(),
    Error,
    "KustomizeTasks.editSetImage: at least one .image() is required",
  );
  assertEquals(
    new KustomizeEditSetImageSettings()
      .image("api", "api:1.4")
      .image("web", "web:2")
      .argv()
      .slice(1),
    ["edit", "set", "image", "api=api:1.4", "web=web:2"],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-kustomize-xyz");
};

Deno.test("every KustomizeTasks function reaches execution", async () => {
  await assertRejects(() => KustomizeTasks.build(missing), ToolNotFoundError);
  await assertRejects(
    () => KustomizeTasks.editSetImage((s) => missing(s).image("api", "api:1")),
    ToolNotFoundError,
  );
});
