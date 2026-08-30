// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud auth` group — the credentials gate every other command in CI
 * passes through.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.authActivateServiceAccount((s) => s.keyFile(keyPath));
 * await GcloudTasks.authConfigureDocker((s) =>
 *   s.registries("us-central1-docker.pkg.dev")
 * );
 * const token = await GcloudTasks.identityToken((s) => s.audiences(url));
 * ```
 *
 * `configure-docker` is the one that is easy to miss and impossible to work
 * around: without it a `docker push` to Artifact Registry fails on
 * authentication, however valid the credentials gcloud itself holds.
 *
 * Distinct from `auth.ts`, which resolves a token for this package's REST task
 * groups. This module wraps the CLI commands; that one is the injectable seam
 * those groups read a token through.
 *
 * @module
 */

import { GcloudSettings } from "./settings.ts";

/** Settings for `gcloud auth activate-service-account`. */
export class GcloudAuthActivateServiceAccountSettings extends GcloudSettings {
  #account?: string;
  #keyFile?: string;

  /** The service account to activate (positional); optional beside a key file. */
  serviceAccount(email: string): this {
    this.#account = email;
    return this;
  }

  /** The JSON key to activate it from (`--key-file`). */
  keyFile(path: string): this {
    this.#keyFile = path;
    return this;
  }

  /** Emit `auth activate-service-account` and its operand. */
  protected override leadingTokens(): string[] {
    if (this.#keyFile === undefined) {
      throw new Error(
        "GcloudTasks.authActivateServiceAccount: no key file — add " +
          ".keyFile(path), since gcloud needs the credentials to activate.",
      );
    }
    const argv = ["auth", "activate-service-account"];
    if (this.#account !== undefined) argv.push(this.#account);
    argv.push("--key-file", this.#keyFile);
    return argv;
  }
}

/** Settings for `gcloud auth print-access-token`. */
export class GcloudAuthPrintAccessTokenSettings extends GcloudSettings {
  #account?: string;

  /** Print the token for this account rather than the active one (positional). */
  forAccount(email: string): this {
    this.#account = email;
    return this;
  }

  /** Emit `auth print-access-token` and its operand. */
  protected override leadingTokens(): string[] {
    const argv = ["auth", "print-access-token"];
    if (this.#account !== undefined) argv.push(this.#account);
    return argv;
  }
}

/** Settings for `gcloud auth print-identity-token`. */
export class GcloudAuthPrintIdentityTokenSettings extends GcloudSettings {
  #account?: string;
  #audiences: string[] = [];
  #includeEmail = false;

  /** Print the token for this account rather than the active one (positional). */
  forAccount(email: string): this {
    this.#account = email;
    return this;
  }

  /**
   * The audiences the token is minted for (`--audiences`); repeatable.
   *
   * A Cloud Run service invoked service-to-service is the usual reason: the
   * receiving service's URL is the audience, and a token minted without one is
   * rejected there.
   */
  audiences(...values: string[]): this {
    this.#audiences.push(...values);
    return this;
  }

  /** Include the service account email in the token (`--include-email`). */
  includeEmail(): this {
    this.#includeEmail = true;
    return this;
  }

  /** Emit `auth print-identity-token` with its operand and flags. */
  protected override leadingTokens(): string[] {
    const argv = ["auth", "print-identity-token"];
    if (this.#account !== undefined) argv.push(this.#account);
    if (this.#audiences.length > 0) {
      argv.push("--audiences", this.#audiences.join(","));
    }
    if (this.#includeEmail) argv.push("--include-email");
    return argv;
  }
}

/** Settings for `gcloud auth configure-docker`. */
export class GcloudAuthConfigureDockerSettings extends GcloudSettings {
  #registries: string[] = [];

  /**
   * The registries to add a credential helper for (positional, comma
   * separated), e.g. `"us-central1-docker.pkg.dev"`; repeatable.
   */
  registries(...values: string[]): this {
    this.#registries.push(...values);
    return this;
  }

  /** Emit `auth configure-docker` and the registries. */
  protected override leadingTokens(): string[] {
    const argv = ["auth", "configure-docker"];
    if (this.#registries.length > 0) argv.push(this.#registries.join(","));
    return argv;
  }
}

/** Settings for `gcloud auth list`. */
export class GcloudAuthListSettings extends GcloudSettings {
  #filterAccount?: string;

  /** Only the named account (`--filter-account`). */
  filterAccount(email: string): this {
    this.#filterAccount = email;
    return this;
  }

  /** Emit `auth list` and its filter. */
  protected override leadingTokens(): string[] {
    const argv = ["auth", "list"];
    if (this.#filterAccount !== undefined) {
      argv.push("--filter-account", this.#filterAccount);
    }
    return argv;
  }
}

/** Settings for `gcloud auth revoke`. */
export class GcloudAuthRevokeSettings extends GcloudSettings {
  #accounts: string[] = [];
  #all = false;

  /** The accounts to revoke (positional); repeatable. */
  accounts(...values: string[]): this {
    this.#accounts.push(...values);
    return this;
  }

  /** Revoke every credentialed account (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Emit `auth revoke` with its operands. */
  protected override leadingTokens(): string[] {
    if (this.#accounts.length === 0 && !this.#all) {
      throw new Error(
        "GcloudTasks.authRevoke: no accounts named — add .accounts(email) or " +
          ".all(), since gcloud revokes the active account otherwise and that " +
          "is rarely what a build means to do.",
      );
    }
    const argv = ["auth", "revoke", ...this.#accounts];
    if (this.#all) argv.push("--all");
    return argv;
  }
}
