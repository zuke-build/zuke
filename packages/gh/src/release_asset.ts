// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Upload an asset to a GitHub release from a build, replacing a
 * `gh release upload` step or a marketplace action.
 *
 * The release is resolved first — the latest one by default, or a specific tag
 * — and an asset the release already carries under the same name is left
 * alone, so the call is idempotent and a published release's assets are never
 * mutated. A repository with no releases yet is an ordinary outcome, not an
 * error, so a release pipeline can run this unconditionally:
 *
 * ```ts
 * await GhTasks.uploadReleaseAsset((s) =>
 *   s.file("dist/extension.tar.gz").token(token)
 * );
 * ```
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { isRecord } from "./api.ts";

/** The GitHub REST base, overridable per call for GHES. */
const API_BASE = "https://api.github.com";

/** Content types inferred from an asset name's extension. */
const CONTENT_TYPES: Record<string, string> = {
  ".tar.gz": "application/gzip",
  ".tgz": "application/gzip",
  ".zip": "application/zip",
  ".json": "application/json",
};

/** What became of a release-asset upload. */
export interface GhReleaseAssetResult {
  /**
   * `uploaded` when the asset was sent; `already-exists` when the release
   * carries an asset of the same name (nothing was changed); `no-release`
   * when the repository has no release to attach to.
   */
  state: "uploaded" | "already-exists" | "no-release";
  /** The asset name the call targeted. */
  name: string;
  /** The tag of the release the asset belongs to, when one was resolved. */
  releaseTag?: string;
  /** The id of the release the asset belongs to, when one was resolved. */
  releaseId?: number;
  /** The asset's download URL, when it was uploaded or already present. */
  url?: string;
}

/** Read an Actions-provided default, treating an absent env as unset. */
function env(name: string): string | undefined {
  try {
    const value = Deno.env.get(name);
    return value === undefined || value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}

/** Settings for {@link GhReleaseAssetApi.uploadReleaseAsset}. */
export class GhReleaseAssetSettings {
  /** The file to upload. Set by {@link file}. */
  file_?: string;
  /** The asset name on the release. Set by {@link name}. */
  name_?: string;
  /** The asset's `content-type`. Set by {@link contentType}. */
  contentType_?: string;
  /** `owner/repo` to upload to. Set by {@link repo}. */
  repo_?: string;
  /** The release tag to attach to. Set by {@link tag}. */
  tag_?: string;
  /** The token to authenticate with. Set by {@link token}. */
  token_?: string;
  /** REST base URL. Set by {@link baseUrl}. */
  baseUrl_: string = API_BASE;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /** The file to upload (required). */
  file(path: PathLike): this {
    this.file_ = String(path);
    return this;
  }

  /** The asset's name on the release. Defaults to the file's base name. */
  name(value: string): this {
    this.name_ = value;
    return this;
  }

  /**
   * The asset's `content-type`. Defaults by extension (`.tar.gz`/`.tgz`,
   * `.zip`, `.json`), then to `application/octet-stream`.
   */
  contentType(value: string): this {
    this.contentType_ = value;
    return this;
  }

  /** The `owner/repo` to upload to. Defaults to `GITHUB_REPOSITORY`. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /** Attach to the release with this tag instead of the latest release. */
  tag(value: string): this {
    this.tag_ = value;
    return this;
  }

  /**
   * The token to authenticate with — needs `contents: write`. Defaults to
   * `GITHUB_TOKEN` in the environment, so it never has to reach argv.
   */
  token(value: string): this {
    this.token_ = value;
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
    const slug = this.repo_ ?? env("GITHUB_REPOSITORY");
    if (slug === undefined) {
      throw new Error(
        "uploading a release asset requires .repo('owner/name') (or " +
          "GITHUB_REPOSITORY).",
      );
    }
    return slug;
  }

  /** The file to upload, or a friendly error naming the missing setting. */
  filePath_(): string {
    if (this.file_ === undefined) {
      throw new Error("uploading a release asset requires .file(...).");
    }
    return this.file_;
  }

  /** The effective asset name: the setting, or the file's base name. */
  assetName_(): string {
    if (this.name_ !== undefined) return this.name_;
    const path = this.filePath_();
    const base = path.split(/[/\\]/).pop();
    if (base === undefined || base === "") {
      throw new Error(
        `the asset name cannot be derived from "${path}" — set .name(...).`,
      );
    }
    return base;
  }

  /** The effective `content-type`: the setting, or inferred by extension. */
  effectiveContentType_(): string {
    if (this.contentType_ !== undefined) return this.contentType_;
    const name = this.assetName_().toLowerCase();
    for (const [suffix, type] of Object.entries(CONTENT_TYPES)) {
      if (name.endsWith(suffix)) return type;
    }
    return "application/octet-stream";
  }
}

/** The shape of the release-asset task, mixed into `GhTasks`. */
export interface GhReleaseAssetApi {
  /**
   * Attach a file to a GitHub release — the latest release by default, or the
   * one named by `.tag(...)`. Idempotent: an asset the release already
   * carries under the same name is kept as-is, and a repository with no
   * releases resolves to `state: "no-release"` rather than throwing. Needs a
   * token with `contents: write`.
   */
  uploadReleaseAsset(
    configure?: Configure<GhReleaseAssetSettings>,
  ): Promise<GhReleaseAssetResult>;
}

/** A field read from a REST response without assuming the response's shape. */
function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** Upload the release asset the settings describe. */
export async function uploadReleaseAsset(
  configure?: Configure<GhReleaseAssetSettings>,
): Promise<GhReleaseAssetResult> {
  const settings = configure
    ? configure(new GhReleaseAssetSettings())
    : new GhReleaseAssetSettings();
  const token = settings.token_ ?? env("GITHUB_TOKEN");
  if (token === undefined) {
    throw new Error(
      "uploading a release asset requires .token(...) (or GITHUB_TOKEN) " +
        "with contents: write.",
    );
  }
  const slug = settings.repoSlug_();
  const name = settings.assetName_();
  const headers = {
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "authorization": `Bearer ${token}`,
  };

  // Resolve the release first: the failure modes here (no release yet, a tag
  // that does not exist) are the likely ones, and the file need not be read
  // for them.
  const releasePath = settings.tag_ === undefined
    ? "releases/latest"
    : `releases/tags/${encodeURIComponent(settings.tag_)}`;
  const releaseResponse = await settings.fetch_(
    `${settings.baseUrl_}/repos/${slug}/${releasePath}`,
    { headers },
  );
  if (releaseResponse.status === 404 && settings.tag_ === undefined) {
    // A repository with no releases is an ordinary state for a pipeline that
    // attaches assets opportunistically — report it, do not throw.
    await releaseResponse.body?.cancel();
    return { state: "no-release", name };
  }
  const releaseText = await releaseResponse.text();
  if (!releaseResponse.ok) {
    throw new Error(
      `resolving the release (${releasePath}) failed: ` +
        `${releaseResponse.status} ${releaseResponse.statusText}. ` +
        releaseText.slice(0, 400),
    );
  }
  let release: unknown;
  try {
    release = JSON.parse(releaseText);
  } catch {
    throw new Error(
      `the release lookup returned a non-JSON body: ${
        releaseText.slice(0, 200)
      }`,
    );
  }
  const releaseId = field(release, "id");
  const uploadUrlTemplate = field(release, "upload_url");
  if (typeof releaseId !== "number" || typeof uploadUrlTemplate !== "string") {
    throw new Error("the release lookup response carried no id/upload_url.");
  }
  const releaseTag = field(release, "tag_name");
  const tag = typeof releaseTag === "string" ? releaseTag : undefined;

  // Idempotence: a release that already carries the asset is left untouched —
  // published assets are immutable history, and re-running the pipeline must
  // not churn them. The one exception is an asset stuck in a non-`uploaded`
  // state: an errored or interrupted upload reserves the name while serving
  // nothing, and GitHub's documented recovery is delete-then-reupload — so a
  // re-run must do exactly that rather than skip past the corpse forever.
  const assets = field(release, "assets");
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (field(asset, "name") !== name) continue;
      const state = field(asset, "state");
      const assetId = field(asset, "id");
      if (
        (state === undefined || state === "uploaded") ||
        typeof assetId !== "number"
      ) {
        const url = field(asset, "browser_download_url");
        return {
          state: "already-exists",
          name,
          releaseTag: tag,
          releaseId,
          ...(typeof url === "string" ? { url } : {}),
        };
      }
      const deletion = await settings.fetch_(
        `${settings.baseUrl_}/repos/${slug}/releases/assets/${assetId}`,
        { method: "DELETE", headers },
      );
      const deletionText = await deletion.text();
      // A 404 means the corpse was already cleaned up — the goal state.
      if (!deletion.ok && deletion.status !== 404) {
        throw new Error(
          `deleting the stuck release asset "${name}" (state ${
            String(state)
          }) failed: ${deletion.status} ${deletion.statusText}. ` +
            deletionText.slice(0, 400),
        );
      }
    }
  }

  // The `upload_url` is an RFC 6570 template ending in `{?name,label}`;
  // GitHub documents cutting the template off and appending a query.
  const uploadBase = uploadUrlTemplate.replace(/\{[^}]*\}$/, "");
  const data = await Deno.readFile(settings.filePath_());
  const uploadResponse = await settings.fetch_(
    `${uploadBase}?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": settings.effectiveContentType_(),
      },
      body: data,
    },
  );
  const uploadText = await uploadResponse.text();
  if (!uploadResponse.ok) {
    throw new Error(
      `uploading release asset "${name}" failed: ${uploadResponse.status} ` +
        `${uploadResponse.statusText}. ${uploadText.slice(0, 400)}`,
    );
  }
  let uploaded: unknown;
  try {
    uploaded = JSON.parse(uploadText);
  } catch {
    throw new Error(
      `the asset upload returned a non-JSON body: ${uploadText.slice(0, 200)}`,
    );
  }
  const url = field(uploaded, "browser_download_url");
  return {
    state: "uploaded",
    name,
    releaseTag: tag,
    releaseId,
    ...(typeof url === "string" ? { url } : {}),
  };
}
