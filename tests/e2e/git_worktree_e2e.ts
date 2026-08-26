// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: `git worktree` against a real repository. Whether git accepts the
 * argv, and whether it refuses to remove a modified worktree, are facts about
 * git rather than about the argv builder, so only a real invocation shows them.
 * The {@link file://./fixtures/git_worktree_build.ts} fixture runs the whole
 * sequence in one build: init, add, list, a refused remove, a forced remove,
 * and a final listing.
 *
 * Like the Node evaluation suite, these tests need a real `git` and skip where
 * there is none, so a checkout without it stays green. On CI the skip is
 * refused: every runner ships git, and skipping quietly would retire the
 * coverage unnoticed.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { runFixture } from "./_harness.ts";

const FIXTURE = new URL("./fixtures/git_worktree_build.ts", import.meta.url);

/** Whether a usable `git` is on `PATH`. */
async function gitAvailable(): Promise<boolean> {
  try {
    const { success } = await new Deno.Command("git", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return success;
  } catch {
    return false;
  }
}

const HAS_GIT = await gitAvailable();

/** On CI a missing git is an environment regression, not a reason to skip. */
const MUST_HAVE_GIT = Deno.env.get("CI") === "true";

Deno.test({
  name: "CI runs the git worktree tests rather than skipping them",
  ignore: !MUST_HAVE_GIT,
  fn: () => {
    assertEquals(
      HAS_GIT,
      true,
      "no usable `git` on PATH: the worktree e2e test would have been " +
        "skipped on a runner that is supposed to provide one.",
    );
  },
});

Deno.test({
  name: "a build adds, lists, and removes a real worktree",
  ignore: !HAS_GIT,
  fn: async () => {
    const repo = await Deno.makeTempDir();
    try {
      const { code, out, err } = await runFixture(FIXTURE, ["worktrees"], {
        ZUKE_E2E_REPO: repo,
        // git reads the ambient home for config; keep the run out of it.
        GIT_CONFIG_GLOBAL: `${repo}/.gitconfig-none`,
        GIT_CONFIG_SYSTEM: `${repo}/.gitconfig-none`,
      });
      const output = out + err;

      assertEquals(code, 0, `expected a passing build:\n${output}`);
      assertEquals(out.includes("ADDED"), true, output);
      // The listing carries both trees, with the branch each has checked out.
      // Compared by the directory name rather than the whole path: git reports
      // the resolved path, and a macOS temp directory reaches it through a
      // symlink (`/var/…` against `/private/var/…`).
      const slashed = repo.replace(/\\/g, "/");
      const name = slashed.slice(slashed.lastIndexOf("/") + 1);
      assertEquals(
        out.includes(`/${name} branch=main bare=false`),
        true,
        output,
      );
      assertEquals(
        out.includes(`/${name}_feature branch=feature bare=false`),
        true,
        output,
      );
      // A modified worktree survives a plain remove and yields to a forced one.
      assertEquals(out.includes("REFUSED_DIRTY"), true, output);
      assertEquals(out.includes("REMOVED"), true, output);
      assertEquals(out.includes("COUNT=1"), true, output);
    } finally {
      await Deno.remove(repo, { recursive: true });
      await Deno.remove(`${repo}_feature`, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "a start point decides where the new branch forks, not the parent's HEAD",
  ignore: !HAS_GIT,
  fn: async () => {
    const repo = await Deno.makeTempDir();
    try {
      const { code, out, err } = await runFixture(FIXTURE, ["startPoint"], {
        GIT_CONFIG_GLOBAL: `${repo}/.gitconfig-none`,
        GIT_CONFIG_SYSTEM: `${repo}/.gitconfig-none`,
        ZUKE_E2E_REPO: repo,
      });
      const output = out + err;
      assertEquals(code, 0, `expected a passing build:\n${output}`);

      const commitOf = (label: string) =>
        out.split("\n").find((line) => line.startsWith(`${label}=`))
          ?.slice(label.length + 1) ?? "";
      const main = commitOf("MAIN");
      const stale = commitOf("STALE");
      const ticket = commitOf("TICKET");

      // The fixture really did leave the parent on another branch, so the two
      // commits differ and the comparison below means something.
      assertEquals(main.length > 0 && stale.length > 0, true, output);
      assertEquals(main === stale, false, output);
      // The new branch forked from the start point, not from the parent's HEAD.
      assertEquals(ticket, main, output);
    } finally {
      await Deno.remove(repo, { recursive: true });
      await Deno.remove(`${repo}_ticket`, { recursive: true }).catch(() => {});
    }
  },
});
