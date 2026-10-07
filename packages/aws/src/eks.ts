// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws eks` service — pointing `kubectl` at a cluster.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * await AwsTasks.eksUpdateKubeconfig((s) =>
 *   s.name("prod").region("eu-west-1").kubeconfig(".kube/config")
 * );
 * ```
 *
 * @module
 */

import { AwsSettings } from "./settings.ts";

/** Settings for `aws eks update-kubeconfig`. */
export class AwsEksUpdateKubeconfigSettings extends AwsSettings {
  #name?: string;
  #kubeconfig?: string;
  #alias?: string;
  #userAlias?: string;
  #roleArn?: string;
  #dryRun = false;

  /** The cluster (`--name`). */
  name(cluster: string): this {
    this.#name = cluster;
    return this;
  }

  /** The kubeconfig file to write (`--kubeconfig`); `~/.kube/config` by default. */
  kubeconfig(path: string): this {
    this.#kubeconfig = path;
    return this;
  }

  /** The context's name (`--alias`); the cluster ARN by default. */
  alias(name: string): this {
    this.#alias = name;
    return this;
  }

  /** The user entry's name (`--user-alias`). */
  userAlias(name: string): this {
    this.#userAlias = name;
    return this;
  }

  /** A role to assume when authenticating to the cluster (`--role-arn`). */
  roleArn(arn: string): this {
    this.#roleArn = arn;
    return this;
  }

  /** Print the configuration instead of writing it (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Emit `eks update-kubeconfig` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "AwsTasks.eksUpdateKubeconfig: no cluster named — add .name('prod').",
      );
    }
    const argv = ["eks", "update-kubeconfig", "--name", this.#name];
    if (this.#kubeconfig !== undefined) {
      argv.push("--kubeconfig", this.#kubeconfig);
    }
    if (this.#alias !== undefined) argv.push("--alias", this.#alias);
    if (this.#userAlias !== undefined) {
      argv.push("--user-alias", this.#userAlias);
    }
    if (this.#roleArn !== undefined) argv.push("--role-arn", this.#roleArn);
    if (this.#dryRun) argv.push("--dry-run");
    return argv;
  }
}

/** Settings for `aws eks describe-cluster`. */
export class AwsEksDescribeClusterSettings extends AwsSettings {
  #name?: string;

  /** The cluster (`--name`). */
  name(cluster: string): this {
    this.#name = cluster;
    return this;
  }

  /** Emit `eks describe-cluster` with the cluster. */
  protected override leadingTokens(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "AwsTasks.eksDescribeCluster: no cluster named — add .name('prod').",
      );
    }
    return ["eks", "describe-cluster", "--name", this.#name];
  }
}
