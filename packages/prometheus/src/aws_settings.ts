// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link PrometheusAwsSettings} — how the AWS source signs: the region, and
 * where its credentials come from. Named after Prometheus's own `sigv4`
 * block (`region`, `access_key`/`secret_key`, `profile`), which is the same
 * vocabulary the AWS SDKs use.
 *
 * @module
 */

/** The SigV4 service name of Amazon Managed Service for Prometheus. */
export const AWS_PROMETHEUS_SERVICE = "aps";

/** An explicit access key (set by {@link PrometheusAwsSettings.accessKey}). */
export interface PrometheusAwsAccessKey {
  /** The access key id. */
  readonly accessKeyId: string;
  /** The secret access key. */
  readonly secretAccessKey: string;
  /** The session token of temporary credentials. */
  readonly sessionToken?: string;
}

/** Settings for `PrometheusConnectionSettings.sigv4(...)`. */
export class PrometheusAwsSettings {
  /** The signing region (set by {@link region}). */
  region_?: string;
  /** The shared-config profile (set by {@link profile}). */
  profile_?: string;
  /** An explicit access key (set by {@link accessKey}). */
  accessKey_?: PrometheusAwsAccessKey;

  /**
   * The workspace's region, such as `us-east-1`; defaults to `AWS_REGION`,
   * then `AWS_DEFAULT_REGION`.
   */
  region(region: string): this {
    this.region_ = region;
    return this;
  }

  /**
   * Read static keys from this profile of the shared credentials and config
   * files (`~/.aws/credentials`, `~/.aws/config`) instead of searching the
   * default chain.
   */
  profile(name: string): this {
    this.profile_ = name;
    return this;
  }

  /** Sign with this access key instead of searching the default chain. */
  accessKey(
    accessKeyId: string,
    secretAccessKey: string,
    sessionToken?: string,
  ): this {
    if (accessKeyId === "" || secretAccessKey === "") {
      throw new Error(
        "sigv4 accessKey(...) was given an empty key id or secret — a " +
          "missing secret, most likely.",
      );
    }
    this.accessKey_ = sessionToken === undefined
      ? { accessKeyId, secretAccessKey }
      : { accessKeyId, secretAccessKey, sessionToken };
    return this;
  }
}
