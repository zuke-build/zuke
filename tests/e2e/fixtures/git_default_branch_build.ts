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
      // again: this can only be answered by the remote.
      await GitTasks.run((s) =>
        s.dir(CLONE).command("remote", "set-head", "origin", "--delete")
      );
      console.log(
        `REMOTE=${await GitTasks.defaultBranch((s) => s.dir(CLONE))}`,
      );
    });
}

await run(GitDefaultBranchBuild);
