// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az webapp` — App Service: deploying an artifact, describing the app,
 * setting app settings and swapping a slot into production.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * await AzTasks.webappDeploy((s) =>
 *   s.name("web").resourceGroup("rg-prod").slot("staging")
 *     .srcPath("dist/app.zip").type("zip")
 * );
 * await AzTasks.webappDeploymentSlotSwap((s) =>
 *   s.name("web").resourceGroup("rg-prod").slot("staging")
 * );
 * ```
 *
 * @module
 */

import { AzResourceSettings } from "./resource.ts";
import { bool, option, pair, required, settingKey } from "./validate.ts";

/** The `--query` the host-name reader pins. */
export const HOST_NAME_QUERY = "defaultHostName";

/** The artifact types `webapp deploy --type` accepts. */
export type AzWebappArtifactType =
  | "war"
  | "jar"
  | "ear"
  | "lib"
  | "startup"
  | "static"
  | "zip";

/**
 * Settings for `az webapp deploy`, the current deploy command (the older
 * `webapp deployment source config-zip` is deprecated in its favour).
 */
export class AzWebappDeploySettings extends AzResourceSettings {
  #srcPath?: string;
  #srcUrl?: string;
  #type?: AzWebappArtifactType;
  #targetPath?: string;
  #slot?: string;
  #async?: boolean;
  #restart?: boolean;
  #clean?: boolean;
  #timeout?: number;

  /** The artifact to deploy, a local path (`--src-path`). */
  srcPath(path: string): this {
    this.#srcPath = path;
    return this;
  }

  /** The artifact to deploy, a URL the app pulls it from (`--src-url`). */
  srcUrl(url: string): this {
    this.#srcUrl = url;
    return this;
  }

  /** The artifact's type, when its extension does not say (`--type`). */
  type(type: AzWebappArtifactType): this {
    this.#type = type;
    return this;
  }

  /** Where to deploy it, an absolute path on the app (`--target-path`). */
  targetPath(path: string): this {
    this.#targetPath = path;
    return this;
  }

  /** The slot to deploy to; production when omitted (`--slot`). */
  slot(name: string): this {
    this.#slot = name;
    return this;
  }

  /** Return once the artifact is pushed, without waiting for it to deploy (`--async`). */
  async(value = true): this {
    this.#async = value;
    return this;
  }

  /** Restart the app after deploying (`--restart`); the CLI's default is to. */
  restart(value: boolean): this {
    this.#restart = value;
    return this;
  }

  /** Empty the target directory first (`--clean`). */
  clean(value: boolean): this {
    this.#clean = value;
    return this;
  }

  /** How long to wait for the deployment, in milliseconds (`--timeout`). */
  timeout(ms: number): this {
    this.#timeout = ms;
    return this;
  }

  /** Emit `webapp deploy` with its options. */
  protected override leadingTokens(): string[] {
    const task = "webappDeploy";
    if ((this.#srcPath === undefined) === (this.#srcUrl === undefined)) {
      throw new Error(
        `AzTasks.${task}: deploy takes one artifact — add .srcPath(path) or ` +
          ".srcUrl(url).",
      );
    }
    const argv = ["webapp", "deploy", ...this.resourceTokens(task, "web app")];
    if (this.#srcPath !== undefined) {
      argv.push(option("--src-path", this.#srcPath));
    }
    if (this.#srcUrl !== undefined) {
      argv.push(option("--src-url", this.#srcUrl));
    }
    if (this.#type !== undefined) argv.push(option("--type", this.#type));
    if (this.#targetPath !== undefined) {
      argv.push(option("--target-path", this.#targetPath));
    }
    if (this.#slot !== undefined) argv.push(option("--slot", this.#slot));
    if (this.#async !== undefined) argv.push(bool("--async", this.#async));
    if (this.#restart !== undefined) {
      argv.push(bool("--restart", this.#restart));
    }
    if (this.#clean !== undefined) argv.push(bool("--clean", this.#clean));
    if (this.#timeout !== undefined) {
      argv.push(option("--timeout", this.#timeout));
    }
    return argv;
  }
}

/** Settings for `az webapp show`. */
export class AzWebappShowSettings extends AzResourceSettings {
  #slot?: string;

  /** A slot instead of production (`--slot`). */
  slot(name: string): this {
    this.#slot = name;
    return this;
  }

  /** Emit `webapp show` with its options. */
  protected override leadingTokens(): string[] {
    const argv = [
      "webapp",
      "show",
      ...this.resourceTokens("webappShow", "web app"),
    ];
    if (this.#slot !== undefined) argv.push(option("--slot", this.#slot));
    return argv;
  }
}

/**
 * Settings for `az webapp config appsettings set`.
 *
 * Each setting's value is part of the argv, so it is visible in the process
 * table and in the command line the build logs; a credential belongs in Key
 * Vault, referenced with {@link keyVaultReference}. A value that starts with
 * `@` is otherwise refused, because the CLI would read it from a file. The
 * CLI's answer lists every setting with its value redacted.
 */
export class AzWebappConfigAppsettingsSetSettings extends AzResourceSettings {
  readonly #settings: string[] = [];
  readonly #slotSettings: string[] = [];
  #slot?: string;

  /** An app setting (`--settings name=value`); repeatable. */
  setting(name: string, value: string): this {
    this.#settings.push(
      pair("webappConfigAppsettingsSet", "setting", name, value),
    );
    return this;
  }

  /**
   * An app setting whose value App Service reads from Key Vault; repeatable.
   * Sent as the JSON object `{"name":"@Microsoft.KeyVault(SecretUri=<uri>)"}`,
   * a form `--settings` accepts: written as `name=@Microsoft…` the CLI would
   * first try to read a file of that name, and send its contents if one
   * existed.
   */
  keyVaultReference(name: string, secretUri: string): this {
    if (!secretUri.startsWith("https://") || /[()\s]/.test(secretUri)) {
      throw new Error(
        "AzTasks.webappConfigAppsettingsSet: a Key Vault reference needs " +
          "the secret's https:// URI, without parentheses or spaces.",
      );
    }
    const key = settingKey("webappConfigAppsettingsSet", "setting", name);
    this.#settings.push(
      JSON.stringify({ [key]: `@Microsoft.KeyVault(SecretUri=${secretUri})` }),
    );
    return this;
  }

  /**
   * A setting that stays with its slot through a swap (`--slot-settings
   * name=value`); repeatable.
   */
  slotSetting(name: string, value: string): this {
    this.#slotSettings.push(
      pair("webappConfigAppsettingsSet", "slot setting", name, value),
    );
    return this;
  }

  /** A slot instead of production (`--slot`). */
  slot(name: string): this {
    this.#slot = name;
    return this;
  }

  /** Emit `webapp config appsettings set` with its options. */
  protected override leadingTokens(): string[] {
    const task = "webappConfigAppsettingsSet";
    if (this.#settings.length + this.#slotSettings.length === 0) {
      throw new Error(
        `AzTasks.${task}: no settings — add .setting(name, value).`,
      );
    }
    const argv = [
      "webapp",
      "config",
      "appsettings",
      "set",
      ...this.resourceTokens(task, "web app"),
    ];
    if (this.#settings.length > 0) argv.push("--settings", ...this.#settings);
    if (this.#slotSettings.length > 0) {
      argv.push("--slot-settings", ...this.#slotSettings);
    }
    if (this.#slot !== undefined) argv.push(option("--slot", this.#slot));
    return argv;
  }
}

/** The kinds of swap `webapp deployment slot swap --action` performs. */
export type AzSlotSwapAction = "swap" | "preview" | "reset";

/**
 * Settings for `az webapp deployment slot swap`: swap a slot with production,
 * or with {@link targetSlot}.
 */
export class AzWebappDeploymentSlotSwapSettings extends AzResourceSettings {
  #slot?: string;
  #targetSlot?: string;
  #action?: AzSlotSwapAction;
  #preserveVnet?: boolean;

  /** The slot to swap from (`--slot`). */
  slot(name: string): this {
    this.#slot = name;
    return this;
  }

  /** The slot to swap with; production by default (`--target-slot`). */
  targetSlot(name: string): this {
    this.#targetSlot = name;
    return this;
  }

  /**
   * `preview` applies the target's settings to the source first, `swap`
   * completes the swap, `reset` cancels a preview (`--action`).
   */
  action(action: AzSlotSwapAction): this {
    this.#action = action;
    return this;
  }

  /** Keep the virtual network with the slot (`--preserve-vnet`). */
  preserveVnet(value: boolean): this {
    this.#preserveVnet = value;
    return this;
  }

  /** Emit `webapp deployment slot swap` with its options. */
  protected override leadingTokens(): string[] {
    const task = "webappDeploymentSlotSwap";
    const slot = required(
      this.#slot,
      task,
      "no slot named — add .slot('staging').",
    );
    const argv = [
      "webapp",
      "deployment",
      "slot",
      "swap",
      ...this.resourceTokens(task, "web app"),
      option("--slot", slot),
    ];
    if (this.#targetSlot !== undefined) {
      argv.push(option("--target-slot", this.#targetSlot));
    }
    if (this.#action !== undefined) argv.push(option("--action", this.#action));
    if (this.#preserveVnet !== undefined) {
      argv.push(bool("--preserve-vnet", this.#preserveVnet));
    }
    return argv;
  }
}
