// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az storage blob` — uploading and downloading blobs, one or a whole
 * directory.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.storageBlobUploadBatch((s) =>
 *   s.accountName("website").authMode("login")
 *     .source("dist").destination("$web").overwrite(true)
 * );
 * ```
 *
 * Prefer `.authMode("login")`, which uses the signed-in identity. An account
 * key, SAS token or connection string is sent on standard input (`=@-`), so
 * it never enters the argv, and is registered with the run's redactor; the
 * CLI also reads them from `AZURE_STORAGE_KEY`, `AZURE_STORAGE_SAS_TOKEN` and
 * `AZURE_STORAGE_CONNECTION_STRING`.
 *
 * @module
 */

import { AzSettings } from "./settings.ts";
import { bool, fromStdin, option, pair, required } from "./validate.ts";

/**
 * The `sig` of a SAS token in every form a log may show it: as written,
 * percent-decoded, and each of those URL-encoded.
 */
function signatureForms(token: string): string[] {
  const written = /(?:^|[?&])sig=([^&]+)/.exec(token)?.[1];
  if (written === undefined) return [];
  const decoded = percentDecoded(written);
  return [
    ...new Set([
      written,
      decoded,
      encodeURIComponent(written),
      encodeURIComponent(decoded),
    ]),
  ];
}

/** `text` percent-decoded, or as it is when it is not valid encoding. */
function percentDecoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** How a storage command authenticates (`--auth-mode`). */
export type AzStorageAuthMode = "login" | "key";

/**
 * The account and credential options every `storage blob` command takes.
 * One credential at most: the CLI reads it from standard input.
 */
export abstract class AzStorageBlobSettings extends AzSettings {
  #accountName?: string;
  #authMode?: AzStorageAuthMode;
  readonly #credentials: Array<{ flag: string; value: string }> = [];

  /** The storage account (`--account-name`). */
  accountName(name: string): this {
    this.#accountName = name;
    return this;
  }

  /** `login` uses the signed-in identity; `key` an account key (`--auth-mode`). */
  authMode(mode: AzStorageAuthMode): this {
    this.#authMode = mode;
    return this;
  }

  /** The account key (`--account-key`), sent on standard input. */
  accountKey(key: string): this {
    return this.#credential("--account-key", key);
  }

  /**
   * A SAS token (`--sas-token`), sent on standard input. Its signature is
   * registered on its own as well — as written, decoded and URL-encoded —
   * since the CLI's debug log prints the token URL-encoded inside a request
   * URL, where the token as a whole never appears.
   */
  sasToken(token: string): this {
    signatureForms(token).forEach((form) => this.markSecret(form));
    return this.#credential("--sas-token", token);
  }

  /** A connection string (`--connection-string`), sent on standard input. */
  connectionString(connection: string): this {
    return this.#credential("--connection-string", connection);
  }

  /** Keep a credential for standard input and register it as a secret. */
  #credential(flag: string, value: string): this {
    this.#credentials.push({ flag, value });
    this.markSecret(value);
    return this;
  }

  /** The credential, for the CLI to read from standard input. */
  protected override stdinInput(): string | undefined {
    return this.#credentials[0]?.value;
  }

  /** The account and credential options, refused with more than one credential. */
  protected accountTokens(task: string): string[] {
    if (this.#credentials.length > 1) {
      throw new Error(
        `AzTasks.${task}: one credential at most — an account key, a SAS ` +
          "token or a connection string.",
      );
    }
    const argv: string[] = [];
    if (this.#accountName !== undefined) {
      argv.push(option("--account-name", this.#accountName));
    }
    if (this.#authMode !== undefined) {
      argv.push(option("--auth-mode", this.#authMode));
    }
    for (const { flag } of this.#credentials) argv.push(fromStdin(flag));
    return argv;
  }
}

/** Settings for `az storage blob upload`. */
export class AzStorageBlobUploadSettings extends AzStorageBlobSettings {
  #containerName?: string;
  #name?: string;
  #file?: string;
  #overwrite?: boolean;
  #contentType?: string;
  #contentCacheControl?: string;
  readonly #tags: string[] = [];

  /** The container (`--container-name`). */
  containerName(name: string): this {
    this.#containerName = name;
    return this;
  }

  /** The blob's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** The local file to upload (`--file`). */
  file(path: string): this {
    this.#file = path;
    return this;
  }

  /** Replace an existing blob (`--overwrite`). */
  overwrite(value: boolean): this {
    this.#overwrite = value;
    return this;
  }

  /** The blob's MIME type (`--content-type`). */
  contentType(type: string): this {
    this.#contentType = type;
    return this;
  }

  /** The blob's `Cache-Control` (`--content-cache-control`). */
  contentCacheControl(value: string): this {
    this.#contentCacheControl = value;
    return this;
  }

  /** A blob index tag (`--tags key=value`); repeatable. */
  tag(key: string, value: string): this {
    this.#tags.push(pair("storageBlobUpload", "tag", key, value));
    return this;
  }

  /** Emit `storage blob upload` with its options. */
  protected override leadingTokens(): string[] {
    const task = "storageBlobUpload";
    const container = required(
      this.#containerName,
      task,
      "no container — add .containerName('assets').",
    );
    const name = required(this.#name, task, "no blob named — add .name(...).");
    const file = required(this.#file, task, "no file — add .file(path).");
    const argv = [
      "storage",
      "blob",
      "upload",
      ...this.accountTokens(task),
      option("--container-name", container),
      option("--name", name),
      option("--file", file),
    ];
    if (this.#overwrite !== undefined) {
      argv.push(bool("--overwrite", this.#overwrite));
    }
    if (this.#contentType !== undefined) {
      argv.push(option("--content-type", this.#contentType));
    }
    if (this.#contentCacheControl !== undefined) {
      argv.push(option("--content-cache-control", this.#contentCacheControl));
    }
    if (this.#tags.length > 0) argv.push("--tags", ...this.#tags);
    return argv;
  }
}

/** Settings for `az storage blob download`. */
export class AzStorageBlobDownloadSettings extends AzStorageBlobSettings {
  #containerName?: string;
  #name?: string;
  #file?: string;
  #overwrite?: boolean;

  /** The container (`--container-name`). */
  containerName(name: string): this {
    this.#containerName = name;
    return this;
  }

  /** The blob's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** The local file to write (`--file`). */
  file(path: string): this {
    this.#file = path;
    return this;
  }

  /** Replace an existing local file (`--overwrite`). */
  overwrite(value: boolean): this {
    this.#overwrite = value;
    return this;
  }

  /** Emit `storage blob download` with its options. */
  protected override leadingTokens(): string[] {
    const task = "storageBlobDownload";
    const container = required(
      this.#containerName,
      task,
      "no container — add .containerName('assets').",
    );
    const name = required(this.#name, task, "no blob named — add .name(...).");
    const file = required(this.#file, task, "no file — add .file(path).");
    const argv = [
      "storage",
      "blob",
      "download",
      ...this.accountTokens(task),
      option("--container-name", container),
      option("--name", name),
      option("--file", file),
    ];
    if (this.#overwrite !== undefined) {
      argv.push(bool("--overwrite", this.#overwrite));
    }
    return argv;
  }
}

/** Settings for `az storage blob upload-batch`: upload a directory. */
export class AzStorageBlobUploadBatchSettings extends AzStorageBlobSettings {
  #source?: string;
  #destination?: string;
  #pattern?: string;
  #destinationPath?: string;
  #overwrite?: boolean;
  #dryrun = false;

  /** The local directory to upload (`--source`). */
  source(path: string): this {
    this.#source = path;
    return this;
  }

  /** The container, by name or URL (`--destination`). */
  destination(container: string): this {
    this.#destination = container;
    return this;
  }

  /** Upload only the files matching this glob (`--pattern`). */
  pattern(glob: string): this {
    this.#pattern = glob;
    return this;
  }

  /** A path inside the container to upload under (`--destination-path`). */
  destinationPath(path: string): this {
    this.#destinationPath = path;
    return this;
  }

  /** Replace existing blobs (`--overwrite`). */
  overwrite(value: boolean): this {
    this.#overwrite = value;
    return this;
  }

  /** Show what would be uploaded without uploading (`--dryrun`). */
  dryrun(): this {
    this.#dryrun = true;
    return this;
  }

  /** Emit `storage blob upload-batch` with its options. */
  protected override leadingTokens(): string[] {
    const task = "storageBlobUploadBatch";
    const source = required(
      this.#source,
      task,
      "no source — add .source('dist').",
    );
    const destination = required(
      this.#destination,
      task,
      "no destination — add .destination('$web').",
    );
    const argv = [
      "storage",
      "blob",
      "upload-batch",
      ...this.accountTokens(task),
      option("--source", source),
      option("--destination", destination),
    ];
    if (this.#pattern !== undefined) {
      argv.push(option("--pattern", this.#pattern));
    }
    if (this.#destinationPath !== undefined) {
      argv.push(option("--destination-path", this.#destinationPath));
    }
    if (this.#overwrite !== undefined) {
      argv.push(bool("--overwrite", this.#overwrite));
    }
    if (this.#dryrun) argv.push("--dryrun");
    return argv;
  }
}
