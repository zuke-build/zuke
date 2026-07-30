/**
 * The release → website sync: regenerate the docs the website consumes
 * (llms.txt / llms-full.txt + api.json), then open (or refresh) a PR against
 * the website repo with the updated artifacts and squash-merge it, so a release
 * needs no manual merge on the website side.
 */

import { type Build, FileTasks } from "@zuke/core";
import { ConsoleTasks } from "@zuke/console";
import { DocsTasks } from "@zuke/docs";
import { GitTasks } from "@zuke/git";
import { GhTasks } from "@zuke/gh";
import { collectPackageDocs, docsOptions } from "./docs.ts";
import { writeApiJson } from "./api_reference.ts";
import { localVersion } from "./packages.ts";

/** The website repo the sync targets, absent an override. */
export const DEFAULT_WEBSITE_REPO = "zuke-build/zuke-build.github.io";

/** Where the sync pushes and opens its PR: a cross-repo token plus a repo slug. */
export interface SyncTarget {
  /** The fine-grained PAT / GitHub App token authorizing the cross-repo push. */
  token: string;
  /** The `owner/repo` slug of the website repository. */
  repo: string;
}

/**
 * A GitHub `owner/repo` slug: exactly two non-empty segments of the characters
 * GitHub allows in an owner or repository name.
 */
const REPO_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The sync's target, derived from env — or `null` when the cross-repo token
 * isn't set. `GITHUB_TOKEN` cannot push to another repo, so this needs a
 * fine-grained PAT / GitHub App token (contents + pull-requests write on the
 * website repo); it is absent locally and on fork PRs, where the sync skips
 * cleanly rather than failing.
 *
 * An overridden repo is checked against {@link REPO_SLUG} before it is returned.
 * This is the one place a cross-repo write token leaves for another repository,
 * so a slug that is not a plain `owner/repo` — anything carrying a URL, a host,
 * a credential, or an extra path segment — is refused rather than handed to
 * `git push` and `gh pr create`.
 *
 * @throws if `env.repo` is set but is not a valid `owner/repo` slug.
 */
export function resolveSyncTarget(
  env: { token?: string; repo?: string },
): SyncTarget | null {
  if (env.token === undefined || env.token === "") return null;
  if (env.repo !== undefined && !REPO_SLUG.test(env.repo)) {
    throw new Error(
      `website sync: WEBSITE_REPO must be an "owner/repo" slug, got ` +
        `"${env.repo}". Unset it to target ${DEFAULT_WEBSITE_REPO}.`,
    );
  }
  return { token: env.token, repo: env.repo ?? DEFAULT_WEBSITE_REPO };
}

/** The sync branch name and commit message for a given `core` version. */
export function syncBranchInfo(
  coreVersion: string,
): { branch: string; message: string } {
  return {
    branch: `zuke-sync/${coreVersion}`,
    message: `chore: sync docs + api reference for core@${coreVersion}`,
  };
}

/** The outcome of opening (or finding an already-open) sync PR. */
export interface OpenPrResult {
  /** The `gh pr create` exit code: `0` on a freshly opened PR. */
  code: number;
  /** The command's trimmed text output (the PR URL on success). */
  text: string;
}

/**
 * The I/O `runWebsiteSync` performs, injected so its skip/idempotent/PR
 * decisions are unit-testable without a real clone, push, or `gh` call —
 * mirroring the seam style {@link "../packages/core/src/conformance.ts"} uses
 * for its own CLI dependencies.
 */
export interface WebsiteSyncDeps {
  /** Regenerate llms.txt / llms-full.txt (the `apiDocs` flow). */
  regenerateDocs(build: Build): Promise<void>;
  /** Regenerate `dist/api.json` (the `apiReference` flow). */
  regenerateApiJson(): Promise<void>;
  /** A fresh temp directory to clone the website into. */
  makeTempDir(): Promise<string>;
  /** Recursively remove `dir`. */
  removeDir(dir: string): Promise<void>;
  /** Shallow-clone `repo` into `dir`. */
  cloneWebsite(repo: string, dir: string): Promise<void>;
  /** Create the sync branch in `dir`, off the freshly-cloned default branch. */
  createSyncBranch(dir: string, branch: string): Promise<void>;
  /** Copy the regenerated artifacts into `dir`'s expected locations. */
  copyArtifacts(dir: string): Promise<void>;
  /** Stage every change in `dir`. */
  stageAll(dir: string): Promise<void>;
  /** Whether `dir` has any staged change (idempotency check). */
  hasStagedChanges(dir: string): Promise<boolean>;
  /** Commit the staged changes in `dir` with `message`, under a bot identity. */
  commitStaged(dir: string, message: string): Promise<void>;
  /** Force-push `branch` from `dir`, authenticated with `token`. */
  pushBranch(dir: string, branch: string, token: string): Promise<void>;
  /** Open the sync PR, or note the one a push to the same head already refreshed. */
  openOrRefreshPr(
    repo: string,
    branch: string,
    message: string,
    dir: string,
    token: string,
  ): Promise<OpenPrResult>;
  /** Squash-merge the sync PR for `branch`, so the release needs no human merge. */
  mergePr(
    repo: string,
    branch: string,
    dir: string,
    token: string,
  ): Promise<OpenPrResult>;
  /** Report an in-progress/skip status line. */
  info(message: string): void;
  /** Report a freshly opened PR. */
  success(message: string): void;
  /** Report that the sync itself is being skipped. */
  warn(message: string): void;
}

/** The PR body posted for every sync — idempotent, so its text never varies. */
const PR_BODY = "Automated docs sync from the Zuke framework: refreshed " +
  "`public/llms.txt`, `public/llms-full.txt`, and " +
  "`src/data/api.json`. Idempotent — regenerated each release.";

/** The bot identity commits are authored under (no human git identity in CI). */
const BOT_NAME = "github-actions[bot]";
/** The bot email paired with {@link BOT_NAME}. */
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/**
 * The real {@link WebsiteSyncDeps}: an actual clone, push, and `gh pr create`
 * against GitHub. This is what `runWebsiteSync` uses in production; a test
 * substitutes a fake instead.
 */
const REAL_DEPS: WebsiteSyncDeps = {
  regenerateDocs: async (build) => {
    await DocsTasks.apiDocs(await collectPackageDocs(), docsOptions(build));
  },
  regenerateApiJson: async () => {
    await writeApiJson();
  },
  makeTempDir: () => Deno.makeTempDir({ prefix: "zuke-sync-" }),
  removeDir: async (dir) => {
    await FileTasks.remove(dir, { recursive: true });
  },
  cloneWebsite: async (repo, dir) => {
    // A public repo — the clone needs no credential.
    await GitTasks.clone((s) =>
      s.repository(`https://github.com/${repo}.git`).directory(dir).depth(1)
    );
  },
  createSyncBranch: async (dir, branch) => {
    await GitTasks.checkout((s) => s.dir(dir).ref(branch).create());
  },
  copyArtifacts: async (dir) => {
    await FileTasks.createDirectory(`${dir}/public`);
    await FileTasks.createDirectory(`${dir}/src/data`);
    await FileTasks.copy("llms.txt", `${dir}/public/llms.txt`);
    await FileTasks.copy("llms-full.txt", `${dir}/public/llms-full.txt`);
    await FileTasks.copy("dist/api.json", `${dir}/src/data/api.json`);
  },
  stageAll: async (dir) => {
    await GitTasks.add((s) => s.dir(dir).all());
  },
  hasStagedChanges: async (dir) => {
    const { stdout } = await GitTasks.status((s) =>
      s.dir(dir).porcelain().quiet()
    );
    return stdout.trim() !== "";
  },
  commitStaged: async (dir, message) => {
    // A non-interactive CI runner has no git identity, so set one.
    await GitTasks.commit((s) =>
      s
        .dir(dir)
        .config("user.name", BOT_NAME)
        .config("user.email", BOT_EMAIL)
        .message(message)
    );
  },
  pushBranch: async (dir, branch, token) => {
    // The token rides as a one-off HTTP Authorization header rather than
    // embedding it in the remote URL — so it is never persisted in
    // .git/config or echoed back by git. Mirrors how actions/checkout
    // injects credentials. Force-push so the branch is create-or-reset on
    // every release.
    const authHeader = `AUTHORIZATION: basic ${
      btoa(`x-access-token:${token}`)
    }`;
    await GitTasks.run((s) =>
      s.dir(dir).config("http.extraheader", authHeader).command(
        "push",
        "--force",
        "origin",
        branch,
      )
    );
  },
  openOrRefreshPr: async (repo, branch, message, dir, token) => {
    // `gh` rejects a duplicate PR — a push to the same head branch already
    // refreshed the existing one, so a non-zero exit here just means that.
    const pr = await GhTasks.run((s) =>
      s
        .command("pr", "create")
        .repo(repo)
        .flag("head", branch)
        .flag("title", message)
        .flag("body", PR_BODY)
        .cwd(dir)
        .env({ GH_TOKEN: token })
        .noThrow()
    );
    return { code: pr.code, text: pr.text() };
  },
  mergePr: async (repo, branch, dir, token) => {
    // Selected by head branch rather than PR number, so the same call merges a
    // PR this run opened and one an earlier run left open. Squash keeps the
    // website history one commit per release; `--delete-branch` is explicit
    // because the website repo does not delete merged branches on its own.
    const merged = await GhTasks.run((s) =>
      s
        .command("pr", "merge", branch)
        .repo(repo)
        .flag("squash")
        .flag("delete-branch")
        .cwd(dir)
        .env({ GH_TOKEN: token })
        .noThrow()
    );
    return { code: merged.code, text: merged.text() };
  },
  info: (message) => ConsoleTasks.info(message),
  success: (message) => ConsoleTasks.success(message),
  warn: (message) => ConsoleTasks.warn(message),
};

/**
 * Open and merge a PR to the website with refreshed llms.txt + api.json. Takes
 * the build
 * so it can render the live CLI block via {@link docsOptions}. `deps` defaults
 * to the real clone/push/`gh` implementation; a test overrides it.
 */
export async function runWebsiteSync(
  build: Build,
  deps: WebsiteSyncDeps = REAL_DEPS,
): Promise<void> {
  const target = resolveSyncTarget({
    token: Deno.env.get("WEBSITE_SYNC_TOKEN"),
    repo: Deno.env.get("WEBSITE_REPO"),
  });
  if (target === null) {
    deps.warn("WEBSITE_SYNC_TOKEN not set — skipping the website sync.");
    return;
  }
  const { token, repo } = target;

  // Regenerate exactly what the website consumes: the llms.txt /
  // llms-full.txt indexes (the `apiDocs` flow) and the structured
  // dist/api.json (the `apiReference` flow).
  await deps.regenerateDocs(build);
  await deps.regenerateApiJson();

  const coreVersion = await localVersion("core");
  const { branch, message } = syncBranchInfo(coreVersion);
  // Shallow-clone the website into a throwaway temp dir, deleted in `finally`.
  const dir = await deps.makeTempDir();
  try {
    await deps.cloneWebsite(repo, dir);
    await deps.createSyncBranch(dir, branch);
    await deps.copyArtifacts(dir);
    await deps.stageAll(dir);

    // Idempotent: bail out before committing if nothing changed — no empty
    // PR. `api.json`'s `generated` is `core@<version>` (no timestamp) and the
    // llms files are deterministic, so re-runs diff to nothing.
    if (!(await deps.hasStagedChanges(dir))) {
      deps.info("website already in sync — no PR needed.");
      return;
    }

    await deps.commitStaged(dir, message);
    await deps.pushBranch(dir, branch, token);

    // Open the PR, or note the existing one.
    const pr = await deps.openOrRefreshPr(repo, branch, message, dir, token);
    if (pr.code === 0) {
      deps.success(`Opened website sync PR: ${pr.text}`);
    } else {
      deps.info(
        `Website sync PR for ${branch} already open — updated by the push.`,
      );
    }

    // Merge it too: the diff is generated output that was just verified by the
    // gate on this repo, so a human merge adds a manual step and no signal.
    // A failed merge is reported but does not fail the release — the packages
    // are already published by then, and the PR stays open to merge by hand.
    const merged = await deps.mergePr(repo, branch, dir, token);
    if (merged.code === 0) {
      deps.success(`Merged the website sync PR for ${branch}.`);
    } else {
      deps.warn(
        `Could not merge the website sync PR for ${branch} — merge it by ` +
          `hand: ${merged.text}`,
      );
    }
  } finally {
    await deps.removeDir(dir);
  }
}
