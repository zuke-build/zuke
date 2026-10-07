// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws s3` commands — the high-level transfer commands for moving a
 * build's artifacts in and out of S3.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * await AwsTasks.s3Sync((s) =>
 *   s.source("dist").destination("s3://releases/app").delete()
 *     .exclude("*.map").cacheControl("max-age=300")
 * );
 * ```
 *
 * `--exclude` and `--include` are applied by the CLI in the order given, and
 * the later filter wins, so they are kept in call order here.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import { AwsSettings } from "./settings.ts";
import { operand, option } from "./validate.ts";

/** Settings for `aws s3 cp`. */
export class AwsS3CpSettings extends AwsSettings {
  #source?: string;
  #destination?: string;
  #recursive = false;
  readonly #filters: string[] = [];
  #dryrun = false;
  #acl?: string;
  #contentType?: string;
  #cacheControl?: string;
  #storageClass?: string;
  #sse?: string;
  #sseKmsKeyId?: string;
  #onlyShowErrors = false;
  #noProgress = false;

  /** The local path or `s3://` URI to copy from (positional). */
  source(path: string): this {
    this.#source = path;
    return this;
  }

  /** The local path or `s3://` URI to copy to (positional). */
  destination(path: string): this {
    this.#destination = path;
    return this;
  }

  /** Copy every file under a directory or prefix (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Skip files matching the pattern (`--exclude`); repeatable, order kept. */
  exclude(pattern: string): this {
    this.#filters.push(option("--exclude", pattern));
    return this;
  }

  /** Copy files matching the pattern despite an earlier exclude (`--include`). */
  include(pattern: string): this {
    this.#filters.push(option("--include", pattern));
    return this;
  }

  /** Print what would be copied without copying it (`--dryrun`). */
  dryrun(): this {
    this.#dryrun = true;
    return this;
  }

  /** A canned ACL for the uploaded objects (`--acl`), e.g. `"private"`. */
  acl(value: string): this {
    this.#acl = value;
    return this;
  }

  /** The uploaded objects' content type (`--content-type`). */
  contentType(value: string): this {
    this.#contentType = value;
    return this;
  }

  /** The uploaded objects' `Cache-Control` (`--cache-control`). */
  cacheControl(value: string): this {
    this.#cacheControl = value;
    return this;
  }

  /** The storage class for the uploaded objects (`--storage-class`). */
  storageClass(value: string): this {
    this.#storageClass = value;
    return this;
  }

  /** Server-side encryption (`--sse`): `"AES256"` or `"aws:kms"`. */
  sse(value: string): this {
    this.#sse = value;
    return this;
  }

  /** The KMS key for `aws:kms` server-side encryption (`--sse-kms-key-id`). */
  sseKmsKeyId(id: string): this {
    this.#sseKmsKeyId = id;
    return this;
  }

  /** Print only errors and warnings (`--only-show-errors`). */
  onlyShowErrors(): this {
    this.#onlyShowErrors = true;
    return this;
  }

  /** Leave out the file-transfer progress lines (`--no-progress`). */
  noProgress(): this {
    this.#noProgress = true;
    return this;
  }

  /** Emit `s3 cp` with its operands and options. */
  protected override leadingTokens(): string[] {
    if (this.#source === undefined || this.#destination === undefined) {
      throw new Error(
        "AwsTasks.s3Cp: a copy needs both ends — add .source(path) and " +
          ".destination('s3://bucket/key').",
      );
    }
    const argv = [
      "s3",
      "cp",
      operand("s3Cp", "source", this.#source),
      operand("s3Cp", "destination", this.#destination),
    ];
    if (this.#recursive) argv.push("--recursive");
    argv.push(...this.#filters);
    if (this.#dryrun) argv.push("--dryrun");
    if (this.#acl !== undefined) argv.push(option("--acl", this.#acl));
    if (this.#contentType !== undefined) {
      argv.push(option("--content-type", this.#contentType));
    }
    if (this.#cacheControl !== undefined) {
      argv.push(option("--cache-control", this.#cacheControl));
    }
    if (this.#storageClass !== undefined) {
      argv.push(option("--storage-class", this.#storageClass));
    }
    if (this.#sse !== undefined) argv.push(option("--sse", this.#sse));
    if (this.#sseKmsKeyId !== undefined) {
      argv.push(option("--sse-kms-key-id", this.#sseKmsKeyId));
    }
    if (this.#onlyShowErrors) argv.push("--only-show-errors");
    if (this.#noProgress) argv.push("--no-progress");
    return argv;
  }
}

/** Settings for `aws s3 sync`. */
export class AwsS3SyncSettings extends AwsSettings {
  #source?: string;
  #destination?: string;
  #delete = false;
  readonly #filters: string[] = [];
  #dryrun = false;
  #exactTimestamps = false;
  #sizeOnly = false;
  #acl?: string;
  #contentType?: string;
  #cacheControl?: string;
  #storageClass?: string;
  #onlyShowErrors = false;
  #noProgress = false;

  /** The local directory or `s3://` prefix to sync from (positional). */
  source(path: string): this {
    this.#source = path;
    return this;
  }

  /** The local directory or `s3://` prefix to sync to (positional). */
  destination(path: string): this {
    this.#destination = path;
    return this;
  }

  /**
   * Delete files at the destination that the source does not have
   * (`--delete`), which makes the destination a mirror rather than a superset.
   */
  delete(): this {
    this.#delete = true;
    return this;
  }

  /** Skip files matching the pattern (`--exclude`); repeatable, order kept. */
  exclude(pattern: string): this {
    this.#filters.push(option("--exclude", pattern));
    return this;
  }

  /** Sync files matching the pattern despite an earlier exclude (`--include`). */
  include(pattern: string): this {
    this.#filters.push(option("--include", pattern));
    return this;
  }

  /** Print what would change without changing it (`--dryrun`). */
  dryrun(): this {
    this.#dryrun = true;
    return this;
  }

  /** Treat same-size files with different timestamps as changed (`--exact-timestamps`). */
  exactTimestamps(): this {
    this.#exactTimestamps = true;
    return this;
  }

  /** Compare by size alone, ignoring timestamps (`--size-only`). */
  sizeOnly(): this {
    this.#sizeOnly = true;
    return this;
  }

  /** A canned ACL for the uploaded objects (`--acl`). */
  acl(value: string): this {
    this.#acl = value;
    return this;
  }

  /** The uploaded objects' content type (`--content-type`). */
  contentType(value: string): this {
    this.#contentType = value;
    return this;
  }

  /** The uploaded objects' `Cache-Control` (`--cache-control`). */
  cacheControl(value: string): this {
    this.#cacheControl = value;
    return this;
  }

  /** The storage class for the uploaded objects (`--storage-class`). */
  storageClass(value: string): this {
    this.#storageClass = value;
    return this;
  }

  /** Print only errors and warnings (`--only-show-errors`). */
  onlyShowErrors(): this {
    this.#onlyShowErrors = true;
    return this;
  }

  /** Leave out the file-transfer progress lines (`--no-progress`). */
  noProgress(): this {
    this.#noProgress = true;
    return this;
  }

  /** Emit `s3 sync` with its operands and options. */
  protected override leadingTokens(): string[] {
    if (this.#source === undefined || this.#destination === undefined) {
      throw new Error(
        "AwsTasks.s3Sync: a sync needs both ends — add .source(path) and " +
          ".destination('s3://bucket/prefix').",
      );
    }
    const argv = [
      "s3",
      "sync",
      operand("s3Sync", "source", this.#source),
      operand("s3Sync", "destination", this.#destination),
    ];
    if (this.#delete) argv.push("--delete");
    argv.push(...this.#filters);
    if (this.#dryrun) argv.push("--dryrun");
    if (this.#exactTimestamps) argv.push("--exact-timestamps");
    if (this.#sizeOnly) argv.push("--size-only");
    if (this.#acl !== undefined) argv.push(option("--acl", this.#acl));
    if (this.#contentType !== undefined) {
      argv.push(option("--content-type", this.#contentType));
    }
    if (this.#cacheControl !== undefined) {
      argv.push(option("--cache-control", this.#cacheControl));
    }
    if (this.#storageClass !== undefined) {
      argv.push(option("--storage-class", this.#storageClass));
    }
    if (this.#onlyShowErrors) argv.push("--only-show-errors");
    if (this.#noProgress) argv.push("--no-progress");
    return argv;
  }
}

/** Settings for `aws s3 ls`. */
export class AwsS3LsSettings extends AwsSettings {
  #path?: string;
  #recursive = false;
  #humanReadable = false;
  #summarize = false;

  /** The `s3://` URI to list (positional); the buckets when omitted. */
  path(uri: string): this {
    this.#path = uri;
    return this;
  }

  /** List every object under the prefix (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Print sizes as KiB, MiB, … (`--human-readable`). */
  humanReadable(): this {
    this.#humanReadable = true;
    return this;
  }

  /** Print the object count and total size (`--summarize`). */
  summarize(): this {
    this.#summarize = true;
    return this;
  }

  /** Emit `s3 ls` with its operand and options. */
  protected override leadingTokens(): string[] {
    const argv = ["s3", "ls"];
    if (this.#path !== undefined) {
      argv.push(operand("s3Ls", "path", this.#path));
    }
    if (this.#recursive) argv.push("--recursive");
    if (this.#humanReadable) argv.push("--human-readable");
    if (this.#summarize) argv.push("--summarize");
    return argv;
  }
}

/** Settings for `aws s3 rm`. */
export class AwsS3RmSettings extends AwsSettings {
  #path?: string;
  #recursive = false;
  readonly #filters: string[] = [];
  #dryrun = false;

  /** The `s3://` object or prefix to remove (positional). */
  path(uri: string): this {
    this.#path = uri;
    return this;
  }

  /** Remove every object under the prefix (`--recursive`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Keep objects matching the pattern (`--exclude`); repeatable, order kept. */
  exclude(pattern: string): this {
    this.#filters.push(option("--exclude", pattern));
    return this;
  }

  /** Remove objects matching the pattern despite an earlier exclude (`--include`). */
  include(pattern: string): this {
    this.#filters.push(option("--include", pattern));
    return this;
  }

  /** Print what would be removed without removing it (`--dryrun`). */
  dryrun(): this {
    this.#dryrun = true;
    return this;
  }

  /** Emit `s3 rm` with its operand and options. */
  protected override leadingTokens(): string[] {
    if (this.#path === undefined) {
      throw new Error(
        "AwsTasks.s3Rm: nothing to remove — add .path('s3://bucket/key'). " +
          "A delete with no operand is not a no-op worth guessing at.",
      );
    }
    const argv = ["s3", "rm", operand("s3Rm", "path", this.#path)];
    if (this.#recursive) argv.push("--recursive");
    argv.push(...this.#filters);
    if (this.#dryrun) argv.push("--dryrun");
    return argv;
  }
}

/** Settings for `aws s3 mb`. */
export class AwsS3MbSettings extends AwsSettings {
  #bucket?: string;

  /** The bucket to make, as an `s3://` URI (positional). */
  bucket(uri: string): this {
    this.#bucket = uri;
    return this;
  }

  /** Emit `s3 mb` with the bucket. */
  protected override leadingTokens(): string[] {
    if (this.#bucket === undefined) {
      throw new Error(
        "AwsTasks.s3Mb: no bucket named — add .bucket('s3://my-bucket').",
      );
    }
    return ["s3", "mb", operand("s3Mb", "bucket", this.#bucket)];
  }
}

/** The query parameter of a presigned URL that carries the session token. */
const SECURITY_TOKEN = "X-Amz-Security-Token";

/**
 * Settings for `aws s3 presign`.
 *
 * A presigned URL is a bearer credential for the object until it expires:
 * anyone holding it can read the object, and when the build runs on
 * temporary credentials it also carries the session token itself
 * (`X-Amz-Security-Token`), which is good for far more than one object. So
 * the command always runs quietly — the URL is captured, never streamed — and
 * the URL and that token are registered with the run's redactor.
 */
export class AwsS3PresignSettings extends AwsSettings {
  #path?: string;
  #expiresIn?: number;

  /** Settings that capture the URL instead of streaming it. */
  constructor() {
    super();
    this.quiet();
  }

  /** Register the URL, and the session token it carries, as secrets. */
  protected override onOutput(output: CommandOutput): void {
    const url = output.stdout.trim();
    if (url === "") return;
    this.markSecret(url);
    const token = URL.canParse(url)
      ? new URL(url).searchParams.get(SECURITY_TOKEN)
      : null;
    if (token !== null) this.markSecret(token);
  }

  /** The `s3://` object to presign (positional). */
  path(uri: string): this {
    this.#path = uri;
    return this;
  }

  /** How long the URL stays valid, in seconds (`--expires-in`; default 3600). */
  expiresIn(seconds: number): this {
    this.#expiresIn = seconds;
    return this;
  }

  /** Emit `s3 presign` with the object and its lifetime. */
  protected override leadingTokens(): string[] {
    if (this.#path === undefined) {
      throw new Error(
        "AwsTasks.s3Presign: no object named — add .path('s3://bucket/key').",
      );
    }
    const argv = ["s3", "presign", operand("s3Presign", "path", this.#path)];
    if (this.#expiresIn !== undefined) {
      argv.push(option("--expires-in", this.#expiresIn));
    }
    return argv;
  }
}
