// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that move content between a container and the host, or turn a
 * container back into an image: `docker cp`, `commit`, and `export`.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * // Recover a test report from a container that has already exited.
 * await DockerTasks.cp((s) => s.from("tests:/out/report.xml").to("reports/"));
 * ```
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { DockerSettings } from "./settings.ts";

/**
 * Settings for `docker cp`. Either end may be a container path
 * (`<container>:<path>`) — which is what makes this the way a build gets an
 * artifact out of a container that has already stopped.
 */
export class DockerCpSettings extends DockerSettings {
  #from?: string;
  #to?: string;
  #archive = false;
  #followLink = false;

  /** The source, `<container>:<path>` or a host path (required). */
  from(path: PathLike): this {
    this.#from = String(path);
    return this;
  }

  /** The destination, `<container>:<path>` or a host path (required). */
  to(path: PathLike): this {
    this.#to = String(path);
    return this;
  }

  /** Keep uid/gid rather than mapping to the current user (`-a`/`--archive`). */
  archive(): this {
    this.#archive = true;
    return this;
  }

  /** Follow a symlink in the source (`-L`/`--follow-link`). */
  followLink(): this {
    this.#followLink = true;
    return this;
  }

  /** Assemble the `docker cp` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#from === undefined || this.#to === undefined) {
      throw new Error(
        "DockerTasks.cp: .from(...) and .to(...) are both required — one of " +
          "them names a container path as `<container>:<path>`.",
      );
    }
    const argv = ["cp"];
    if (this.#archive) argv.push("--archive");
    if (this.#followLink) argv.push("--follow-link");
    argv.push(this.#from, this.#to);
    return argv;
  }
}

/** Settings for `docker commit`. */
export class DockerCommitSettings extends DockerSettings {
  #container?: string;
  #reference?: string;
  #message?: string;
  #author?: string;
  #changes: string[] = [];
  #pause = true;

  /** The container to snapshot (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** The image name to give the snapshot (positional). */
  reference(name: string): this {
    this.#reference = name;
    return this;
  }

  /** A commit message (`-m`/`--message`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** The author to record (`-a`/`--author`). */
  author(value: string): this {
    this.#author = value;
    return this;
  }

  /** Apply a Dockerfile instruction to the result (`-c`/`--change`); repeatable. */
  change(...instructions: string[]): this {
    this.#changes.push(...instructions);
    return this;
  }

  /**
   * Leave the container running while it is committed (`--pause=false`).
   * docker pauses it by default, which is what makes the snapshot consistent.
   */
  noPause(): this {
    this.#pause = false;
    return this;
  }

  /** Assemble the `docker commit` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#container === undefined) {
      throw new Error("DockerTasks.commit: .container() is required.");
    }
    const argv = ["commit"];
    if (this.#message !== undefined) argv.push("--message", this.#message);
    if (this.#author !== undefined) argv.push("--author", this.#author);
    for (const change of this.#changes) argv.push("--change", change);
    if (!this.#pause) argv.push("--pause=false");
    argv.push(this.#container);
    if (this.#reference !== undefined) argv.push(this.#reference);
    return argv;
  }
}

/** Settings for `docker export`. */
export class DockerExportSettings extends DockerSettings {
  #container?: string;
  #output?: string;

  /** The container whose filesystem to export (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** Write to a file rather than stdout (`-o`/`--output`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Assemble the `docker export` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#container === undefined) {
      throw new Error("DockerTasks.export: .container() is required.");
    }
    const argv = ["export"];
    if (this.#output !== undefined) argv.push("--output", this.#output);
    argv.push(this.#container);
    return argv;
  }
}
