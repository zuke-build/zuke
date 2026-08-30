// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `gcloud container clusters` group — chiefly `get-credentials`, which is
 * what lets a build talk to GKE at all.
 *
 * ```ts
 * import { GcloudTasks } from "jsr:@zuke/gcloud";
 * await GcloudTasks.clustersGetCredentials((s) =>
 *   s.cluster("prod").region("us-central1")
 * );
 * // kubectl now has a context to work against.
 * ```
 *
 * `get-credentials` writes the kubeconfig entry every `@zuke/kubectl` task then
 * depends on, so in CI it is the step between "authenticated to Google Cloud"
 * and "able to deploy".
 *
 * @module
 */

import { GcloudSettings } from "./settings.ts";

/**
 * Refuse more than one of the location flags, which gcloud reports as
 * "At most one of --location | --region | --zone can be specified."
 */
function checkLocation(
  location: string | undefined,
  region: string | undefined,
  zone: string | undefined,
  task: string,
): void {
  const chosen = [
    [".location()", location],
    [".region()", region],
    [".zone()", zone],
  ].filter(([, value]) => value !== undefined).map(([name]) => name);
  if (chosen.length > 1) {
    throw new Error(
      `GcloudTasks.${task}: ${chosen.join(" and ")} each name where the ` +
        "cluster is, and gcloud accepts at most one of --location, --region " +
        "and --zone. Keep one.",
    );
  }
}

/** Settings for `gcloud container clusters get-credentials`. */
export class GcloudClustersGetCredentialsSettings extends GcloudSettings {
  #cluster?: string;
  #location?: string;
  #region?: string;
  #zone?: string;
  #internalIp = false;
  #dnsEndpoint = false;

  /** The cluster to fetch credentials for (positional). */
  cluster(name: string): this {
    this.#cluster = name;
    return this;
  }

  /** The cluster's location (`--location`). */
  location(value: string): this {
    this.#location = value;
    return this;
  }

  /** The cluster's region (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** The cluster's zone (`--zone`). */
  zone(value: string): this {
    this.#zone = value;
    return this;
  }

  /** Use the internal endpoint (`--internal-ip`), for a private cluster. */
  internalIp(): this {
    this.#internalIp = true;
    return this;
  }

  /** Use the DNS endpoint (`--dns-endpoint`). */
  dnsEndpoint(): this {
    this.#dnsEndpoint = true;
    return this;
  }

  /** Emit `container clusters get-credentials` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#cluster === undefined) {
      throw new Error(
        "GcloudTasks.clustersGetCredentials: no cluster named — add " +
          ".cluster('prod').",
      );
    }
    checkLocation(
      this.#location,
      this.#region,
      this.#zone,
      "clustersGetCredentials",
    );
    const argv = [
      "container",
      "clusters",
      "get-credentials",
      this.#cluster,
    ];
    if (this.#location !== undefined) argv.push("--location", this.#location);
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#zone !== undefined) argv.push("--zone", this.#zone);
    if (this.#internalIp) argv.push("--internal-ip");
    if (this.#dnsEndpoint) argv.push("--dns-endpoint");
    return argv;
  }
}

/** Settings for `gcloud container clusters list`. */
export class GcloudClustersListSettings extends GcloudSettings {
  #location?: string;
  #region?: string;
  #zone?: string;
  #filter?: string;

  /** Restrict to a location (`--location`). */
  location(value: string): this {
    this.#location = value;
    return this;
  }

  /** Restrict to a region (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** Restrict to a zone (`--zone`). */
  zone(value: string): this {
    this.#zone = value;
    return this;
  }

  /** Restrict the listing (`--filter`). */
  filter(expression: string): this {
    this.#filter = expression;
    return this;
  }

  /** Emit `container clusters list` with its flags. */
  protected override leadingTokens(): string[] {
    checkLocation(this.#location, this.#region, this.#zone, "clustersList");
    const argv = ["container", "clusters", "list"];
    if (this.#location !== undefined) argv.push("--location", this.#location);
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#zone !== undefined) argv.push("--zone", this.#zone);
    if (this.#filter !== undefined) argv.push("--filter", this.#filter);
    return argv;
  }
}

/** Settings for `gcloud container clusters describe`. */
export class GcloudClustersDescribeSettings extends GcloudSettings {
  #cluster?: string;
  #location?: string;
  #region?: string;
  #zone?: string;

  /** The cluster to describe (positional). */
  cluster(name: string): this {
    this.#cluster = name;
    return this;
  }

  /** The cluster's location (`--location`). */
  location(value: string): this {
    this.#location = value;
    return this;
  }

  /** The cluster's region (`--region`). */
  region(value: string): this {
    this.#region = value;
    return this;
  }

  /** The cluster's zone (`--zone`). */
  zone(value: string): this {
    this.#zone = value;
    return this;
  }

  /** Emit `container clusters describe` with its operand. */
  protected override leadingTokens(): string[] {
    if (this.#cluster === undefined) {
      throw new Error(
        "GcloudTasks.clustersDescribe: no cluster named — add " +
          ".cluster('prod').",
      );
    }
    checkLocation(this.#location, this.#region, this.#zone, "clustersDescribe");
    const argv = ["container", "clusters", "describe", this.#cluster];
    if (this.#location !== undefined) argv.push("--location", this.#location);
    if (this.#region !== undefined) argv.push("--region", this.#region);
    if (this.#zone !== undefined) argv.push("--zone", this.#zone);
    return argv;
  }
}
