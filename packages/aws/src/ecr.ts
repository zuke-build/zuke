// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws ecr` service — logging in to a registry, and finding and pruning
 * images.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * import { DockerTasks } from "@zuke/docker";
 * const password = await AwsTasks.ecrLoginPassword((s) => s.region("eu-west-1"));
 * await DockerTasks.login((s) =>
 *   s.username("AWS").passwordStdin(password).registry(registry)
 * );
 * ```
 *
 * Image ids go to the CLI as a JSON document — the form every AWS CLI
 * structure parameter accepts — so a tag or digest cannot change how the list
 * around it is read, as a stray `,` would in the shorthand syntax.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import { secretsIn } from "./secret_output.ts";
import { operands, option } from "./validate.ts";
import { AwsSettings } from "./settings.ts";

/** One image, by tag or by digest, as `--image-ids` takes it. */
type ImageId = { imageTag: string } | { imageDigest: string };

/**
 * Settings for `aws ecr get-login-password`.
 *
 * The password is a registry credential, so the command always runs quietly
 * and the password is registered with the run's redactor once it returns.
 * Hand it to `docker login --password-stdin` (`DockerTasks.login` with
 * `.passwordStdin(...)`), never to `-p`.
 */
export class AwsEcrGetLoginPasswordSettings extends AwsSettings {
  /** Settings that capture the password instead of streaming it. */
  constructor() {
    super();
    this.quiet();
  }

  /** Register the printed password as a secret. */
  protected override onOutput(output: CommandOutput): void {
    for (const secret of secretsIn(output.stdout, [])) this.markSecret(secret);
  }

  /** Emit `ecr get-login-password`. */
  protected override leadingTokens(): string[] {
    return ["ecr", "get-login-password"];
  }
}

/** Settings for `aws ecr describe-images`. */
export class AwsEcrDescribeImagesSettings extends AwsSettings {
  #repositoryName?: string;
  #registryId?: string;
  readonly #imageIds: ImageId[] = [];
  #tagStatus?: "TAGGED" | "UNTAGGED" | "ANY";

  /** The repository to describe (`--repository-name`). */
  repositoryName(name: string): this {
    this.#repositoryName = name;
    return this;
  }

  /** The registry's account id, when not the caller's (`--registry-id`). */
  registryId(id: string): this {
    this.#registryId = id;
    return this;
  }

  /** Describe the image with this tag (`--image-ids`); repeatable. */
  imageTag(tag: string): this {
    this.#imageIds.push({ imageTag: tag });
    return this;
  }

  /** Describe the image with this digest (`--image-ids`); repeatable. */
  imageDigest(digest: string): this {
    this.#imageIds.push({ imageDigest: digest });
    return this;
  }

  /** Only images with this tag status (`--filter tagStatus=…`). */
  tagStatus(status: "TAGGED" | "UNTAGGED" | "ANY"): this {
    this.#tagStatus = status;
    return this;
  }

  /** Emit `ecr describe-images` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#repositoryName === undefined) {
      throw new Error(
        "AwsTasks.ecrDescribeImages: no repository named — add " +
          ".repositoryName('api').",
      );
    }
    const argv = [
      "ecr",
      "describe-images",
      option("--repository-name", this.#repositoryName),
    ];
    if (this.#registryId !== undefined) {
      argv.push(option("--registry-id", this.#registryId));
    }
    if (this.#imageIds.length > 0) {
      argv.push("--image-ids", JSON.stringify(this.#imageIds));
    }
    if (this.#tagStatus !== undefined) {
      argv.push(
        option("--filter", JSON.stringify({ tagStatus: this.#tagStatus })),
      );
    }
    return argv;
  }
}

/** Settings for `aws ecr describe-repositories`. */
export class AwsEcrDescribeRepositoriesSettings extends AwsSettings {
  readonly #repositoryNames: string[] = [];
  #registryId?: string;

  /** Only these repositories (`--repository-names`); all when omitted. */
  repositoryNames(...names: string[]): this {
    this.#repositoryNames.push(...names);
    return this;
  }

  /** The registry's account id, when not the caller's (`--registry-id`). */
  registryId(id: string): this {
    this.#registryId = id;
    return this;
  }

  /** Emit `ecr describe-repositories` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["ecr", "describe-repositories"];
    if (this.#repositoryNames.length > 0) {
      argv.push(
        "--repository-names",
        ...operands(
          "ecrDescribeRepositories",
          "--repository-names",
          this.#repositoryNames,
        ),
      );
    }
    if (this.#registryId !== undefined) {
      argv.push(option("--registry-id", this.#registryId));
    }
    return argv;
  }
}

/** Settings for `aws ecr batch-delete-image`. */
export class AwsEcrBatchDeleteImageSettings extends AwsSettings {
  #repositoryName?: string;
  #registryId?: string;
  readonly #imageIds: ImageId[] = [];

  /** The repository to delete from (`--repository-name`). */
  repositoryName(name: string): this {
    this.#repositoryName = name;
    return this;
  }

  /** The registry's account id, when not the caller's (`--registry-id`). */
  registryId(id: string): this {
    this.#registryId = id;
    return this;
  }

  /** Delete the image with this tag (`--image-ids`); repeatable. */
  imageTag(tag: string): this {
    this.#imageIds.push({ imageTag: tag });
    return this;
  }

  /** Delete the image with this digest (`--image-ids`); repeatable. */
  imageDigest(digest: string): this {
    this.#imageIds.push({ imageDigest: digest });
    return this;
  }

  /** Emit `ecr batch-delete-image` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#repositoryName === undefined || this.#imageIds.length === 0) {
      throw new Error(
        "AwsTasks.ecrBatchDeleteImage: a delete needs a repository and at " +
          "least one image — add .repositoryName('api').imageTag('old').",
      );
    }
    const argv = [
      "ecr",
      "batch-delete-image",
      option("--repository-name", this.#repositoryName),
      "--image-ids",
      JSON.stringify(this.#imageIds),
    ];
    if (this.#registryId !== undefined) {
      argv.push(option("--registry-id", this.#registryId));
    }
    return argv;
  }
}
