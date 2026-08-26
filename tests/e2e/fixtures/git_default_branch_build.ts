// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fixture for {@link file://../git_default_branch_e2e.ts}: resolve a remote's
 * default branch from a real clone, both ways round. The source repository is
 * created at `ZUKE_E2E_REPO` on a branch called neither `main` nor `master`, so
 * a hardcoded guess cannot pass; the clone beside it is what gets asked.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";
import { GitTasks } from "../../../packages/git/mod.ts";

/** The source repository the test prepared for this run. */
const SOURCE = Deno.env.get("ZUKE_E2E_REPO") ?? "";

/** The clone that has `origin` pointing at the source. */
const CLONE = `${SOURCE}_clone`;

/** The branch the source repository is created on. */
const TRUNK = "trunk";

/** Whether the clone still has a local `refs/remotes/origin/HEAD`. */
async function hasRemoteHead(): Promise<boolean> {
  try {
    await GitTasks.run((s) =>
      s.dir(CLONE).command(
        "symbolic-ref",
        "--quiet",
        "refs/remotes/origin/HEAD",
      )
    );
    return true;
  } catch {
    return false; // `--quiet` exits non-zero when the ref is absent
  }
}

class GitDefaultBranchBuild extends Build {
  resolve = target()
    .description("resolve the remote's default branch from a real clone")
    .executes(async () => {
      await GitTasks.init((s) => s.dir(SOURCE).initialBranch(TRUNK));
      await GitTasks.commit((s) =>
        s.dir(SOURCE)
          .config("user.name", "Zuke Test")
          .config("user.email", "test@zuke.build")
          .allowEmpty()
          .message("chore: initial commit")
      );
      await GitTasks.clone((s) => s.repository(SOURCE).directory(CLONE));

      // A fresh clone has `refs/remotes/origin/HEAD`, so this is the local read.
      console.log(
        `LOCAL=${await GitTasks.defaultBranch((s) => s.dir(CLONE))}`,
      );

      // Drop that ref, as a fetch-only checkout often never has it, and ask
      // again: this can only be answered by the remote. `remote set-head` is
      // git's own interface for it and has no typed task, so this is the run
      // escape hatch doing what it is for.
      await GitTasks.run((s) =>
        s.dir(CLONE).command("remote", "set-head", "origin", "--delete")
      );
      // Prove the ref is gone before resolving again. Without this the next
      // line would still print the right branch if the deletion silently did
      // nothing — and the fallback, which is the whole point, would go
      // untested.
      console.log(`REF_GONE=${!await hasRemoteHead()}`);
      console.log(
        `REMOTE=${await GitTasks.defaultBranch((s) => s.dir(CLONE))}`,
      );
    });
}

await run(GitDefaultBranchBuild);
