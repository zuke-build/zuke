// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `ChocolateyTasks.verify`, against a fake `choco` process: the
 * order of the calls, the package being packed where it is installed from,
 * the binary check, and the cleanup that runs whatever failed.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { withEnv } from "../../core/tests/_env.ts";
import {
  type ChocolateyPackage,
  ChocolateyTasks,
  type ChocolateyVerifySettings,
} from "../mod.ts";
import type { Configure } from "@zuke/core/tooling";
import {
  FAKE_CHOCO_UNSUPPORTED,
  type FakeChoco,
  fakeChoco,
} from "./_fake_choco.ts";

/** A rendered package to verify. */
const PKG: ChocolateyPackage = ChocolateyTasks.package((s) =>
  s.id("app").version("1.2.3").authors("Acme")
    .projectUrl("https://example.com")
    .description("Command-line tool that builds and ships widgets")
    .url64bit("https://example.com/app.zip").checksum64("ab".repeat(32))
);

/** The verbs of the recorded calls, in order. */
function verbs(calls: Array<{ args: string[] }>): string[] {
  return calls.map((call) => call.args[0] ?? "");
}

/** Whether `path` exists. */
function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a verification against `choco`, with its bin directory on `PATH` so the
 * shim it installs is found the way the real one would be.
 */
function verify(
  choco: FakeChoco,
  configure: Configure<ChocolateyVerifySettings>,
): Promise<void> {
  return withEnv(
    { ...choco.env, PATH: `${choco.binDir}:${Deno.env.get("PATH") ?? ""}` },
    () =>
      ChocolateyTasks.verify((s) =>
        configure(s.package(PKG).binary("app").toolPath(choco.choco))
      ),
  );
}

Deno.test({
  name: "verify: pack, install, check, uninstall — in that order",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco();
    try {
      await verify(choco, (s) => s.command("--version").expectVersion());
      const calls = choco.calls();
      assertEquals(verbs(calls), ["pack", "install", "uninstall"]);
      const staging = calls[0].cwd;
      assertEquals(calls[0].args, [
        "pack",
        "app.nuspec",
        `--output-directory=${staging}`,
      ]);
      assertEquals(calls[1].args, [
        "install",
        "app",
        `--source=${staging}`,
        "--version=1.2.3",
        "--yes",
        "--force",
        "--no-progress",
      ]);
      assertEquals(calls[2].args, [
        "uninstall",
        "app",
        "--version=1.2.3",
        "--yes",
        "--no-progress",
      ]);
      // The staging directory is gone, and the shim with the uninstall.
      assertEquals(exists(staging), false);
      assertEquals(exists(`${choco.binDir}/app`), false);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "verify: the binary only has to succeed when nothing is expected",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco();
    try {
      await verify(choco, (s) => s);
      assertEquals(verbs(choco.calls()), ["pack", "install", "uninstall"]);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name:
    "verify: output that lacks the expected text fails, and still cleans up",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco();
    try {
      const error = await assertRejects(
        () =>
          verify(
            choco,
            (s) => s.command("--version").expectOutput("app 9.9.9"),
          ),
        Error,
        'app --version did not print "app 9.9.9"',
      );
      assertStringIncludes(error.message, "app v1.2.3 --version");
      assertEquals(verbs(choco.calls()), ["pack", "install", "uninstall"]);
      assertEquals(exists(choco.calls()[0].cwd), false);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "verify: a failing binary is raised, and still uninstalls",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["shim"]);
    try {
      await assertRejects(
        () => verify(choco, (s) => s.command("--version")),
        Error,
        "app --version",
      );
      assertEquals(verbs(choco.calls()), ["pack", "install", "uninstall"]);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "verify: a failed install skips the uninstall, and removes the staging",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["install"]);
    try {
      await assertRejects(
        () => verify(choco, (s) => s),
        Error,
        "choco install",
      );
      assertEquals(verbs(choco.calls()), ["pack", "install"]);
      assertEquals(exists(choco.calls()[0].cwd), false);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "verify: a failed pack installs nothing",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["pack"]);
    try {
      await assertRejects(() => verify(choco, (s) => s), Error, "choco pack");
      assertEquals(verbs(choco.calls()), ["pack"]);
      assertEquals(exists(choco.calls()[0].cwd), false);
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "verify: a pack that wrote no .nupkg, or two, is refused",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    for (const mode of ["pack-none", "pack-two"]) {
      const choco = fakeChoco([mode]);
      try {
        await assertRejects(
          () => verify(choco, (s) => s),
          Error,
          "expected exactly one",
        );
        assertEquals(verbs(choco.calls()), ["pack"]);
      } finally {
        choco.dispose();
      }
    }
  },
});

Deno.test({
  name: "verify: when the cleanup fails too, both failures are raised together",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["shim", "uninstall"]);
    try {
      const error = await assertRejects(
        () => verify(choco, (s) => s.command("--version")),
        AggregateError,
        "verifying the Chocolatey package failed",
      );
      const errors = error instanceof AggregateError ? error.errors : [];
      assertEquals(errors.length, 2);
      // The failure that mattered comes first.
      assertStringIncludes(String(errors[0]), "app --version");
      assertStringIncludes(String(errors[1]), "choco uninstall");
    } finally {
      choco.dispose();
    }
  },
});

Deno.test({
  name: "verify: a cleanup failure after a passing check is raised on its own",
  ignore: FAKE_CHOCO_UNSUPPORTED,
  async fn() {
    const choco = fakeChoco(["uninstall"]);
    try {
      await assertRejects(
        () => verify(choco, (s) => s.command("--version").expectVersion()),
        Error,
        "choco uninstall",
      );
    } finally {
      choco.dispose();
    }
  },
});

Deno.test("verify: a package and a binary are required before choco runs", async () => {
  await assertRejects(
    () => ChocolateyTasks.verify((s) => s.binary("app")),
    Error,
    "requires .package(...)",
  );
  await assertRejects(
    () => ChocolateyTasks.verify((s) => s.package(PKG)),
    Error,
    "requires .binary(...)",
  );
  await assertRejects(
    () => ChocolateyTasks.verify((s) => s.package(PKG).binary("")),
    Error,
    "requires .binary(...)",
  );
});

Deno.test("verify: a hand-built package is checked before anything is written", async () => {
  const cases: Array<[ChocolateyPackage, string]> = [
    [{ ...PKG, id: "../evil" }, "invalid package id"],
    [{ ...PKG, version: "1.0 --force" }, "invalid package version"],
    [
      { ...PKG, files: { ...PKG.files, "../../outside.ps1": "x" } },
      "must be a relative path",
    ],
    [
      { ...PKG, files: { ...PKG.files, "tools/./x.ps1": "x" } },
      'no "." or ".." segment',
    ],
    [{ ...PKG, files: { "/etc/x": "x" } }, "must be a relative path"],
    [{ ...PKG, files: { "C:\\x": "x" } }, "must be a relative path"],
    [
      { ...PKG, files: { "tools/chocolateyinstall.ps1": "x" } },
      "has no app.nuspec",
    ],
  ];
  for (const [pkg, message] of cases) {
    await assertRejects(
      () =>
        ChocolateyTasks.verify((s) =>
          s.package(pkg).binary("app").toolPath("/nonexistent")
        ),
      Error,
      message,
    );
  }
});
