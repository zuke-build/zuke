// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading what `lambdaCanary` acts on: an alias — the version it points at,
 * its weighted routing, its ARN and its revision — and a published version's
 * number and code hash. Each read is one CLI call, pinned to `--output json`
 * and a `--query` that keeps only those fields, and its answer is checked
 * field by field before the platform relies on it.
 *
 * Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import { AwsOutputError } from "./errors.ts";
import { jsonFrom } from "./reader.ts";
import { isRecord } from "./shape.ts";
import type {
  AwsLambdaGetAliasSettings,
  AwsLambdaGetFunctionSettings,
  AwsLambdaUpdateFunctionCodeSettings,
} from "./lambda.ts";

/** What the platform reads failures as. */
const TASK = "lambdaCanary";

/** The fields of `get-alias` the platform uses, under names of its own. */
const ALIAS_QUERY =
  "{version: FunctionVersion, arn: AliasArn, revision: RevisionId, " +
  "weights: RoutingConfig.AdditionalVersionWeights}";

/** A version's number and code hash, from `get-function --qualifier`. */
const FUNCTION_VERSION_QUERY =
  "{version: Configuration.Version, sha: Configuration.CodeSha256}";

/** The same two fields from `update-function-code --publish`. */
const PUBLISHED_VERSION_QUERY = "{version: Version, sha: CodeSha256}";

/** An alias as `get-alias` reported it. */
export interface LambdaAlias {
  /** The version the alias sends its main share to (`FunctionVersion`). */
  readonly version: string;
  /** The alias's ARN, which names its account, region and function. */
  readonly arn: string;
  /** The alias's revision, for `update-alias --revision-id`. */
  readonly revision: string;
  /** The other versions and the share of traffic each gets, from 0 to 1. */
  readonly weights: Readonly<Record<string, number>>;
}

/** A published version and its code's SHA-256. */
export interface LambdaVersion {
  /** The version number. */
  readonly version: string;
  /** Its `CodeSha256`. */
  readonly sha: string;
}

/** Read the alias `command` names. */
export async function readAlias(
  command: AwsLambdaGetAliasSettings,
): Promise<LambdaAlias> {
  const answer = await jsonFrom(command, TASK, ALIAS_QUERY);
  if (!isRecord(answer)) {
    throw new AwsOutputError(TASK, "get-alias did not answer with an object.");
  }
  const { version, arn, revision, weights } = answer;
  if (typeof version !== "string" || version === "") {
    throw new AwsOutputError(TASK, "get-alias reported no FunctionVersion.");
  }
  if (typeof arn !== "string" || arn === "") {
    throw new AwsOutputError(TASK, "get-alias reported no AliasArn.");
  }
  if (typeof revision !== "string" || revision === "") {
    throw new AwsOutputError(TASK, "get-alias reported no RevisionId.");
  }
  return { version, arn, revision, weights: weightsOf(weights) };
}

/** Read the version and code hash `command` (a `get-function`) names. */
export async function readVersion(
  command: AwsLambdaGetFunctionSettings,
): Promise<LambdaVersion> {
  return versionOf(
    await jsonFrom(command, TASK, FUNCTION_VERSION_QUERY),
    "get-function",
  );
}

/** Ship the code `command` names, publish it, and read the new version. */
export async function publishCode(
  command: AwsLambdaUpdateFunctionCodeSettings,
): Promise<LambdaVersion> {
  return versionOf(
    await jsonFrom(command, TASK, PUBLISHED_VERSION_QUERY),
    "update-function-code",
  );
}

/** A version answer, checked field by field. */
function versionOf(answer: unknown, operation: string): LambdaVersion {
  if (!isRecord(answer)) {
    throw new AwsOutputError(
      TASK,
      `${operation} did not answer with an object.`,
    );
  }
  const { version, sha } = answer;
  if (typeof version !== "string" || version === "") {
    throw new AwsOutputError(TASK, `${operation} reported no Version.`);
  }
  if (typeof sha !== "string" || sha === "") {
    throw new AwsOutputError(TASK, `${operation} reported no CodeSha256.`);
  }
  return { version, sha };
}

/**
 * An alias's additional version weights: `null` when it has no routing
 * configuration, otherwise each version's share as a number.
 */
function weightsOf(value: unknown): Record<string, number> {
  if (value === null) return {};
  if (!isRecord(value)) {
    throw new AwsOutputError(
      TASK,
      "get-alias reported AdditionalVersionWeights that are not an object.",
    );
  }
  const weights: Record<string, number> = {};
  for (const [version, weight] of Object.entries(value)) {
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw new AwsOutputError(
        TASK,
        `get-alias reported a weight for version ${version} that is not a ` +
          "number.",
      );
    }
    weights[version] = weight;
  }
  return weights;
}
