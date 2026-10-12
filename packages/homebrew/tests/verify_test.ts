// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `HomebrewTasks.verify`, against a fake `brew` process: the
 * order of the calls, the formula landing in the throwaway tap, and the
 * cleanup that runs whatever failed.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { HomebrewTasks } from "../mod.ts";
import { FAKE_BREW_UNSUPPORTED, fakeBrew } from "./_fake_brew.ts";

/** A formula file on disk, in a temp dir. */
function formulaFile(): string {
  const dir = Deno.makeTempDirSync({ prefix: "zuke-formula-" });
  const path = `${dir}/app.rb`;
  Deno.writeTextFileSync(path, "class App < Formula\nend\n");
  return path;
}

/** The verbs of the recorded calls, in order. */
function verbs(calls: Array<{ args: string[] }>): string[] {
  return calls.map((call) => call.args[0] ?? "");
}

Deno.test({
  name: "verify: tap-new, install, test, uninstall, untap — in that order",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew();
    const file = formulaFile();
    try {
      await withEnv(
        brew.env,
        () =>
          HomebrewTasks.verify((s) =>
            s.formulaFile(file).name("app").toolPath(brew.brew)
          ),
      );
      const calls = brew.calls();
      assertEquals(verbs(calls), [
        "tap-new",
        "--repository",
        "install",
        "test",
        "uninstall",
        "untap",
      ]);
      const tap = calls[0].args[2];
      assertEquals(/^zuke-verify\/verify-[0-9a-f]{12}$/.test(tap), true, tap);
      assertEquals(calls[0].args, ["tap-new", "--no-git", tap]);
      assertEquals(calls[2].args, ["install", "--formula", `${tap}/app`]);
      assertEquals(calls[3].args, ["test", `${tap}/app`]);
      assertEquals(calls[4].args, [
        "uninstall",
        "--formula",
        "--force",
        `${tap}/app`,
      ]);
      assertEquals(calls[5].args, ["untap", "--force", tap]);
      // Every call skips the auto-update.
      assertEquals(calls.every((call) => call.autoUpdate === "1"), true);
      // The formula was copied into the tap the install read it from.
      assertEquals(
        Deno.readTextFileSync(`${brew.root}/${tap}/Formula/app.rb`),
        "class App < Formula\nend\n",
      );
    } finally {
      brew.dispose();
    }
  },
});

Deno.test({
  name:
    "verify: a failing test still uninstalls and untaps, and its error is raised",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew(["test"]);
    const file = formulaFile();
    try {
      await withEnv(brew.env, async () => {
        await assertRejects(
          () =>
            HomebrewTasks.verify((s) =>
              s.formulaFile(file).name("app").toolPath(brew.brew)
            ),
          Error,
          "brew test",
        );
      });
      assertEquals(verbs(brew.calls()), [
        "tap-new",
        "--repository",
        "install",
        "test",
        "uninstall",
        "untap",
      ]);
    } finally {
      brew.dispose();
    }
  },
});

Deno.test({
  name:
    "verify: a failed install skips the uninstall, and the forced untap cleans up",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew(["install"]);
    const file = formulaFile();
    try {
      await withEnv(brew.env, async () => {
        await assertRejects(
          () =>
            HomebrewTasks.verify((s) =>
              s.formulaFile(file).name("app").toolPath(brew.brew)
            ),
          Error,
          "brew install",
        );
      });
      assertEquals(verbs(brew.calls()), [
        "tap-new",
        "--repository",
        "install",
        "untap",
      ]);
    } finally {
      brew.dispose();
    }
  },
});

Deno.test({
  name: "verify: when the cleanup fails too, both failures are raised together",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew(["test", "uninstall", "untap"]);
    const file = formulaFile();
    try {
      await withEnv(brew.env, async () => {
        const error = await assertRejects(
          () =>
            HomebrewTasks.verify((s) =>
              s.formulaFile(file).name("app").toolPath(brew.brew)
            ),
          AggregateError,
          "verifying the formula failed",
        );
        const errors = error instanceof AggregateError ? error.errors : [];
        assertEquals(errors.length, 3);
        assertStringIncludes(String(errors[0]), "brew test");
        assertStringIncludes(String(errors[1]), "brew uninstall");
        assertStringIncludes(String(errors[2]), "brew untap");
      });
    } finally {
      brew.dispose();
    }
  },
});

Deno.test({
  name: "verify: a cleanup failure after a passing test is raised on its own",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew(["untap"]);
    const file = formulaFile();
    try {
      await withEnv(brew.env, async () => {
        await assertRejects(
          () =>
            HomebrewTasks.verify((s) =>
              s.formulaFile(file).name("app").toolPath(brew.brew)
            ),
          Error,
          "brew untap",
        );
      });
    } finally {
      brew.dispose();
    }
  },
});

Deno.test({
  name: "verify: a failed tap-new leaves nothing to clean up",
  ignore: FAKE_BREW_UNSUPPORTED,
  async fn() {
    const brew = fakeBrew(["tap-new"]);
    const file = formulaFile();
    try {
      await withEnv(brew.env, async () => {
        await assertRejects(
          () =>
            HomebrewTasks.verify((s) =>
              s.formulaFile(file).name("app").toolPath(brew.brew)
            ),
          Error,
          "brew tap-new",
        );
      });
      assertEquals(verbs(brew.calls()), ["tap-new"]);
    } finally {
      brew.dispose();
    }
  },
});

Deno.test("verify: the file and a valid name are required before brew runs", async () => {
  await assertRejects(
    () => HomebrewTasks.verify((s) => s.name("app")),
    Error,
    "requires .formulaFile(path)",
  );
  await assertRejects(
    () => HomebrewTasks.verify((s) => s.formulaFile("app.rb")),
    Error,
    "requires .name(...)",
  );
  // The name becomes a path in the tap, so a traversal is refused up front —
  // the brew this would run does not exist, so reaching it would fail later.
  await assertRejects(
    () =>
      HomebrewTasks.verify((s) =>
        s.formulaFile("app.rb").name("../../etc/x").toolPath("/nonexistent")
      ),
    Error,
    "invalid formula name",
  );
  // A file that defines some other formula is refused before a tap is made.
  const file = formulaFile();
  await assertRejects(
    () =>
      HomebrewTasks.verify((s) =>
        s.formulaFile(file).name("other").toolPath("/nonexistent")
      ),
    Error,
    "does not define `class Other < Formula`",
  );
});
