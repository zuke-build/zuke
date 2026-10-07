// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az login` and `az logout` — signing the CLI in non-interactively, as a
 * service principal (secret, certificate or federated token) or a managed
 * identity.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.login((s) =>
 *   s.servicePrincipal().username(clientId).tenant(tenantId)
 *     .federatedToken(oidcToken)
 * );
 * await AzTasks.login((s) => s.identity().clientId(identityClientId));
 * ```
 *
 * A secret never enters the argv: `.password(...)` and `.federatedToken(...)`
 * send `--password=@-` / `--federated-token=@-`, and the value goes to the
 * CLI on standard input, which it reads in place of the `@-` (and strips of
 * trailing line breaks). It is registered with the run's redactor as well.
 *
 * @module
 */

import { AzSettings } from "./settings.ts";
import { fromStdin, option } from "./validate.ts";

/**
 * Settings for `az login`, for the non-interactive forms a build uses. The
 * interactive browser and device-code forms are left to `.command("login")`.
 *
 * Exactly one credential is sent: a secret ({@link password}), a
 * {@link certificate} or a {@link federatedToken} for a service principal,
 * or {@link identity} for a managed identity. A service principal without
 * one would make the CLI prompt for a password, so it is refused here.
 *
 * `az login` reads the global `.subscription(...)` as the subscription to
 * make the default once it has signed in. Its output lists the account's
 * subscriptions — no credential — so it is not masked.
 */
export class AzLoginSettings extends AzSettings {
  #servicePrincipal = false;
  #username?: string;
  #tenant?: string;
  #secret?: { flag: string; value: string };
  #certificate?: string;
  #useCertSnIssuer = false;
  #identity = false;
  #clientId?: string;
  #objectId?: string;
  #resourceId?: string;
  #allowNoSubscriptions = false;

  /** Log in as a service principal (`--service-principal`). */
  servicePrincipal(): this {
    this.#servicePrincipal = true;
    return this;
  }

  /** The service principal's client id (`--username`). */
  username(clientId: string): this {
    this.#username = clientId;
    return this;
  }

  /** The Microsoft Entra tenant, required for a service principal (`--tenant`). */
  tenant(tenant: string): this {
    this.#tenant = tenant;
    return this;
  }

  /**
   * The service principal's client secret (`--password`), sent on standard
   * input as `--password=@-` so it never enters the argv, and registered with
   * the run's redactor. Prefer {@link federatedToken} (no long-lived secret)
   * or {@link certificate}.
   */
  password(secret: string): this {
    this.#secret = { flag: "--password", value: secret };
    this.markSecret(secret);
    return this;
  }

  /**
   * A federated token (OIDC) to exchange for the service principal's access
   * (`--federated-token`), sent on standard input as `--federated-token=@-`
   * and registered with the run's redactor.
   */
  federatedToken(token: string): this {
    this.#secret = { flag: "--federated-token", value: token };
    this.markSecret(token);
    return this;
  }

  /** A PEM file with the service principal's key and certificate (`--certificate`). */
  certificate(path: string): this {
    this.#certificate = path;
    return this;
  }

  /**
   * Authenticate with Subject Name + Issuer, for automatic certificate
   * rolls (`--use-cert-sn-issuer`).
   */
  useCertSnIssuer(): this {
    this.#useCertSnIssuer = true;
    return this;
  }

  /** Log in with the managed identity of the machine the build runs on (`--identity`). */
  identity(): this {
    this.#identity = true;
    return this;
  }

  /** A user-assigned managed identity, by client id (`--client-id`). */
  clientId(id: string): this {
    this.#clientId = id;
    return this;
  }

  /** A user-assigned managed identity, by object id (`--object-id`). */
  objectId(id: string): this {
    this.#objectId = id;
    return this;
  }

  /** A user-assigned managed identity, by resource id (`--resource-id`). */
  resourceId(id: string): this {
    this.#resourceId = id;
    return this;
  }

  /** Succeed for a tenant with no subscriptions (`--allow-no-subscriptions`). */
  allowNoSubscriptions(): this {
    this.#allowNoSubscriptions = true;
    return this;
  }

  /** The secret, for the CLI to read from standard input. */
  protected override stdinInput(): string | undefined {
    return this.#secret?.value;
  }

  /** Emit `login` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["login"];
    if (this.#identity) {
      if (this.#servicePrincipal || this.#secret || this.#certificate) {
        throw new Error(
          "AzTasks.login: --identity takes no service-principal credential — " +
            "use .identity() alone, with .clientId(...) for a user-assigned one.",
        );
      }
      argv.push("--identity");
      if (this.#clientId !== undefined) {
        argv.push(option("--client-id", this.#clientId));
      }
      if (this.#objectId !== undefined) {
        argv.push(option("--object-id", this.#objectId));
      }
      if (this.#resourceId !== undefined) {
        argv.push(option("--resource-id", this.#resourceId));
      }
    } else {
      argv.push(...this.#servicePrincipalTokens());
    }
    if (this.#allowNoSubscriptions) argv.push("--allow-no-subscriptions");
    return argv;
  }

  /** The service-principal half of the options, refused when incomplete. */
  #servicePrincipalTokens(): string[] {
    const credentials = [this.#secret, this.#certificate].filter((c) =>
      c !== undefined
    );
    if (
      !this.#servicePrincipal || this.#username === undefined ||
      this.#tenant === undefined || credentials.length !== 1
    ) {
      throw new Error(
        "AzTasks.login: a non-interactive login is a managed identity — " +
          ".identity() — or a service principal with a client id, a tenant " +
          "and one credential: .servicePrincipal().username(id).tenant(t) " +
          "with .federatedToken(...), .certificate(path) or .password(...).",
      );
    }
    const argv = [
      "--service-principal",
      option("--username", this.#username),
      option("--tenant", this.#tenant),
    ];
    if (this.#secret !== undefined) argv.push(fromStdin(this.#secret.flag));
    if (this.#certificate !== undefined) {
      argv.push(option("--certificate", this.#certificate));
    }
    if (this.#useCertSnIssuer) argv.push("--use-cert-sn-issuer");
    return argv;
  }
}

/** Settings for `az logout`. */
export class AzLogoutSettings extends AzSettings {
  #username?: string;

  /** The account to log out; the active one when omitted (`--username`). */
  username(name: string): this {
    this.#username = name;
    return this;
  }

  /** Emit `logout` with its options. */
  protected override leadingTokens(): string[] {
    return this.#username === undefined
      ? ["logout"]
      : ["logout", option("--username", this.#username)];
  }
}
