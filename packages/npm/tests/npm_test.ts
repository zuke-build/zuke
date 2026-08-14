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
  NpmCiSettings,
  NpmExecSettings,
  NpmInstallSettings,
  NpmPublishSettings,
  NpmRunSettings,
  NpmTasks,
  NpmVersionSettings,
} from "../src/npm.ts";

Deno.test("the default binary is npm", () => {
  assertEquals(new NpmInstallSettings().argv()[0], "npm");
});

Deno.test("install: bare, packages, --save-dev, --save-exact", () => {
  assertEquals(new NpmInstallSettings().argv().slice(1), ["install"]);
  assertEquals(
    new NpmInstallSettings()
      .saveDev()
      .saveExact()
      .packages("typescript@5", "eslint")
      .argv()
      .slice(1),
    ["install", "--save-dev", "--save-exact", "typescript@5", "eslint"],
  );
});

Deno.test("ci: bare and with --omit flags", () => {
  assertEquals(new NpmCiSettings().argv().slice(1), ["ci"]);
  assertEquals(
    new NpmCiSettings().omit("dev").omit("optional").argv().slice(1),
    ["ci", "--omit=dev", "--omit=optional"],
  );
});

Deno.test("run: script required; workspace, --if-present, forwarded args", () => {
  assertThrows(
    () => new NpmRunSettings().argv(),
    Error,
    "NpmTasks.run: .script() is required",
  );
  assertEquals(
    new NpmRunSettings()
      .script("build")
      .workspace("app")
      .ifPresent()
      .scriptArgs("--watch", 1)
      .argv()
      .slice(1),
    ["run", "--workspace=app", "--if-present", "build", "--", "--watch", "1"],
  );
});

Deno.test("run: no -- separator when there are no script args", () => {
  assertEquals(new NpmRunSettings().script("build").argv().slice(1), [
    "run",
    "build",
  ]);
});

Deno.test("run: --workspaces runs every workspace and composes with --if-present", () => {
  assertEquals(
    new NpmRunSettings().script("build").workspaces().argv().slice(1),
    ["run", "--workspaces", "build"],
  );
  assertEquals(
    new NpmRunSettings().script("test").workspaces().ifPresent().argv().slice(
      1,
    ),
    ["run", "--workspaces", "--if-present", "test"],
  );
});

Deno.test("run: .workspace() and .workspaces() are mutually exclusive", () => {
  assertThrows(
    () =>
      new NpmRunSettings().script("build").workspace("app").workspaces().argv(),
    Error,
    "mutually exclusive",
  );
});

Deno.test("exec: command required; --yes, --package, forwarded args", () => {
  assertThrows(
    () => new NpmExecSettings().argv(),
    Error,
    "NpmTasks.exec: .command() is required",
  );
  assertEquals(
    new NpmExecSettings()
      .yes()
      .package("cowsay@1")
      .command("cowsay")
      .execArgs("hello")
      .argv()
      .slice(1),
    ["exec", "--yes", "--package=cowsay@1", "cowsay", "--", "hello"],
  );
});

Deno.test("publish: tag, access, --dry-run, otp", () => {
  assertEquals(new NpmPublishSettings().argv().slice(1), ["publish"]);
  assertEquals(
    new NpmPublishSettings()
      .tag("next")
      .access("public")
      .dryRun()
      .otp("123456")
      .argv()
      .slice(1),
    [
      "publish",
      "--tag=next",
      "--access=public",
      "--dry-run",
      "--otp=123456",
    ],
  );
});

Deno.test("version: bump required; message and --no-git-tag-version", () => {
  assertThrows(
    () => new NpmVersionSettings().argv(),
    Error,
    "NpmTasks.version: .bump() is required",
  );
  assertEquals(
    new NpmVersionSettings()
      .bump("patch")
      .message("release %s")
      .noGitTagVersion()
      .argv()
      .slice(1),
    ["version", "patch", "--message", "release %s", "--no-git-tag-version"],
  );
});

Deno.test("every NpmTasks function reaches execution", async () => {
  await assertRejects(() => NpmTasks.install(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.ci(missingTool), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.run((s) => missingTool(s).script("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NpmTasks.exec((s) => missingTool(s).command("x")),
    ToolNotFoundError,
  );
  await assertRejects(() => NpmTasks.publish(missingTool), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.version((s) => missingTool(s).bump("patch")),
    ToolNotFoundError,
  );
});

Deno.test("npm: conforms to the wrapper contract", async () => {
  await assertWrapperConformance(() => new NpmInstallSettings(), "npm", {
    resolution: "path",
  });
});
