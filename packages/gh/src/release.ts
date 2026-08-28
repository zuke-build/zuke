// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `gh release` — publishing and reading releases: create, list, view, upload,
 * download, edit, and delete.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.releaseCreate((s) => s.tag("v1.2.3").generateNotes().latest());
 * await GhTasks.releaseUpload((s) => s.tag("v1.2.3").files("dist/app.tgz").clobber());
 * const published = await GhTasks.releaseListEntries((s) => s.excludeDrafts());
 * ```
 *
 * {@link "./gh.ts".GhTasks.uploadReleaseAsset} and
 * {@link "./gh.ts".GhTasks.markReleaseLatest} remain the REST paths for two of
 * these: they need a token but no `gh` binary, where these need `gh` and its
 * own auth. Reach for whichever the build already has.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import {
  GhCommandSettings,
  GhReadSettings,
  GhWebReadSettings,
} from "./subcommand.ts";
import { booleanField, parseJsonArray, stringField } from "./json_array.ts";

/** Settings for `gh release create`. */
export class GhReleaseCreateSettings extends GhCommandSettings {
  #tag?: string;
  #files: string[] = [];
  #title?: string;
  #notes?: string;
  #notesFile?: string;
  #notesStartTag?: string;
  #notesFromTag = false;
  #generateNotes = false;
  #draft = false;
  #prerelease = false;
  #latest = false;
  #target?: string;
  #discussionCategory?: string;
  #verifyTag = false;
  #failOnNoCommits = false;

  /** The tag to release (required); gh creates it when it does not exist. */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /**
   * Asset files to attach (positional); repeatable. gh reads a `#label`
   * suffix on a path as the asset's display label.
   */
  files(...paths: PathLike[]): this {
    this.#files.push(...paths.map(String));
    return this;
  }

  /** The release title (`--title`). */
  title(text: string): this {
    this.#title = text;
    return this;
  }

  /** The release notes (`--notes`). */
  notes(text: string): this {
    this.#notes = text;
    return this;
  }

  /** Read the notes from a file (`--notes-file`); `-` reads standard input. */
  notesFile(path: PathLike): this {
    this.#notesFile = String(path);
    return this;
  }

  /** Have GitHub write the title and notes (`--generate-notes`). */
  generateNotes(): this {
    this.#generateNotes = true;
    return this;
  }

  /** Take the notes from the tag's annotation (`--notes-from-tag`). */
  notesFromTag(): this {
    this.#notesFromTag = true;
    return this;
  }

  /** Generate notes starting from this tag (`--notes-start-tag`). */
  notesStartTag(name: string): this {
    this.#notesStartTag = name;
    return this;
  }

  /** Save it as a draft rather than publishing (`--draft`). */
  draft(): this {
    this.#draft = true;
    return this;
  }

  /** Mark it a prerelease (`--prerelease`). */
  prerelease(): this {
    this.#prerelease = true;
    return this;
  }

  /** Mark it the latest release (`--latest`). */
  latest(): this {
    this.#latest = true;
    return this;
  }

  /** The branch or commit to tag (`--target`). */
  target(branchOrSha: string): this {
    this.#target = branchOrSha;
    return this;
  }

  /** Open a discussion in this category (`--discussion-category`). */
  discussionCategory(name: string): this {
    this.#discussionCategory = name;
    return this;
  }

  /** Abort unless the tag already exists on the remote (`--verify-tag`). */
  verifyTag(): this {
    this.#verifyTag = true;
    return this;
  }

  /** Fail when there are no commits since the last release (`--fail-on-no-commits`). */
  failOnNoCommits(): this {
    this.#failOnNoCommits = true;
    return this;
  }

  /** The `gh release create` command path, with the tag and any assets. */
  protected override commandPath(): string[] {
    if (this.#tag === undefined) {
      throw new Error("GhTasks.releaseCreate: .tag(...) is required.");
    }
    return ["release", "create", this.#tag, ...this.#files];
  }

  /** Assemble the `gh release create` flags. */
  protected override commandFlags(): string[] {
    if (this.#notes !== undefined && this.#notesFile !== undefined) {
      throw new Error(
        "GhTasks.releaseCreate: .notes(...) and .notesFile(...) are two " +
          "sources for the same text — pick one.",
      );
    }
    if (this.#draft && this.#latest) {
      throw new Error(
        "GhTasks.releaseCreate: a draft is not published, so it cannot also " +
          "be the latest release — drop one.",
      );
    }
    const argv: string[] = [];
    if (this.#title !== undefined) argv.push("--title", this.#title);
    if (this.#notes !== undefined) argv.push("--notes", this.#notes);
    if (this.#notesFile !== undefined) {
      argv.push("--notes-file", this.#notesFile);
    }
    if (this.#generateNotes) argv.push("--generate-notes");
    if (this.#notesFromTag) argv.push("--notes-from-tag");
    if (this.#notesStartTag !== undefined) {
      argv.push("--notes-start-tag", this.#notesStartTag);
    }
    if (this.#draft) argv.push("--draft");
    if (this.#prerelease) argv.push("--prerelease");
    if (this.#latest) argv.push("--latest");
    if (this.#target !== undefined) argv.push("--target", this.#target);
    if (this.#discussionCategory !== undefined) {
      argv.push("--discussion-category", this.#discussionCategory);
    }
    if (this.#verifyTag) argv.push("--verify-tag");
    if (this.#failOnNoCommits) argv.push("--fail-on-no-commits");
    return argv;
  }
}

/** Settings for `gh release list`. */
export class GhReleaseListSettings extends GhReadSettings {
  #limit?: number;
  #order?: string;
  #excludeDrafts = false;
  #excludePreReleases = false;

  /** Cap how many are fetched (`--limit`); gh's default is 30. */
  limit(count: number): this {
    this.#limit = count;
    return this;
  }

  /** The order they come back in (`--order`): `asc` or `desc`. */
  order(direction: "asc" | "desc"): this {
    this.#order = direction;
    return this;
  }

  /** Leave out drafts (`--exclude-drafts`). */
  excludeDrafts(): this {
    this.#excludeDrafts = true;
    return this;
  }

  /** Leave out prereleases (`--exclude-pre-releases`). */
  excludePreReleases(): this {
    this.#excludePreReleases = true;
    return this;
  }

  /** The `gh release list` command path. */
  protected override commandPath(): string[] {
    return ["release", "list"];
  }

  /** Assemble the `gh release list` flags. */
  protected override commandFlags(): string[] {
    const argv: string[] = [];
    if (this.#excludeDrafts) argv.push("--exclude-drafts");
    if (this.#excludePreReleases) argv.push("--exclude-pre-releases");
    if (this.#order !== undefined) argv.push("--order", this.#order);
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    argv.push(...this.readFlags());
    return argv;
  }
}

/** Settings for `gh release view`. */
export class GhReleaseViewSettings extends GhWebReadSettings {
  #tag?: string;

  /** The release's tag; gh shows the latest release when it is omitted. */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /** The `gh release view` command path. */
  protected override commandPath(): string[] {
    const argv = ["release", "view"];
    if (this.#tag !== undefined) argv.push(this.#tag);
    return argv;
  }

  /** Assemble the `gh release view` flags. */
  protected override commandFlags(): string[] {
    return this.readFlags();
  }
}

/** Settings for `gh release upload`. */
export class GhReleaseUploadSettings extends GhCommandSettings {
  #tag?: string;
  #files: string[] = [];
  #clobber = false;

  /** The release's tag (required). */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /**
   * Asset files to attach (required); repeatable. gh reads a `#label` suffix
   * on a path as the asset's display label.
   */
  files(...paths: PathLike[]): this {
    this.#files.push(...paths.map(String));
    return this;
  }

  /** Replace an asset of the same name (`--clobber`). */
  clobber(): this {
    this.#clobber = true;
    return this;
  }

  /** The `gh release upload` command path, with the tag and the assets. */
  protected override commandPath(): string[] {
    if (this.#tag === undefined || this.#files.length === 0) {
      throw new Error(
        "GhTasks.releaseUpload: .tag(...) and .files(...) are both required — " +
          "the release to attach to, and what to attach.",
      );
    }
    return ["release", "upload", this.#tag, ...this.#files];
  }

  /** Assemble the `gh release upload` flags. */
  protected override commandFlags(): string[] {
    return this.#clobber ? ["--clobber"] : [];
  }
}

/** Settings for `gh release download`. */
export class GhReleaseDownloadSettings extends GhCommandSettings {
  #tag?: string;
  #patterns: string[] = [];
  #dir?: string;
  #output?: string;
  #archive?: string;
  #clobber = false;
  #skipExisting = false;

  /** The release's tag; gh takes the latest release when it is omitted. */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /** Only assets matching this glob (`--pattern`); repeatable. */
  pattern(...globs: string[]): this {
    this.#patterns.push(...globs);
    return this;
  }

  /** The directory to download into (`--dir`). */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Write a single asset to this file (`--output`); `-` writes standard output. */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Download the source archive instead of the assets (`--archive`). */
  archive(format: "zip" | "tar.gz"): this {
    this.#archive = format;
    return this;
  }

  /** Overwrite files that already exist (`--clobber`). */
  clobber(): this {
    this.#clobber = true;
    return this;
  }

  /** Leave files that already exist alone (`--skip-existing`). */
  skipExisting(): this {
    this.#skipExisting = true;
    return this;
  }

  /** The `gh release download` command path. */
  protected override commandPath(): string[] {
    const argv = ["release", "download"];
    if (this.#tag !== undefined) argv.push(this.#tag);
    return argv;
  }

  /** Assemble the `gh release download` flags. */
  protected override commandFlags(): string[] {
    if (this.#clobber && this.#skipExisting) {
      throw new Error(
        "GhTasks.releaseDownload: .clobber() overwrites what exists and " +
          ".skipExisting() leaves it — pick one.",
      );
    }
    if (this.#archive !== undefined && this.#patterns.length > 0) {
      throw new Error(
        "GhTasks.releaseDownload: .archive(...) fetches the source archive, " +
          "which .pattern(...) cannot filter — drop one.",
      );
    }
    const argv: string[] = [];
    for (const glob of this.#patterns) argv.push("--pattern", glob);
    if (this.#archive !== undefined) argv.push("--archive", this.#archive);
    if (this.#dir !== undefined) argv.push("--dir", this.#dir);
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#clobber) argv.push("--clobber");
    if (this.#skipExisting) argv.push("--skip-existing");
    return argv;
  }
}

/** Settings for `gh release edit`. */
export class GhReleaseEditSettings extends GhCommandSettings {
  #tag?: string;
  #newTag?: string;
  #title?: string;
  #notes?: string;
  #notesFile?: string;
  #draft = false;
  #prerelease = false;
  #latest = false;
  #target?: string;
  #discussionCategory?: string;
  #verifyTag = false;

  /** The release to edit, by its current tag (required). */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /** Move the release to a different tag (`--tag`). */
  newTag(name: string): this {
    this.#newTag = name;
    return this;
  }

  /** Set the title (`--title`). */
  title(text: string): this {
    this.#title = text;
    return this;
  }

  /** Set the notes (`--notes`). */
  notes(text: string): this {
    this.#notes = text;
    return this;
  }

  /** Read the notes from a file (`--notes-file`); `-` reads standard input. */
  notesFile(path: PathLike): this {
    this.#notesFile = String(path);
    return this;
  }

  /** Make it a draft (`--draft`). */
  draft(): this {
    this.#draft = true;
    return this;
  }

  /** Mark it a prerelease (`--prerelease`). */
  prerelease(): this {
    this.#prerelease = true;
    return this;
  }

  /** Mark it the latest release (`--latest`). */
  latest(): this {
    this.#latest = true;
    return this;
  }

  /** Change the target branch or commit (`--target`). */
  target(branchOrSha: string): this {
    this.#target = branchOrSha;
    return this;
  }

  /** Open a discussion in this category when publishing (`--discussion-category`). */
  discussionCategory(name: string): this {
    this.#discussionCategory = name;
    return this;
  }

  /** Abort unless the tag exists on the remote (`--verify-tag`). */
  verifyTag(): this {
    this.#verifyTag = true;
    return this;
  }

  /** The `gh release edit` command path. */
  protected override commandPath(): string[] {
    if (this.#tag === undefined) {
      throw new Error(
        "GhTasks.releaseEdit: .tag(...) is required — it names the release to " +
          "edit. Use .newTag(...) to move it to another tag.",
      );
    }
    return ["release", "edit", this.#tag];
  }

  /** Assemble the `gh release edit` flags. */
  protected override commandFlags(): string[] {
    if (this.#notes !== undefined && this.#notesFile !== undefined) {
      throw new Error(
        "GhTasks.releaseEdit: .notes(...) and .notesFile(...) are two sources " +
          "for the same text — pick one.",
      );
    }
    if (this.#draft && this.#latest) {
      throw new Error(
        "GhTasks.releaseEdit: a draft is not published, so it cannot also be " +
          "the latest release — drop one.",
      );
    }
    const argv: string[] = [];
    if (this.#newTag !== undefined) argv.push("--tag", this.#newTag);
    if (this.#title !== undefined) argv.push("--title", this.#title);
    if (this.#notes !== undefined) argv.push("--notes", this.#notes);
    if (this.#notesFile !== undefined) {
      argv.push("--notes-file", this.#notesFile);
    }
    if (this.#draft) argv.push("--draft");
    if (this.#prerelease) argv.push("--prerelease");
    if (this.#latest) argv.push("--latest");
    if (this.#target !== undefined) argv.push("--target", this.#target);
    if (this.#discussionCategory !== undefined) {
      argv.push("--discussion-category", this.#discussionCategory);
    }
    if (this.#verifyTag) argv.push("--verify-tag");
    return argv;
  }
}

/** Settings for `gh release delete`. */
export class GhReleaseDeleteSettings extends GhCommandSettings {
  #tag?: string;
  #cleanupTag = false;
  #yes = false;

  /** The release to delete, by tag (required). */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /** Delete the git tag as well (`--cleanup-tag`). */
  cleanupTag(): this {
    this.#cleanupTag = true;
    return this;
  }

  /** Skip the confirmation prompt (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** The `gh release delete` command path. */
  protected override commandPath(): string[] {
    if (this.#tag === undefined) {
      throw new Error("GhTasks.releaseDelete: .tag(...) is required.");
    }
    return ["release", "delete", this.#tag];
  }

  /** Assemble the `gh release delete` flags. */
  protected override commandFlags(): string[] {
    if (!this.#yes) {
      throw new Error(
        "GhTasks.releaseDelete: gh prompts before deleting, which a build " +
          "cannot answer — add .yes() to mean it.",
      );
    }
    const argv = ["--yes"];
    if (this.#cleanupTag) argv.push("--cleanup-tag");
    return argv;
  }
}

/** One release of {@link "./gh.ts".GhTasks.releaseListEntries}. */
export interface GhReleaseEntry {
  /** The release's tag. */
  tagName?: string;
  /** Its name, which GitHub calls the title. */
  name?: string;
  /** Whether it is still a draft. */
  isDraft?: boolean;
  /** Whether it is marked a prerelease. */
  isPrerelease?: boolean;
  /** Whether it is the latest release. */
  isLatest?: boolean;
  /** When it was published, ISO 8601; absent while it is a draft. */
  publishedAt?: string;
}

/**
 * The `--json` fields {@link readReleases} asks for; gh requires the list by
 * name, so the reader pins the set {@link GhReleaseEntry} describes.
 */
export const RELEASE_LIST_FIELDS: readonly string[] = [
  "tagName",
  "name",
  "isDraft",
  "isPrerelease",
  "isLatest",
  "publishedAt",
];

/**
 * Parse `gh release list --json …` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseReleases(stdout: string): GhReleaseEntry[] {
  return parseJsonArray(stdout).map((record) => {
    const entry: GhReleaseEntry = {};
    const tagName = stringField(record, "tagName");
    const name = stringField(record, "name");
    const isDraft = booleanField(record, "isDraft");
    const isPrerelease = booleanField(record, "isPrerelease");
    const isLatest = booleanField(record, "isLatest");
    const publishedAt = stringField(record, "publishedAt");
    if (tagName !== undefined) entry.tagName = tagName;
    if (name !== undefined) entry.name = name;
    if (isDraft !== undefined) entry.isDraft = isDraft;
    if (isPrerelease !== undefined) entry.isPrerelease = isPrerelease;
    if (isLatest !== undefined) entry.isLatest = isLatest;
    if (publishedAt !== undefined) entry.publishedAt = publishedAt;
    return entry;
  });
}

/**
 * Run `gh release list --json …` and parse it. Backs
 * {@link "./gh.ts".GhTasks.releaseListEntries}.
 */
export async function readReleases(
  configure?: Configure<GhReleaseListSettings>,
): Promise<GhReleaseEntry[]> {
  const settings = new GhReleaseListSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.json(...RELEASE_LIST_FIELDS).run();
  return parseReleases(output.stdout);
}
