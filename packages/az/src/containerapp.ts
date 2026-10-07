// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az containerapp` — Azure Container Apps: rolling out an image, reading a
 * revision list, activating revisions and splitting traffic between them.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.containerappUpdate((s) =>
 *   s.name("api").resourceGroup("rg-prod")
 *     .image("myregistry.azurecr.io/api:1.4.0").revisionSuffix("v140")
 * );
 * await AzTasks.containerappIngressTrafficSet((s) =>
 *   s.name("api").resourceGroup("rg-prod")
 *     .revisionWeight("api--v140", 10).revisionWeight("api--v130", 90)
 * );
 * const fqdn = await AzTasks.containerappFqdn((s) =>
 *   s.name("api").resourceGroup("rg-prod")
 * );
 * ```
 *
 * @module
 */

import { AzResourceSettings } from "./resource.ts";
import { finite, operands, option, pair, required } from "./validate.ts";

/** The `--query` the FQDN reader pins. */
export const FQDN_QUERY = "properties.configuration.ingress.fqdn";

/**
 * Settings for `az containerapp update`: a new image, environment or scale,
 * which makes a new revision.
 */
export class AzContainerappUpdateSettings extends AzResourceSettings {
  #image?: string;
  #containerName?: string;
  #revisionSuffix?: string;
  readonly #setEnvVars: string[] = [];
  readonly #removeEnvVars: string[] = [];
  #cpu?: number;
  #memory?: string;
  #minReplicas?: number;
  #maxReplicas?: number;
  #yaml?: string;

  /** The container image (`--image`), e.g. `"myregistry.azurecr.io/api:1.4.0"`. */
  image(image: string): this {
    this.#image = image;
    return this;
  }

  /** The container to update, when the app has several (`--container-name`). */
  containerName(name: string): this {
    this.#containerName = name;
    return this;
  }

  /** A suffix for the new revision's name (`--revision-suffix`). */
  revisionSuffix(suffix: string): this {
    this.#revisionSuffix = suffix;
    return this;
  }

  /**
   * Add or update an environment variable (`--set-env-vars name=value`);
   * repeatable. A value of `secretref:<secret>` reads one of the app's
   * secrets.
   */
  setEnvVar(name: string, value: string): this {
    this.#setEnvVars.push(pair("containerappUpdate", "env var", name, value));
    return this;
  }

  /** Remove environment variables (`--remove-env-vars`); repeatable. */
  removeEnvVars(...names: string[]): this {
    this.#removeEnvVars.push(...names);
    return this;
  }

  /** CPU cores for the container (`--cpu`), e.g. `0.5`. */
  cpu(cores: number): this {
    this.#cpu = finite("AzTasks.containerappUpdate", "cpu", cores);
    return this;
  }

  /** Memory for the container (`--memory`), e.g. `"1.0Gi"`. */
  memory(amount: string): this {
    this.#memory = amount;
    return this;
  }

  /** The fewest replicas (`--min-replicas`). */
  minReplicas(count: number): this {
    this.#minReplicas = count;
    return this;
  }

  /** The most replicas (`--max-replicas`). */
  maxReplicas(count: number): this {
    this.#maxReplicas = count;
    return this;
  }

  /** Take the whole configuration from a YAML file (`--yaml`); other options are ignored. */
  yaml(path: string): this {
    this.#yaml = path;
    return this;
  }

  /** Emit `containerapp update` with its options. */
  protected override leadingTokens(): string[] {
    const task = "containerappUpdate";
    const argv = [
      "containerapp",
      "update",
      ...this.resourceTokens(task, "container app"),
    ];
    if (this.#image !== undefined) argv.push(option("--image", this.#image));
    if (this.#containerName !== undefined) {
      argv.push(option("--container-name", this.#containerName));
    }
    if (this.#revisionSuffix !== undefined) {
      argv.push(option("--revision-suffix", this.#revisionSuffix));
    }
    if (this.#setEnvVars.length > 0) {
      argv.push("--set-env-vars", ...this.#setEnvVars);
    }
    if (this.#removeEnvVars.length > 0) {
      argv.push(
        "--remove-env-vars",
        ...operands(task, "--remove-env-vars", this.#removeEnvVars),
      );
    }
    if (this.#cpu !== undefined) argv.push(option("--cpu", this.#cpu));
    if (this.#memory !== undefined) argv.push(option("--memory", this.#memory));
    if (this.#minReplicas !== undefined) {
      argv.push(option("--min-replicas", this.#minReplicas));
    }
    if (this.#maxReplicas !== undefined) {
      argv.push(option("--max-replicas", this.#maxReplicas));
    }
    if (this.#yaml !== undefined) argv.push(option("--yaml", this.#yaml));
    return argv;
  }
}

/** Settings for `az containerapp show`. Secrets stay out: `--show-secrets` is not typed. */
export class AzContainerappShowSettings extends AzResourceSettings {
  /** Emit `containerapp show`. */
  protected override leadingTokens(): string[] {
    return [
      "containerapp",
      "show",
      ...this.resourceTokens("containerappShow", "container app"),
    ];
  }
}

/** Settings for `az containerapp revision list`. */
export class AzContainerappRevisionListSettings extends AzResourceSettings {
  #all = false;

  /** Include inactive revisions (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Emit `containerapp revision list` with its options. */
  protected override leadingTokens(): string[] {
    const argv = [
      "containerapp",
      "revision",
      "list",
      ...this.resourceTokens("containerappRevisionList", "container app"),
    ];
    if (this.#all) argv.push("--all");
    return argv;
  }
}

/**
 * Settings for `az containerapp revision activate` and `deactivate`: the
 * app, and the revision to switch.
 */
export class AzContainerappRevisionSettings extends AzResourceSettings {
  #revision?: string;

  /** The settings for `revision <verb>`. */
  constructor(
    /** `activate` or `deactivate`. */
    readonly verb_: "activate" | "deactivate",
  ) {
    super();
  }

  /** The revision to activate or deactivate (`--revision`). */
  revision(name: string): this {
    this.#revision = name;
    return this;
  }

  /** Emit `containerapp revision <verb>` with its options. */
  protected override leadingTokens(): string[] {
    const task = this.verb_ === "activate"
      ? "containerappRevisionActivate"
      : "containerappRevisionDeactivate";
    const revision = required(
      this.#revision,
      task,
      "no revision named — add .revision('api--v140').",
    );
    return [
      "containerapp",
      "revision",
      this.verb_,
      ...this.resourceTokens(task, "container app"),
      option("--revision", revision),
    ];
  }
}

/**
 * Settings for `az containerapp ingress traffic set`: the share of traffic
 * each revision — or each label — receives. The weights must add up to 100;
 * the CLI checks.
 */
export class AzContainerappIngressTrafficSetSettings
  extends AzResourceSettings {
  readonly #revisionWeights: string[] = [];
  readonly #labelWeights: string[] = [];

  /**
   * A revision's share of traffic, in percent (`--revision-weight
   * revision=weight`); repeatable. `"latest"` is the newest revision.
   */
  revisionWeight(revision: string, weight: number): this {
    this.#revisionWeights.push(this.#weight("revision", revision, weight));
    return this;
  }

  /** A label's share of traffic, in percent (`--label-weight label=weight`); repeatable. */
  labelWeight(label: string, weight: number): this {
    this.#labelWeights.push(this.#weight("label", label, weight));
    return this;
  }

  /** `name=weight`, refused unless the weight is a whole percentage. */
  #weight(what: string, name: string, weight: number): string {
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
      throw new Error(
        `AzTasks.containerappIngressTrafficSet: the ${what} "${name}" needs ` +
          `a whole-number weight from 0 to 100, got ${weight}.`,
      );
    }
    return pair("containerappIngressTrafficSet", what, name, weight);
  }

  /** Emit `containerapp ingress traffic set` with its options. */
  protected override leadingTokens(): string[] {
    const task = "containerappIngressTrafficSet";
    if (this.#revisionWeights.length + this.#labelWeights.length === 0) {
      throw new Error(
        `AzTasks.${task}: no weights — add .revisionWeight(revision, percent) ` +
          "or .labelWeight(label, percent).",
      );
    }
    const argv = [
      "containerapp",
      "ingress",
      "traffic",
      "set",
      ...this.resourceTokens(task, "container app"),
    ];
    if (this.#revisionWeights.length > 0) {
      argv.push("--revision-weight", ...this.#revisionWeights);
    }
    if (this.#labelWeights.length > 0) {
      argv.push("--label-weight", ...this.#labelWeights);
    }
    return argv;
  }
}
