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

import type { SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import {
  GcloudRunServicesDescribeSettings,
  GcloudRunServicesUpdateSettings,
  GcloudRunUpdateTrafficSettings,
} from "./cloud_run.ts";
import { readScalar } from "./scalar_output.ts";
import type { GcloudSettings } from "./settings.ts";

/** The projection that reads back the revision a `services update` created. */
const LATEST_REVISION_FORMAT = "value(status.latestCreatedRevisionName)";

/** The state key the staged candidate's revision name is recorded under. */
const CANDIDATE = "cloudRunCandidate";

/**
 * The state key recording how far `stage` got: `"deploying"` before the
 * update, `"tagged"` once the candidate carries the tag. It is what tells
 * `abort` whether there is a tagged route to take traffic back from.
 */
const STAGE = "cloudRunStage";

/**
 * A Cloud Run tag or revision name: a tag becomes part of a URL, and both are
 * DNS labels — which also keeps a `,` or `=` from changing what
 * `--to-tags <tag>=<percent>` or `--to-revisions <revision>=100` means.
 */
const LABEL_SHAPE = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * Runs one prepared `gcloud` command and returns its output. The default runs
 * it; a test or a build that executes gcloud some other way injects its own
 * with {@link CloudRunCanarySettings.runner}.
 */
export type GcloudSettingsRunner = (
  settings: GcloudSettings,
) => Promise<CommandOutput>;

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
   * Deploy the candidate image as a new revision carrying the tag and no
   * traffic, then record which revision that is. `services update` never
   * creates a service, so a misspelt name fails here rather than standing up a
   * second service.
   */
  async stage(ctx: CloudRunCanaryContext): Promise<void> {
    // First, before anything can throw: a rollback reads this to tell a stage
    // that failed on its own settings (nothing to undo) from a hand-run abort
    // (which goes to the stable revision).
    await ctx.state.set({ [STAGE]: "deploying" });
    const settings = this.#settings();
    const service = serviceOf(settings);
    const image = settings.image_;
    if (image === undefined || image === "") {
      throw new Error(
        "cloudRunCanary: no candidate image — add r.image(...), the image " +
          "the canary deploys.",
      );
    }
    await runChecked(
      settings,
      this.#scoped(settings, new GcloudRunServicesUpdateSettings())
        .service(service).image(image).tag(settings.tag_).noTraffic(),
    );
    // A rollback reads this to know there is a tagged route to empty, so it
    // must be on record before any traffic can reach the candidate.
    if (!await ctx.state.trySet({ [STAGE]: "tagged" })) {
      throw new Error(
        "cloudRunCanary: could not record that the candidate is tagged, so a " +
          "rollback could not find it. Stopping before it takes any traffic.",
      );
    }
    const candidate = await this.#latestRevision(settings, service);
    await ctx.state.set({ [CANDIDATE]: candidate });
    ctx.reportSummary({ Candidate: candidate });
  }

  /**
   * Send `percent` of the requests to the candidate, through its tag. gcloud
   * spreads the rest over the revisions already serving, in proportion and in
   * whole percents, so a split the service had before the canary keeps its
   * shape only approximately — a revision whose share rounds to 0 drops out.
   */
  async expose(percent: number): Promise<number> {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `cloudRunCanary: Cloud Run splits traffic in whole percents from 0 ` +
          `to 100, so it cannot expose ${percent} %. Use whole-number steps.`,
      );
    }
    const settings = this.#settings();
    await runChecked(
      settings,
      this.#scoped(settings, new GcloudRunUpdateTrafficSettings())
        .service(serviceOf(settings)).toTags(`${settings.tag_}=${percent}`),
    );
    return percent;
  }

  /**
   * Send all traffic to the latest revision — after checking that it is
   * still the candidate this rollout staged, so a revision someone deployed in
   * the meantime is not promoted in its place. The check and the traffic move
   * are two gcloud calls, so a deploy landing in the seconds between them is
   * not caught. Idempotent.
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
    const latest = await this.#latestRevision(settings, service);
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
      this.#scoped(settings, new GcloudRunUpdateTrafficSettings())
        .service(service).toLatest(),
    );
  }

  /**
   * Take the candidate's traffic back. Idempotent. What it does depends on
   * what this rollout recorded:
   *
   * - **The candidate is tagged** (a rollback mid-rollout): the tag goes to
   *   0 % and gcloud returns that share to the revisions already serving. The
   *   candidate revision stays, with no traffic.
   * - **`stage` failed before tagging it**: nothing has any traffic to take
   *   back, so nothing runs.
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
    if (stage === "tagged") {
      await runChecked(
        settings,
        this.#scoped(settings, new GcloudRunUpdateTrafficSettings())
          .service(service).toTags(`${settings.tag_}=0`),
      );
      return;
    }
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
      this.#scoped(settings, new GcloudRunUpdateTrafficSettings())
        .service(service).toRevisions(`${stable}=100`),
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

  /** `command` with the region and the caller's global flags applied. */
  #scoped<S extends GcloudSettings & { region(value: string): S }>(
    settings: CloudRunCanarySettings,
    command: S,
  ): S {
    if (settings.region_ !== undefined) command.region(settings.region_);
    settings.gcloud_?.(command);
    return command;
  }

  /** The revision a `services update` on `service` last created. */
  async #latestRevision(
    settings: CloudRunCanarySettings,
    service: string,
  ): Promise<string> {
    const describe = this.#scoped(
      settings,
      new GcloudRunServicesDescribeSettings(),
    ).service(service).format(LATEST_REVISION_FORMAT).quiet();
    return readScalar(
      await runChecked(settings, describe),
      "cloudRunCanary",
      "latest revision",
    );
  }
}

/**
 * Run one prepared command and fail on a non-zero exit — whatever the
 * `.gcloud(...)` lambda says. With `noThrow()` set there, a failed rollback
 * would otherwise return normally and be reported as done.
 */
async function runChecked(
  settings: CloudRunCanarySettings,
  command: GcloudSettings,
): Promise<CommandOutput> {
  const output = await settings.runner_(command);
  if (output.code !== 0) {
    const detail = output.stderr.trim();
    throw new Error(
      `cloudRunCanary: gcloud ${command.argv().slice(1, 4).join(" ")} ` +
        `exited ${output.code}${detail === "" ? "." : `: ${detail}`}`,
    );
  }
  return output;
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
 * - **stage** — `run services update <service> --image <image> --tag canary
 *   --no-traffic`, then records the new revision.
 * - **expose** — `run services update-traffic <service> --to-tags canary=<n>`.
 * - **promote** — checks the latest revision is still the candidate, then
 *   `update-traffic --to-latest`.
 * - **abort** — `update-traffic --to-tags canary=0` mid-rollout; run by hand,
 *   `--to-revisions <stable>=100` to the revision set with `.stable(...)`.
 */
export function cloudRunCanary(
  configure: Configure<CloudRunCanarySettings>,
): CloudRunCanary {
  return new CloudRunCanary(configure);
}
