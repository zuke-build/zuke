// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `ChocoTasks`: the pure argv each command builds, the operand
 * guard, the masking of an API key, and the wrapper conformance every Zuke
 * tool wrapper proves.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { CommandError, CommandTimeoutError } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  ChocoApikeySettings,
  ChocoInstallSettings,
  ChocoPackSettings,
  ChocoPushSettings,
  ChocoSettings,
  ChocoTasks,
  ChocoUninstallSettings,
} from "../mod.ts";
import { FAKE_CHOCO_UNSUPPORTED, fakeChoco } from "./_fake_choco.ts";

Deno.test("choco pack: the nuspec, then the options as --name=value", () => {
  assertEquals(new ChocoPackSettings().argv(), ["choco", "pack"]);
  assertEquals(
    new ChocoPackSettings().nuspec("app.nuspec").version("1.2.3")
      .outputDirectory("dist").argv(),
    [
      "choco",
      "pack",
      "app.nuspec",
      "--version=1.2.3",
      "--output-directory=dist",
    ],
  );
});

Deno.test("choco push: the package, the source and the key", () => {
  assertEquals(new ChocoPushSettings().argv(), ["choco", "push"]);
  assertEquals(
    new ChocoPushSettings().nupkg("app.1.2.3.nupkg")
      .source("https://push.chocolatey.org/").apiKey("k-123").argv(),
    [
      "choco",
      "push",
      "app.1.2.3.nupkg",
      "--source=https://push.chocolatey.org/",
      "--api-key=k-123",
    ],
  );
});

Deno.test("choco install and uninstall: ids, options, then the common switches", () => {
  assertEquals(
    new ChocoInstallSettings().packages("app").argv(),
    ["choco", "install", "app"],
  );
  assertEquals(
    new ChocoInstallSettings().packages("app", "other").source("C:\\pkgs")
      .version("1.2.3").prerelease().yes().force().noProgress().limitOutput()
      .verbose().argv(),
    [
      "choco",
      "install",
      "app",
      "other",
      "--source=C:\\pkgs",
      "--version=1.2.3",
      "--prerelease",
      "--yes",
      "--force",
      "--no-progress",
      "--limit-output",
      "--verbose",
    ],
  );
  assertEquals(
    new ChocoUninstallSettings().packages("app").argv(),
    ["choco", "uninstall", "app"],
  );
  assertEquals(
    new ChocoUninstallSettings().packages("app").source("dist")
      .version("1.2.3").allVersions().yes().argv(),
    [
      "choco",
      "uninstall",
      "app",
      "--source=dist",
      "--version=1.2.3",
      "--all-versions",
      "--yes",
    ],
  );
});

Deno.test("choco install and uninstall: a package is required", () => {
  assertThrows(
    () => new ChocoInstallSettings().argv(),
    Error,
    "choco install requires .packages(...)",
  );
  assertThrows(
    () => new ChocoUninstallSettings().yes().argv(),
    Error,
    "choco uninstall requires .packages(...)",
  );
});

Deno.test("choco apikey: list, add and remove", () => {
  assertEquals(new ChocoApikeySettings().argv(), ["choco", "apikey"]);
  assertEquals(
    new ChocoApikeySettings().list().argv(),
    ["choco", "apikey", "list"],
  );
  assertEquals(
    new ChocoApikeySettings().list().source("https://feed/").argv(),
    ["choco", "apikey", "list", "--source=https://feed/"],
  );
  assertEquals(
    new ChocoApikeySettings().add().source("https://push.chocolatey.org/")
      .apiKey("k-123").argv(),
    [
      "choco",
      "apikey",
      "add",
      "--source=https://push.chocolatey.org/",
      "--api-key=k-123",
    ],
  );
  assertEquals(
    new ChocoApikeySettings().remove().source("https://feed/").argv(),
    ["choco", "apikey", "remove", "--source=https://feed/"],
  );
});

Deno.test("choco apikey: each action's requirements are enforced", () => {
  assertThrows(
    () => new ChocoApikeySettings().add().apiKey("k").argv(),
    Error,
    "choco apikey add requires .source(...)",
  );
  assertThrows(
    () => new ChocoApikeySettings().add().source("https://feed/").argv(),
    Error,
    "choco apikey add requires .apiKey(...)",
  );
  assertThrows(
    () => new ChocoApikeySettings().remove().argv(),
    Error,
    "choco apikey remove requires .source(...)",
  );
  assertThrows(
    () =>
      new ChocoApikeySettings().remove().source("https://feed/").apiKey("k")
        .argv(),
    Error,
    "takes no .apiKey(...)",
  );
  assertThrows(
    () => new ChocoApikeySettings().apiKey("k").argv(),
    Error,
    "choco apikey list takes no .apiKey(...)",
  );
});

Deno.test("choco: an option value that starts with '-' stays the option's value", () => {
  assertEquals(
    new ChocoPushSettings().apiKey("--force").argv(),
    ["choco", "push", "--api-key=--force"],
  );
});

Deno.test("choco: operands choco would read as a switch are refused", () => {
  for (const operand of ["--force", "-y", "", "/y", "/force"]) {
    assertThrows(
      () => new ChocoInstallSettings().packages("app", operand).argv(),
      Error,
      "choco install: refusing the operand",
    );
  }
  assertThrows(
    () => new ChocoPackSettings().nuspec("-v").argv(),
    Error,
    "choco pack: refusing the operand",
  );
  // A path is not a switch, even one starting with "/".
  assertEquals(
    new ChocoPushSettings().nupkg("/tmp/out/app.1.2.3.nupkg").argv(),
    ["choco", "push", "/tmp/out/app.1.2.3.nupkg"],
  );
  assertEquals(
    new ChocoPackSettings().nuspec("C:\\pkg\\app.nuspec").argv(),
    ["choco", "pack", "C:\\pkg\\app.nuspec"],
  );
});

Deno.test("choco: the escape hatches follow the typed argv", () => {
  assertEquals(
    new ChocoSettings().command("outdated").flag("limit-output").argv(),
    ["choco", "outdated", "--limit-output"],
  );
  assertEquals(
    new ChocoInstallSettings().packages("app").flag("pre").args("--x86")
      .argv(),
    ["choco", "install", "app", "--pre", "--x86"],
  );
});

Deno.test({
  name: "choco push: a failure outside a run masks the API key in the error",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["push"]);
    try {
      await withEnv(choco.env, async () => {
        const error = await assertRejects(
          () =>
            ChocoTasks.push((s) =>
              s.toolPath(choco.choco).nupkg("app.1.2.3.nupkg")
                .apiKey("hidden-key-123").quiet()
            ),
          CommandError,
          "--api-key=[redacted]",
        );
        const failed = error instanceof CommandError ? error : undefined;
        assertEquals(failed?.message.includes("hidden-key-123"), false);
        assertEquals(failed?.command.includes("hidden-key-123"), false);
        // The fake echoes its argv on stderr; the key is masked there too.
        assertStringIncludes(failed?.stderr ?? "", "--api-key=[redacted]");
        assertEquals(failed?.stderr.includes("hidden-key-123"), false);
      });
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "choco apikey add: a failure masks the key too",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["apikey"]);
    try {
      await withEnv(choco.env, async () => {
        const error = await assertRejects(
          () =>
            ChocoTasks.apikey((s) =>
              s.toolPath(choco.choco).add().source("https://feed/")
                .apiKey("hidden-key-456").quiet()
            ),
          CommandError,
        );
        assertEquals(String(error).includes("hidden-key-456"), false);
      });
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "choco: a command without a key fails with its plain error",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["install"]);
    try {
      await withEnv(choco.env, async () => {
        await assertRejects(
          () =>
            ChocoTasks.install((s) =>
              s.toolPath(choco.choco).packages("app").quiet()
            ),
          CommandError,
          "install app",
        );
      });
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "choco: a timeout masks the key in its error",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    // A choco that hangs, standing in for a push that never answers.
    const dir = Deno.makeTempDirSync({ prefix: "zuke-hung-choco-" });
    const hung = `${dir}/choco`;
    Deno.writeTextFileSync(hung, "#!/bin/sh\nexec sleep 5\n");
    Deno.chmodSync(hung, 0o755);
    try {
      const settings = new ChocoPushSettings().toolPath(hung)
        .apiKey("hidden-key-789").killAfter(50).quiet();
      const error = await assertRejects(
        () => settings.run(),
        CommandTimeoutError,
        "timed out",
      );
      assertEquals(String(error).includes("hidden-key-789"), false);
      assertStringIncludes(String(error), "--api-key=[redacted]");
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test("choco: every task reaches execution", async () => {
  const tasks: Array<() => Promise<unknown>> = [
    () => ChocoTasks.run((s) => missingTool(s).command("outdated")),
    () => ChocoTasks.pack((s) => missingTool(s)),
    () => ChocoTasks.push((s) => missingTool(s)),
    () => ChocoTasks.install((s) => missingTool(s).packages("app")),
    () => ChocoTasks.uninstall((s) => missingTool(s).packages("app")),
    () => ChocoTasks.apikey((s) => missingTool(s)),
  ];
  for (const task of tasks) await assertRejects(task, ToolNotFoundError);
});

Deno.test("choco: resolves its binary from PATH", async () => {
  await assertWrapperConformance(
    () => new ChocoInstallSettings().packages("app"),
    "choco",
    { resolution: "path" },
  );
  await assertWrapperConformance(() => new ChocoSettings(), "choco", {
    resolution: "path",
  });
});
