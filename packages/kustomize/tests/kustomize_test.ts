// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../../tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  KustomizeBuildSettings,
  KustomizeEditSetImageSettings,
  KustomizeTasks,
} from "../src/kustomize.ts";

test("the default binary is kustomize", () => {
  assertEquals(new KustomizeBuildSettings().argv()[0], "kustomize");
});

test("build: bare and all options", () => {
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

test("editSetImage: requires an image; renders name=ref pairs", () => {
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

test("every KustomizeTasks function reaches execution", async () => {
  await assertRejects(
    () => KustomizeTasks.build(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KustomizeTasks.editSetImage((s) => missingTool(s).image("api", "api:1")),
    ToolNotFoundError,
  );
});

test("kustomize: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(
    () => new KustomizeBuildSettings(),
    "kustomize",
    {
      resolution: "path",
    },
  );
});
