// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `az acr` — Azure Container Registry: logging in, building an image in the
 * registry, and listing and deleting tags.
 *
 * ```ts
 * import { AzTasks } from "@zuke/az";
 * import { DockerTasks } from "@zuke/docker";
 * const token = await AzTasks.acrToken((s) => s.name("myregistry"));
 * await DockerTasks.login((s) =>
 *   s.username("00000000-0000-0000-0000-000000000000")
 *     .passwordStdin(token).registry("myregistry.azurecr.io")
 * );
 * await AzTasks.acrBuild((s) =>
 *   s.registry("myregistry").image("api:1.4.0").source(".")
 * );
 * ```
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import { registerSecrets } from "./secret_output.ts";
import { type AzOutputFormat, AzSettings } from "./settings.ts";
import { fromStdin, keyed, operand, option, required } from "./validate.ts";

/** The `--query` the ACR token reader pins. */
export const ACR_TOKEN_QUERY = "accessToken";

/** The fields of an `acr login --expose-token` answer that are secret. */
const TOKEN_KEYS = [ACR_TOKEN_QUERY, "refreshToken"];

/** `--name=<registry>`, refused without one. */
function registryName(task: string, name: string | undefined): string {
  return option(
    "--name",
    required(name, task, "no registry named — add .name('myregistry')."),
  );
}

/**
 * Settings for `az acr login`.
 *
 * Without {@link exposeToken} the CLI logs the local Docker client in itself.
 * With it, the CLI prints a registry refresh token instead — for
 * `docker login` with the user `00000000-0000-0000-0000-000000000000` — so the
 * command always runs quietly with `--output json` pinned, and the token is
 * registered with the run's redactor once it returns.
 */
export class AzAcrLoginSettings extends AzSettings {
  #name?: string;
  #exposeToken = false;
  #username?: string;
  #password?: string;
  #suffix?: string;

  /** Settings that capture the answer instead of streaming it. */
  constructor() {
    super();
    this.quiet();
  }

  /** The registry's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** Print a token instead of logging Docker in (`--expose-token`). */
  exposeToken(): this {
    this.#exposeToken = true;
    return this;
  }

  /** A registry user, instead of the signed-in identity (`--username`). */
  username(name: string): this {
    this.#username = name;
    return this;
  }

  /**
   * The registry user's password (`--password`), sent on standard input as
   * `--password=@-` so it never enters the argv, and registered with the
   * run's redactor.
   */
  password(secret: string): this {
    this.#password = secret;
    this.markSecret(secret);
    return this;
  }

  /** The tenant suffix of the registry's login server (`--suffix`). */
  suffix(suffix: string): this {
    this.#suffix = suffix;
    return this;
  }

  /** Pin `--output json`, the form the returned token can be found in. */
  protected override pinnedOutput(): AzOutputFormat {
    return "json";
  }

  /** The password, for the CLI to read from standard input. */
  protected override stdinInput(): string | undefined {
    return this.#password;
  }

  /**
   * Register the returned token as a secret — with {@link exposeToken} only:
   * without it the CLI logs Docker in and prints no credential.
   */
  protected override onOutput(output: CommandOutput): void {
    if (!this.#exposeToken) return;
    registerSecrets(
      output.stdout,
      TOKEN_KEYS,
      this.queried,
      (secret) => this.markSecret(secret),
    );
  }

  /** Emit `acr login` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["acr", "login", registryName("acrLogin", this.#name)];
    if (this.#exposeToken) {
      if (this.#username !== undefined || this.#password !== undefined) {
        throw new Error(
          "AzTasks.acrLogin: --expose-token cannot be combined with a " +
            "username or password.",
        );
      }
      argv.push("--expose-token");
    }
    if (this.#username !== undefined) {
      argv.push(option("--username", this.#username));
    }
    if (this.#password !== undefined) argv.push(fromStdin("--password"));
    if (this.#suffix !== undefined) argv.push(option("--suffix", this.#suffix));
    return argv;
  }
}

/**
 * Settings for `az acr build`: build an image in the registry from a local
 * directory, a git URL or a tarball, and push it.
 *
 * `--build-arg` values are visible to the ACR team for debugging, as the CLI
 * warns; pass a credential with {@link secretBuildArg}, whose value is also
 * registered with the run's redactor.
 */
export class AzAcrBuildSettings extends AzSettings {
  #registry?: string;
  #source?: string;
  readonly #images: string[] = [];
  #file?: string;
  readonly #buildArgs: string[] = [];
  readonly #secretBuildArgs: string[] = [];
  #platform?: string;
  #target?: string;
  #timeout?: number;
  #resourceGroup?: string;
  #noPush = false;
  #noLogs = false;
  #noWait = false;

  /** The registry to build in (`--registry`). */
  registry(name: string): this {
    this.#registry = name;
    return this;
  }

  /** The build context: a directory, a git URL or a tarball URL (the positional source). */
  source(location: string): this {
    this.#source = location;
    return this;
  }

  /** A `name:tag` to give the image (`--image`); repeatable. */
  image(nameAndTag: string): this {
    this.#images.push(nameAndTag);
    return this;
  }

  /** The Dockerfile, relative to the source (`--file`). */
  file(path: string): this {
    this.#file = path;
    return this;
  }

  /** A build argument (`--build-arg name=value`); repeatable. Never a credential. */
  buildArg(name: string, value: string): this {
    this.#buildArgs.push(keyed("acrBuild", "build-arg", name, value));
    return this;
  }

  /**
   * A build argument the ACR team does not see (`--secret-build-arg
   * name=value`); repeatable. The value is registered with the run's
   * redactor; it is still part of the argv.
   */
  secretBuildArg(name: string, value: string): this {
    this.#secretBuildArgs.push(
      keyed("acrBuild", "secret-build-arg", name, value),
    );
    this.markSecret(value);
    return this;
  }

  /** The platform to build for (`--platform`), e.g. `"linux/arm64"`. */
  platform(platform: string): this {
    this.#platform = platform;
    return this;
  }

  /** The Dockerfile stage to build (`--target`). */
  target(stage: string): this {
    this.#target = stage;
    return this;
  }

  /** The build's timeout in seconds (`--timeout`). */
  timeout(seconds: number): this {
    this.#timeout = seconds;
    return this;
  }

  /** The registry's resource group (`--resource-group`). */
  resourceGroup(name: string): this {
    this.#resourceGroup = name;
    return this;
  }

  /** Build without pushing (`--no-push`). */
  noPush(): this {
    this.#noPush = true;
    return this;
  }

  /** Do not stream the build's logs (`--no-logs`). */
  noLogs(): this {
    this.#noLogs = true;
    return this;
  }

  /** Return once the build is queued (`--no-wait`). */
  noWait(): this {
    this.#noWait = true;
    return this;
  }

  /** Emit `acr build` with its options and source. */
  protected override leadingTokens(): string[] {
    const task = "acrBuild";
    const registry = required(
      this.#registry,
      task,
      "no registry named — add .registry('myregistry').",
    );
    const source = required(
      this.#source,
      task,
      "no build context — add .source('.').",
    );
    const argv = ["acr", "build", option("--registry", registry)];
    for (const image of this.#images) argv.push(option("--image", image));
    if (this.#file !== undefined) argv.push(option("--file", this.#file));
    for (const arg of this.#buildArgs) argv.push(option("--build-arg", arg));
    for (const arg of this.#secretBuildArgs) {
      argv.push(option("--secret-build-arg", arg));
    }
    if (this.#platform !== undefined) {
      argv.push(option("--platform", this.#platform));
    }
    if (this.#target !== undefined) argv.push(option("--target", this.#target));
    if (this.#timeout !== undefined) {
      argv.push(option("--timeout", this.#timeout));
    }
    if (this.#resourceGroup !== undefined) {
      argv.push(option("--resource-group", this.#resourceGroup));
    }
    if (this.#noPush) argv.push("--no-push");
    if (this.#noLogs) argv.push("--no-logs");
    if (this.#noWait) argv.push("--no-wait");
    argv.push(operand(task, "source", source));
    return argv;
  }
}

/** Settings for `az acr repository show-tags`. */
export class AzAcrRepositoryShowTagsSettings extends AzSettings {
  #name?: string;
  #repository?: string;
  #top?: number;
  #orderby?: "time_asc" | "time_desc";
  #detail = false;

  /** The registry's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** The repository whose tags to list (`--repository`). */
  repository(name: string): this {
    this.#repository = name;
    return this;
  }

  /** At most this many tags (`--top`). */
  top(count: number): this {
    this.#top = count;
    return this;
  }

  /** Order by time, oldest or newest first (`--orderby`); by name otherwise. */
  orderby(order: "time_asc" | "time_desc"): this {
    this.#orderby = order;
    return this;
  }

  /** Each tag's details, not only its name (`--detail`). */
  detail(): this {
    this.#detail = true;
    return this;
  }

  /** Emit `acr repository show-tags` with its options. */
  protected override leadingTokens(): string[] {
    const task = "acrRepositoryShowTags";
    const repository = required(
      this.#repository,
      task,
      "no repository named — add .repository('api').",
    );
    const argv = [
      "acr",
      "repository",
      "show-tags",
      registryName(task, this.#name),
      option("--repository", repository),
    ];
    if (this.#top !== undefined) argv.push(option("--top", this.#top));
    if (this.#orderby !== undefined) {
      argv.push(option("--orderby", this.#orderby));
    }
    if (this.#detail) argv.push("--detail");
    return argv;
  }
}

/**
 * Settings for `az acr repository delete`: one image, by tag or digest, or a
 * whole repository. The CLI asks for confirmation unless {@link yes} is set.
 */
export class AzAcrRepositoryDeleteSettings extends AzSettings {
  #name?: string;
  #image?: string;
  #repository?: string;
  #yes = false;

  /** The registry's name (`--name`). */
  name(name: string): this {
    this.#name = name;
    return this;
  }

  /** The image to delete, `repo:tag` or `repo@digest` (`--image`). */
  image(image: string): this {
    this.#image = image;
    return this;
  }

  /** Delete the whole repository, every tag in it (`--repository`). */
  repository(name: string): this {
    this.#repository = name;
    return this;
  }

  /** Delete without asking (`--yes`). */
  yes(): this {
    this.#yes = true;
    return this;
  }

  /** Emit `acr repository delete` with its options. */
  protected override leadingTokens(): string[] {
    const task = "acrRepositoryDelete";
    const argv = [
      "acr",
      "repository",
      "delete",
      registryName(task, this.#name),
    ];
    if ((this.#image === undefined) === (this.#repository === undefined)) {
      throw new Error(
        `AzTasks.${task}: delete takes an image or a repository, not both — ` +
          "add .image('api:old') or .repository('api').",
      );
    }
    if (this.#image !== undefined) argv.push(option("--image", this.#image));
    if (this.#repository !== undefined) {
      argv.push(option("--repository", this.#repository));
    }
    if (this.#yes) argv.push("--yes");
    return argv;
  }
}
