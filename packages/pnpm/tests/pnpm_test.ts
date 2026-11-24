// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../core/tests/_testing.ts";
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
  PnpmAddSettings,
  PnpmDlxSettings,
  PnpmInstallSettings,
  PnpmPublishSettings,
  PnpmRemoveSettings,
  PnpmRunSettings,
  PnpmTasks,
} from "../src/pnpm.ts";

test("the default binary is pnpm", () => {
  assertEquals(new PnpmInstallSettings().argv()[0], "pnpm");
});

test("install: bare, --frozen-lockfile, --prod", () => {
  assertEquals(new PnpmInstallSettings().argv().slice(1), ["install"]);
  assertEquals(
    new PnpmInstallSettings().frozenLockfile().prod().argv().slice(1),
    ["install", "--frozen-lockfile", "--prod"],
  );
});

test("add: packages required; --save-dev, --save-exact, --global", () => {
  assertThrows(
    () => new PnpmAddSettings().argv(),
    Error,
    "PnpmTasks.add: .packages() requires at least one spec",
  );
  assertEquals(
    new PnpmAddSettings()
      .saveDev()
      .saveExact()
      .global()
      .packages("typescript@5", "eslint")
      .argv()
      .slice(1),
    ["add", "--save-dev", "--save-exact", "--global", "typescript@5", "eslint"],
  );
});

test("remove: names required", () => {
  assertThrows(
    () => new PnpmRemoveSettings().argv(),
    Error,
    "PnpmTasks.remove: .packages() requires at least one name",
  );
  assertEquals(
    new PnpmRemoveSettings().packages("eslint").argv().slice(1),
    ["remove", "eslint"],
  );
});

test("run: script required; --filter, --if-present, forwarded args", () => {
  assertThrows(
    () => new PnpmRunSettings().argv(),
    Error,
    "PnpmTasks.run: .script() is required",
  );
  assertEquals(
    new PnpmRunSettings()
      .script("build")
      .filter("app")
      .ifPresent()
      .scriptArgs("--watch", 1)
      .argv()
      .slice(1),
    ["run", "--filter=app", "--if-present", "build", "--watch", "1"],
  );
});

test("dlx: command required; --package and forwarded args", () => {
  assertThrows(
    () => new PnpmDlxSettings().argv(),
    Error,
    "PnpmTasks.dlx: .command() is required",
  );
  assertEquals(
    new PnpmDlxSettings()
      .package("cowsay@1")
      .command("cowsay")
      .execArgs("hello")
      .argv()
      .slice(1),
    ["dlx", "--package=cowsay@1", "cowsay", "hello"],
  );
});

test("publish: tag, access, --no-git-checks, --dry-run", () => {
  assertEquals(new PnpmPublishSettings().argv().slice(1), ["publish"]);
  assertEquals(
    new PnpmPublishSettings()
      .tag("next")
      .access("public")
      .noGitChecks()
      .dryRun()
      .argv()
      .slice(1),
    [
      "publish",
      "--tag=next",
      "--access=public",
      "--no-git-checks",
      "--dry-run",
    ],
  );
});

test("every PnpmTasks function reaches execution", async () => {
  await assertRejects(() => PnpmTasks.install(missingTool), ToolNotFoundError);
  await assertRejects(
    () => PnpmTasks.add((s) => missingTool(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => PnpmTasks.remove((s) => missingTool(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => PnpmTasks.run((s) => missingTool(s).script("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => PnpmTasks.dlx((s) => missingTool(s).command("x")),
    ToolNotFoundError,
  );
  await assertRejects(() => PnpmTasks.publish(missingTool), ToolNotFoundError);
});

test("pnpm: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(() => new PnpmInstallSettings(), "pnpm", {
    resolution: "path",
  });
});
