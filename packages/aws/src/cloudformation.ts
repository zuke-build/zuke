// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws cloudformation` service — deploying a stack, reading its outputs,
 * deleting it, and waiting for each of those to finish.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * await AwsTasks.cloudformationDeploy((s) =>
 *   s.templateFile("stack.yaml").stackName("api")
 *     .parameterOverride("Image", image).capabilities("CAPABILITY_IAM")
 * );
 * const url = await AwsTasks.stackOutput("api", "ServiceUrl");
 * ```
 *
 * Parameter values passed to `deploy` travel on the command line. For a
 * secret, mark the template parameter `NoEcho` and point it at Secrets Manager
 * or SSM with a dynamic reference, rather than passing the value.
 *
 * @module
 */

import { operand, operands, option } from "./validate.ts";
import { AwsSettings } from "./settings.ts";

/** The waiters `aws cloudformation wait` offers for a stack. */
export type AwsCloudformationStackWaiter =
  | "stack-create-complete"
  | "stack-update-complete"
  | "stack-delete-complete"
  | "stack-import-complete"
  | "stack-rollback-complete"
  | "stack-exists";

/**
 * An output key as CloudFormation allows it: alphanumeric. The stack-output
 * reader puts the key inside a JMESPath string literal, so this is also what
 * keeps a quote from ending the literal early.
 */
const OUTPUT_KEY_SHAPE = /^[A-Za-z0-9]+$/;

/**
 * The `--query` that projects one stack output's value: a list, which is
 * empty when the stack has no such output.
 */
export function stackOutputQuery(key: string): string {
  if (!OUTPUT_KEY_SHAPE.test(key)) {
    throw new Error(
      `AwsTasks.stackOutput: "${key}" is not a CloudFormation output key — ` +
        "output keys are alphanumeric.",
    );
  }
  return `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`;
}

/** Refuse a `Key=Value` pair whose key would split somewhere else. */
function pair(task: string, flag: string, key: string, value: string) {
  if (key === "" || key.includes("=")) {
    throw new Error(
      `AwsTasks.${task}: "${key}" cannot be a ${flag} key — the CLI splits ` +
        "each pair at its first '=', so a key may not be empty or contain one.",
    );
  }
  return operand(task, flag, `${key}=${value}`);
}

/** Settings for `aws cloudformation deploy`. */
export class AwsCloudformationDeploySettings extends AwsSettings {
  #templateFile?: string;
  #stackName?: string;
  readonly #parameterOverrides: Array<[string, string]> = [];
  readonly #capabilities: string[] = [];
  readonly #tags: Array<[string, string]> = [];
  #noExecuteChangeset = false;
  #noFailOnEmptyChangeset = false;
  #roleArn?: string;
  #s3Bucket?: string;
  #s3Prefix?: string;
  #kmsKeyId?: string;

  /** The template to deploy (`--template-file`). */
  templateFile(path: string): this {
    this.#templateFile = path;
    return this;
  }

  /** The stack to create or update (`--stack-name`). */
  stackName(name: string): this {
    this.#stackName = name;
    return this;
  }

  /** Set a template parameter (`--parameter-overrides Key=Value`); repeatable. */
  parameterOverride(key: string, value: string): this {
    this.#parameterOverrides.push([key, value]);
    return this;
  }

  /** Acknowledge what the template creates (`--capabilities`), e.g. `"CAPABILITY_IAM"`. */
  capabilities(...values: string[]): this {
    this.#capabilities.push(...values);
    return this;
  }

  /** Tag the stack and its resources (`--tags Key=Value`); repeatable. */
  tag(key: string, value: string): this {
    this.#tags.push([key, value]);
    return this;
  }

  /** Create the change set without executing it (`--no-execute-changeset`). */
  noExecuteChangeset(): this {
    this.#noExecuteChangeset = true;
    return this;
  }

  /** Exit 0 when there is nothing to change (`--no-fail-on-empty-changeset`). */
  noFailOnEmptyChangeset(): this {
    this.#noFailOnEmptyChangeset = true;
    return this;
  }

  /** The role CloudFormation assumes to deploy (`--role-arn`). */
  roleArn(arn: string): this {
    this.#roleArn = arn;
    return this;
  }

  /** The bucket a large template is uploaded to (`--s3-bucket`). */
  s3Bucket(name: string): this {
    this.#s3Bucket = name;
    return this;
  }

  /** The key prefix for that upload (`--s3-prefix`). */
  s3Prefix(prefix: string): this {
    this.#s3Prefix = prefix;
    return this;
  }

  /** The KMS key that encrypts that upload (`--kms-key-id`). */
  kmsKeyId(id: string): this {
    this.#kmsKeyId = id;
    return this;
  }

  /** Emit `cloudformation deploy` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#templateFile === undefined || this.#stackName === undefined) {
      throw new Error(
        "AwsTasks.cloudformationDeploy: a deploy needs a template and a " +
          "stack — add .templateFile('stack.yaml').stackName('api').",
      );
    }
    const argv = [
      "cloudformation",
      "deploy",
      option("--template-file", this.#templateFile),
      option("--stack-name", this.#stackName),
    ];
    if (this.#parameterOverrides.length > 0) {
      argv.push(
        "--parameter-overrides",
        ...this.#parameterOverrides.map(([k, v]) =>
          pair("cloudformationDeploy", "--parameter-overrides", k, v)
        ),
      );
    }
    if (this.#capabilities.length > 0) {
      argv.push(
        "--capabilities",
        ...operands(
          "cloudformationDeploy",
          "--capabilities",
          this.#capabilities,
        ),
      );
    }
    if (this.#tags.length > 0) {
      argv.push(
        "--tags",
        ...this.#tags.map(([k, v]) =>
          pair("cloudformationDeploy", "--tags", k, v)
        ),
      );
    }
    if (this.#noExecuteChangeset) argv.push("--no-execute-changeset");
    if (this.#noFailOnEmptyChangeset) {
      argv.push("--no-fail-on-empty-changeset");
    }
    if (this.#roleArn !== undefined) {
      argv.push(option("--role-arn", this.#roleArn));
    }
    if (this.#s3Bucket !== undefined) {
      argv.push(option("--s3-bucket", this.#s3Bucket));
    }
    if (this.#s3Prefix !== undefined) {
      argv.push(option("--s3-prefix", this.#s3Prefix));
    }
    if (this.#kmsKeyId !== undefined) {
      argv.push(option("--kms-key-id", this.#kmsKeyId));
    }
    return argv;
  }
}

/** Settings for `aws cloudformation describe-stacks`. */
export class AwsCloudformationDescribeStacksSettings extends AwsSettings {
  #stackName?: string;

  /** The stack to describe (`--stack-name`); every stack when omitted. */
  stackName(name: string): this {
    this.#stackName = name;
    return this;
  }

  /** Emit `cloudformation describe-stacks` with its options. */
  protected override leadingTokens(): string[] {
    const argv = ["cloudformation", "describe-stacks"];
    if (this.#stackName !== undefined) {
      argv.push(option("--stack-name", this.#stackName));
    }
    return argv;
  }
}

/** Settings for `aws cloudformation delete-stack`. */
export class AwsCloudformationDeleteStackSettings extends AwsSettings {
  #stackName?: string;
  #roleArn?: string;
  readonly #retainResources: string[] = [];

  /** The stack to delete (`--stack-name`). */
  stackName(name: string): this {
    this.#stackName = name;
    return this;
  }

  /** The role CloudFormation assumes to delete (`--role-arn`). */
  roleArn(arn: string): this {
    this.#roleArn = arn;
    return this;
  }

  /** Logical ids to keep when a delete is retried (`--retain-resources`). */
  retainResources(...ids: string[]): this {
    this.#retainResources.push(...ids);
    return this;
  }

  /** Emit `cloudformation delete-stack` with its options. */
  protected override leadingTokens(): string[] {
    if (this.#stackName === undefined) {
      throw new Error(
        "AwsTasks.cloudformationDeleteStack: no stack named — add " +
          ".stackName('api').",
      );
    }
    const argv = [
      "cloudformation",
      "delete-stack",
      option("--stack-name", this.#stackName),
    ];
    if (this.#roleArn !== undefined) {
      argv.push(option("--role-arn", this.#roleArn));
    }
    if (this.#retainResources.length > 0) {
      argv.push(
        "--retain-resources",
        ...operands(
          "cloudformationDeleteStack",
          "--retain-resources",
          this.#retainResources,
        ),
      );
    }
    return argv;
  }
}

/**
 * Settings for `aws cloudformation wait <waiter>`: block until the stack
 * reaches the waiter's state. The CLI polls every 30 seconds and exits
 * non-zero after 120 attempts, or as soon as the stack lands in a failed
 * state — which surfaces as a `CommandError`.
 */
export class AwsCloudformationWaitSettings extends AwsSettings {
  #waiter?: AwsCloudformationStackWaiter;
  #stackName?: string;

  /** The state to wait for, e.g. `"stack-update-complete"`. */
  waiter(name: AwsCloudformationStackWaiter): this {
    this.#waiter = name;
    return this;
  }

  /** The stack to wait on (`--stack-name`). */
  stackName(name: string): this {
    this.#stackName = name;
    return this;
  }

  /** Emit `cloudformation wait <waiter>` with the stack. */
  protected override leadingTokens(): string[] {
    if (this.#waiter === undefined || this.#stackName === undefined) {
      throw new Error(
        "AwsTasks.cloudformationWait: name the state and the stack — add " +
          ".waiter('stack-update-complete').stackName('api').",
      );
    }
    return [
      "cloudformation",
      "wait",
      this.#waiter,
      option("--stack-name", this.#stackName),
    ];
  }
}
