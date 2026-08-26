// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `GitTasks.defaultBranch` — what a remote calls its default branch, so a build
 * does not have to guess between `main` and `master`.
 *
 * Two commands answer the question and neither is enough alone. The local
 * `refs/remotes/<remote>/HEAD` costs nothing but is often never populated by a
 * plain clone or fetch; `ls-remote --symref` always answers but pays a network
 * round trip. This asks the local ref first and falls back to the remote.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * const base = await GitTasks.defaultBranch((s) => s.remote("origin"));
 * ```
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";
import { shortBranchName } from "./refs.ts";

/**
 * Settings for {@link "./git.ts".GitTasks.defaultBranch}: which remote to ask,
 * plus the global options every git task shares.
 */
export class GitDefaultBranchSettings extends GitSettings {
  #remote = "origin";

  /**
   * Ask the remote itself rather than reading the local ref. Set by the task
   * for its fallback attempt; a caller has no reason to set it, since the task
   * already tries both in the order that avoids the network when it can.
   */
  askRemote_ = false;

  /** The remote whose default branch is wanted (default `origin`). */
  remote(name: string): this {
    this.#remote = name;
    return this;
  }

  /** The remote being asked — the prefix the local ref reports it under. */
  get remoteName(): string {
    return this.#remote;
  }

  /** Assemble either the local ref read or the remote query. */
  protected override subcommandArgs(): string[] {
    return this.askRemote_ ? ["ls-remote", "--symref", this.#remote, "HEAD"] : [
      "symbolic-ref",
      "--quiet",
      "--short",
      `refs/remotes/${this.#remote}/HEAD`,
    ];
  }
}

/**
 * The branch name in `symbolic-ref --short` output — `origin/main` for remote
 * `origin` — or `undefined` when it named nothing usable.
 *
 * Not part of the package's public surface; exported for its unit test.
 */
export function parseSymbolicRef(
  stdout: string,
  remote: string,
): string | undefined {
  const ref = stdout.trim();
  if (ref === "") return undefined;
  const prefix = `${remote}/`;
  // `--short` abbreviates to `<remote>/<branch>`, but an older git (or a
  // caller's `.config(...)`) can still hand back the full ref.
  if (ref.startsWith(prefix)) return ref.slice(prefix.length);
  const full = `refs/remotes/${prefix}`;
  return ref.startsWith(full) ? ref.slice(full.length) : undefined;
}

/**
 * The branch name in `ls-remote --symref <remote> HEAD` output, whose first
 * line reads `ref: refs/heads/main<TAB>HEAD`, or `undefined` when the remote
 * reported no symref (a detached or empty remote `HEAD`).
 *
 * Not part of the package's public surface; exported for its unit test.
 */
export function parseSymrefListing(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("ref:")) continue;
    const ref = line.slice("ref:".length).trim().split(/\s+/)[0];
    if (ref === undefined || ref === "") continue;
    const name = shortBranchName(ref);
    if (name !== "") return name;
  }
  return undefined;
}

/**
 * Resolve the remote's default branch. Backs
 * {@link "./git.ts".GitTasks.defaultBranch}.
 *
 * @throws {Error} If neither the local ref nor the remote names a branch.
 */
export async function resolveDefaultBranch(
  configure?: Configure<GitDefaultBranchSettings>,
): Promise<string> {
  const settingsFor = (askRemote: boolean): GitDefaultBranchSettings => {
    const settings = new GitDefaultBranchSettings();
    const configured = configure ? configure(settings) : settings;
    configured.askRemote_ = askRemote;
    return configured;
  };

  const local = settingsFor(false);
  try {
    const output = await local.run();
    const name = parseSymbolicRef(output.stdout, local.remoteName);
    if (name !== undefined) return name;
  } catch {
    // The ref is absent (`--quiet` still exits non-zero), or reading it failed
    // for a reason the remote can answer anyway. Either way, ask the remote —
    // and let *its* failure be the one the caller sees.
  }

  const remote = settingsFor(true);
  const output = await remote.run();
  const name = parseSymrefListing(output.stdout);
  if (name === undefined) {
    throw new Error(
      `GitTasks.defaultBranch: remote "${remote.remoteName}" reported no ` +
        `default branch. Its HEAD is unset or detached, so there is no name ` +
        `to resolve — pass the branch explicitly instead.`,
    );
  }
  return name;
}
