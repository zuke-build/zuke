// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link HomebrewPublishSettings} and `HomebrewTasks.publish`: write a
 * formula into a tap repository on GitHub, as `Formula/<name>.rb`.
 *
 * ```ts
 * await HomebrewTasks.publish((s) =>
 *   s.tap("acme/tap").formula("app", ruby).token(tapToken)
 *     .branch("main").message("app 1.2.3")
 * );
 * ```
 *
 * The write goes through `GhTasks.createOrUpdateFile` from `@zuke/gh` — its
 * transport, its token resolution, its path and repository guards — rather
 * than a second GitHub client here. That task is also what makes publishing
 * idempotent: a formula whose content is already in the tap is reported
 * `unchanged` and makes no commit, so a release pipeline can publish on every
 * run.
 *
 * @module
 */

import { GhTasks } from "@zuke/gh";
import type { Configure } from "@zuke/core/tooling";
import { assertDefinesFormula } from "./formula_name.ts";
import { tapRepository } from "./tap.ts";

/** What became of a `HomebrewTasks.publish` call. */
export interface HomebrewPublishResult {
  /**
   * `created` for a formula new to the tap, `updated` for a changed one,
   * `unchanged` when the tap already held exactly this formula and nothing
   * was committed.
   */
  state: "created" | "updated" | "unchanged";
  /** The tap's GitHub repository, `owner/homebrew-x`. */
  repo: string;
  /** The formula's path in the tap, `Formula/<name>.rb`. */
  path: string;
  /** The commit that wrote it; absent when the state is `unchanged`. */
  commitSha?: string;
}

/** Settings for publishing a formula to a tap. */
export class HomebrewPublishSettings {
  /** The tap, as given. Set by {@link tap}. */
  tap_?: string;
  /** The formula name. Set by {@link formula}. */
  name_?: string;
  /** The formula's Ruby source. Set by {@link formula}. */
  source_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The branch to commit on. Set by {@link branch}. */
  branch_?: string;
  /** The commit message. Set by {@link message}. */
  message_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_?: string;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_?: typeof fetch;

  /**
   * The tap (required): its GitHub repository `owner/homebrew-x`, or brew's
   * short form `owner/x`, which names the same repository.
   */
  tap(value: string): this {
    this.tap_ = value;
    return this;
  }

  /**
   * The formula to publish (required): its name, which becomes the file
   * `Formula/<name>.rb`, and its Ruby source — typically what
   * `HomebrewTasks.formula` rendered.
   */
  formula(name: string, source: string): this {
    this.name_ = name;
    this.source_ = source;
    return this;
  }

  /**
   * The token to write with — needs `contents: write` on the tap repository.
   * Defaults to `GITHUB_TOKEN`, which only works when the tap is the
   * repository the job runs in; a separate tap needs its own token.
   */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /** The branch to commit on. Defaults to the tap's default branch. */
  branch(name: string): this {
    this.branch_ = name;
    return this;
  }

  /** The commit message. Defaults to `<name>: update formula`. */
  message(text: string): this {
    this.message_ = text;
    return this;
  }

  /** The API root, for GitHub Enterprise. */
  baseUrl(url: string): this {
    this.baseUrl_ = url;
    return this;
  }

  /** Override the `fetch` implementation (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }
}

/** Perform the configured publish. */
export async function publishFormula(
  configure: Configure<HomebrewPublishSettings>,
): Promise<HomebrewPublishResult> {
  const settings = configure(new HomebrewPublishSettings());
  const { tap_: tap, name_: name, source_: source } = settings;
  if (tap === undefined) {
    throw new Error("publishing a formula requires .tap('owner/homebrew-x').");
  }
  if (name === undefined || source === undefined) {
    throw new Error("publishing a formula requires .formula(name, source).");
  }
  const repo = tapRepository(tap);
  assertDefinesFormula(source, name);
  const path = `Formula/${name}.rb`;
  const { token_: token, branch_: branch, baseUrl_: baseUrl } = settings;
  const fetchImpl = settings.fetch_;
  const result = await GhTasks.createOrUpdateFile((s) => {
    s.repo(repo).path(path).content(source)
      .message(settings.message_ ?? `${name}: update formula`);
    if (token !== undefined) s.token(token);
    if (branch !== undefined) s.branch(branch);
    if (baseUrl !== undefined) s.baseUrl(baseUrl);
    if (fetchImpl !== undefined) s.fetch(fetchImpl);
    return s;
  });
  return {
    state: result.state,
    repo,
    path,
    ...(result.commitSha === undefined ? {} : { commitSha: result.commitSha }),
  };
}
