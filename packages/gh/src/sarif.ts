// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Upload a SARIF report to GitHub code scanning from a build, replacing the
 * `github/codeql-action/upload-sarif` step.
 *
 * The endpoint takes the report gzipped and base64-encoded, which is the only
 * reason this needs more than a POST. Everything else — the commit, the ref — is
 * read from the Actions environment when it is not set explicitly, so a target
 * that produced a `results.sarif` can publish it in one call:
 *
 * ```ts
 * await GhTasks.uploadSarif((s) => s.file("results.sarif").token(token));
 * ```
 *
 * @module
 */

import { gzip } from "@zuke/core";
import type { Configure, PathLike } from "@zuke/core/tooling";
import { caller, DEFAULT_BASE_URL, env } from "./api.ts";
import { resolveAuthToken, resolveRepoSlug } from "./credentials.ts";

/** What GitHub returns for an accepted SARIF upload. */
export interface GhSarifUploadResult {
  /** The opaque id of the upload, for polling its processing status. */
  id: string;
  /** The URL that reports whether GitHub finished processing the report. */
  url: string;
}

/** Settings for {@link GhSarifApi.uploadSarif}. */
export class GhSarifSettings {
  /** The SARIF file to upload. Set by {@link file}. */
  file_?: string;
  /** `owner/repo` to upload for. Set by {@link repo}. */
  repo_?: string;
  /** The commit the results describe. Set by {@link commit}. */
  commit_?: string;
  /** The ref the results describe. Set by {@link ref}. */
  ref_?: string;
  /** The token to authenticate with. Set by {@link token}. */
  token_?: string;
  /** Where the checkout that produced the results lives. Set by {@link checkoutUri}. */
  checkoutUri_?: string;
  /** REST base URL. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /** The SARIF report to upload (required). */
  file(path: PathLike): this {
    this.file_ = String(path);
    return this;
  }

  /** The `owner/repo` to upload for. Defaults to `GITHUB_REPOSITORY`. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /** The commit SHA the results describe. Defaults to `GITHUB_SHA`. */
  commit(sha: string): this {
    this.commit_ = sha;
    return this;
  }

  /** The full ref the results describe (`refs/heads/main`). Defaults to `GITHUB_REF`. */
  ref(ref: string): this {
    this.ref_ = ref;
    return this;
  }

  /**
   * The token to authenticate with — needs `security-events: write`. Defaults to
   * `GITHUB_TOKEN` in the environment, so it never has to reach argv.
   */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /** The URI of the checkout the results are relative to (`file:///…`). */
  checkoutUri(uri: string): this {
    this.checkoutUri_ = uri;
    return this;
  }

  /** Use a different REST base (GitHub Enterprise Server). */
  baseUrl(url: string): this {
    this.baseUrl_ = url.replace(/\/+$/, "");
    return this;
  }

  /** Override the `fetch` implementation (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }

  /** The effective `owner/repo`, from the setting or the Actions environment. */
  repoSlug_(): string {
    return resolveRepoSlug(this.repo_, "uploading SARIF");
  }

  /**
   * The request body. The `sarif` field is the report gzipped then base64'd,
   * which is what the endpoint accepts — a plain JSON body is rejected.
   */
  async body_(): Promise<Record<string, string>> {
    if (this.file_ === undefined) {
      throw new Error("uploading SARIF requires .file(...).");
    }
    const commit = this.commit_ ?? env("GITHUB_SHA");
    const ref = this.ref_ ?? env("GITHUB_REF");
    if (commit === undefined) {
      throw new Error("uploading SARIF requires .commit(...) (or GITHUB_SHA).");
    }
    if (ref === undefined) {
      throw new Error("uploading SARIF requires .ref(...) (or GITHUB_REF).");
    }
    const packed = await gzip(await Deno.readFile(this.file_));
    let binary = "";
    for (const byte of packed) binary += String.fromCharCode(byte);
    const body: Record<string, string> = {
      commit_sha: commit,
      ref,
      sarif: btoa(binary),
    };
    if (this.checkoutUri_ !== undefined) {
      body.checkout_uri = this.checkoutUri_;
    }
    return body;
  }
}

/** The shape of the SARIF task, mixed into `GhTasks`. */
export interface GhSarifApi {
  /**
   * Upload a SARIF report to GitHub code scanning, so its findings land in the
   * repository's Security tab. Needs a token with `security-events: write`.
   */
  uploadSarif(
    configure?: Configure<GhSarifSettings>,
  ): Promise<GhSarifUploadResult>;
}

/** Upload the SARIF report the settings describe. */
export async function uploadSarifReport(
  configure?: Configure<GhSarifSettings>,
): Promise<GhSarifUploadResult> {
  const settings = configure
    ? configure(new GhSarifSettings())
    : new GhSarifSettings();
  const token = resolveAuthToken(
    settings.token_,
    "uploading SARIF",
    " with security-events: write.",
  );
  // Resolve where it is going before reading and gzipping it — the destination
  // is the likelier misconfiguration, and it costs nothing to check first. The
  // shared caller is what validates the slug, so that happens here too.
  const call = caller(
    settings.baseUrl_,
    settings.repoSlug_(),
    token,
    settings.fetch_,
  );
  const parsed = await call(
    "POST",
    "/code-scanning/sarifs",
    await settings.body_(),
  );
  if (
    typeof parsed !== "object" || parsed === null || !("id" in parsed) ||
    typeof parsed.id !== "string" || !("url" in parsed) ||
    typeof parsed.url !== "string"
  ) {
    throw new Error("the SARIF upload response carried no id/url.");
  }
  return { id: parsed.id, url: parsed.url };
}
