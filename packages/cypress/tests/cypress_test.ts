// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  CypressInfoSettings,
  CypressInstallSettings,
  CypressOpenSettings,
  CypressRunSettings,
  CypressTasks,
  CypressVerifySettings,
} from "../src/cypress.ts";

Deno.test("the default binary is cypress", () => {
  assertEquals(new CypressRunSettings().argv()[0], "cypress");
});

Deno.test("cypress: resolves its binary from node_modules by default", async () => {
  await assertWrapperConformance(() => new CypressRunSettings(), "cypress", {
    resolution: "node_modules",
  });
});

Deno.test("run: bare and all options (shared + run-specific)", () => {
  assertEquals(new CypressRunSettings().argv().slice(1), ["run"]);
  assertEquals(
    new CypressRunSettings()
      .e2e()
      .component()
      .browser("chrome")
      .configFile("cypress.config.ts")
      .project("apps/web")
      .headed()
      .spec("cypress/e2e/**")
      .record()
      .parallel()
      .tag("ci")
      .port(9000)
      .argv()
      .slice(1),
    [
      "run",
      "--e2e",
      "--component",
      "--browser",
      "chrome",
      "--config-file",
      "cypress.config.ts",
      "--project",
      "apps/web",
      "--headed",
      "--spec",
      "cypress/e2e/**",
      "--record",
      "--parallel",
      "--tag",
      "ci",
      "--port",
      "9000",
    ],
  );
});

Deno.test("open: shared options only", () => {
  assertEquals(new CypressOpenSettings().argv().slice(1), ["open"]);
  assertEquals(
    new CypressOpenSettings().component().browser("electron").argv().slice(1),
    ["open", "--component", "--browser", "electron"],
  );
});

Deno.test("install: bare and --force", () => {
  assertEquals(new CypressInstallSettings().argv().slice(1), ["install"]);
  assertEquals(
    new CypressInstallSettings().force().argv().slice(1),
    ["install", "--force"],
  );
});

Deno.test("verify and info are fixed argv", () => {
  assertEquals(new CypressVerifySettings().argv().slice(1), ["verify"]);
  assertEquals(new CypressInfoSettings().argv().slice(1), ["info"]);
});

Deno.test("every CypressTasks function reaches execution", async () => {
  await assertRejects(() => CypressTasks.run(missingTool), ToolNotFoundError);
  await assertRejects(() => CypressTasks.open(missingTool), ToolNotFoundError);
  await assertRejects(
    () => CypressTasks.install(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(
    () => CypressTasks.verify(missingTool),
    ToolNotFoundError,
  );
  await assertRejects(() => CypressTasks.info(missingTool), ToolNotFoundError);
});
