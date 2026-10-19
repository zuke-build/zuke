// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `lambdaCanary` records about the rollout it staged, and the checks
 * every later call makes against it: the function, alias and AWS global
 * flags `stage` was configured with; the alias's ARN as the CLI read it then,
 * which carries the account and region the alias lives in; the stable version
 * the alias pointed at; and the candidate version with its code's SHA-256. A
 * resumed process or a `zuke cancel` whose configuration — or whose
 * environment, through `AWS_PROFILE` or `AWS_REGION` — resolves differently
 * would otherwise move traffic on an alias the rollout never staged.
 *
 * Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import type { LambdaAlias } from "./lambda_canary_alias.ts";
import { AwsSettings } from "./settings.ts";
import { isStringArray } from "./shape.ts";

/**
 * A function name, partial ARN or full ARN: letters, digits, `-`, `_`, `:`
 * and `.`, not starting with `-` so the CLI cannot read it as an option.
 */
export const FUNCTION_SHAPE = /^[A-Za-z0-9_][A-Za-z0-9_:.-]*$/;

/**
 * An alias name as Lambda accepts it: letters, digits, `-` and `_`, up to 128
 * characters, and not all digits (which would be a version).
 */
export const ALIAS_SHAPE = /^(?!\d+$)[A-Za-z0-9_-]{1,128}$/;

/** A published version's number. `$LATEST` is not one. */
export const VERSION_SHAPE = /^[1-9][0-9]*$/;

/** The function, alias and global flags a rollout acts through. */
export interface LambdaIdentity {
  /** The function's name or ARN, as configured. */
  readonly functionName: string;
  /** The alias whose traffic the rollout splits. */
  readonly alias: string;
  /** The AWS global flags every command carries, as argv. */
  readonly flags: readonly string[];
}

/** A rollout as `stage` recorded it. */
export interface LambdaRecord extends LambdaIdentity {
  /** The alias's ARN when the rollout was staged. */
  readonly aliasArn: string;
  /** The version the alias pointed at when the rollout was staged. */
  readonly stable: string;
  /** The stable version's `CodeSha256` when the rollout was staged. */
  readonly stableCodeSha256: string;
  /** The candidate version the rollout published or was given. */
  readonly candidate: string;
  /** The candidate's `CodeSha256` when the rollout was staged. */
  readonly codeSha256: string;
}

/** The state keys the record is kept under. */
const KEYS = {
  functionName: "lambdaCanaryFunction",
  alias: "lambdaCanaryAlias",
  flags: "lambdaCanaryAwsFlags",
  aliasArn: "lambdaCanaryAliasArn",
  stable: "lambdaCanaryStable",
  stableCodeSha256: "lambdaCanaryStableCodeSha256",
  candidate: "lambdaCanaryCandidate",
  codeSha256: "lambdaCanaryCodeSha256",
};

/**
 * The global flags `configure` gives every command. Only argv, and without
 * the binary: what the lambda passes with `.env(...)` may be a secret and is
 * neither read nor recorded, and which `aws` runs does not choose the alias it
 * reaches.
 */
export function awsFlags(configure: Configure<AwsSettings>): string[] {
  // A bare AwsSettings renders no command of its own, so every token after
  // the binary is one the lambda added.
  return configure(new AwsSettings()).argv().slice(1);
}

/** The state patch recording a staged rollout. */
export function rolloutRecord(record: LambdaRecord): Record<string, JsonValue> {
  return {
    [KEYS.functionName]: record.functionName,
    [KEYS.alias]: record.alias,
    [KEYS.flags]: [...record.flags],
    [KEYS.aliasArn]: record.aliasArn,
    [KEYS.stable]: record.stable,
    [KEYS.stableCodeSha256]: record.stableCodeSha256,
    [KEYS.candidate]: record.candidate,
    [KEYS.codeSha256]: record.codeSha256,
  };
}

/**
 * The rollout `stage` recorded, refused as a damaged record — before any
 * command runs — unless every part of it is there, with its type and the
 * shape `stage` checked it had. A record edited by hand cannot put an option
 * or a stray version into a command, or into the recovery a refusal prints.
 */
export function recordedRollout(
  recorded: Record<string, JsonValue>,
): LambdaRecord {
  const functionName = recorded[KEYS.functionName];
  const alias = recorded[KEYS.alias];
  const flags = recorded[KEYS.flags];
  const aliasArn = recorded[KEYS.aliasArn];
  const stable = recorded[KEYS.stable];
  const stableCodeSha256 = recorded[KEYS.stableCodeSha256];
  const candidate = recorded[KEYS.candidate];
  const codeSha256 = recorded[KEYS.codeSha256];
  if (typeof functionName !== "string" || !FUNCTION_SHAPE.test(functionName)) {
    throw damagedRecord("the function it staged", functionName);
  }
  if (typeof alias !== "string" || !ALIAS_SHAPE.test(alias)) {
    throw damagedRecord("the alias it staged", alias);
  }
  if (!isStringArray(flags)) {
    throw damagedRecord("the AWS flags it staged with", flags);
  }
  if (typeof aliasArn !== "string" || aliasArn === "") {
    throw damagedRecord("the ARN of the alias it staged", aliasArn);
  }
  if (typeof stable !== "string" || !VERSION_SHAPE.test(stable)) {
    throw damagedRecord("the stable version", stable);
  }
  if (typeof stableCodeSha256 !== "string" || stableCodeSha256 === "") {
    throw damagedRecord("the stable version's code hash", stableCodeSha256);
  }
  if (typeof candidate !== "string" || !VERSION_SHAPE.test(candidate)) {
    throw damagedRecord("the candidate version", candidate);
  }
  if (typeof codeSha256 !== "string" || codeSha256 === "") {
    throw damagedRecord("the candidate's code hash", codeSha256);
  }
  return {
    functionName,
    alias,
    flags,
    aliasArn,
    stable,
    stableCodeSha256,
    candidate,
    codeSha256,
  };
}

/**
 * Refuse unless `now` — the identity this call is configured with — is the
 * one the rollout recorded. Pure: it runs before any command. The flags are
 * compared as written, in order, so two spellings of one profile are refused
 * too.
 */
export function checkIdentity(recorded: LambdaRecord, now: LambdaIdentity) {
  const parts: ReadonlyArray<
    readonly [label: string, same: boolean, was: string, is: string]
  > = [
    [
      "function",
      recorded.functionName === now.functionName,
      shown(recorded.functionName),
      shown(now.functionName),
    ],
    [
      "alias",
      recorded.alias === now.alias,
      shown(recorded.alias),
      shown(
        now.alias,
      ),
    ],
    [
      "AWS flags",
      sameArgv(recorded.flags, now.flags),
      shownFlags(recorded.flags),
      shownFlags(now.flags),
    ],
  ];
  for (const [label, same, was, is] of parts) {
    if (same) continue;
    throw new Error(
      `lambdaCanary: this rollout staged with the ${label} ${was}, but it is ` +
        `now configured with ${is}, so this call changed nothing rather than ` +
        `move traffic on an alias the rollout never staged. ${
          recovery(recorded)
        }`,
    );
  }
}

/**
 * Refuse unless `live` — the alias the CLI reaches now, read with the
 * configuration that matched the record — has the ARN `stage` read. The ARN
 * names the account and region, so a different one means the CLI now
 * resolves another account or region: from `AWS_PROFILE`, `AWS_REGION`, or a
 * profile whose role changed, none of which the recorded flags can see.
 */
export function checkAliasArn(recorded: LambdaRecord, live: LambdaAlias) {
  if (live.arn === recorded.aliasArn) return;
  throw new Error(
    `lambdaCanary: this rollout staged the alias ${
      shown(recorded.aliasArn)
    }, ` +
      `but the alias the AWS CLI reaches now is ${shown(live.arn)}: it ` +
      "resolves another account or region (AWS_PROFILE, AWS_REGION, the " +
      "profile's role). This call changed nothing rather than move traffic " +
      `on an alias the rollout never staged. ${recovery(recorded)}`,
  );
}

/**
 * Whether two argv lists are the same tokens in the same order. Shared with
 * the platform, which checks that the `.aws(...)` lambda resolves the same
 * flags each time it runs.
 */
export function sameArgv(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

/**
 * How to recover from a refusal, built from the recorded values: the engine
 * settles a refused call by cancelling the run, and its rollback refuses the
 * same way, so the one course that works is by hand.
 */
export function recovery(recorded: LambdaRecord): string {
  const read = scopedTo(recorded, [
    "lambda",
    "get-alias",
    `--function-name=${recorded.functionName}`,
    `--name=${recorded.alias}`,
    "--query",
    "[AliasArn, FunctionVersion, RoutingConfig]",
  ]);
  const undo = scopedTo(recorded, [
    "lambda",
    "update-alias",
    `--function-name=${recorded.functionName}`,
    `--name=${recorded.alias}`,
    `--function-version=${recorded.stable}`,
    '--routing-config={"AdditionalVersionWeights":{}}',
  ]);
  return "The run stops, and its rollback refuses the same way, so a resume " +
    "or `zuke cancel` will not roll it back: the candidate keeps whatever " +
    "share of the alias it had. To recover, set the configuration and the " +
    "AWS environment back to what the rollout started with, check that " +
    `\`${shell(read)}\` prints the ARN ${recorded.aliasArn} — the alias that ` +
    "was staged — then send all of its traffic back to the stable version " +
    `${recorded.stable} with \`${shell(undo)}\`. If it prints another ARN, ` +
    "the alias the rollout staged is out of reach from this environment: " +
    "fix the profile or region first.";
}

/** A command's argv as an operator would type it, with the recorded flags. */
function scopedTo(recorded: LambdaRecord, command: string[]): string[] {
  return ["aws", ...command, ...recorded.flags];
}

/** An argv as a POSIX shell would take it back, quoting what needs it. */
function shell(argv: readonly string[]): string {
  return argv.map((token) =>
    /^[A-Za-z0-9_@%+=:,./-]+$/.test(token)
      ? token
      : `'${token.replaceAll("'", "'\\''")}'`
  ).join(" ");
}

/**
 * The refusal for a record missing one of its parts — `missing` names it —
 * which nothing can be checked against, so the call changes nothing.
 */
export function damagedRecord(
  missing: string,
  value: JsonValue | undefined,
): Error {
  return new Error(
    "lambdaCanary: the rollout's record is damaged: it does not hold " +
      `${missing} (it holds ${
        value === undefined ? "nothing" : JSON.stringify(value)
      }), so this call cannot tell which alias is the rollout's and changed ` +
      "nothing. The run stops, and its rollback needs the record too, so a " +
      "resume or `zuke cancel` will not roll it back: check with `aws lambda " +
      "get-alias` that the CLI reaches the alias that was staged, then send " +
      "its traffic back by hand with `aws lambda update-alias " +
      "--function-name <function> --name <alias> --function-version <stable> " +
      `--routing-config '{"AdditionalVersionWeights":{}}'\`, plus the ` +
      "--profile and --region the rollout used.",
  );
}

/** A recorded or configured value, for a message. */
function shown(value: string): string {
  return JSON.stringify(value);
}

/** Global flags as an operator would type them, or a note there are none. */
function shownFlags(flags: readonly string[]): string {
  return flags.length === 0 ? "no AWS flags" : `\`${shell(flags)}\``;
}
