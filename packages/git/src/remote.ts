// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `git remote` and `git ls-remote` — the repositories this one talks to, and
 * what refs one of them currently has.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.remote((s) => s.add("upstream", "https://host/up.git"));
 * const remotes = await GitTasks.remoteList(); // { name, fetchUrl, pushUrl }[]
 * await GitTasks.lsRemote((s) => s.heads().remote("origin").patterns("main"));
 * ```
 *
 * {@link "./git.ts".GitTasks.remoteList} parses `git remote --verbose`, whose
 * two lines per remote (fetch and push) fold into one entry — so a target that
 * checks where it is about to push reads a value instead of a listing.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { GitSettings } from "./settings.ts";

/** Which `git remote` subcommand a {@link GitRemoteSettings} runs. */
type RemoteMode =
  | "list"
  | "add"
  | "remove"
  | "rename"
  | "set-url"
  | "get-url"
  | "show"
  | "prune";

/**
 * Settings for `git remote`. Pick the subcommand with {@link list},
 * {@link add}, {@link remove}, {@link rename}, {@link setUrl},
 * {@link getUrl}, {@link show}, or {@link prune}.
 */
export class GitRemoteSettings extends GitSettings {
  #mode: RemoteMode = "list";
  #args: string[] = [];
  #verbose = false;
  #fetch = false;
  #track?: string;
  #push = false;

  /** List the configured remotes (`git remote`), the default. */
  list(): this {
    this.#mode = "list";
    this.#args = [];
    return this;
  }

  /** Add a remote (`git remote add <name> <url>`). */
  add(name: string, url: string): this {
    this.#mode = "add";
    this.#args = [name, url];
    return this;
  }

  /** Remove a remote and its tracking refs (`git remote remove <name>`). */
  remove(name: string): this {
    this.#mode = "remove";
    this.#args = [name];
    return this;
  }

  /** Rename a remote (`git remote rename <old> <new>`). */
  rename(oldName: string, newName: string): this {
    this.#mode = "rename";
    this.#args = [oldName, newName];
    return this;
  }

  /**
   * Change a remote's URL (`git remote set-url <name> <url>`). Add
   * {@link pushUrl} to change only the push URL.
   */
  setUrl(name: string, url: string): this {
    this.#mode = "set-url";
    this.#args = [name, url];
    return this;
  }

  /** Print a remote's URL (`git remote get-url <name>`). */
  getUrl(name: string): this {
    this.#mode = "get-url";
    this.#args = [name];
    return this;
  }

  /** Describe a remote and its branches (`git remote show <name>`). */
  show(name: string): this {
    this.#mode = "show";
    this.#args = [name];
    return this;
  }

  /** Delete tracking refs the remote no longer has (`git remote prune <name>`). */
  prune(name: string): this {
    this.#mode = "prune";
    this.#args = [name];
    return this;
  }

  /** Show each remote's URLs when listing (`-v`/`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Fetch from the remote right after adding it (`-f`, `add` only). */
  fetch(): this {
    this.#fetch = true;
    return this;
  }

  /** Track only this branch (`-t <branch>`, `add` only). */
  track(branch: string): this {
    this.#track = branch;
    return this;
  }

  /** Operate on the push URL (`--push`), for {@link setUrl} and {@link getUrl}. */
  pushUrl(): this {
    this.#push = true;
    return this;
  }

  /** Assemble the `git remote` argv. */
  protected override subcommandArgs(): string[] {
    if ((this.#fetch || this.#track !== undefined) && this.#mode !== "add") {
      throw new Error(
        `GitTasks.remote: .fetch()/.track(...) belong to \`remote add\`, and ` +
          `\`remote ${this.#mode}\` does not take them — drop one.`,
      );
    }
    if (
      this.#push && this.#mode !== "set-url" && this.#mode !== "get-url"
    ) {
      throw new Error(
        `GitTasks.remote: .pushUrl() picks which URL .setUrl()/.getUrl() act ` +
          `on, and \`remote ${this.#mode}\` has no such choice — drop it.`,
      );
    }
    const argv = ["remote"];
    // `-v` is a `git remote` option, so it precedes the subcommand.
    if (this.#verbose) argv.push("--verbose");
    if (this.#mode === "list") return argv;
    argv.push(this.#mode);
    if (this.#mode === "add") {
      if (this.#fetch) argv.push("-f");
      if (this.#track !== undefined) argv.push("-t", this.#track);
    }
    if (this.#push) argv.push("--push");
    argv.push(...this.#args);
    return argv;
  }
}

/** One remote of `git remote --verbose`, with both of its URLs folded in. */
export interface GitRemote {
  /** The remote's name, e.g. `origin`. */
  name: string;
  /** Where fetches read from, when the listing reported one. */
  fetchUrl?: string;
  /** Where pushes write to, when the listing reported one. */
  pushUrl?: string;
}

/**
 * Parse `git remote --verbose` into entries. It prints one line per direction
 * — `origin<TAB><url> (fetch)` and `... (push)` — which fold into a single
 * entry per remote, in the order the remotes first appear.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseRemoteList(stdout: string): GitRemote[] {
  const byName = new Map<string, GitRemote>();
  for (const line of stdout.split("\n")) {
    const text = line.trimEnd(); // tolerate CRLF
    // `<name><TAB><url> (fetch|push)`. Split on the tab and take the direction
    // off the end rather than splitting on whitespace: a remote can be a local
    // path, and a path can contain a space.
    const tab = text.indexOf("\t");
    if (tab === -1) continue;
    const name = text.slice(0, tab);
    const direction = /^(.*?)\s+\((fetch|push)\)$/.exec(text.slice(tab + 1));
    if (name === "" || direction === null) continue;
    const [, url, which] = direction;
    if (url === undefined || url === "") continue;
    const entry = byName.get(name) ?? { name };
    // A remote with one URL for both directions still prints both lines.
    if (which === "push") entry.pushUrl = url;
    else entry.fetchUrl = url;
    byName.set(name, entry);
  }
  return [...byName.values()];
}

/**
 * Run `git remote --verbose` and parse it. Backs
 * {@link "./git.ts".GitTasks.remoteList}.
 */
export async function listRemotes(
  configure?: Configure<GitRemoteSettings>,
): Promise<GitRemote[]> {
  const settings = new GitRemoteSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.list().verbose().run();
  return parseRemoteList(output.stdout);
}

/** Settings for `git ls-remote`. */
export class GitLsRemoteSettings extends GitSettings {
  #remote?: string;
  #patterns: string[] = [];
  #heads = false;
  #tags = false;
  #refs = false;
  #symref = false;
  #exitCode = false;

  /** The remote (or URL) to ask; defaults to the branch's upstream. */
  remote(nameOrUrl: string): this {
    this.#remote = nameOrUrl;
    return this;
  }

  /** Limit the listing to refs matching these patterns (positional); repeatable. */
  patterns(...values: string[]): this {
    this.#patterns.push(...values);
    return this;
  }

  /** List branch refs only (`--heads`). */
  heads(): this {
    this.#heads = true;
    return this;
  }

  /** List tag refs only (`--tags`). */
  tags(): this {
    this.#tags = true;
    return this;
  }

  /** Hide peeled tags and pseudo-refs (`--refs`). */
  refs(): this {
    this.#refs = true;
    return this;
  }

  /** Also report what the remote's `HEAD` points at (`--symref`). */
  symref(): this {
    this.#symref = true;
    return this;
  }

  /** Exit 2 when nothing matched (`--exit-code`). */
  exitCode(): this {
    this.#exitCode = true;
    return this;
  }

  /** Assemble the `git ls-remote` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#remote === undefined && this.#patterns.length > 0) {
      throw new Error(
        "GitTasks.lsRemote: .patterns(...) follow the remote — call " +
          ".remote(...) so git does not read the first pattern as one.",
      );
    }
    const argv = ["ls-remote"];
    if (this.#heads) argv.push("--heads");
    if (this.#tags) argv.push("--tags");
    if (this.#refs) argv.push("--refs");
    if (this.#symref) argv.push("--symref");
    if (this.#exitCode) argv.push("--exit-code");
    if (this.#remote !== undefined) argv.push(this.#remote);
    argv.push(...this.#patterns);
    return argv;
  }
}
