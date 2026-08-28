// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that move images between this daemon, a registry, and a tar
 * archive: `docker images`, `pull`, `push`, `tag`, `rmi`, `save`, `load`,
 * `history`, `import`, and `image prune`.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.pull((s) => s.image("alpine:3.20").platform("linux/amd64"));
 * await DockerTasks.save((s) => s.images("app:latest").output("app.tar"));
 * const images = await DockerTasks.imageEntries();
 * ```
 *
 * {@link "./docker.ts".DockerTasks.imageEntries} hands back parsed entries
 * from `--format '{{json .}}'`, so a cleanup target reads what is on the
 * daemon instead of scraping a column-aligned table.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { DockerSettings } from "./settings.ts";
import { parseJsonLines, stringField } from "./json_lines.ts";

/** Settings for `docker images`. */
export class DockerImagesSettings extends DockerSettings {
  #all = false;
  #quiet = false;
  #filters: string[] = [];
  #repository?: string;
  #format?: string;
  #digests = false;

  /** Show all images, including intermediate layers (`-a`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Only show image IDs (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Filter the listing (`--filter`); repeatable. */
  filter(expression: string): this {
    this.#filters.push("--filter", expression);
    return this;
  }

  /** Restrict to a repository (positional argument). */
  repository(name: string): this {
    this.#repository = name;
    return this;
  }

  /**
   * Render each image through a Go template (`--format`), e.g.
   * `{{json .}}` for one JSON object per line.
   * {@link "./docker.ts".DockerTasks.imageEntries} pins that form.
   */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Also show each image's digest (`--digests`). */
  digests(): this {
    this.#digests = true;
    return this;
  }

  /** Assemble the `docker images` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["images"];
    if (this.#all) argv.push("-a");
    if (this.#quiet) argv.push("-q");
    if (this.#digests) argv.push("--digests");
    argv.push(...this.#filters);
    if (this.#format !== undefined) argv.push("--format", this.#format);
    if (this.#repository !== undefined) argv.push(this.#repository);
    return argv;
  }
}

/** Settings for `docker pull`. */
export class DockerPullSettings extends DockerSettings {
  #image?: string;
  #platform?: string;
  #quiet = false;

  /** The image reference to pull (required). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** Pull a specific platform (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Suppress verbose output (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Assemble the `docker pull` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#image === undefined) {
      throw new Error("DockerTasks.pull: .image() is required.");
    }
    const argv = ["pull"];
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    if (this.#quiet) argv.push("-q");
    argv.push(this.#image);
    return argv;
  }
}

/** Settings for `docker push`. */
export class DockerPushSettings extends DockerSettings {
  #image?: string;
  #allTags = false;

  /** The image reference to push (required). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** Push every tag of the repository (`--all-tags`). */
  allTags(): this {
    this.#allTags = true;
    return this;
  }

  /** Assemble the `docker push` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#image === undefined) {
      throw new Error("DockerTasks.push: .image() is required.");
    }
    const argv = ["push"];
    if (this.#allTags) argv.push("--all-tags");
    argv.push(this.#image);
    return argv;
  }
}

/** Settings for `docker tag`. */
export class DockerTagSettings extends DockerSettings {
  #source?: string;
  #target?: string;

  /** The existing image reference (required). */
  source(reference: string): this {
    this.#source = reference;
    return this;
  }

  /** The new image reference (required). */
  target(reference: string): this {
    this.#target = reference;
    return this;
  }

  /** Assemble the `docker tag` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#source === undefined || this.#target === undefined) {
      throw new Error("DockerTasks.tag: .source() and .target() are required.");
    }
    return ["tag", this.#source, this.#target];
  }
}

/** Settings for `docker rmi`. */
export class DockerRmiSettings extends DockerSettings {
  #images: string[] = [];
  #force = false;

  /** The images to remove (at least one is required). */
  images(...references: string[]): this {
    this.#images.push(...references);
    return this;
  }

  /** Force removal (`-f`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `docker rmi` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#images.length === 0) {
      throw new Error("DockerTasks.rmi: at least one image is required.");
    }
    const argv = ["rmi"];
    if (this.#force) argv.push("-f");
    argv.push(...this.#images);
    return argv;
  }
}

/** Settings for `docker save`. */
export class DockerSaveSettings extends DockerSettings {
  #images: string[] = [];
  #output?: string;

  /** The images to save (at least one is required). */
  images(...references: string[]): this {
    this.#images.push(...references);
    return this;
  }

  /** Write to a file instead of STDOUT (`-o`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Assemble the `docker save` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#images.length === 0) {
      throw new Error("DockerTasks.save: at least one image is required.");
    }
    const argv = ["save"];
    if (this.#output !== undefined) argv.push("-o", this.#output);
    argv.push(...this.#images);
    return argv;
  }
}

/** Settings for `docker load`. */
export class DockerLoadSettings extends DockerSettings {
  #input?: string;
  #quiet = false;

  /** Read from a tar archive instead of STDIN (`-i`). */
  input(path: PathLike): this {
    this.#input = String(path);
    return this;
  }

  /** Suppress the load output (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Assemble the `docker load` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["load"];
    if (this.#input !== undefined) argv.push("-i", this.#input);
    if (this.#quiet) argv.push("-q");
    return argv;
  }
}

/** The shape of {@link DockerTasks}. */

/** Settings for `docker history`. */
export class DockerHistorySettings extends DockerSettings {
  #image?: string;
  #noTrunc = false;
  #quietOutput = false;
  #format?: string;

  /** The image whose layers to show (required). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** Print the full commands rather than eliding them (`--no-trunc`). */
  noTrunc(): this {
    this.#noTrunc = true;
    return this;
  }

  /** Only show layer ids (`-q`/`--quiet`). */
  quietOutput(): this {
    this.#quietOutput = true;
    return this;
  }

  /** Render each layer through a Go template (`--format`). */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Assemble the `docker history` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#image === undefined) {
      throw new Error("DockerTasks.history: .image() is required.");
    }
    const argv = ["history"];
    if (this.#noTrunc) argv.push("--no-trunc");
    if (this.#quietOutput) argv.push("--quiet");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    argv.push(this.#image);
    return argv;
  }
}

/** Settings for `docker import`. */
export class DockerImportSettings extends DockerSettings {
  #source?: string;
  #reference?: string;
  #message?: string;
  #changes: string[] = [];
  #platform?: string;

  /**
   * The tarball to import (required); `-` reads it from stdin, as docker's own
   * `import` does.
   */
  source(path: PathLike): this {
    this.#source = String(path);
    return this;
  }

  /** The image name to give the result (positional). */
  reference(name: string): this {
    this.#reference = name;
    return this;
  }

  /** A commit message for the imported image (`-m`/`--message`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Apply a Dockerfile instruction to the result (`-c`/`--change`); repeatable. */
  change(...instructions: string[]): this {
    this.#changes.push(...instructions);
    return this;
  }

  /** The platform to import for (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Assemble the `docker import` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#source === undefined) {
      throw new Error(
        "DockerTasks.import: .source() is required — the tarball to import, " +
          'or "-" to read it from stdin.',
      );
    }
    const argv = ["import"];
    if (this.#message !== undefined) argv.push("--message", this.#message);
    for (const change of this.#changes) argv.push("--change", change);
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    argv.push(this.#source);
    if (this.#reference !== undefined) argv.push(this.#reference);
    return argv;
  }
}

/** Settings for `docker image prune`. */
export class DockerImagePruneSettings extends DockerSettings {
  #all = false;
  #force = false;
  #filters: string[] = [];

  /**
   * Remove every unused image, not only the dangling ones (`--all`). This is
   * the difference between reclaiming a little space and reclaiming a lot.
   */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Do not prompt for confirmation (`--force`), which a build always needs. */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Limit what is pruned (`--filter`), e.g. `until=24h`; repeatable. */
  filter(...expressions: string[]): this {
    this.#filters.push(...expressions);
    return this;
  }

  /** Assemble the `docker image prune` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["image", "prune"];
    if (this.#all) argv.push("--all");
    if (this.#force) argv.push("--force");
    for (const expression of this.#filters) argv.push("--filter", expression);
    return argv;
  }
}

/** One image of `docker images --format '{{json .}}'`. */
export interface DockerImageEntry {
  /** The image id, as docker abbreviates it in a listing. */
  id?: string;
  /** The repository, or `<none>` for an untagged image. */
  repository?: string;
  /** The tag, or `<none>` when the image carries none. */
  tag?: string;
  /** How docker describes the image's age, e.g. `2 days ago`. */
  createdSince?: string;
  /** The on-disk size, as docker formats it. */
  size?: string;
  /** The digest, when the listing was asked for one. */
  digest?: string;
}

/**
 * Parse `docker images --format '{{json .}}'` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseImageEntries(stdout: string): DockerImageEntry[] {
  return parseJsonLines(stdout).map((record) => {
    const entry: DockerImageEntry = {};
    const id = stringField(record, "ID");
    const repository = stringField(record, "Repository");
    const tag = stringField(record, "Tag");
    const createdSince = stringField(record, "CreatedSince");
    const size = stringField(record, "Size");
    const digest = stringField(record, "Digest");
    if (id !== undefined) entry.id = id;
    if (repository !== undefined) entry.repository = repository;
    if (tag !== undefined) entry.tag = tag;
    if (createdSince !== undefined) entry.createdSince = createdSince;
    if (size !== undefined) entry.size = size;
    if (digest !== undefined) entry.digest = digest;
    return entry;
  });
}

/**
 * Run `docker images --format '{{json .}}'` and parse it. Backs
 * {@link "./docker.ts".DockerTasks.imageEntries}.
 */
export async function readImageEntries(
  configure?: Configure<DockerImagesSettings>,
): Promise<DockerImageEntry[]> {
  const settings = new DockerImagesSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.format("{{json .}}").run();
  return parseImageEntries(output.stdout);
}
