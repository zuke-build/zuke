// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az account` — the subscription the CLI acts on, and access tokens.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.accountSet((s) => s.subscription("prod"));
 * const subscription = await AzTasks.subscriptionId();
 * const token = await AzTasks.accessToken((s) =>
 *   s.resource("https://management.azure.com/")
 * );
 * ```
 *
 * The `account` commands read the global `.subscription(...)` as the
 * subscription they show or select.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import { type AzOutputFormat, AzSettings } from "./settings.ts";
import { operands, option } from "./validate.ts";

/** The `--query` the subscription-id reader pins. */
export const SUBSCRIPTION_ID_QUERY = "id";

/** The `--query` the tenant-id reader pins. */
export const TENANT_ID_QUERY = "tenantId";

/** The `--query` the access-token reader pins. */
export const ACCESS_TOKEN_QUERY = "accessToken";

/** The well-known resources `get-access-token --resource-type` accepts. */
export type AzAccessTokenResourceType =
  | "oss-rdbms"
  | "arm"
  | "aad-graph"
  | "ms-graph"
  | "batch"
  | "media"
  | "data-lake";

/** Settings for `az account show`: the current (or the given) subscription. */
export class AzAccountShowSettings extends AzSettings {
  /** Emit `account show`. */
  protected override leadingTokens(): string[] {
    return ["account", "show"];
  }
}

/**
 * Settings for `az account set`: make a subscription the default. Name it
 * with the global `.subscription(nameOrId)`, which `account set` requires.
 */
export class AzAccountSetSettings extends AzSettings {
  /** Emit `account set`. */
  protected override leadingTokens(): string[] {
    return ["account", "set"];
  }
}

/** Settings for `az account list`. */
export class AzAccountListSettings extends AzSettings {
  #all = false;
  #refresh = false;

  /** Include subscriptions from every cloud and in every state (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Read the subscriptions from the server, not the cache (`--refresh`). */
  refresh(): this {
    this.#refresh = true;
    return this;
  }

  /** Emit `account list` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["account", "list"];
    if (this.#all) argv.push("--all");
    if (this.#refresh) argv.push("--refresh");
    return argv;
  }
}

/**
 * Settings for `az account get-access-token`.
 *
 * The answer is a bearer token, so the command always runs quietly —
 * captured, never streamed — with `--output json` pinned whatever the
 * settings or the user's config say, and the token is registered with the
 * run's redactor once it returns.
 */
export class AzAccountGetAccessTokenSettings extends AzSettings {
  #resource?: string;
  #resourceType?: AzAccessTokenResourceType;
  readonly #scopes: string[] = [];
  #tenant?: string;

  /** Settings that capture the token instead of streaming it. */
  constructor() {
    super();
    this.quiet();
  }

  /** The resource the token is for, as a Microsoft Entra v1.0 endpoint (`--resource`). */
  resource(uri: string): this {
    this.#resource = uri;
    return this;
  }

  /** A well-known resource the token is for (`--resource-type`). */
  resourceType(type: AzAccessTokenResourceType): this {
    this.#resourceType = type;
    return this;
  }

  /** Microsoft Entra v2.0 scopes for the token (`--scope`); repeatable. */
  scope(...scopes: string[]): this {
    this.#scopes.push(...scopes);
    return this;
  }

  /** The tenant to get the token from (`--tenant`). */
  tenant(tenant: string): this {
    this.#tenant = tenant;
    return this;
  }

  /** Pin `--output json`, the form the returned token can be found in. */
  protected override pinnedOutput(): AzOutputFormat {
    return "json";
  }

  /** Register the returned access token as a secret. */
  protected override onOutput(output: CommandOutput): void {
    this.markSecretsInOutput(
      output.stdout,
      (s) => s.keys(ACCESS_TOKEN_QUERY).queried(this.queried),
    );
  }

  /** Emit `account get-access-token` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["account", "get-access-token"];
    if (this.#resource !== undefined) {
      argv.push(option("--resource", this.#resource));
    }
    if (this.#resourceType !== undefined) {
      argv.push(option("--resource-type", this.#resourceType));
    }
    if (this.#scopes.length > 0) {
      argv.push(
        "--scope",
        ...operands("accountGetAccessToken", "--scope", this.#scopes),
      );
    }
    if (this.#tenant !== undefined) {
      argv.push(option("--tenant", this.#tenant));
    }
    return argv;
  }
}
