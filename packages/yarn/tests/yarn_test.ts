// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  YarnAddSettings,
  YarnDlxSettings,
  YarnInstallSettings,
  YarnRemoveSettings,
  YarnRunSettings,
  YarnTasks,
} from "../src/yarn.ts";

Deno.test("the default binary is yarn", () => {
  assertEquals(new YarnInstallSettings().argv()[0], "yarn");
});

Deno.test("install: bare, --immutable (Berry), --frozen-lockfile (Classic)", () => {
  assertEquals(new YarnInstallSettings().argv().slice(1), ["install"]);
  assertEquals(
    new YarnInstallSettings().immutable().frozenLockfile().argv().slice(1),
    ["install", "--immutable", "--frozen-lockfile"],
  );
});

Deno.test("add: packages required; --dev, --exact", () => {
  assertThrows(
    () => new YarnAddSettings().argv(),
    Error,
    "YarnTasks.add: .packages() requires at least one spec",
  );
  assertEquals(
    new YarnAddSettings()
      .dev()
      .exact()
      .packages("typescript@5", "eslint")
      .argv()
      .slice(1),
    ["add", "--dev", "--exact", "typescript@5", "eslint"],
  );
});

Deno.test("remove: names required", () => {
  assertThrows(
    () => new YarnRemoveSettings().argv(),
    Error,
    "YarnTasks.remove: .packages() requires at least one name",
  );
  assertEquals(
    new YarnRemoveSettings().packages("eslint").argv().slice(1),
    ["remove", "eslint"],
  );
});

Deno.test("run: script required; forwarded args", () => {
  assertThrows(
    () => new YarnRunSettings().argv(),
    Error,
    "YarnTasks.run: .script() is required",
  );
  assertEquals(
    new YarnRunSettings().script("build").scriptArgs("--watch", 1).argv().slice(
      1,
    ),
    ["run", "build", "--watch", "1"],
  );
});

Deno.test("dlx: command required; --package and forwarded args", () => {
  assertThrows(
    () => new YarnDlxSettings().argv(),
    Error,
    "YarnTasks.dlx: .command() is required",
  );
  assertEquals(
    new YarnDlxSettings()
      .package("create-react-app")
      .command("create-react-app")
      .execArgs("my-app")
      .argv()
      .slice(1),
    ["dlx", "--package", "create-react-app", "create-react-app", "my-app"],
  );
});

Deno.test("every YarnTasks function reaches execution", async () => {
  await assertRejects(() => YarnTasks.install(missingTool), ToolNotFoundError);
  await assertRejects(
    () => YarnTasks.add((s) => missingTool(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => YarnTasks.remove((s) => missingTool(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => YarnTasks.run((s) => missingTool(s).script("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => YarnTasks.dlx((s) => missingTool(s).command("x")),
    ToolNotFoundError,
  );
});

Deno.test("yarn: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(() => new YarnInstallSettings(), "yarn", {
    resolution: "path",
  });
});
