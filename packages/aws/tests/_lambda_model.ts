// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Just enough of AWS Lambda to drive `lambdaCanary` against, shared by its
 * unit and integration tests. Functions are keyed by account, region and
 * name — the profile picks the account, `--region` the region — and each has
 * published versions with a code hash and aliases with a version, weighted
 * routing and a revision that every update changes. `update-alias` honours
 * `--revision-id` the way Lambda does, so a stale read fails the update.
 *
 * The model answers the `--query` projections the platform pins with their
 * result directly; it does not evaluate JMESPath.
 *
 * @module
 */

import { CommandOutput } from "@zuke/core/shell";
import type { AwsSettings, AwsSettingsRunner } from "../mod.ts";

/** An alias as the model keeps it. */
export interface ModelAlias {
  /** The version it points at. */
  version: string;
  /** Additional version weights, 0 to 1. */
  weights: Record<string, number>;
  /** The revision `--revision-id` must match. */
  revision: string;
}

/** A function as the model keeps it. */
export interface ModelFunction {
  /** Published versions and their code hashes. */
  versions: Record<string, string>;
  /** Aliases by name. */
  aliases: Record<string, ModelAlias>;
  /** The code hash of `$LATEST`, which `--publish` publishes. */
  latest: string;
}

/** A recording model of Lambda. */
export class LambdaModel {
  /** Every command line run, without the binary. */
  calls: string[][] = [];
  /** Functions keyed `<account>/<region>/<name>`. */
  functions: Record<string, ModelFunction> = {};
  /** The account each profile resolves; no profile is `default`. */
  accounts: Record<string, string> = { default: "111111111111" };
  /** The region used when no `--region` is given. */
  defaultRegion = "eu-west-1";
  /** A waiter that fails, as one that gives up or sees `Failed` does. */
  failingWaiter?: string;
  /** Revisions handed out so far, to make each new one unique. */
  #revisions = 0;

  /** A model with `api` in the default account and region, alias `live` at 3. */
  constructor() {
    this.functions["111111111111/eu-west-1/api"] = {
      versions: { "1": "sha-1", "2": "sha-2", "3": "sha-3" },
      aliases: { live: { version: "3", weights: {}, revision: "rev-0" } },
      latest: "sha-3",
    };
  }

  /** The runner to hand to `.runner(...)` through `l.aws(...)`. */
  readonly runner: AwsSettingsRunner = (settings: AwsSettings) =>
    Promise.resolve(this.run(settings.argv().slice(1)));

  /** The function `argv` reaches, keyed as {@link functions} is. */
  keyOf(argv: readonly string[]): string {
    const profile = flagValue(argv, "--profile") ?? "default";
    const region = flagValue(argv, "--region") ?? this.defaultRegion;
    return `${this.accounts[profile]}/${region}/${
      flagValue(argv, "--function-name")
    }`;
  }

  /** The alias `live` of `api` in the default account and region. */
  get live(): ModelAlias {
    return this.functions["111111111111/eu-west-1/api"].aliases.live;
  }

  /** Run one command line (without the binary) against the model. */
  run(argv: string[]): CommandOutput {
    this.calls.push(argv);
    const key = this.keyOf(argv);
    const fn = this.functions[key];
    if (fn === undefined) {
      return failure(`ResourceNotFoundException: Function not found: ${key}`);
    }
    const [account, region, name] = key.split("/");
    const operation = argv[1];
    if (operation === "get-alias") {
      const aliasName = flagValue(argv, "--name") ?? "";
      const alias = fn.aliases[aliasName];
      if (alias === undefined) {
        return failure(`ResourceNotFoundException: Alias not found`);
      }
      return answer({
        version: alias.version,
        arn:
          `arn:aws:lambda:${region}:${account}:function:${name}:${aliasName}`,
        revision: alias.revision,
        weights: Object.keys(alias.weights).length === 0
          ? null
          : { ...alias.weights },
      });
    }
    if (operation === "get-function") {
      const version = flagValue(argv, "--qualifier") ?? "$LATEST";
      const sha = fn.versions[version];
      if (sha === undefined) {
        return failure(`ResourceNotFoundException: no version ${version}`);
      }
      return answer({ version, sha });
    }
    if (operation === "update-function-code") {
      const sha = `sha-${flagValue(argv, "--zip-file")}`;
      fn.latest = sha;
      if (argv.includes("--dry-run") || !argv.includes("--publish")) {
        return answer({ version: "$LATEST", sha });
      }
      // Lambda publishes nothing new when the code has not changed.
      const existing = Object.entries(fn.versions)
        .find(([, hash]) => hash === sha);
      if (existing !== undefined) {
        return answer({ version: existing[0], sha });
      }
      const version = String(Object.keys(fn.versions).length + 1);
      fn.versions[version] = sha;
      return answer({ version, sha });
    }
    if (operation === "wait") {
      return argv[2] === this.failingWaiter
        ? failure(
          `Waiter ${
            argv[2]
          } failed: Waiter encountered a terminal failure state`,
        )
        : answer(null);
    }
    if (operation === "update-alias") {
      const alias = fn.aliases[flagValue(argv, "--name") ?? ""];
      if (alias === undefined) {
        return failure("ResourceNotFoundException: Alias not found");
      }
      const expected = flagValue(argv, "--revision-id");
      if (expected !== undefined && expected !== alias.revision) {
        return failure(
          "PreconditionFailedException: The Revision Id provided does not " +
            "match the latest Revision Id.",
        );
      }
      const version = flagValue(argv, "--function-version");
      if (version !== undefined) alias.version = version;
      const routing = flagValue(argv, "--routing-config");
      if (routing !== undefined) {
        alias.weights = { ...JSON.parse(routing).AdditionalVersionWeights };
      }
      this.#revisions += 1;
      alias.revision = `rev-${this.#revisions}`;
      return answer({ revision: alias.revision });
    }
    return failure(`not modelled: ${argv.join(" ")}`);
  }

  /** The update-alias commands run, as their changing options. */
  aliasUpdates(): string[][] {
    return this.calls.filter((argv) => argv[1] === "update-alias")
      .map((argv) =>
        argv.filter((token) =>
          token.startsWith("--function-version=") ||
          token.startsWith("--routing-config=")
        )
      );
  }

  /** The commands that change something — everything but reads and waits. */
  mutations(): string[][] {
    return this.calls.filter((argv) =>
      !argv[1].startsWith("get-") && argv[1] !== "wait"
    );
  }
}

/** The flag's value in `argv`, as `--flag=value` or `--flag value`. */
export function flagValue(
  argv: readonly string[],
  flag: string,
): string | undefined {
  const joined = argv.find((token) => token.startsWith(`${flag}=`));
  if (joined !== undefined) return joined.slice(flag.length + 1);
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

/** A successful JSON answer. */
function answer(value: unknown): CommandOutput {
  return new CommandOutput(0, `${JSON.stringify(value)}\n`, "");
}

/** A failed call, as the CLI reports a service error. */
function failure(message: string): CommandOutput {
  return new CommandOutput(254, "", `An error occurred (${message})`);
}
