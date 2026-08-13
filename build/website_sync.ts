// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
import { localVersion, PACKAGES } from "./packages.ts";
import { renderToolsModule } from "./website_tools.ts";

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
  return { token: env.token, repo: resolveSyncRepo(env) };
}

/**
 * The `owner/repo` the sync targets, validated. Separate from
 * {@link resolveSyncTarget} because the repository has to be known *before* a
 * token exists: an app-minted token is scoped to that one repository, so the
 * slug is an input to minting rather than a companion of it.
 *
 * @throws if `env.repo` is set but is not a valid `owner/repo` slug.
 */
export function resolveSyncRepo(env: { repo?: string }): string {
  if (env.repo !== undefined && !REPO_SLUG.test(env.repo)) {
    throw new Error(
      `website sync: WEBSITE_REPO must be an "owner/repo" slug, got ` +
        `"${env.repo}". Unset it to target ${DEFAULT_WEBSITE_REPO}.`,
    );
  }
  return env.repo ?? DEFAULT_WEBSITE_REPO;
}

/**
 * The credentials of the GitHub App the sync mints its cross-repo token from,
 * when no explicit `WEBSITE_SYNC_TOKEN` is supplied.
 */
export interface AppCredentials {
  /** The app's id (`ZUKE_BUILD_APP_ID`). */
  appId: string;
  /** The app's PEM private key (`ZUKE_BUILD_APP_KEY`). */
  privateKey: string;
}

/**
 * The app credentials in `env`, or `null` when either half is missing — absent
 * locally and on fork PRs, where the sync skips rather than fails.
 */
export function resolveAppCredentials(
  env: { appId?: string; privateKey?: string },
): AppCredentials | null {
  const { appId, privateKey } = env;
  if (appId === undefined || appId === "") return null;
  if (privateKey === undefined || privateKey === "") return null;
  return { appId, privateKey };
}

/**
 * Whether a token may be *minted* for `repo`.
 *
 * Minting is the powerful path, so it is restricted to the one repository this
 * sync exists to update. Before the token was minted in code its scope was a
 * literal in the workflow's action inputs, and `WEBSITE_REPO` could only
 * misdirect the push — which then failed, because the token did not cover the
 * new target. Deriving the minted scope from that variable instead would turn a
 * redirect into a redirect *with a working credential* for wherever it pointed,
 * anywhere the app happens to be installed.
 *
 * Overriding the target is still supported; it just requires supplying
 * `WEBSITE_SYNC_TOKEN`, so whoever redirects the sync provides the credential
 * for it rather than borrowing the app's.
 */
export function mintableFor(repo: string): boolean {
  return repo === DEFAULT_WEBSITE_REPO;
}

/** The refusal when a redirected sync tries to borrow the app's credential. */
export function mintRefusal(repo: string): string {
  return `website sync: WEBSITE_REPO points at "${repo}", but a minted app ` +
    `token is only ever scoped to ${DEFAULT_WEBSITE_REPO}. Set ` +
    `WEBSITE_SYNC_TOKEN to sync a different repository, or unset WEBSITE_REPO.`;
}

/**
 * Mint a token scoped to just the website repository, from the app credentials.
 *
 * This is what replaced the `actions/create-github-app-token` step: the
 * permissions requested here are exactly what the sync performs — a branch push,
 * a pull request, and the squash-merge of it (the merge API is a contents write,
 * so it needs no third permission).
 */
export async function mintWebsiteToken(
  credentials: AppCredentials,
  repo: string,
): Promise<string> {
  const [owner, name] = repo.split("/");
  const { token } = await GhTasks.appToken((s) =>
    s
      .appId(credentials.appId)
      .privateKey(credentials.privateKey)
      .owner(owner)
      .repositories(name)
      .permission("contents", "write")
      .permission("pull_requests", "write")
  );
  return token;
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
  /**
   * Mint the cross-repo token from the app credentials, scoped to `repo`. Its
   * own seam so the sync is testable without an app or a network call.
   */
  mintToken(credentials: AppCredentials, repo: string): Promise<string>;
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
  mintToken: (credentials, repo) => mintWebsiteToken(credentials, repo),
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
    // The landing page's package grid. Generated from this repo's catalogue so
    // dropping a package updates the site in the same release, rather than the
    // website keeping its own list that quietly advertises a dead package.
    await FileTasks.writeText(
      `${dir}/src/data/tools.ts`,
      renderToolsModule(PACKAGES),
    );
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
    // website history one commit per release.
    //
    // No `--delete-branch`: `gh` implements that by deleting the branch itself
    // once the merge returns, which never happens under `--auto` — it hands the
    // merge to GitHub and exits. The website repo has `delete_branch_on_merge`
    // instead, which is what actually reaps `zuke-sync/*`.
    //
    // `--auto` rather than a straight merge: the website repo's ruleset
    // requires its `Build the site` check, which builds the very artifacts this
    // sync just pushed. Auto-merge lands the PR when that check passes and
    // leaves it open if the build rejects them, so a broken llms.txt or
    // api.json cannot reach the live site. Note the exit code then reports
    // whether auto-merge was *enabled*, not whether the PR merged.
    const merged = await GhTasks.run((s) =>
      s
        .command("pr", "merge", branch)
        .repo(repo)
        .flag("auto")
        .flag("squash")
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
  const repo = resolveSyncRepo({ repo: Deno.env.get("WEBSITE_REPO") });
  // An explicit token wins; otherwise mint one from the app credentials, scoped
  // to this repository alone. Either way no workflow step is involved.
  const explicit = Deno.env.get("WEBSITE_SYNC_TOKEN");
  let token: string;
  if (explicit !== undefined && explicit !== "") {
    token = explicit;
  } else {
    const credentials = resolveAppCredentials({
      appId: Deno.env.get("ZUKE_BUILD_APP_ID"),
      privateKey: Deno.env.get("ZUKE_BUILD_APP_KEY"),
    });
    if (credentials === null) {
      deps.warn(
        "Neither WEBSITE_SYNC_TOKEN nor ZUKE_BUILD_APP_ID/_KEY is set — " +
          "skipping the website sync.",
      );
      return;
    }
    // Refuse rather than mint for a redirected target: an env var must not be
    // able to decide what the app's credential reaches.
    if (!mintableFor(repo)) throw new Error(mintRefusal(repo));
    token = await deps.mintToken(credentials, repo);
    deps.info(`Minted a website-scoped token for ${repo} from the GitHub App.`);
  }

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

    // Queue the merge too. The human click this replaces reviewed generated
    // output — llms.txt, llms-full.txt, api.json — that the website's own
    // `Build the site` check re-builds anyway, so the gate that matters is
    // automated and the click was not adding signal.
    // Failing to *enable* auto-merge FAILS this job. The published packages are
    // unaffected (`publish` already ran and succeeded), but the point of
    // automating the merge is that nobody watches the website repo — so a
    // buried warning would silently hand the job back to someone not looking.
    // A PR that auto-merge holds back because the build rejected the artifacts
    // is the gate doing its job, and shows up as a red check on that PR.
    const merged = await deps.mergePr(repo, branch, dir, token);
    if (merged.code === 0) {
      deps.success(
        `Website sync PR for ${branch} will merge once its build check passes.`,
      );
    } else {
      const detail =
        `Could not queue the website sync PR for ${branch} to merge — merge ` +
        `it by hand: ${merged.text}`;
      deps.warn(detail);
      throw new Error(detail);
    }
  } finally {
    await deps.removeDir(dir);
  }
}
