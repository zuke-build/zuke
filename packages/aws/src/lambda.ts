// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `aws lambda` service — shipping new code, publishing a version, moving
 * an alias onto it, and invoking the function.
 *
 * ```ts
 * import { AwsTasks } from "@zuke/aws";
 * await AwsTasks.lambdaUpdateFunctionCode((s) =>
 *   s.functionName("api").zipFile("dist/api.zip")
 * );
 * const version = await AwsTasks.lambdaPublishedVersion((s) => s.functionName("api"));
 * await AwsTasks.lambdaUpdateAlias((s) =>
 *   s.functionName("api").name("live").functionVersion(version)
 * );
 * ```
 *
 * @module
 */

import { freeText, operand, operands, option } from "./validate.ts";
import { AwsSettings } from "./settings.ts";

/** The `--query` the version reader pins, so the CLI extracts the field. */
export const FUNCTION_VERSION_QUERY = "Version";

/** The `--function-name` every lambda command starts with, or a clear refusal. */
function functionNameArgv(
  task: string,
  operation: string,
  name: string | undefined,
): string[] {
  if (name === undefined) {
    throw new Error(
      `AwsTasks.${task}: no function named — add .functionName('api').`,
    );
  }
  return ["lambda", operation, option("--function-name", name)];
}

/** Settings for `aws lambda update-function-code`. */
export class AwsLambdaUpdateFunctionCodeSettings extends AwsSettings {
  #functionName?: string;
  #zipFile?: string;
  #s3Bucket?: string;
  #s3Key?: string;
  #s3ObjectVersion?: string;
  #imageUri?: string;
  #publish = false;
  #dryRun = false;
  #revisionId?: string;
  readonly #architectures: string[] = [];

  /** The function's name or ARN (`--function-name`). */
  functionName(name: string): this {
    this.#functionName = name;
    return this;
  }

  /**
   * The deployment package on disk (`--zip-file`). The CLI reads the file
   * when the path carries its `fileb://` prefix, which this adds unless the
   * path already has it.
   */
  zipFile(path: string): this {
    this.#zipFile = path.startsWith("fileb://") ? path : `fileb://${path}`;
    return this;
  }

  /** The bucket holding the deployment package (`--s3-bucket`). */
  s3Bucket(name: string): this {
    this.#s3Bucket = name;
    return this;
  }

  /** The package's key in that bucket (`--s3-key`). */
  s3Key(key: string): this {
    this.#s3Key = key;
    return this;
  }

  /** The package object's version (`--s3-object-version`). */
  s3ObjectVersion(version: string): this {
    this.#s3ObjectVersion = version;
    return this;
  }

  /** The container image, for an image-packaged function (`--image-uri`). */
  imageUri(uri: string): this {
    this.#imageUri = uri;
    return this;
  }

  /** Publish a new version once the code is updated (`--publish`). */
  publish(): this {
    this.#publish = true;
    return this;
  }

  /** Validate the request without updating the function (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Update only if the function is still at this revision (`--revision-id`). */
  revisionId(id: string): this {
    this.#revisionId = id;
    return this;
  }

  /** The instruction set architectures (`--architectures`), e.g. `"arm64"`. */
  architectures(...values: string[]): this {
    this.#architectures.push(...values);
    return this;
  }

  /** Emit `lambda update-function-code` with its options. */
  protected override leadingTokens(): string[] {
    const argv = functionNameArgv(
      "lambdaUpdateFunctionCode",
      "update-function-code",
      this.#functionName,
    );
    const sources = [this.#zipFile, this.#s3Bucket, this.#imageUri]
      .filter((source) => source !== undefined);
    if (sources.length !== 1) {
      throw new Error(
        "AwsTasks.lambdaUpdateFunctionCode: name exactly one source for the " +
          "code — .zipFile(path), .s3Bucket(bucket).s3Key(key), or " +
          ".imageUri(uri).",
      );
    }
    if (this.#zipFile !== undefined) {
      argv.push(option("--zip-file", this.#zipFile));
    }
    if (this.#s3Bucket !== undefined) {
      argv.push(option("--s3-bucket", this.#s3Bucket));
    }
    if (this.#s3Key !== undefined) argv.push(option("--s3-key", this.#s3Key));
    if (this.#s3ObjectVersion !== undefined) {
      argv.push(option("--s3-object-version", this.#s3ObjectVersion));
    }
    if (this.#imageUri !== undefined) {
      argv.push(option("--image-uri", this.#imageUri));
    }
    if (this.#publish) argv.push("--publish");
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#revisionId !== undefined) {
      argv.push(option("--revision-id", this.#revisionId));
    }
    if (this.#architectures.length > 0) {
      argv.push(
        "--architectures",
        ...operands(
          "lambdaUpdateFunctionCode",
          "--architectures",
          this.#architectures,
        ),
      );
    }
    return argv;
  }
}

/** Settings for `aws lambda update-function-configuration`. */
export class AwsLambdaUpdateFunctionConfigurationSettings extends AwsSettings {
  #functionName?: string;
  #environment?: Record<string, string>;
  #timeout?: number;
  #memorySize?: number;
  #handler?: string;
  #runtime?: string;
  #role?: string;
  #description?: string;
  readonly #layers: string[] = [];

  /** The function's name or ARN (`--function-name`). */
  functionName(name: string): this {
    this.#functionName = name;
    return this;
  }

  /**
   * The function's environment variables (`--environment`). This **replaces**
   * the whole set — a variable left out is removed — and the values travel on
   * the command line, so keep secrets in Secrets Manager or SSM and pass their
   * names instead.
   */
  environment(variables: Record<string, string>): this {
    this.#environment = { ...variables };
    return this;
  }

  /** The longest an invocation may run, in seconds (`--timeout`). */
  timeout(seconds: number): this {
    this.#timeout = seconds;
    return this;
  }

  /** Memory for the function in MiB (`--memory-size`). */
  memorySize(mib: number): this {
    this.#memorySize = mib;
    return this;
  }

  /** The handler entry point (`--handler`), e.g. `"index.handler"`. */
  handler(name: string): this {
    this.#handler = name;
    return this;
  }

  /** The runtime (`--runtime`), e.g. `"nodejs22.x"`. */
  runtime(name: string): this {
    this.#runtime = name;
    return this;
  }

  /** The execution role's ARN (`--role`). */
  role(arn: string): this {
    this.#role = arn;
    return this;
  }

  /** A description of the function (`--description`). */
  description(text: string): this {
    this.#description = freeText(
      "lambdaUpdateFunctionConfiguration",
      "--description",
      text,
    );
    return this;
  }

  /** The layers to attach, by version ARN (`--layers`); replaces the set. */
  layers(...arns: string[]): this {
    this.#layers.push(...arns);
    return this;
  }

  /** Emit `lambda update-function-configuration` with its options. */
  protected override leadingTokens(): string[] {
    const argv = functionNameArgv(
      "lambdaUpdateFunctionConfiguration",
      "update-function-configuration",
      this.#functionName,
    );
    if (this.#environment !== undefined) {
      argv.push(
        option(
          "--environment",
          JSON.stringify({ Variables: this.#environment }),
        ),
      );
    }
    if (this.#timeout !== undefined) {
      argv.push(option("--timeout", this.#timeout));
    }
    if (this.#memorySize !== undefined) {
      argv.push(option("--memory-size", this.#memorySize));
    }
    if (this.#handler !== undefined) {
      argv.push(option("--handler", this.#handler));
    }
    if (this.#runtime !== undefined) {
      argv.push(option("--runtime", this.#runtime));
    }
    if (this.#role !== undefined) argv.push(option("--role", this.#role));
    if (this.#description !== undefined) {
      argv.push(option("--description", this.#description));
    }
    if (this.#layers.length > 0) {
      argv.push(
        "--layers",
        ...operands(
          "lambdaUpdateFunctionConfiguration",
          "--layers",
          this.#layers,
        ),
      );
    }
    return argv;
  }
}

/** Settings for `aws lambda publish-version`. */
export class AwsLambdaPublishVersionSettings extends AwsSettings {
  #functionName?: string;
  #description?: string;
  #codeSha256?: string;
  #revisionId?: string;

  /** The function's name or ARN (`--function-name`). */
  functionName(name: string): this {
    this.#functionName = name;
    return this;
  }

  /** A description of the version (`--description`). */
  description(text: string): this {
    this.#description = freeText("lambdaPublishVersion", "--description", text);
    return this;
  }

  /** Publish only if the code still has this SHA-256 (`--code-sha256`). */
  codeSha256(hash: string): this {
    this.#codeSha256 = hash;
    return this;
  }

  /** Publish only if the function is still at this revision (`--revision-id`). */
  revisionId(id: string): this {
    this.#revisionId = id;
    return this;
  }

  /** Emit `lambda publish-version` with its options. */
  protected override leadingTokens(): string[] {
    const argv = functionNameArgv(
      "lambdaPublishVersion",
      "publish-version",
      this.#functionName,
    );
    if (this.#description !== undefined) {
      argv.push(option("--description", this.#description));
    }
    if (this.#codeSha256 !== undefined) {
      argv.push(option("--code-sha256", this.#codeSha256));
    }
    if (this.#revisionId !== undefined) {
      argv.push(option("--revision-id", this.#revisionId));
    }
    return argv;
  }
}

/** Settings for `aws lambda update-alias`. */
export class AwsLambdaUpdateAliasSettings extends AwsSettings {
  #functionName?: string;
  #name?: string;
  #functionVersion?: string;
  #description?: string;
  readonly #weights: Record<string, number> = {};
  #routing = false;

  /** The function's name or ARN (`--function-name`). */
  functionName(name: string): this {
    this.#functionName = name;
    return this;
  }

  /** The alias to move (`--name`), e.g. `"live"`. */
  name(alias: string): this {
    this.#name = alias;
    return this;
  }

  /** The version the alias points at (`--function-version`). */
  functionVersion(version: string): this {
    this.#functionVersion = version;
    return this;
  }

  /** A description of the alias (`--description`). */
  description(text: string): this {
    this.#description = freeText("lambdaUpdateAlias", "--description", text);
    return this;
  }

  /**
   * Send a share of the alias's traffic to another version
   * (`--routing-config AdditionalVersionWeights`), as a fraction from 0 to 1;
   * repeatable. The rest goes to {@link functionVersion}.
   */
  additionalVersionWeight(version: string, weight: number): this {
    this.#weights[version] = weight;
    this.#routing = true;
    return this;
  }

  /**
   * Clear the alias's weighted routing, sending all traffic to its version
   * (`--routing-config` with no additional weights).
   */
  clearRouting(): this {
    for (const version of Object.keys(this.#weights)) {
      delete this.#weights[version];
    }
    this.#routing = true;
    return this;
  }

  /** Emit `lambda update-alias` with its options. */
  protected override leadingTokens(): string[] {
    const argv = functionNameArgv(
      "lambdaUpdateAlias",
      "update-alias",
      this.#functionName,
    );
    if (this.#name === undefined) {
      throw new Error(
        "AwsTasks.lambdaUpdateAlias: no alias named — add .name('live').",
      );
    }
    argv.push(option("--name", this.#name));
    if (this.#functionVersion !== undefined) {
      argv.push(option("--function-version", this.#functionVersion));
    }
    if (this.#description !== undefined) {
      argv.push(option("--description", this.#description));
    }
    if (this.#routing) {
      argv.push(
        option(
          "--routing-config",
          JSON.stringify({ AdditionalVersionWeights: this.#weights }),
        ),
      );
    }
    return argv;
  }
}

/** Settings for `aws lambda get-function`. */
export class AwsLambdaGetFunctionSettings extends AwsSettings {
  #functionName?: string;
  #qualifier?: string;

  /** The function's name or ARN (`--function-name`). */
  functionName(name: string): this {
    this.#functionName = name;
    return this;
  }

  /** A version or alias to describe instead of `$LATEST` (`--qualifier`). */
  qualifier(value: string): this {
    this.#qualifier = value;
    return this;
  }

  /** Emit `lambda get-function` with its options. */
  protected override leadingTokens(): string[] {
    const argv = functionNameArgv(
      "lambdaGetFunction",
      "get-function",
      this.#functionName,
    );
    if (this.#qualifier !== undefined) {
      argv.push(option("--qualifier", this.#qualifier));
    }
    return argv;
  }
}

/**
 * Settings for `aws lambda invoke`.
 *
 * The function's response is written to the {@link outfile}; what the CLI
 * prints is the invocation's status. A function that throws still exits 0:
 * the CLI reports it in the printed `FunctionError` field, so read that (or
 * the outfile) before treating an invocation as a success.
 */
export class AwsLambdaInvokeSettings extends AwsSettings {
  #functionName?: string;
  #payload?: string;
  #invocationType?: "RequestResponse" | "Event" | "DryRun";
  #logType?: "None" | "Tail";
  #qualifier?: string;
  #outfile?: string;

  /** The function's name or ARN (`--function-name`). */
  functionName(name: string): this {
    this.#functionName = name;
    return this;
  }

  /**
   * The event to send, as JSON text (`--payload`). AWS CLI v2 reads a payload
   * as base64 unless told otherwise, so this also passes
   * `--cli-binary-format raw-in-base64-out` to send the text as it is.
   */
  payload(json: string): this {
    this.#payload = freeText("lambdaInvoke", "--payload", json);
    return this;
  }

  /** Wait for the response, queue the event, or only check access (`--invocation-type`). */
  invocationType(value: "RequestResponse" | "Event" | "DryRun"): this {
    this.#invocationType = value;
    return this;
  }

  /** `"Tail"` returns the last 4 KB of the execution log, base64-encoded (`--log-type`). */
  logType(value: "None" | "Tail"): this {
    this.#logType = value;
    return this;
  }

  /** A version or alias to invoke (`--qualifier`). */
  qualifier(value: string): this {
    this.#qualifier = value;
    return this;
  }

  /** The file the function's response is written to (positional). */
  outfile(path: string): this {
    this.#outfile = path;
    return this;
  }

  /** Emit `lambda invoke` with its options and the outfile. */
  protected override leadingTokens(): string[] {
    const argv = functionNameArgv("lambdaInvoke", "invoke", this.#functionName);
    if (this.#outfile === undefined) {
      throw new Error(
        "AwsTasks.lambdaInvoke: the CLI writes the response to a file — add " +
          ".outfile('response.json').",
      );
    }
    if (this.#payload !== undefined) {
      argv.push(
        option("--cli-binary-format", "raw-in-base64-out"),
        option("--payload", this.#payload),
      );
    }
    if (this.#invocationType !== undefined) {
      argv.push(option("--invocation-type", this.#invocationType));
    }
    if (this.#logType !== undefined) {
      argv.push(option("--log-type", this.#logType));
    }
    if (this.#qualifier !== undefined) {
      argv.push(option("--qualifier", this.#qualifier));
    }
    argv.push(operand("lambdaInvoke", "outfile", this.#outfile));
    return argv;
  }
}
