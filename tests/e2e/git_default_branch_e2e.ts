// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: resolving a remote's default branch, both the local read and the
 * fallback that asks the remote. Which of the two answers is a property of the
 * repository's refs — whether a clone kept `refs/remotes/origin/HEAD` — so only
 * a real clone shows that the fallback is reached and still correct.
 *
 * The fixture's source repository is on a branch called neither `main` nor
 * `master`, so a hardcoded guess fails the test rather than passing it.
 *
 * Needs a real `git` and skips without one; on CI the skip is refused.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { runFixture } from "./_harness.ts";

const FIXTURE = new URL(
  "./fixtures/git_default_branch_build.ts",
  import.meta.url,
);

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
  name: "CI runs the default-branch test rather than skipping it",
  ignore: !MUST_HAVE_GIT,
  fn: () => {
    assertEquals(
      HAS_GIT,
      true,
      "no usable `git` on PATH: the default-branch e2e test would have been " +
        "skipped on a runner that is supposed to provide one.",
    );
  },
});

Deno.test({
  name: "the default branch resolves from the local ref and from the remote",
  ignore: !HAS_GIT,
  fn: async () => {
    const repo = await Deno.makeTempDir();
    try {
      const { code, out, err } = await runFixture(FIXTURE, ["resolve"], {
        GIT_CONFIG_GLOBAL: `${repo}/.gitconfig-none`,
        GIT_CONFIG_SYSTEM: `${repo}/.gitconfig-none`,
        ZUKE_E2E_REPO: repo,
      });
      const output = out + err;

      assertEquals(code, 0, `expected a passing build:\n${output}`);
      // The clone still had origin/HEAD: answered without touching the remote.
      assertEquals(out.includes("LOCAL=trunk"), true, output);
      // The deletion really removed the ref, so the second lookup had nothing
      // local to read and could only have been answered by the remote.
      assertEquals(out.includes("REF_GONE=true"), true, output);
      assertEquals(out.includes("REMOTE=trunk"), true, output);
    } finally {
      await Deno.remove(repo, { recursive: true });
      await Deno.remove(`${repo}_clone`, { recursive: true }).catch(() => {});
    }
  },
});
