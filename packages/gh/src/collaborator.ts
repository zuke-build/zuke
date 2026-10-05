// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A collaborator's standing on a repository — what they may do there, as
 * GitHub reports it. REST-only: the `gh` CLI has no verb for it.
 *
 * It answers the question an `author_association` cannot: an organisation
 * member whose membership is private is reported as `CONTRIBUTOR` to a token
 * that cannot see it, while this endpoint says whether they can push.
 *
 * @module
 */

import { caller, DEFAULT_BASE_URL, readString } from "./api.ts";
import { resolveAuthToken, resolveRepoSlug } from "./credentials.ts";

/** A collaborator's standing, as `GET /collaborators/<login>/permission` reports it. */
export interface GhCollaboratorPermission {
  /**
   * The base permission level: `admin`, `write`, `read` or `none`. A custom
   * role reports the level it is built on here.
   */
  permission: string;
  /**
   * The role's name: `admin`, `maintain`, `write`, `triage`, `read` — or a
   * custom role's own name.
   */
  roleName: string;
}

/** Settings for {@link GhCollaboratorApi.collaboratorPermission}. */
export class GhCollaboratorSettings {
  /** The account to look up. Set by {@link login}. */
  login_?: string;
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /** The account to look up. */
  login(value: string): this {
    this.login_ = value;
    return this;
  }

  /** `owner/repo`. Defaults to `GITHUB_REPOSITORY`. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /** The token to authenticate with. Defaults to `GITHUB_TOKEN`. */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /** The API root, for GitHub Enterprise. */
  baseUrl(url: string): this {
    this.baseUrl_ = url.replace(/\/+$/, "");
    return this;
  }

  /** Override the `fetch` implementation (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }
}

/** The collaborator operation {@link GhTasks} exposes. */
export interface GhCollaboratorApi {
  /**
   * The standing of `.login(...)` on the repository. Throws when GitHub
   * refuses or the account is unknown, so a caller deciding trust on it fails
   * closed.
   */
  collaboratorPermission(
    configure?: (settings: GhCollaboratorSettings) => GhCollaboratorSettings,
  ): Promise<GhCollaboratorPermission>;
}

/** Look up the configured collaborator's standing. */
export async function collaboratorPermission(
  configure?: (settings: GhCollaboratorSettings) => GhCollaboratorSettings,
): Promise<GhCollaboratorPermission> {
  const settings = configure?.(new GhCollaboratorSettings()) ??
    new GhCollaboratorSettings();
  const login = settings.login_;
  if (login === undefined) {
    throw new Error(
      "reading a collaborator's permission requires .login(...).",
    );
  }
  // Interpolated into the path: only the characters a GitHub login can hold.
  if (!/^[A-Za-z0-9-]+$/.test(login)) {
    throw new Error(
      `refusing to use ${JSON.stringify(login)} as a login: a GitHub login ` +
        `holds only letters, digits and hyphens.`,
    );
  }
  const operation = "reading a collaborator's permission";
  const call = caller(
    settings.baseUrl_,
    resolveRepoSlug(settings.repo_, operation),
    resolveAuthToken(settings.token_, operation),
    settings.fetch_,
  );
  const answer = await call("GET", `/collaborators/${login}/permission`);
  return {
    permission: readString(answer, ["permission"], "collaborator permission"),
    roleName: readString(answer, ["role_name"], "collaborator permission"),
  };
}
