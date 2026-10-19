// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link lambdaCanary} — a Lambda alias as a platform for a `@zuke/canary`
 * rollout.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { lambdaCanary } from "@zuke/aws";
 *
 * rollout = canary((c) =>
 *   c.platform(lambdaCanary((l) =>
 *     l.functionName("api").alias("live").zipFile("dist/api.zip")
 *       .aws((a) => a.region("eu-west-1"))
 *   ))
 *     .steps(10, 25, 50)
 *     .bake("10m")
 * );
 * ```
 *
 * The candidate is a published version, and its exposure is the alias's
 * weighted routing: the alias keeps pointing at the stable version and sends
 * the candidate an additional weight (`AdditionalVersionWeights`). Callers
 * that invoke the alias are split; callers that invoke a version directly, or
 * the function unqualified (`$LATEST`), are not.
 *
 * The canary engine's platform interface lives in `@zuke/canary`, and a wrapper
 * depends only on `@zuke/core`, so this module does not import it: the object
 * {@link lambdaCanary} returns has the same shape and is accepted by
 * `c.platform(...)` as it is.
 *
 * @module
 */

import type { JsonValue, SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  AwsLambdaGetAliasSettings,
  AwsLambdaGetFunctionSettings,
  AwsLambdaUpdateAliasSettings,
  AwsLambdaUpdateFunctionCodeSettings,
  type AwsLambdaWaiter,
  AwsLambdaWaitSettings,
} from "./lambda.ts";
import {
  type LambdaAlias,
  type LambdaVersion,
  publishCode,
  readAlias,
  readVersion,
} from "./lambda_canary_alias.ts";
import {
  ALIAS_SHAPE,
  awsFlags,
  checkAliasArn,
  checkIdentity,
  damagedRecord,
  FUNCTION_SHAPE,
  type LambdaIdentity,
  type LambdaRecord,
  recordedRollout,
  recovery,
  rolloutRecord,
  sameArgv,
  VERSION_SHAPE,
} from "./lambda_canary_record.ts";
import { runChecked } from "./reader.ts";
import { type AwsSettings, failOnExit } from "./settings.ts";

/**
 * The state key recording how far `stage` got: `"publishing"` before the
 * candidate is published, `"staged"` once the rollout is on record. Until
 * `"staged"` the alias has not been touched, so a rollback has nothing to
 * undo.
 */
const STAGE = "lambdaCanaryStage";

/**
 * How many times a rollback reads the alias and tries its update again when
 * another write to the alias got in between — the rollout's own expose still
 * landing while a `zuke cancel` rolls it back, most likely.
 */
const ABORT_ATTEMPTS = 5;

/** What Lambda calls a `--revision-id` that is no longer the alias's. */
const STALE_REVISION = "PreconditionFailedException";

/**
 * The part of the canary engine's context the Lambda platform uses: the
 * rollout's durable state, where the staged versions are recorded, and the
 * build summary. The engine hands a richer context; this is the narrow view.
 */
export interface AwsLambdaCanaryContext {
  /** The rollout's durable platform state, shared by every call. */
  readonly state: TargetStateHandle;
  /** Add key/value pairs to the calling target's row in the build summary. */
  reportSummary(pairs: SummaryPairs): void;
}

/**
 * How {@link lambdaCanary} reaches the alias and finds the candidate,
 * configured through its lambda.
 */
export class AwsLambdaCanarySettings {
  /** The function's name or ARN (set by {@link functionName}). */
  functionName_?: string;
  /** The alias whose traffic is split (set by {@link alias}). */
  alias_?: string;
  /** The deployment package on disk (set by {@link zipFile}). */
  zipFile_?: string;
  /** The bucket holding the package (set by {@link s3Bucket}). */
  s3Bucket_?: string;
  /** The package's key in that bucket (set by {@link s3Key}). */
  s3Key_?: string;
  /** The package object's version (set by {@link s3ObjectVersion}). */
  s3ObjectVersion_?: string;
  /** The container image (set by {@link imageUri}). */
  imageUri_?: string;
  /** An already published candidate version (set by {@link version}). */
  version_?: string;
  /** The version a hand-run rollback returns to (set by {@link stable}). */
  stable_?: string;
  /** Global options for every command (set by {@link aws}). */
  aws_: Configure<AwsSettings> = (a) => a;

  /** The function to roll out — its name, partial ARN or ARN. */
  functionName(name: string): this {
    this.functionName_ = name;
    return this;
  }

  /**
   * The alias whose traffic the canary splits, e.g. `"live"`. It must
   * already exist and point at a published version: that version is the
   * stable one.
   */
  alias(name: string): this {
    this.alias_ = name;
    return this;
  }

  /**
   * The candidate's deployment package on disk, shipped and published by
   * `stage` (`update-function-code --zip-file --publish`). Name one code
   * source — this, {@link s3Bucket} with {@link s3Key}, or {@link imageUri} —
   * or a {@link version} instead.
   */
  zipFile(path: string): this {
    this.zipFile_ = path;
    return this;
  }

  /** The bucket holding the candidate's package (`--s3-bucket`). */
  s3Bucket(name: string): this {
    this.s3Bucket_ = name;
    return this;
  }

  /** The candidate package's key in that bucket (`--s3-key`). */
  s3Key(key: string): this {
    this.s3Key_ = key;
    return this;
  }

  /** The candidate package object's version (`--s3-object-version`). */
  s3ObjectVersion(version: string): this {
    this.s3ObjectVersion_ = version;
    return this;
  }

  /** The candidate's container image, for an image function (`--image-uri`). */
  imageUri(uri: string): this {
    this.imageUri_ = uri;
    return this;
  }

  /**
   * An already published version to roll out — one the build published
   * itself, for example with `AwsTasks.lambdaPublishedVersion`. Use this or a
   * code source, not both. Unlike a code source it leaves the function's
   * `$LATEST` as it is.
   */
  version(number: string): this {
    this.version_ = number;
    return this;
  }

  /**
   * The version to send all traffic back to when `rollout.abort` is run by
   * hand. Such a run is fresh, with no record of a rollout, so it has nothing
   * else to go on — and the release it is undoing has usually been promoted
   * already. A rollback the engine runs mid-rollout does not use it: that one
   * takes the candidate's weight off the alias instead.
   */
  stable(number: string): this {
    this.stable_ = number;
    return this;
  }

  /**
   * Global options for every command the platform runs —
   * `(a) => a.profile("deploy").region("eu-west-1")`, a `.toolPath(...)`, or
   * a `.runner(...)`, the seam a test answers through. The flags it gives are
   * recorded in the rollout's state, which is plain JSON: never pass a secret
   * on the command line here. A reader's `--output` and `--query` are its own
   * and are set after it.
   */
  aws(configure: Configure<AwsSettings>): this {
    this.aws_ = configure;
    return this;
  }
}

/**
 * A Lambda alias as a canary platform. Create one with {@link lambdaCanary};
 * hand it to `@zuke/canary`'s `c.platform(...)`.
 *
 * Exposure is a share of the alias's invocations, set exactly.
 */
export class AwsLambdaCanary {
  /** The alias splits invocations, so exposure is a traffic share. */
  readonly exposure: "traffic" = "traffic";
  readonly #configure: Configure<AwsLambdaCanarySettings>;

  /** A platform whose settings `configure` produces, afresh on every call. */
  constructor(configure: Configure<AwsLambdaCanarySettings>) {
    this.#configure = configure;
  }

  /** `"Lambda alias api:live"`, for the build summary. */
  describe(): string {
    const settings = this.#configure(new AwsLambdaCanarySettings());
    const name = settings.functionName_;
    const alias = settings.alias_;
    if (name === undefined || alias === undefined) return "Lambda alias";
    return `Lambda alias ${name}:${alias}`;
  }

  /**
   * Read the alias and its stable version, publish the candidate (or take the
   * version given) and wait for it to be `Active`, then record the rollout:
   * the function, alias and AWS flags every later call is checked against,
   * the alias's ARN, the stable version and the candidate with their code
   * hashes. The alias itself is not changed, so the candidate takes no
   * traffic yet — though publishing a code source does make it the
   * function's `$LATEST`.
   *
   * Refuses an alias that already splits its traffic — another rollout, or
   * one left behind — and one that points at `$LATEST`, which weighted
   * routing does not allow; and a candidate that is the stable version, which
   * is what publishing unchanged code and configuration gives back. A stage
   * run again over a record of the same rollout checks it and changes
   * nothing.
   */
  async stage(ctx: AwsLambdaCanaryContext): Promise<void> {
    const prior = ctx.state.get()[STAGE];
    // A marker this does not know cannot say what was done, so it is neither
    // overwritten nor acted on.
    if (prior !== undefined && prior !== "publishing" && prior !== "staged") {
      throw damagedStage(prior);
    }
    const settings = this.#settings();
    const identity = identityOf(settings);
    if (prior === "staged") {
      const recorded = recordedRollout(ctx.state.get());
      checkIdentity(recorded, identity);
      checkAliasArn(recorded, await this.#alias(settings, identity));
      reportStaged(ctx, recorded);
      return;
    }
    // Before anything else can fail: a rollback reads this to tell a stage
    // that never reached the alias (nothing to undo) from a hand-run abort.
    await ctx.state.set({ [STAGE]: "publishing" });
    const alias = await this.#alias(settings, identity);
    if (!VERSION_SHAPE.test(alias.version)) {
      throw new Error(
        `lambdaCanary: the alias ${identity.alias} points at ` +
          `${alias.version}, and Lambda splits an alias's traffic only ` +
          "between published versions. Point it at a published version " +
          "first — that becomes the stable one.",
      );
    }
    const others = Object.keys(alias.weights);
    if (others.length > 0) {
      throw new Error(
        `lambdaCanary: the alias ${identity.alias} already sends traffic to ` +
          `version ${
            others.join(", ")
          } as well as ${alias.version} — another rollout ` +
          "is running, or one left its weights behind. Clear the alias's " +
          "routing configuration, or finish that rollout, before staging " +
          "this one.",
      );
    }
    const stable = await this.#version(settings, identity, alias.version);
    const candidate = await this.#candidate(settings, identity);
    if (candidate.version === alias.version) {
      throw new Error(
        `lambdaCanary: the candidate is version ${candidate.version}, which ` +
          `the alias ${identity.alias} already points at, so there is ` +
          "nothing to roll out. Lambda publishes no new version when the " +
          "code and configuration have not changed since the last one.",
      );
    }
    // A version is Pending while Lambda prepares it (a SnapStart snapshot,
    // an image), and invocations of it fail until it is Active — so it gets
    // no share of the alias before then.
    await this.#wait(settings, identity, "published-version-active", candidate);
    const recorded: LambdaRecord = {
      ...identity,
      aliasArn: alias.arn,
      stable: stable.version,
      stableCodeSha256: stable.sha,
      candidate: candidate.version,
      codeSha256: candidate.sha,
    };
    // A rollback reads this to find the candidate, and every later call
    // checks against it, so it must be on record before any traffic can
    // reach the candidate.
    const staged = { [STAGE]: "staged", ...rolloutRecord(recorded) };
    if (!await ctx.state.trySet(staged)) {
      throw new Error(
        "lambdaCanary: could not record the staged rollout, so a rollback " +
          "could not find it. Stopping before the candidate takes any " +
          "traffic.",
      );
    }
    reportStaged(ctx, recorded);
  }

  /**
   * Send `percent` of the alias's invocations to the candidate, as its
   * additional weight; the stable version keeps the rest. First the
   * configuration is compared with the record; then the alias is read, and
   * this refuses — changing nothing — unless it is still the alias staged,
   * still points at the stable version, and splits only with the candidate,
   * and unless the candidate still has the code staged. The update carries
   * the alias's revision, so a change made in between fails it.
   */
  async expose(
    percent: number,
    ctx: AwsLambdaCanaryContext,
  ): Promise<number> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `lambdaCanary: an alias's weight is a share from 0 to 100 %, so it ` +
          `cannot expose ${percent} %.`,
      );
    }
    const settings = this.#settings();
    const identity = identityOf(settings);
    const stage = ctx.state.get()[STAGE];
    if (stage !== "staged") throw damagedStage(stage);
    const recorded = recordedRollout(ctx.state.get());
    checkIdentity(recorded, identity);
    const alias = await this.#alias(settings, identity);
    checkAliasArn(recorded, alias);
    checkSplit(recorded, alias);
    await this.#checkCode(settings, identity, recorded, "candidate");
    const update = new AwsLambdaUpdateAliasSettings()
      .functionName(identity.functionName).name(identity.alias)
      .revisionId(alias.revision);
    if (percent === 0) update.clearRouting();
    else update.additionalVersionWeight(recorded.candidate, percent / 100);
    await runChecked(this.#scoped(settings, identity, update));
    return percent;
  }

  /**
   * Point the alias at the candidate and clear its routing, so the candidate
   * takes every invocation. Before that, the same checks as
   * {@link expose}: the record, the alias's ARN, that it still splits only
   * between the stable version and the candidate, and the candidate's code.
   * An alias already pointing at the candidate with no routing is left as it
   * is, so a promote run again changes nothing.
   */
  async promote(ctx: AwsLambdaCanaryContext): Promise<void> {
    const settings = this.#settings();
    const identity = identityOf(settings);
    if (ctx.state.get()[STAGE] !== "staged") {
      throw new Error(
        "lambdaCanary: no staged candidate is recorded for this rollout, so " +
          "there is nothing to promote. Promote runs after stage, in the same " +
          "run.",
      );
    }
    const recorded = recordedRollout(ctx.state.get());
    checkIdentity(recorded, identity);
    const alias = await this.#alias(settings, identity);
    checkAliasArn(recorded, alias);
    if (
      alias.version === recorded.candidate &&
      Object.keys(alias.weights).length === 0
    ) {
      return;
    }
    checkSplit(recorded, alias);
    await this.#checkCode(settings, identity, recorded, "candidate");
    await runChecked(this.#scoped(
      settings,
      identity,
      new AwsLambdaUpdateAliasSettings().functionName(identity.functionName)
        .name(identity.alias).functionVersion(recorded.candidate)
        .clearRouting().revisionId(alias.revision),
    ));
  }

  /**
   * Take the candidate's traffic back. Idempotent. What it does depends on
   * what this rollout recorded:
   *
   * - **The rollout is staged** (a rollback mid-rollout): once the
   *   configuration and the alias's ARN match the record, the candidate's
   *   weight comes off the alias, leaving any other weight as it is. The
   *   update is written even when the candidate has no share, so an expose
   *   of this rollout still in flight — a `zuke cancel` from another process
   *   races it — fails on the revision instead of landing afterwards; a
   *   write that loses such a race reads the alias again and retries. An
   *   alias already pointing at the candidate — promoted, or moved there —
   *   goes back to the stable version, once that version still has the code
   *   recorded; one that also splits with another version is a newer rollout
   *   built on the candidate, and this refuses rather than undo it too.
   * - **`stage` failed before recording it**: the alias was never changed,
   *   so nothing runs.
   * - **Any other stage marker**: the record is damaged, and this refuses.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): the
   *   alias goes to the version set with {@link AwsLambdaCanarySettings.stable}
   *   and its routing is cleared. Without one this refuses, since claiming a
   *   rollback it cannot do would be worse.
   */
  async abort(ctx: AwsLambdaCanaryContext): Promise<void> {
    const stage = ctx.state.get()[STAGE];
    if (stage === "publishing") return;
    const settings = this.#settings();
    const identity = identityOf(settings);
    if (stage === "staged") {
      const recorded = recordedRollout(ctx.state.get());
      checkIdentity(recorded, identity);
      await this.#rollBack(settings, identity, recorded);
      return;
    }
    if (stage !== undefined) throw damagedStage(stage);
    const stable = settings.stable_;
    if (stable === undefined) {
      throw new Error(
        `lambdaCanary: this abort has no record of a rollout of ` +
          `${identity.functionName}:${identity.alias} — it was run by hand — ` +
          "so it does not know which version to go back to. Add " +
          "l.stable('<version>') to send all traffic there, or use `zuke " +
          "cancel <run-id>` for a rollout that is still running.",
      );
    }
    if (!VERSION_SHAPE.test(stable)) {
      throw new Error(
        `lambdaCanary: "${stable}" is not a published version number.`,
      );
    }
    await runChecked(this.#scoped(
      settings,
      identity,
      new AwsLambdaUpdateAliasSettings().functionName(identity.functionName)
        .name(identity.alias).functionVersion(stable).clearRouting(),
    ));
  }

  /**
   * The staged rollback: read the alias, work out the update that takes the
   * candidate's traffic back, and write it with the alias's revision —
   * reading again and retrying, up to {@link ABORT_ATTEMPTS} times, when
   * another write to the alias got in between.
   */
  async #rollBack(
    settings: AwsLambdaCanarySettings,
    identity: LambdaIdentity,
    recorded: LambdaRecord,
  ): Promise<void> {
    for (let attempt = 1;; attempt++) {
      const alias = await this.#alias(settings, identity);
      checkAliasArn(recorded, alias);
      const update = new AwsLambdaUpdateAliasSettings()
        .functionName(identity.functionName).name(identity.alias)
        .revisionId(alias.revision);
      if (alias.version === recorded.candidate) {
        const others = Object.keys(alias.weights);
        if (others.length > 0) {
          throw new Error(
            `lambdaCanary: the alias ${recorded.alias} points at this ` +
              `rollout's candidate ${recorded.candidate} and also sends ` +
              `traffic to version ${others.join(", ")} — a newer rollout ` +
              "built on it. Sending the alias back to the stable version " +
              `${recorded.stable} would undo that one as well, so this ` +
              "changed nothing. Roll the newer rollout back first.",
          );
        }
        await this.#checkCode(settings, identity, recorded, "stable");
        update.functionVersion(recorded.stable).clearRouting();
      } else {
        const rest = Object.entries(alias.weights)
          .filter(([version]) => version !== recorded.candidate);
        if (rest.length === 0) update.clearRouting();
        for (const [version, weight] of rest) {
          update.additionalVersionWeight(version, weight);
        }
      }
      const command = this.#scoped(settings, identity, update).noThrow();
      const output = await command.run();
      if (output.code === 0) return;
      if (
        !output.stderr.includes(STALE_REVISION) || attempt >= ABORT_ATTEMPTS
      ) {
        failOnExit(command, output);
      }
    }
  }

  /** The settings, evaluated now so the lambda sees resolved parameters. */
  #settings(): AwsLambdaCanarySettings {
    return this.#configure(new AwsLambdaCanarySettings());
  }

  /**
   * `command` with the caller's global options applied — and refused, before
   * it runs, unless the `.aws(...)` lambda gave it exactly the flags this
   * call resolved and checked. The lambda runs once per command, so one that
   * resolves differently between two runs of itself cannot send one command
   * to another account.
   */
  #scoped<S extends AwsSettings>(
    settings: AwsLambdaCanarySettings,
    identity: LambdaIdentity,
    command: S,
  ): S {
    const own = command.argv().length;
    settings.aws_(command);
    const added = command.argv().slice(own);
    if (!sameArgv(added, identity.flags)) {
      throw new Error(
        "lambdaCanary: l.aws(...) gave this command other flags than the " +
          "ones this call resolved and checked, so it does not run: the " +
          "lambda must give the same flags every time it runs. Make it " +
          "depend only on the build's resolved parameters.",
      );
    }
    return command;
  }

  /** Read the alias this call is configured with. */
  #alias(
    settings: AwsLambdaCanarySettings,
    identity: LambdaIdentity,
  ): Promise<LambdaAlias> {
    return readAlias(this.#scoped(
      settings,
      identity,
      new AwsLambdaGetAliasSettings().functionName(identity.functionName)
        .name(identity.alias),
    ));
  }

  /**
   * A published version's number and code hash, read from the function —
   * refused unless it is a published version's number, which `$LATEST` (what
   * a dry run reports) is not, and unless the function reports that version.
   */
  async #version(
    settings: AwsLambdaCanarySettings,
    identity: LambdaIdentity,
    version: string,
  ): Promise<LambdaVersion> {
    if (!VERSION_SHAPE.test(version)) {
      throw new Error(
        `lambdaCanary: ${JSON.stringify(version)} is not a published ` +
          "version's number.",
      );
    }
    const read = await readVersion(this.#scoped(
      settings,
      identity,
      new AwsLambdaGetFunctionSettings().functionName(identity.functionName)
        .qualifier(version),
    ));
    if (read.version !== version) {
      throw new Error(
        `lambdaCanary: asked ${identity.functionName} for version ` +
          `${version}, and it reported version ${read.version}.`,
      );
    }
    return read;
  }

  /**
   * The candidate: the code source published — after waiting out any update
   * of the function still in progress, which would make the publish fail —
   * or the version given; read back from the function either way.
   */
  async #candidate(
    settings: AwsLambdaCanarySettings,
    identity: LambdaIdentity,
  ): Promise<LambdaVersion> {
    const code = settings.zipFile_ !== undefined ||
      settings.s3Bucket_ !== undefined || settings.s3Key_ !== undefined ||
      settings.s3ObjectVersion_ !== undefined ||
      settings.imageUri_ !== undefined;
    const given = settings.version_;
    if (code && given === undefined) {
      await this.#wait(settings, identity, "function-updated-v2");
      const published = await publishCode(
        this.#scoped(settings, identity, codeCommand(settings, identity)),
      );
      const read = await this.#version(settings, identity, published.version);
      if (read.sha !== published.sha) {
        throw new Error(
          `lambdaCanary: version ${published.version}, just published, does ` +
            "not have the code it was published with when read back from " +
            `${identity.functionName}: another update reached the function ` +
            "in between.",
        );
      }
      return read;
    }
    if (given !== undefined && !code) {
      return await this.#version(settings, identity, given);
    }
    throw new Error(
      "lambdaCanary: name the candidate once — a code source (l.zipFile, " +
        "l.s3Bucket with l.s3Key, or l.imageUri) to ship and publish it, or " +
        "l.version('<n>') for a version already published.",
    );
  }

  /** Wait for the function, or one of its versions, to reach `state`. */
  async #wait(
    settings: AwsLambdaCanarySettings,
    identity: LambdaIdentity,
    state: AwsLambdaWaiter,
    version?: LambdaVersion,
  ): Promise<void> {
    const wait = new AwsLambdaWaitSettings().waiter(state)
      .functionName(identity.functionName);
    if (version !== undefined) wait.qualifier(version.version);
    await runChecked(this.#scoped(settings, identity, wait));
  }

  /**
   * Refuse unless the `which` version still has the code `stage` recorded. A
   * version is immutable, so a different hash means the function was deleted
   * and created again and its version numbers started over.
   */
  async #checkCode(
    settings: AwsLambdaCanarySettings,
    identity: LambdaIdentity,
    recorded: LambdaRecord,
    which: "candidate" | "stable",
  ): Promise<void> {
    const version = which === "candidate"
      ? recorded.candidate
      : recorded.stable;
    const expected = which === "candidate"
      ? recorded.codeSha256
      : recorded.stableCodeSha256;
    const live = await this.#version(settings, identity, version);
    if (live.sha === expected) return;
    throw new Error(
      `lambdaCanary: the ${which} version ${version} of ` +
        `${recorded.functionName} now has the code hash ${live.sha}, not ` +
        `${expected} as staged: the function was deleted and created again. ` +
        "This call changed nothing rather than send traffic to code the " +
        `canary never ran. ${recovery(recorded)}`,
    );
  }
}

/**
 * The `update-function-code --publish` that ships the configured code source
 * to the function — the function name and `--publish` are the platform's.
 */
function codeCommand(
  settings: AwsLambdaCanarySettings,
  identity: LambdaIdentity,
): AwsLambdaUpdateFunctionCodeSettings {
  const command = new AwsLambdaUpdateFunctionCodeSettings()
    .functionName(identity.functionName).publish();
  if (settings.zipFile_ !== undefined) command.zipFile(settings.zipFile_);
  if (settings.s3Bucket_ !== undefined) command.s3Bucket(settings.s3Bucket_);
  if (settings.s3Key_ !== undefined) command.s3Key(settings.s3Key_);
  if (settings.s3ObjectVersion_ !== undefined) {
    command.s3ObjectVersion(settings.s3ObjectVersion_);
  }
  if (settings.imageUri_ !== undefined) command.imageUri(settings.imageUri_);
  return command;
}

/**
 * Refuse unless the alias still splits as this rollout left it: pointing at
 * the stable version, with no weight for any version but the candidate. The
 * rollback that follows a refusal takes the candidate's weight off and
 * leaves the rest of the alias as it is.
 */
function checkSplit(recorded: LambdaRecord, alias: LambdaAlias): void {
  const foreign = Object.keys(alias.weights)
    .filter((version) => version !== recorded.candidate);
  if (alias.version === recorded.stable && foreign.length === 0) return;
  const routing = Object.entries(alias.weights)
    .map(([version, weight]) => `${version}=${weight}`).join(", ");
  throw new Error(
    `lambdaCanary: the alias ${recorded.alias} now points at version ` +
      `${alias.version}${routing === "" ? "" : ` with weights ${routing}`}, ` +
      `not at the stable version ${recorded.stable} splitting only with the ` +
      `candidate ${recorded.candidate}: something else changed it. This call ` +
      "changed nothing; the rollback takes the candidate's weight off the " +
      "alias and leaves the rest of it as it is.",
  );
}

/** Report the staged versions in the build summary. */
function reportStaged(ctx: AwsLambdaCanaryContext, recorded: LambdaRecord) {
  ctx.reportSummary({
    Candidate: `version ${recorded.candidate}`,
    Stable: `version ${recorded.stable}`,
  });
}

/**
 * What this call is configured to act through — refused, before any command,
 * unless the function and alias are set and shaped as Lambda takes them.
 */
function identityOf(settings: AwsLambdaCanarySettings): LambdaIdentity {
  const functionName = settings.functionName_;
  const alias = settings.alias_;
  if (functionName === undefined || !FUNCTION_SHAPE.test(functionName)) {
    throw new Error(
      "lambdaCanary: name the function with l.functionName('api') — its " +
        "name, partial ARN or ARN.",
    );
  }
  if (alias === undefined || !ALIAS_SHAPE.test(alias)) {
    throw new Error(
      "lambdaCanary: name the alias with l.alias('live') — letters, digits, " +
        "- and _, not all digits. It must already exist.",
    );
  }
  return { functionName, alias, flags: awsFlags(settings.aws_) };
}

/** The refusal for a stage marker this call cannot act on. */
function damagedStage(stage: JsonValue | undefined): Error {
  return damagedRecord("a stage marker this call can act on", stage);
}

/**
 * A Lambda alias as a canary platform, for `@zuke/canary`:
 *
 * ```ts
 * c.platform(lambdaCanary((l) =>
 *   l.functionName("api").alias("live").zipFile("dist/api.zip")
 *     .aws((a) => a.profile("deploy").region("eu-west-1"))
 * ))
 * ```
 *
 * The lambda runs on every call, so it may read resolved parameters.
 *
 * - **stage** — reads the alias (`get-alias`), whose version becomes the
 *   stable one; waits out an update in progress (`wait function-updated-v2`)
 *   and publishes the candidate with `update-function-code --publish`, or
 *   takes `.version(...)`; reads it back with `get-function`; waits for it
 *   to be `Active` (`wait published-version-active`); records the rollout.
 *   The alias is not changed.
 * - **expose** — `update-alias --routing-config
 *   AdditionalVersionWeights={"<candidate>": <n/100>} --revision-id <rev>`.
 * - **promote** — `update-alias --function-version <candidate>` with the
 *   routing cleared.
 * - **abort** — takes the candidate's weight off mid-rollout; run by hand,
 *   `--function-version <stable>` with the routing cleared.
 *
 * Every call after `stage` that has its record — expose, promote, and abort
 * mid-rollout — compares the configured function, alias and AWS flags with
 * the record, reads the alias and checks its ARN (which names the account and
 * region), and refuses on any difference before changing anything. Expose and
 * promote also check that the alias splits only as the rollout left it and
 * that the candidate still has the code staged. Each `update-alias` carries
 * the alias's `--revision-id`, so a change made between the read and the
 * update fails it. A hand-run abort has no record and uses the configuration
 * as it is.
 *
 * Lambda's weighted routing needs the two versions to share an execution role
 * and a dead-letter configuration; the update fails, and the canary rolls
 * back, when they do not.
 */
export function lambdaCanary(
  configure: Configure<AwsLambdaCanarySettings>,
): AwsLambdaCanary {
  return new AwsLambdaCanary(configure);
}
