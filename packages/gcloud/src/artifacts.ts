// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud artifacts` group — Artifact Registry, where a build's images and
 * packages land.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.artifactsImagesList((s) =>
 *   s.repository("us-central1-docker.pkg.dev/proj/images").includeTags()
 * );
 * ```
 *
 * @module
 */

import { GcloudSettings } from "./settings.ts";

/** Reject a `--limit` gcloud would, with the message it uses. */
function checkLimit(limit: number | undefined, task: string): void {
  if (limit === undefined) return;
  // gcloud: "argument --limit: Value must be greater than or equal to 1".
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `GcloudTasks.${task}: .limit(${limit}) is not a count — gcloud requires ` +
        "a whole number of at least 1.",
    );
  }
}

/** Settings for `gcloud artifacts docker images list`. */
export class GcloudArtifactsImagesListSettings extends GcloudSettings {
  #repository?: string;
  #includeTags = false;
  #limit?: number;
  #filter?: string;

  /** The repository or image to list (positional). */
  repository(path: string): this {
    this.#repository = path;
    return this;
  }

  /** Include each version's tags (`--include-tags`). */
  includeTags(): this {
    this.#includeTags = true;
    return this;
  }

  /** Return at most this many images (`--limit`). */
  limit(value: number): this {
    this.#limit = value;
    return this;
  }

  /** Restrict the listing (`--filter`). */
  filter(expression: string): this {
    this.#filter = expression;
    return this;
  }

  /** Emit `artifacts docker images list` with its operand and flags. */
  protected override leadingTokens(): string[] {
    if (this.#repository === undefined) {
      throw new Error(
        "GcloudTasks.artifactsImagesList: no repository named — add " +
          ".repository('us-central1-docker.pkg.dev/proj/images').",
      );
    }
    checkLimit(this.#limit, "artifactsImagesList");
    const argv = [
      "artifacts",
      "docker",
      "images",
      "list",
      this.#repository,
    ];
    if (this.#includeTags) argv.push("--include-tags");
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    return argv;
  }
}

/** Settings for `gcloud artifacts docker images delete`. */
export class GcloudArtifactsImagesDeleteSettings extends GcloudSettings {
  #image?: string;
  #deleteTags = false;

  /** The image or version to delete (positional). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /**
   * Delete the version even though tags point at it (`--delete-tags`), which
   * gcloud otherwise refuses.
   */
  deleteTags(): this {
    this.#deleteTags = true;
    return this;
  }

  /** Emit `artifacts docker images delete` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#image === undefined) {
      throw new Error(
        "GcloudTasks.artifactsImagesDelete: no image named — add " +
          ".image('…/images/app:tag').",
      );
    }
    const argv = ["artifacts", "docker", "images", "delete", this.#image];
    if (this.#deleteTags) argv.push("--delete-tags");
    return argv;
  }
}

/** Settings for `gcloud artifacts repositories list`. */
export class GcloudArtifactsRepositoriesListSettings extends GcloudSettings {
  #location?: string;
  #limit?: number;

  /** The location to list from (`--location`). */
  location(value: string): this {
    this.#location = value;
    return this;
  }

  /** Return at most this many repositories (`--limit`). */
  limit(value: number): this {
    this.#limit = value;
    return this;
  }

  /** Emit `artifacts repositories list` with its flags. */
  protected override leadingTokens(): string[] {
    checkLimit(this.#limit, "artifactsRepositoriesList");
    const argv = ["artifacts", "repositories", "list"];
    if (this.#location !== undefined) argv.push("--location", this.#location);
    if (this.#limit !== undefined) argv.push("--limit", String(this.#limit));
    return argv;
  }
}

/** Settings for `gcloud artifacts repositories describe`. */
export class GcloudArtifactsRepositoriesDescribeSettings
  extends GcloudSettings {
  #repository?: string;
  #location?: string;

  /** The repository to describe (positional). */
  repository(name: string): this {
    this.#repository = name;
    return this;
  }

  /** The location it lives in (`--location`). */
  location(value: string): this {
    this.#location = value;
    return this;
  }

  /** Emit `artifacts repositories describe` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#repository === undefined) {
      throw new Error(
        "GcloudTasks.artifactsRepositoriesDescribe: no repository named — " +
          "add .repository('images').",
      );
    }
    const argv = ["artifacts", "repositories", "describe", this.#repository];
    if (this.#location !== undefined) argv.push("--location", this.#location);
    return argv;
  }
}
