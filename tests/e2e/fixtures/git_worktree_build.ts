// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fixture for {@link file://../git_worktree_e2e.ts}: drive `git worktree`
 * against a real repository. The repository is `ZUKE_E2E_REPO`, created by the
 * test; the second working tree is checked out beside it.
 *
 * Each step prints a marker the test asserts on, so a failure names the step
 * that produced it rather than a diff of the whole output.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";
import { GitTasks } from "../../../packages/git/mod.ts";

/** The repository the test prepared for this run. */
const REPO = Deno.env.get("ZUKE_E2E_REPO") ?? "";

/** Where the second working tree is checked out. */
const TREE = `${REPO}_feature`;

class GitWorktreeBuild extends Build {
  worktrees = target()
    .description("add, list, and remove a worktree in a real repository")
    .executes(async () => {
      await GitTasks.init((s) => s.dir(REPO).initialBranch("main"));
      await GitTasks.commit((s) =>
        s.dir(REPO)
          .config("user.name", "Zuke Test")
          .config("user.email", "test@zuke.build")
          .allowEmpty()
          .message("chore: initial commit")
      );

      await GitTasks.worktree((s) =>
        s.dir(REPO).add(TREE).branch("feature").createBranch()
      );
      console.log("ADDED");

      const added = await GitTasks.worktreeList((s) => s.dir(REPO));
      for (const tree of added) {
        console.log(
          `TREE ${tree.path} branch=${tree.branch} bare=${tree.bare}`,
        );
      }

      // A modified worktree must not disappear on a plain remove.
      await Deno.writeTextFile(`${TREE}/uncommitted.txt`, "work in progress\n");
      try {
        await GitTasks.worktree((s) => s.dir(REPO).remove(TREE));
        console.log("REMOVED_DIRTY");
      } catch {
        console.log("REFUSED_DIRTY");
      }

      await GitTasks.worktree((s) => s.dir(REPO).remove(TREE).force());
      console.log("REMOVED");

      const left = await GitTasks.worktreeList((s) => s.dir(REPO));
      console.log(`COUNT=${left.length}`);
    });
}

await run(GitWorktreeBuild);
