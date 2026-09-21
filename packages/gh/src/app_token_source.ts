// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A GitHub App installation token as a **source**: minted lazily, once, the
 * first time something needs it, and shared by everything that asks after —
 * the shape a build hands to whatever posts on its behalf, such as an AI
 * reviewer's `.commentToken(...)`.
 *
 * The defaults are the ones a build wants without saying so. The repository is
 * the one the run is on (`GITHUB_REPOSITORY`); the permissions are the
 * installation's own grant, so an App configured with exactly what its job
 * needs mints exactly that; and without the App's credentials — locally, on a
 * fork's run, on a repository that has no App — the source yields the
 * workflow's `GITHUB_TOKEN`, so a build that names an App still works
 * everywhere the App is absent, only posting as `github-actions[bot]` there.
 * A mint that fails is a warning and the fallback, never a failed build: the
 * identity is a courtesy.
 *
 * @module
 */

import type { AnyParameter } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  type GhAppTokenResult,
  type GhAppTokenSettings,
  type GhPermissionLevel,
  mintAppToken,
} from "./app_token.ts";

/** Read an environment variable, tolerating an absent `--allow-env`. */
export type GhEnvReader = (name: string) => string | undefined;

/** The default env reader: `Deno.env.get`, `undefined` when denied. */
function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/**
 * A token provider: resolves to the App's installation token, or to the
 * fallback when the App is not configured or cannot be minted from. The same
 * promise is returned on every call, so the token is minted at most once per
 * run.
 */
export type GhAppTokenSource = () => Promise<string>;

/** A credential a build passes: a parameter, or a literal for tests. */
export type GhCredential = AnyParameter | string;

/** The shape of the mint, replaceable by a test. */
export type GhAppTokenMint = (
  configure: Configure<GhAppTokenSettings>,
) => Promise<GhAppTokenResult>;

/** The value a credential holds now, or `undefined` when it has none. */
function credentialValue(
  credential: GhCredential | undefined,
): string | undefined {
  if (credential === undefined) return undefined;
  const value = typeof credential === "string"
    ? credential
    : credential.stringValue_();
  return value === undefined || value === "" ? undefined : value;
}

/** Settings for {@link GhAppTokenApi.appTokenSource}. */
export class GhAppTokenSourceSettings {
  /** The App's id. Set by {@link app}. */
  appId_?: GhCredential;
  /** The App's PEM private key. Set by {@link app}. */
  privateKey_?: GhCredential;
  /** The `owner/name` to mint for. Set by {@link repository}. */
  repository_?: string;
  /** Permissions to narrow the token to. Set by {@link permission}. */
  permissions_: Record<string, GhPermissionLevel> = {};
  /** The token yielded without an App. Set by {@link fallback}. */
  fallback_?: GhCredential;
  /** The env reader for the defaults. Set by {@link env}. */
  env_: GhEnvReader = readEnv;
  /** The `fetch` implementation the mint uses. Set by {@link fetch}. */
  fetch_?: typeof fetch;
  /** REST base URL for the mint. Set by {@link baseUrl}. */
  baseUrl_?: string;
  /** The mint itself. Set by {@link mint}. */
  mint_: GhAppTokenMint = mintAppToken;

  /**
   * The App's credentials — its numeric id and the PEM contents of its
   * private key, as the build's parameters (`.secret()` for the key). Either
   * one unset at call time means "no App": the source yields the
   * {@link fallback}. Both are read when the token is first needed, never at
   * construction, so parameters declared on the build resolve first.
   */
  app(appId: GhCredential, privateKey: GhCredential): this {
    this.appId_ = appId;
    this.privateKey_ = privateKey;
    return this;
  }

  /**
   * The repository to mint for, as `owner/name`. Defaults to the repository
   * the run is on, `GITHUB_REPOSITORY`. Name it to refuse minting anywhere
   * else: a run whose `GITHUB_REPOSITORY` is another repository then gets the
   * fallback, with a warning, rather than a token for this one minted into a
   * build running elsewhere.
   */
  repository(slug: string): this {
    this.repository_ = slug;
    return this;
  }

  /**
   * Narrow the token to one permission, e.g. `.permission("contents", "write")`.
   * Repeatable. Without any, the token holds the installation's whole grant,
   * which is the App's configured permissions — the sane default for an App
   * set up for one job. A hyphenated name is accepted as the mint accepts it.
   */
  permission(name: string, level: GhPermissionLevel): this {
    this.permissions_[name] = level;
    return this;
  }

  /**
   * The token yielded when no App is configured or the mint fails. Defaults
   * to `GITHUB_TOKEN` from the environment — the workflow's own token, so a
   * build that names an App still posts, as `github-actions[bot]`, wherever
   * the App is absent.
   */
  fallback(token: GhCredential): this {
    this.fallback_ = token;
    return this;
  }

  /** Override the environment reader (a test seam). */
  env(reader: GhEnvReader): this {
    this.env_ = reader;
    return this;
  }

  /** Override the `fetch` the mint uses (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }

  /** Use a different REST base for the mint (GitHub Enterprise Server). */
  baseUrl(url: string): this {
    this.baseUrl_ = url;
    return this;
  }

  /** Override the mint itself (a test seam). */
  mint(fn: GhAppTokenMint): this {
    this.mint_ = fn;
    return this;
  }

  /** The fallback token: the configured one, else `GITHUB_TOKEN`, else empty. */
  fallbackValue_(): string {
    return credentialValue(this.fallback_) ??
      credentialValue(this.env_("GITHUB_TOKEN")) ?? "";
  }

  /**
   * Mint the token these settings describe, or return the fallback: without
   * both credentials silently, and with a warning when the repository is not
   * an `owner/name` or the mint fails.
   */
  async resolve_(): Promise<string> {
    const appId = credentialValue(this.appId_);
    const privateKey = credentialValue(this.privateKey_);
    if (appId === undefined || privateKey === undefined) {
      return this.fallbackValue_();
    }
    const current = this.env_("GITHUB_REPOSITORY");
    if (
      this.repository_ !== undefined && current !== undefined &&
      current !== "" && current !== this.repository_
    ) {
      console.warn(
        `gh: not minting the app token: this run is on ${current}, and the ` +
          `source is pinned to ${this.repository_}; using the fallback token.`,
      );
      return this.fallbackValue_();
    }
    const slug = this.repository_ ?? current ?? "";
    const parts = slug.split("/");
    if (parts.length !== 2 || parts.some((part) => part === "")) {
      console.warn(
        `gh: not minting the app token: ${JSON.stringify(slug)} is not an ` +
          `"owner/name" repository; using the fallback token.`,
      );
      return this.fallbackValue_();
    }
    const [owner, name] = parts;
    try {
      const { token } = await this.mint_((s) => {
        s.appId(appId).privateKey(privateKey).owner(owner).repositories(name);
        for (const [permission, level] of Object.entries(this.permissions_)) {
          s.permission(permission, level);
        }
        if (this.fetch_ !== undefined) s.fetch(this.fetch_);
        if (this.baseUrl_ !== undefined) s.baseUrl(this.baseUrl_);
        return s;
      });
      return token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `gh: could not mint the app token (${message}); using the fallback ` +
          "token.",
      );
      return this.fallbackValue_();
    }
  }
}

/**
 * Build a {@link GhAppTokenSource} from the settings a lambda configures. The
 * first call mints (or falls back); every later call returns the same
 * promise. Nothing runs until the first call, so the source can be a build
 * field that names parameters declared above it.
 */
export function appTokenSource(
  configure?: Configure<GhAppTokenSourceSettings>,
): GhAppTokenSource {
  const settings = configure
    ? configure(new GhAppTokenSourceSettings())
    : new GhAppTokenSourceSettings();
  let pending: Promise<string> | undefined;
  return () => {
    pending ??= settings.resolve_();
    return pending;
  };
}
