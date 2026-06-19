/**
 * `@zuke/release-please` — typed `ReleasePleaseTasks` wrappers for the
 * [release-please](https://github.com/googleapis/release-please) CLI, for use in
 * Zuke builds (maintaining release PRs and cutting GitHub releases).
 *
 * ```ts
 * import { ReleasePleaseTasks } from "jsr:@zuke/release-please";
 *
 * await ReleasePleaseTasks.releasePr((s) =>
 *   s.token(token).repoUrl("owner/repo").targetBranch("main"));
 * await ReleasePleaseTasks.githubRelease((s) =>
 *   s.token(token).repoUrl("owner/repo").targetBranch("main"));
 * ```
 *
 * @module
 */

export {
  ReleasePleaseGithubReleaseSettings,
  ReleasePleaseReleasePrSettings,
  ReleasePleaseTasks,
  type ReleasePleaseTasksApi,
} from "./src/release_please.ts";
