// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link PrometheusAzureSettings} — which Microsoft Entra ID credential the
 * Azure source uses and what it asks for, named as the Azure Identity
 * libraries name them: `tenantId`, `clientId`, `authorityHost`, and one
 * method per credential — `clientSecret`, `workloadIdentity`,
 * `managedIdentity`.
 *
 * @module
 */

/** The scope Azure Monitor managed service for Prometheus queries need. */
const AZURE_PROMETHEUS_SCOPE = "https://prometheus.monitor.azure.com/.default";

/** The Microsoft Entra authority, when neither a setting nor the env names one. */
export const AZURE_PUBLIC_AUTHORITY_HOST = "https://login.microsoftonline.com";

/**
 * Which credential to use: `"default"` picks one from the environment (see
 * `PrometheusConnectionSettings.azure`); the others are explicit.
 */
export type PrometheusAzureCredentialKind =
  | "default"
  | "clientSecret"
  | "workloadIdentity"
  | "managedIdentity";

/** Settings for `PrometheusConnectionSettings.azure(...)`. */
export class PrometheusAzureSettings {
  /** The credential to use (set by the credential methods). */
  credential_: PrometheusAzureCredentialKind = "default";
  /** The scope requested (set by {@link scope}). */
  scope_: string = AZURE_PROMETHEUS_SCOPE;
  /** The tenant (set by {@link tenantId}); else `AZURE_TENANT_ID`. */
  tenantId_?: string;
  /** The application or identity (set by {@link clientId}); else `AZURE_CLIENT_ID`. */
  clientId_?: string;
  /** The authority (set by {@link authorityHost}); else `AZURE_AUTHORITY_HOST`. */
  authorityHost_?: string;
  /** The client secret (set by {@link clientSecret}); else `AZURE_CLIENT_SECRET`. */
  clientSecret_?: string;
  /** The federated token file (set by {@link workloadIdentity}); else `AZURE_FEDERATED_TOKEN_FILE`. */
  federatedTokenFile_?: string;

  /** The scope to request, replacing `https://prometheus.monitor.azure.com/.default`. */
  scope(scope: string): this {
    this.scope_ = scope;
    return this;
  }

  /** The Microsoft Entra tenant (directory) id; defaults to `AZURE_TENANT_ID`. */
  tenantId(id: string): this {
    this.tenantId_ = id;
    return this;
  }

  /**
   * The application's client id — or, for a user-assigned managed identity,
   * the identity's; defaults to `AZURE_CLIENT_ID`.
   */
  clientId(id: string): this {
    this.clientId_ = id;
    return this;
  }

  /**
   * The Microsoft Entra authority, such as `https://login.microsoftonline.us`
   * for Azure Government; defaults to `AZURE_AUTHORITY_HOST`, then
   * `https://login.microsoftonline.com`.
   */
  authorityHost(url: string): this {
    this.authorityHost_ = url;
    return this;
  }

  /**
   * Use a service principal's client secret (the client-credentials grant).
   * The secret defaults to `AZURE_CLIENT_SECRET`.
   */
  clientSecret(secret?: string): this {
    this.credential_ = "clientSecret";
    this.clientSecret_ = secret;
    return this;
  }

  /**
   * Use workload identity federation: the Kubernetes service-account token
   * in `tokenFile` (default `AZURE_FEDERATED_TOKEN_FILE`) is the client
   * assertion, read afresh on every token request since it is rotated.
   */
  workloadIdentity(tokenFile?: string): this {
    this.credential_ = "workloadIdentity";
    this.federatedTokenFile_ = tokenFile;
    return this;
  }

  /**
   * Use the managed identity of the VM, App Service or Functions app the
   * build runs on. Pass a user-assigned identity's client id, or leave it
   * out for `clientId(...)` / `AZURE_CLIENT_ID`, and failing those the
   * system-assigned identity.
   */
  managedIdentity(clientId?: string): this {
    this.credential_ = "managedIdentity";
    if (clientId !== undefined) this.clientId_ = clientId;
    return this;
  }
}
