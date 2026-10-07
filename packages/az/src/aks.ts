// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az aks` — Azure Kubernetes Service: writing a cluster's credentials to a
 * kubeconfig, and describing the cluster.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.aksGetCredentials((s) =>
 *   s.name("prod").resourceGroup("rg-prod").file("kubeconfig")
 *     .overwriteExisting()
 * );
 * ```
 *
 * @module
 */

import { AzResourceSettings } from "./resource.ts";
import { option } from "./validate.ts";

/**
 * Settings for `az aks get-credentials`. The credentials go to a file —
 * `~/.kube/config` unless {@link file} says otherwise. Printing them
 * (`--file -`) would put a cluster credential in the build log, so a `-` is
 * refused.
 */
export class AzAksGetCredentialsSettings extends AzResourceSettings {
  #admin = false;
  #file?: string;
  #overwriteExisting = false;
  #context?: string;
  #publicFqdn = false;
  #format?: "azure" | "exec";

  /** Get the cluster-admin credentials (`--admin`). */
  admin(): this {
    this.#admin = true;
    return this;
  }

  /** The kubeconfig file to write (`--file`); `~/.kube/config` by default. */
  file(path: string): this {
    if (path === "-") {
      throw new Error(
        "AzTasks.aksGetCredentials: --file - prints the cluster's " +
          "credentials to the build log. Refused — write them to a file.",
      );
    }
    this.#file = path;
    return this;
  }

  /** Replace an existing entry of the same name (`--overwrite-existing`). */
  overwriteExisting(): this {
    this.#overwriteExisting = true;
    return this;
  }

  /** The context name to write, instead of the cluster's (`--context`). */
  context(name: string): this {
    this.#context = name;
    return this;
  }

  /** Point the kubeconfig at the cluster's public FQDN (`--public-fqdn`). */
  publicFqdn(): this {
    this.#publicFqdn = true;
    return this;
  }

  /** The credential format (`--format`): `azure` or `exec` (kubelogin). */
  format(format: "azure" | "exec"): this {
    this.#format = format;
    return this;
  }

  /** Emit `aks get-credentials` with its options. */
  protected override leadingTokens(): string[] {
    const argv = [
      "aks",
      "get-credentials",
      ...this.resourceTokens("aksGetCredentials", "cluster"),
    ];
    if (this.#admin) argv.push("--admin");
    if (this.#file !== undefined) argv.push(option("--file", this.#file));
    if (this.#overwriteExisting) argv.push("--overwrite-existing");
    if (this.#context !== undefined) {
      argv.push(option("--context", this.#context));
    }
    if (this.#publicFqdn) argv.push("--public-fqdn");
    if (this.#format !== undefined) argv.push(option("--format", this.#format));
    return argv;
  }
}

/** Settings for `az aks show`. */
export class AzAksShowSettings extends AzResourceSettings {
  /** Emit `aks show`. */
  protected override leadingTokens(): string[] {
    return ["aks", "show", ...this.resourceTokens("aksShow", "cluster")];
  }
}
