// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud builds` group — Cloud Build, submitted and inspected from a
 * build.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.buildsSubmit((s) =>
 *   s.source(".").tag(image).timeout("600s")
 * );
 * ```
 *
 * @module
 */

import { GcloudSettings } from "./settings.ts";
import { commaJoined } from "./comma_list.ts";

/** Settings for `gcloud builds submit`. */
export class GcloudBuildsSubmitSettings extends GcloudSettings {
  #source?: string;
  #tag?: string;
  #config?: string;
  #pack?: string;
  #timeout?: string;
  #machineType?: string;
  #substitutions: string[] = [];
  #async = false;
  #gcsSourceStagingDir?: string;
  #ignoreFile?: string;
  #region?: string;

  /** The source to build (positional), e.g. `"."` or a `gs://` archive. */
  source(path: string): this {
    this.#source = path;
    return this;
  }

  /** Build a container and push it to this tag (`--tag`). */
  tag(image: string): this {
    this.#tag = image;
    return this;
  }

  /** Build from a config file (`--config`), e.g. `cloudbuild.yaml`. */
  config(path: string): this {
    this.#config = path;
    return this;
  }

  /** Build with buildpacks (`--pack`), e.g. `"image=gcr.io/p/i"`. */
  pack(spec: string): this {
    this.#pack = spec;
    return this;
  }

  /** Fail the build after this long (`--timeout`), e.g. `"600s"`. */
  timeout(value: string): this {
    this.#timeout = value;
    return this;
  }

  /** The machine type to build on (`--machine-type`). */
  machineType(value: string): this {
    this.#machineType = value;
    return this;
  }

  /** Substitution values for the config (`--substitutions`); repeatable. */
  substitutions(...pairs: string[]): this {
    this.#substitutions.push(...pairs);
    return this;
  }

  /** Return as soon as the build is queued (`--async`). */
  async(): this {
    this.#async = true;
    return this;
  }

  /** Stage the source under this bucket path (`--gcs-source-staging-dir`). */
  gcsSourceStagingDir(uri: string): this {
    this.#gcsSourceStagingDir = uri;
    return this;
  }

  /** Exclude files matching this ignore file (`--ignore-file`). */
  ignoreFile(path: string): this {
    this.#ignoreFile = path;
    return this;
  }

  /** The region to build in (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** Emit `builds submit` with its source and flags. */
  protected override leadingTokens(): string[] {
    // gcloud: "argument --config: At most one of --config | --pack | --tag can
    // be specified." Each is a different way to say what to build.
    const chosen = [
      [".tag()", this.#tag],
      [".config()", this.#config],
      [".pack()", this.#pack],
    ].filter(([, value]) => value !== undefined).map(([name]) => name);
    if (chosen.length > 1) {
      throw new Error(
        `GcloudTasks.buildsSubmit: ${
          chosen.join(" and ")
        } each describe what ` +
          "to build, and gcloud accepts at most one of --config, --pack and " +
          "--tag. Keep one.",
      );
    }
    const argv = ["builds", "submit"];
    if (this.#source !== undefined) argv.push(this.#source);
    if (this.#tag !== undefined) argv.push("--tag", this.#tag);
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#pack !== undefined) argv.push("--pack", this.#pack);
    if (this.#timeout !== undefined) argv.push("--timeout", this.#timeout);
    if (this.#machineType !== undefined) {
      argv.push("--machine-type", this.#machineType);
    }
    if (this.#substitutions.length > 0) {
      argv.push(
        "--substitutions",
        commaJoined(this.#substitutions, "buildsSubmit", "--substitutions"),
      );
    }
    if (this.#async) argv.push("--async");
    if (this.#gcsSourceStagingDir !== undefined) {
      argv.push("--gcs-source-staging-dir", this.#gcsSourceStagingDir);
    }
    if (this.#ignoreFile !== undefined) {
      argv.push("--ignore-file", this.#ignoreFile);
    }
    if (this.#region !== undefined) argv.push("--region", this.#region);
    return argv;
  }
}

/** Settings for `gcloud builds list`. */
export class GcloudBuildsListSettings extends GcloudSettings {
  #limit?: number;
  #filter?: string;
  #region?: string;
  #ongoing = false;

  /** Return at most this many builds (`--limit`). */
  limit(value: number): this {
    this.#limit = value;
    return this;
  }

  /** Restrict the listing (`--filter`), e.g. `"status=SUCCESS"`. */
  filter(expression: string): this {
    this.#filter = expression;
    return this;
  }

  /** The region to list from (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** Only builds that have not finished (`--ongoing`). */
  ongoing(): this {
    this.#ongoing = true;
    return this;
  }

  /** Emit `builds list` with its flags. */
  protected override leadingTokens(): string[] {
    const argv = ["builds", "list"];
    if (this.#limit !== undefined) {
      // gcloud: "argument --limit: Value must be greater than or equal to 1".
      if (!Number.isInteger(this.#limit) || this.#limit < 1) {
        throw new Error(
          `GcloudTasks.buildsList: .limit(${this.#limit}) is not a count — ` +
            "gcloud requires a whole number of at least 1.",
        );
      }
      argv.push("--limit", String(this.#limit));
    }
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#ongoing) argv.push("--ongoing");
    return argv;
  }
}

/** Settings for `gcloud builds describe`. */
export class GcloudBuildsDescribeSettings extends GcloudSettings {
  #build?: string;
  #region?: string;

  /** The build to describe (positional). */
  build(id: string): this {
    this.#build = id;
    return this;
  }

  /** The region it ran in (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** Emit `builds describe` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#build === undefined) {
      throw new Error(
        "GcloudTasks.buildsDescribe: no build named — add .build(id).",
      );
    }
    const argv = ["builds", "describe", this.#build];
    if (this.#region !== undefined) argv.push("--region", this.#region);
    return argv;
  }
}

/** Settings for `gcloud builds log`. */
export class GcloudBuildsLogSettings extends GcloudSettings {
  #build?: string;
  #stream = false;
  #region?: string;

  /** The build whose log to read (positional). */
  build(id: string): this {
    this.#build = id;
    return this;
  }

  /**
   * Follow the log until the build finishes (`--stream`), which makes the task
   * block for the build's duration rather than returning what exists now.
   */
  stream(): this {
    this.#stream = true;
    return this;
  }

  /** The region it ran in (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** Emit `builds log` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#build === undefined) {
      throw new Error(
        "GcloudTasks.buildsLog: no build named — add .build(id).",
      );
    }
    const argv = ["builds", "log", this.#build];
    if (this.#stream) argv.push("--stream");
    if (this.#region !== undefined) argv.push("--region", this.#region);
    return argv;
  }
}
