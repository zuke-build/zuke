// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az deployment group` — deploying an ARM or Bicep template to a resource
 * group, previewing it with what-if, and reading a deployment back.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.deploymentGroupWhatIf((s) =>
 *   s.resourceGroup("rg-prod").templateFile("main.bicep")
 *     .parametersFile("prod.bicepparam")
 * );
 * await AzTasks.deploymentGroupCreate((s) =>
 *   s.name("release-42").resourceGroup("rg-prod").templateFile("main.bicep")
 *     .parametersFile("prod.bicepparam").parameter("imageTag", "1.4.0")
 * );
 * const url = await AzTasks.deploymentOutput("rg-prod", "release-42", "apiUrl");
 * ```
 *
 * Both deploying commands pass `--no-prompt=true`, so a parameter the
 * template needs and nothing supplies fails the command instead of prompting
 * for it.
 *
 * @module
 */

import { AzResourceSettings } from "./resource.ts";
import { keyed, operands, option } from "./validate.ts";

/** The `--query` the deployment-output reader pins. */
export const OUTPUTS_QUERY = "properties.outputs";

/** How a deployment treats resources the template does not mention (`--mode`). */
export type AzDeploymentMode = "Incremental" | "Complete";

/** The kinds of change `what-if --exclude-change-types` can leave out. */
export type AzWhatIfChangeType =
  | "Create"
  | "Delete"
  | "Deploy"
  | "Ignore"
  | "Modify"
  | "NoChange"
  | "Unsupported";

/**
 * The template, parameters and mode a deploying `deployment group` command
 * shares — `create` and `what-if` read them identically. The deployment's
 * `--name` is optional here; the CLI defaults it to the template file's name.
 */
export abstract class AzDeploymentGroupTemplateSettings
  extends AzResourceSettings {
  #templateFile?: string;
  #templateUri?: string;
  #templateSpec?: string;
  readonly #parameters: Array<string | [string, string]> = [];
  #mode?: AzDeploymentMode;

  /** A local ARM template or Bicep file (`--template-file`). */
  templateFile(path: string): this {
    this.#templateFile = path;
    return this;
  }

  /** A template at a URL (`--template-uri`). */
  templateUri(uri: string): this {
    this.#templateUri = uri;
    return this;
  }

  /** A template spec, by resource id (`--template-spec`). */
  templateSpec(id: string): this {
    this.#templateSpec = id;
    return this;
  }

  /**
   * A parameters file — JSON or `.bicepparam` (`--parameters <path>`);
   * repeatable, later values winning.
   */
  parametersFile(path: string): this {
    this.#parameters.push(path);
    return this;
  }

  /**
   * One parameter (`--parameters name=value`); repeatable. The value is
   * converted to the type the template declares. It is part of the argv, so a
   * secure value belongs in a parameters file or a Key Vault reference.
   */
  parameter(name: string, value: string | number | boolean): this {
    this.#parameters.push([name, String(value)]);
    return this;
  }

  /** `Incremental` (the default) or `Complete`, which deletes what the template omits (`--mode`). */
  mode(mode: AzDeploymentMode): this {
    this.#mode = mode;
    return this;
  }

  /** The template, parameter and mode options, refused without one template. */
  protected templateTokens(task: string): string[] {
    const sources = [this.#templateFile, this.#templateUri, this.#templateSpec]
      .filter((source) => source !== undefined);
    if (sources.length !== 1) {
      throw new Error(
        `AzTasks.${task}: a deployment takes one template — add ` +
          ".templateFile(path), .templateUri(uri) or .templateSpec(id).",
      );
    }
    const argv: string[] = [];
    if (this.#templateFile !== undefined) {
      argv.push(option("--template-file", this.#templateFile));
    }
    if (this.#templateUri !== undefined) {
      argv.push(option("--template-uri", this.#templateUri));
    }
    if (this.#templateSpec !== undefined) {
      argv.push(option("--template-spec", this.#templateSpec));
    }
    for (const parameter of this.#parameters) {
      const text = typeof parameter === "string"
        ? parameter
        : keyed(task, "parameter", ...parameter);
      argv.push(option("--parameters", text));
    }
    if (this.#mode !== undefined) argv.push(option("--mode", this.#mode));
    argv.push(option("--no-prompt", "true"));
    return argv;
  }
}

/** Settings for `az deployment group create`. */
export class AzDeploymentGroupCreateSettings
  extends AzDeploymentGroupTemplateSettings {
  #noWait = false;

  /** Return once the deployment has started (`--no-wait`). */
  noWait(): this {
    this.#noWait = true;
    return this;
  }

  /** Emit `deployment group create` with its options. */
  protected override leadingTokens(): string[] {
    const task = "deploymentGroupCreate";
    const argv = [
      "deployment",
      "group",
      "create",
      ...this.optionalNameTokens(task, "deployment"),
      ...this.templateTokens(task),
    ];
    if (this.#noWait) argv.push("--no-wait");
    return argv;
  }
}

/** Settings for `az deployment group what-if`: what a deployment would change. */
export class AzDeploymentGroupWhatIfSettings
  extends AzDeploymentGroupTemplateSettings {
  #resultFormat?: "FullResourcePayloads" | "ResourceIdOnly";
  readonly #excludeChangeTypes: AzWhatIfChangeType[] = [];
  #noPrettyPrint = false;

  /** How much of each change to show (`--result-format`). */
  resultFormat(format: "FullResourcePayloads" | "ResourceIdOnly"): this {
    this.#resultFormat = format;
    return this;
  }

  /** Leave these kinds of change out (`--exclude-change-types`); repeatable. */
  excludeChangeTypes(...types: AzWhatIfChangeType[]): this {
    this.#excludeChangeTypes.push(...types);
    return this;
  }

  /** Print the result as JSON rather than the formatted diff (`--no-pretty-print`). */
  noPrettyPrint(): this {
    this.#noPrettyPrint = true;
    return this;
  }

  /** Emit `deployment group what-if` with its options. */
  protected override leadingTokens(): string[] {
    const task = "deploymentGroupWhatIf";
    const argv = [
      "deployment",
      "group",
      "what-if",
      ...this.optionalNameTokens(task, "deployment"),
      ...this.templateTokens(task),
    ];
    if (this.#resultFormat !== undefined) {
      argv.push(option("--result-format", this.#resultFormat));
    }
    if (this.#excludeChangeTypes.length > 0) {
      argv.push(
        "--exclude-change-types",
        ...operands(task, "--exclude-change-types", this.#excludeChangeTypes),
      );
    }
    if (this.#noPrettyPrint) argv.push("--no-pretty-print");
    return argv;
  }
}

/** Settings for `az deployment group show`. */
export class AzDeploymentGroupShowSettings extends AzResourceSettings {
  /** Emit `deployment group show`. */
  protected override leadingTokens(): string[] {
    return [
      "deployment",
      "group",
      "show",
      ...this.resourceTokens("deploymentGroupShow", "deployment"),
    ];
  }
}
