// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `BrewTasks`: the pure argv each subcommand builds, the
 * operand guard, and the wrapper conformance every Zuke tool wrapper proves.
 *
 * @module
 */

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
  BrewAuditSettings,
  BrewInfoSettings,
  BrewInstallSettings,
  BrewLivecheckSettings,
  BrewRepositorySettings,
  BrewSettings,
  BrewStyleSettings,
  BrewTapNewSettings,
  BrewTapSettings,
  BrewTasks,
  BrewTestSettings,
  BrewUninstallSettings,
  BrewUntapSettings,
} from "../mod.ts";

Deno.test("brew install: names, then every flag in the manual's order", () => {
  assertEquals(
    new BrewInstallSettings().formulae("app").argv(),
    ["brew", "install", "app"],
  );
  assertEquals(
    new BrewInstallSettings().formulae("acme/tap/app", "./Formula/x.rb")
      .formula().buildFromSource().force().verbose().argv(),
    [
      "brew",
      "install",
      "--formula",
      "--build-from-source",
      "--force",
      "--verbose",
      "acme/tap/app",
      "./Formula/x.rb",
    ],
  );
});

Deno.test("brew uninstall and test", () => {
  assertEquals(
    new BrewUninstallSettings().formulae("app").formula().force()
      .ignoreDependencies().argv(),
    [
      "brew",
      "uninstall",
      "--formula",
      "--force",
      "--ignore-dependencies",
      "app",
    ],
  );
  assertEquals(
    new BrewUninstallSettings().formulae("app").argv(),
    ["brew", "uninstall", "app"],
  );
  assertEquals(
    new BrewTestSettings().formulae("app").force().keepTmp().retry().argv(),
    ["brew", "test", "--force", "--keep-tmp", "--retry", "app"],
  );
  assertEquals(
    new BrewTestSettings().formulae("app").argv(),
    ["brew", "test", "app"],
  );
});

Deno.test("brew audit, style and livecheck: names are optional", () => {
  assertEquals(new BrewAuditSettings().argv(), ["brew", "audit"]);
  assertEquals(
    new BrewAuditSettings().formulae("app").strict().online().new().formula()
      .argv(),
    ["brew", "audit", "--strict", "--online", "--new", "--formula", "app"],
  );
  assertEquals(new BrewStyleSettings().argv(), ["brew", "style"]);
  assertEquals(
    new BrewStyleSettings().targets("Formula/app.rb").fix().argv(),
    ["brew", "style", "--fix", "Formula/app.rb"],
  );
  assertEquals(new BrewLivecheckSettings().argv(), ["brew", "livecheck"]);
  assertEquals(
    new BrewLivecheckSettings().formulae("app").json().newerOnly().formula()
      .argv(),
    ["brew", "livecheck", "--json", "--newer-only", "--formula", "app"],
  );
});

Deno.test("brew tap, untap, tap-new and --repository", () => {
  assertEquals(
    new BrewTapSettings().name("acme/tap").argv(),
    ["brew", "tap", "acme/tap"],
  );
  assertEquals(
    new BrewTapSettings().name("acme/tap", "https://git.example.com/tap.git")
      .force().argv(),
    ["brew", "tap", "--force", "acme/tap", "https://git.example.com/tap.git"],
  );
  assertEquals(
    new BrewUntapSettings().taps("a/b", "c/d").force().argv(),
    ["brew", "untap", "--force", "a/b", "c/d"],
  );
  assertEquals(
    new BrewUntapSettings().taps("a/b").argv(),
    ["brew", "untap", "a/b"],
  );
  assertEquals(
    new BrewTapNewSettings().name("me/tmp").noGit().argv(),
    ["brew", "tap-new", "--no-git", "me/tmp"],
  );
  assertEquals(
    new BrewTapNewSettings().name("me/tmp").branch("trunk").argv(),
    ["brew", "tap-new", "--branch=trunk", "me/tmp"],
  );
  assertEquals(new BrewRepositorySettings().argv(), ["brew", "--repository"]);
  assertEquals(
    new BrewRepositorySettings().tap("me/tmp").argv(),
    ["brew", "--repository", "me/tmp"],
  );
});

Deno.test("brew info always asks for --json=v2", () => {
  assertEquals(
    new BrewInfoSettings().formulae("app").argv(),
    ["brew", "info", "--json=v2", "app"],
  );
  assertEquals(
    new BrewInfoSettings().installed().formula().argv(),
    ["brew", "info", "--json=v2", "--formula", "--installed"],
  );
});

Deno.test("brew: the generic builder and the escape hatches", () => {
  assertEquals(
    new BrewSettings().command("doctor").flag("quiet").argv(),
    ["brew", "doctor", "--quiet"],
  );
  assertEquals(
    new BrewInstallSettings().formulae("app").args("--HEAD").argv(),
    ["brew", "install", "app", "--HEAD"],
  );
});

Deno.test("brew: a command that needs a name refuses to run without one", () => {
  const cases: Array<[() => string[], string]> = [
    [() => new BrewInstallSettings().argv(), "brew install requires .formulae"],
    [
      () => new BrewUninstallSettings().argv(),
      "brew uninstall requires .formulae",
    ],
    [() => new BrewTestSettings().argv(), "brew test requires .formulae"],
    [() => new BrewTapSettings().argv(), "brew tap requires .name"],
    [() => new BrewUntapSettings().argv(), "brew untap requires .taps"],
    [() => new BrewTapNewSettings().argv(), "brew tap-new requires .name"],
  ];
  for (const [build, message] of cases) {
    assertThrows(build, Error, message);
  }
});

Deno.test("brew: an operand that would read as an option is refused", () => {
  for (const operand of ["--force", "-v", ""]) {
    assertThrows(
      () => new BrewInstallSettings().formulae("app", operand).argv(),
      Error,
      "brew install: refusing the operand",
    );
  }
  assertThrows(
    () => new BrewUntapSettings().taps("--force").argv(),
    Error,
    "brew untap: refusing the operand",
  );
});

Deno.test("brew: every task reaches execution", async () => {
  const tasks: Array<() => Promise<unknown>> = [
    () => BrewTasks.run((s) => missingTool(s).command("doctor")),
    () => BrewTasks.install((s) => missingTool(s).formulae("app")),
    () => BrewTasks.uninstall((s) => missingTool(s).formulae("app")),
    () => BrewTasks.test((s) => missingTool(s).formulae("app")),
    () => BrewTasks.audit((s) => missingTool(s)),
    () => BrewTasks.style((s) => missingTool(s)),
    () => BrewTasks.livecheck((s) => missingTool(s)),
    () => BrewTasks.tap((s) => missingTool(s).name("a/b")),
    () => BrewTasks.untap((s) => missingTool(s).taps("a/b")),
    () => BrewTasks.tapNew((s) => missingTool(s).name("a/b")),
    () => BrewTasks.repository((s) => missingTool(s)),
    () => BrewTasks.info((s) => missingTool(s).formulae("app")),
  ];
  for (const task of tasks) await assertRejects(task, ToolNotFoundError);
});

Deno.test("brew: resolves its binary from PATH", async () => {
  await assertWrapperConformance(
    () => new BrewInstallSettings().formulae("app"),
    "brew",
    { resolution: "path" },
  );
  await assertWrapperConformance(() => new BrewSettings(), "brew", {
    resolution: "path",
  });
});
