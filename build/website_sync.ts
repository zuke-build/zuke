/**
 * The release → website sync: regenerate the docs the website consumes
 * (llms.txt / llms-full.txt + api.json), then open (or refresh) a PR against
 * the website repo with the updated artifacts.
 */

import { type Build, FileTasks } from "@zuke/core";
import { ConsoleTasks } from "@zuke/console";
import { DocsTasks } from "@zuke/docs";
import { GitTasks } from "@zuke/git";
import { GhTasks } from "@zuke/gh";
import { collectPackageDocs, docsOptions } from "./docs.ts";
import { writeApiJson } from "./api_reference.ts";
import { localVersion } from "./packages.ts";

/**
 * Open a PR to the website with refreshed llms.txt + api.json. Takes the build
 * so it can render the live CLI block via {@link docsOptions}.
 */
export async function runWebsiteSync(build: Build): Promise<void> {
  // The push is cross-repo, which GITHUB_TOKEN cannot do — it needs a
  // fine-grained PAT / GitHub App token (contents + pull-requests write on
  // the website repo). Absent locally and on fork PRs: skip cleanly.
  const token = Deno.env.get("WEBSITE_SYNC_TOKEN");
  if (token === undefined || token === "") {
    ConsoleTasks.warn(
      "WEBSITE_SYNC_TOKEN not set — skipping the website sync.",
    );
    return;
  }
  const repo = Deno.env.get("WEBSITE_REPO") ??
    "zuke-build/zuke-build.github.io";

  // Regenerate exactly what the website consumes: the llms.txt /
  // llms-full.txt indexes (the `apiDocs` flow) and the structured
  // dist/api.json (the `apiReference` flow).
  await DocsTasks.apiDocs(await collectPackageDocs(), docsOptions(build));
  await writeApiJson();

  // Shallow-clone the website (a public repo — the clone needs no credential)
  // into a throwaway temp dir, deleted in `finally`.
  const coreVersion = await localVersion("core");
  const branch = `zuke-sync/${coreVersion}`;
  const message = `chore: sync docs + api reference for core@${coreVersion}`;
  const dir = await Deno.makeTempDir({ prefix: "zuke-sync-" });
  // The push carries the token as a one-off HTTP Authorization header rather
  // than embedding it in the remote URL — so it is never persisted in
  // .git/config or echoed back by git. Mirrors how actions/checkout injects
  // credentials.
  const authHeader = `AUTHORIZATION: basic ${btoa(`x-access-token:${token}`)}`;
  try {
    await GitTasks.clone((s) =>
      s.repository(`https://github.com/${repo}.git`).directory(dir).depth(1)
    );

    // Reset the sync branch off the freshly-cloned default branch.
    await GitTasks.checkout((s) => s.dir(dir).ref(branch).create());

    // Copy the artifacts into the website's expected locations.
    await FileTasks.createDirectory(`${dir}/public`);
    await FileTasks.createDirectory(`${dir}/src/data`);
    await FileTasks.copy("llms.txt", `${dir}/public/llms.txt`);
    await FileTasks.copy("llms-full.txt", `${dir}/public/llms-full.txt`);
    await FileTasks.copy("dist/api.json", `${dir}/src/data/api.json`);

    // Idempotent: bail out before committing if nothing changed — no empty
    // PR. `api.json`'s `generated` is `core@<version>` (no timestamp) and
    // the llms files are deterministic, so re-runs diff to nothing.
    await GitTasks.add((s) => s.dir(dir).all());
    const { stdout } = await GitTasks.status((s) =>
      s.dir(dir).porcelain().quiet()
    );
    if (stdout.trim() === "") {
      ConsoleTasks.info("website already in sync — no PR needed.");
      return;
    }

    // A non-interactive CI runner has no git identity, so set one.
    await GitTasks.commit((s) =>
      s
        .dir(dir)
        .config("user.name", "github-actions[bot]")
        .config(
          "user.email",
          "41898282+github-actions[bot]@users.noreply.github.com",
        )
        .message(message)
    );
    // Force-push so the branch is create-or-reset on every release. The token
    // rides as a one-off `-c http.extraheader`, never in the remote URL.
    await GitTasks.run((s) =>
      s.dir(dir).config("http.extraheader", authHeader).command(
        "push",
        "--force",
        "origin",
        branch,
      )
    );

    // Open the PR, or note the existing one — a push to the same head
    // branch already refreshed it, and `gh` rejects a duplicate.
    const pr = await GhTasks.run((s) =>
      s
        .command("pr", "create")
        .repo(repo)
        .flag("head", branch)
        .flag("title", message)
        .flag(
          "body",
          "Automated docs sync from the Zuke framework: refreshed " +
            "`public/llms.txt`, `public/llms-full.txt`, and " +
            "`src/data/api.json`. Idempotent — regenerated each release.",
        )
        .cwd(dir)
        .env({ GH_TOKEN: token })
        .noThrow()
    );
    if (pr.code === 0) {
      ConsoleTasks.success(`Opened website sync PR: ${pr.text()}`);
    } else {
      ConsoleTasks.info(
        `Website sync PR for ${branch} already open — updated by the push.`,
      );
    }
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
}
