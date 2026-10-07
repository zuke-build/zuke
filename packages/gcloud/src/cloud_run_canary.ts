// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link cloudRunCanary} — a Cloud Run service as a platform for a
 * `@zuke/canary` rollout.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { cloudRunCanary } from "@zuke/gcloud";
 *
 * rollout = canary((c) =>
 *   c.platform(cloudRunCanary((r) =>
 *     r.service("api").region("europe-west1").image(this.image.value)
 *   ))
 *     .steps(10, 25, 50)
 *     .bake("10m")
 * );
 * ```
 *
 * Every traffic move goes through the candidate's **tag**, never a revision
 * name. That keeps the one thing this package refuses to do — parse a JSON
 * document gcloud printed — out of the picture: the only value read back is the
 * latest created revision, through gcloud's own `value(...)` projection, the
 * same way {@link "./gcloud.ts".GcloudTasks.runServiceUrl} reads a URL.
 *
 * The canary engine's platform interface lives in `@zuke/canary`, and a wrapper
 * depends only on `@zuke/core`, so this module does not import it: the object
 * {@link cloudRunCanary} returns has the same shape and is accepted by
 * `c.platform(...)` as it is.
 *
 * @module
 */

import type { JsonValue, SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import {
  GcloudRunServicesDescribeSettings,
  GcloudRunServicesUpdateSettings,
  GcloudRunUpdateTrafficSettings,
} from "./cloud_run.ts";
import {
  checkApplied,
  checkIdentity,
  checkUid,
  type CloudRunIdentity,
  damagedRecord,
  gcloudFlags,
  identityRecord,
  recordedIdentity,
  UID_FORMAT,
} from "./cloud_run_canary_record.ts";
import { readScalar } from "./scalar_output.ts";
import {
  failOnExit,
  type GcloudSettings,
  type GcloudSettingsRunner,
} from "./settings.ts";

/** The projection that reads back the revision a `services update` created. */
export const LATEST_REVISION_FORMAT = "value(status.latestCreatedRevisionName)";

/** The state key the staged candidate's revision name is recorded under. */
const CANDIDATE = "cloudRunCandidate";

/**
 * The state key recording how far `stage` got: `"deploying"` before the
 * update, `"tagged"` once the candidate carries the tag. It is what tells
 * `abort` whether there is a tagged route to take traffic back from. The
 * `"tagged"` write also records the service, region, tag, gcloud flags and
 * service uid every later call is checked against.
 */
const STAGE = "cloudRunStage";

/**
 * A Cloud Run tag or revision name: a tag becomes part of a URL, and both are
 * DNS labels — which also keeps a `,` or `=` from changing what
 * `--to-tags <tag>=<percent>` or `--to-revisions <revision>=100` means.
 */
const LABEL_SHAPE = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * The part of the canary engine's context the Cloud Run platform uses: the
 * rollout's durable state, where the staged revision is recorded, and the
 * build summary. The engine hands a richer context; this is the narrow view.
 */
export interface CloudRunCanaryContext {
  /** The rollout's durable platform state, shared by every call. */
  readonly state: TargetStateHandle;
  /** Add key/value pairs to the calling target's row in the build summary. */
  reportSummary(pairs: SummaryPairs): void;
}

/**
 * How {@link cloudRunCanary} reaches the service, configured through its
 * lambda.
 */
export class CloudRunCanarySettings {
  /** The Cloud Run service (set by {@link service}). */
  service_?: string;
  /** The region the service runs in (set by {@link region}). */
  region_?: string;
  /** The candidate's container image (set by {@link image}). */
  image_?: string;
  /** The tag that routes the candidate's traffic (set by {@link tag}). */
  tag_ = "canary";
  /** The revision a hand-run rollback returns to (set by {@link stable}). */
  stable_?: string;
  /** Global gcloud flags for every command (set by {@link gcloud}). */
  gcloud_?: Configure<GcloudSettings>;
  /** How each command is run (set by {@link runner}). */
  runner_: GcloudSettingsRunner = (settings) => settings.run();

  /** The Cloud Run service to roll out to. It must already exist. */
  service(name: string): this {
    this.service_ = name;
    return this;
  }

  /** The region the service runs in (`--region`). */
  region(value: string): this {
    this.region_ = value;
    return this;
  }

  /** The candidate's container image, deployed by `stage`. */
  image(reference: string): this {
    this.image_ = reference;
    return this;
  }

  /**
   * The tag the candidate revision carries, and that every traffic move routes
   * through (default `canary`). Lowercase letters, digits and hyphens,
   * starting with a letter.
   */
  tag(name: string): this {
    this.tag_ = name;
    return this;
  }

  /**
   * The revision to send all traffic back to when `rollout.abort` is run by
   * hand. Such a run is fresh, with no record of a rollout, so it has nothing
   * else to go on — and the release it is undoing has usually been promoted
   * already. A rollback the engine runs mid-rollout does not use it: that one
   * takes the candidate's tag back to 0 % instead.
   */
  stable(revision: string): this {
    this.stable_ = revision;
    return this;
  }

  /**
   * Global flags for every gcloud command the platform runs —
   * `(g) => g.project("p").account("deploy@p.iam.gserviceaccount.com")`, or a
   * `.toolPath(...)` to a specific gcloud.
   */
  gcloud(configure: Configure<GcloudSettings>): this {
    this.gcloud_ = configure;
    return this;
  }

  /**
   * Replace how each prepared command is run. The default runs it; this is
   * for a test, or for a build that executes gcloud through something else.
   */
  runner(run: GcloudSettingsRunner): this {
    this.runner_ = run;
    return this;
  }
}

/**
 * A Cloud Run service as a canary platform. Create one with
 * {@link cloudRunCanary}; hand it to `@zuke/canary`'s `c.platform(...)`.
 *
 * Exposure is a share of requests, set exactly, in whole percents.
 */
export class CloudRunCanary {
  /** Cloud Run splits requests, so exposure is a traffic share. */
  readonly exposure: "traffic" = "traffic";
  readonly #configure: Configure<CloudRunCanarySettings>;

  /** A platform whose settings `configure` produces, afresh on every call. */
  constructor(configure: Configure<CloudRunCanarySettings>) {
    this.#configure = configure;
  }

  /** `"Cloud Run service api"`, for the build summary. */
  describe(): string {
    const service = this.#settings().service_;
    return service === undefined
      ? "Cloud Run service"
      : `Cloud Run service ${service}`;
  }

  /**
   * Read the service's uid, deploy the candidate image as a new revision
   * carrying the tag and no traffic, then record the service, region, tag,
   * gcloud flags and uid every later call is checked against, and which
   * revision the candidate is. `services update` never creates a service, so a
   * misspelt name fails here rather than standing up a second service. A stage
   * run again over a record that shows the candidate tagged is checked against
   * that record first, as every later call is.
   */
  async stage(ctx: CloudRunCanaryContext): Promise<void> {
    const prior = ctx.state.get()[STAGE];
    // A marker this does not know cannot say whether a tagged route exists,
    // so it is neither overwritten nor acted on.
    if (prior !== undefined && prior !== "deploying" && prior !== "tagged") {
      throw damagedStage(prior);
    }
    // Then, before anything else can throw: a rollback reads this to tell a
    // stage that failed on its own settings (nothing to undo) from a hand-run
    // abort (which goes to the stable revision). An earlier attempt that
    // tagged the candidate keeps its marker, so its tagged route is not
    // forgotten.
    if (prior !== "tagged") await ctx.state.set({ [STAGE]: "deploying" });
    const settings = this.#settings();
    const service = serviceOf(settings);
    const image = settings.image_;
    if (image === undefined || image === "") {
      throw new Error(
        "cloudRunCanary: no candidate image — add r.image(...), the image " +
          "the canary deploys.",
      );
    }
    const identity = identityOf(settings, service);
    const uid = prior === "tagged"
      ? await this.#verified(ctx, settings, identity)
      : await this.#uid(settings, identity);
    await runChecked(
      settings,
      this.#scoped(
        settings,
        identity,
        new GcloudRunServicesUpdateSettings().service(service).image(image)
          .tag(settings.tag_).noTraffic(),
      ),
    );
    // A rollback reads this to know there is a tagged route to empty, and
    // which service it is on, so it must be on record before any traffic can
    // reach the candidate.
    const tagged = { [STAGE]: "tagged", ...identityRecord(identity, uid) };
    if (!await ctx.state.trySet(tagged)) {
      throw new Error(
        "cloudRunCanary: could not record that the candidate is tagged, so a " +
          "rollback could not find it. Stopping before it takes any traffic.",
      );
    }
    const candidate = await this.#latestRevision(settings, identity);
    await ctx.state.set({ [CANDIDATE]: candidate });
    ctx.reportSummary({ Candidate: candidate });
  }

  /**
   * Send `percent` of the requests to the candidate, through its tag. gcloud
   * spreads the rest over the revisions already serving, in proportion and in
   * whole percents, so a split the service had before the canary keeps its
   * shape only approximately — a revision whose share rounds to 0 drops out.
   * First the configuration is compared with what `stage` recorded, then the
   * service's uid is read again; on any difference this refuses, changing
   * nothing.
   */
  async expose(
    percent: number,
    ctx: CloudRunCanaryContext,
  ): Promise<number> {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `cloudRunCanary: Cloud Run splits traffic in whole percents from 0 ` +
          `to 100, so it cannot expose ${percent} %. Use whole-number steps.`,
      );
    }
    const settings = this.#settings();
    const service = serviceOf(settings);
    const stage = ctx.state.get()[STAGE];
    if (stage !== "tagged") throw damagedStage(stage);
    const identity = identityOf(settings, service);
    await this.#verified(ctx, settings, identity);
    await runChecked(
      settings,
      this.#scoped(
        settings,
        identity,
        new GcloudRunUpdateTrafficSettings().service(service)
          .toTags(`${settings.tag_}=${percent}`),
      ),
    );
    return percent;
  }

  /**
   * Send all traffic to the latest revision — after checking that it is
   * still the candidate this rollout staged, so a revision someone deployed in
   * the meantime is not promoted in its place. The check and the traffic move
   * are two gcloud calls, so a deploy landing in the seconds between them is
   * not caught. Before either, the configuration is compared with what
   * `stage` recorded and the service's uid is read again; on any difference
   * this refuses, changing nothing. Idempotent.
   */
  async promote(ctx: CloudRunCanaryContext): Promise<void> {
    const settings = this.#settings();
    const service = serviceOf(settings);
    const staged = ctx.state.get()[CANDIDATE];
    if (typeof staged !== "string") {
      throw new Error(
        "cloudRunCanary: no staged candidate is recorded for this rollout, so " +
          "there is nothing to promote. Promote runs after stage, in the same " +
          "run.",
      );
    }
    const identity = identityOf(settings, service);
    await this.#verified(ctx, settings, identity);
    const latest = await this.#latestRevision(settings, identity);
    if (latest !== staged) {
      throw new Error(
        `cloudRunCanary: the latest revision of ${service} is ${latest}, not ` +
          `the staged candidate ${staged}. Something deployed in between, so ` +
          "promoting would hand all traffic to a revision this canary never " +
          "analysed.",
      );
    }
    await runChecked(
      settings,
      this.#scoped(
        settings,
        identity,
        new GcloudRunUpdateTrafficSettings().service(service).toLatest(),
      ),
    );
  }

  /**
   * Take the candidate's traffic back. Idempotent. What it does depends on
   * what this rollout recorded:
   *
   * - **The candidate is tagged** (a rollback mid-rollout): once the
   *   configuration and the service's uid match what `stage` recorded, the
   *   tag goes to 0 % and gcloud returns that share to the revisions already
   *   serving. The candidate revision stays, with no traffic. On a mismatch
   *   this refuses, changing nothing.
   * - **`stage` failed before tagging it**: nothing has any traffic to take
   *   back, so nothing runs.
   * - **Any other stage marker**: the record is damaged, and this refuses.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): all
   *   traffic goes to the revision set with
   *   {@link CloudRunCanarySettings.stable}. Without one this refuses, since
   *   claiming a rollback it cannot do would be worse.
   */
  async abort(ctx: CloudRunCanaryContext): Promise<void> {
    const settings = this.#settings();
    const service = serviceOf(settings);
    const stage = ctx.state.get()[STAGE];
    if (stage === "deploying") return;
    const identity = identityOf(settings, service);
    if (stage === "tagged") {
      await this.#verified(ctx, settings, identity);
      await runChecked(
        settings,
        this.#scoped(
          settings,
          identity,
          new GcloudRunUpdateTrafficSettings().service(service)
            .toTags(`${settings.tag_}=0`),
        ),
      );
      return;
    }
    if (stage !== undefined) throw damagedStage(stage);
    const stable = settings.stable_;
    if (stable === undefined) {
      throw new Error(
        `cloudRunCanary: this abort has no record of a rollout of ${service} ` +
          "— it was run by hand — so it does not know which revision to go " +
          "back to. Add r.stable('<revision>') to send all traffic there, or " +
          "use `zuke cancel <run-id>` for a rollout that is still running.",
      );
    }
    if (!LABEL_SHAPE.test(stable)) {
      throw new Error(
        `cloudRunCanary: "${stable}" is not a Cloud Run revision name — ` +
          "lowercase letters, digits and hyphens, starting with a letter.",
      );
    }
    await runChecked(
      settings,
      this.#scoped(
        settings,
        identity,
        new GcloudRunUpdateTrafficSettings().service(service)
          .toRevisions(`${stable}=100`),
      ),
    );
  }

  /** The settings, evaluated now so the lambda sees resolved parameters. */
  #settings(): CloudRunCanarySettings {
    const settings = this.#configure(new CloudRunCanarySettings());
    if (!LABEL_SHAPE.test(settings.tag_)) {
      throw new Error(
        `cloudRunCanary: the tag "${settings.tag_}" is not one Cloud Run ` +
          "accepts — use lowercase letters, digits and hyphens, starting with " +
          "a letter (it becomes part of the revision's URL).",
      );
    }
    return settings;
  }

  /**
   * `command` with the region and the caller's global flags applied — and
   * refused, before it runs, unless the lambda gave it exactly the flags this
   * call resolved, which every check was made with. The lambda runs once per
   * command, so one that resolves differently between two runs of itself
   * cannot send one command to another project.
   */
  #scoped<S extends GcloudSettings & { region(value: string): S }>(
    settings: CloudRunCanarySettings,
    identity: CloudRunIdentity,
    command: S,
  ): S {
    if (identity.region !== null) command.region(identity.region);
    const own = command.argv().length;
    settings.gcloud_?.(command);
    checkApplied(command.argv(), own, identity.flags);
    return command;
  }

  /**
   * Refuse unless this call reaches the service `stage` recorded: first the
   * configured service, region, tag and gcloud flags against the record —
   * before any command — then the live service's uid, read before anything
   * changes. Returns the uid.
   */
  async #verified(
    ctx: CloudRunCanaryContext,
    settings: CloudRunCanarySettings,
    identity: CloudRunIdentity,
  ): Promise<string> {
    const recorded = recordedIdentity(ctx.state.get());
    checkIdentity(recorded, identity);
    const live = await this.#uid(settings, identity);
    checkUid(recorded, live);
    return live;
  }

  /** The revision a `services update` on the service last created. */
  #latestRevision(
    settings: CloudRunCanarySettings,
    identity: CloudRunIdentity,
  ): Promise<string> {
    return this.#read(
      settings,
      identity,
      LATEST_REVISION_FORMAT,
      "latest revision",
    );
  }

  /**
   * The `metadata.uid` of the service gcloud reaches: set when the service is
   * created and kept until it is deleted, so it tells this service from one
   * created again under its name, or one of the same name in another project.
   */
  #uid(
    settings: CloudRunCanarySettings,
    identity: CloudRunIdentity,
  ): Promise<string> {
    return this.#read(settings, identity, UID_FORMAT, "service uid");
  }

  /** One field of the service, through gcloud's `value(...)` projection. */
  async #read(
    settings: CloudRunCanarySettings,
    identity: CloudRunIdentity,
    format: string,
    subject: string,
  ): Promise<string> {
    const describe = this.#scoped(
      settings,
      identity,
      new GcloudRunServicesDescribeSettings().service(identity.service),
    ).format(format).quiet();
    return readScalar(
      await runChecked(settings, describe),
      "cloudRunCanary",
      subject,
    );
  }
}

/**
 * Run one prepared command and fail on a non-zero exit — whatever the
 * `.gcloud(...)` lambda says. With `noThrow()` set there, a failed rollback
 * would otherwise return normally and be reported as done. The failure is
 * core's `CommandError`, whose command line the run's redactor masks.
 */
async function runChecked(
  settings: CloudRunCanarySettings,
  command: GcloudSettings,
): Promise<CommandOutput> {
  const output = await settings.runner_(command);
  failOnExit(command, output);
  return output;
}

/** What this call is configured to act through, for the record checks. */
function identityOf(
  settings: CloudRunCanarySettings,
  service: string,
): CloudRunIdentity {
  return {
    service,
    region: settings.region_ ?? null,
    tag: settings.tag_,
    flags: gcloudFlags(settings.gcloud_),
  };
}

/** The refusal for a stage marker this call cannot act on. */
function damagedStage(stage: JsonValue | undefined): Error {
  return damagedRecord("a stage marker this call can act on", stage);
}

/** The configured service, or a friendly error naming the fix. */
function serviceOf(settings: CloudRunCanarySettings): string {
  if (settings.service_ === undefined) {
    throw new Error(
      "cloudRunCanary: no service named — add r.service('api'). The service " +
        "must already exist; the canary amends it.",
    );
  }
  return settings.service_;
}

/**
 * A Cloud Run service as a canary platform, for `@zuke/canary`:
 *
 * ```ts
 * c.platform(cloudRunCanary((r) =>
 *   r.service("api").region("europe-west1").image(this.image.value)
 *     .gcloud((g) => g.project("my-project"))
 * ))
 * ```
 *
 * The lambda runs on every call, so it may read resolved parameters.
 *
 * - **stage** — reads the service's `metadata.uid`, runs `run services update
 *   <service> --image <image> --tag canary --no-traffic`, then records the
 *   service, region, tag, gcloud flags and uid, and the new revision.
 * - **expose** — `run services update-traffic <service> --to-tags canary=<n>`.
 * - **promote** — checks the latest revision is still the candidate, then
 *   `update-traffic --to-latest`.
 * - **abort** — `update-traffic --to-tags canary=0` mid-rollout; run by hand,
 *   `--to-revisions <stable>=100` to the revision set with `.stable(...)`.
 *
 * Every call after `stage` that has its record — expose, promote, and abort
 * mid-rollout — first compares the configured service, region, tag and
 * gcloud flags with the record, then reads the service's uid again, and
 * refuses on any difference before changing anything. A hand-run abort has no
 * record and uses the configuration as it is.
 */
export function cloudRunCanary(
  configure: Configure<CloudRunCanarySettings>,
): CloudRunCanary {
  return new CloudRunCanary(configure);
}
