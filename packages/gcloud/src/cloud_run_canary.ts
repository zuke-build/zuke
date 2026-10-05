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
 * A Cloud Run tag: it becomes part of the tagged revision's URL, so it is held
 * to a DNS label's shape — which also keeps a `,` or `=` from changing what
 * `--to-tags <tag>=<percent>` means.
 */
const TAG_SHAPE = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

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
    const settings = this.#settings();
    const service = serviceOf(settings);
    const image = settings.image_;
    if (image === undefined) {
      throw new Error(
        "cloudRunCanary: no candidate image — add r.image(...), the image " +
          "the canary deploys.",
      );
    }
    await settings.runner_(
      this.#scoped(settings, new GcloudRunServicesUpdateSettings())
        .service(service).image(image).tag(settings.tag_).noTraffic(),
    );
    const candidate = await this.#latestRevision(settings, service);
    await ctx.state.set({ [CANDIDATE]: candidate });
    ctx.reportSummary({ Candidate: candidate });
  }

  /**
   * Send `percent` of the requests to the candidate, through its tag. gcloud
   * spreads the rest over the revisions already serving, in proportion, so a
   * split the service had before the canary keeps its shape.
   */
  async expose(percent: number): Promise<number> {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `cloudRunCanary: Cloud Run splits traffic in whole percents from 0 ` +
          `to 100, so it cannot expose ${percent} %. Use whole-number steps.`,
      );
    }
    const settings = this.#settings();
    await settings.runner_(
      this.#scoped(settings, new GcloudRunUpdateTrafficSettings())
        .service(serviceOf(settings)).toTags(`${settings.tag_}=${percent}`),
    );
    return percent;
  }

  /**
   * Send all traffic to the latest revision — after checking that it is
   * still the candidate this rollout staged, so a revision someone deployed in
   * the meantime is never promoted in its place. Idempotent.
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
    await settings.runner_(
      this.#scoped(settings, new GcloudRunUpdateTrafficSettings())
        .service(service).toLatest(),
    );
  }

  /**
   * Take every request back from the candidate: its tag goes to 0 % and gcloud
   * returns that share to the revisions already serving. It reads no recorded
   * state, so it also works when run by hand; it is idempotent; and after a
   * promote it changes nothing, because the tag's own route is at 0 % once
   * traffic is on the latest revision.
   */
  async abort(): Promise<void> {
    const settings = this.#settings();
    await settings.runner_(
      this.#scoped(settings, new GcloudRunUpdateTrafficSettings())
        .service(serviceOf(settings)).toTags(`${settings.tag_}=0`),
    );
  }

  /** The settings, evaluated now so the lambda sees resolved parameters. */
  #settings(): CloudRunCanarySettings {
    const settings = this.#configure(new CloudRunCanarySettings());
    if (!TAG_SHAPE.test(settings.tag_)) {
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
      await settings.runner_(describe),
      "cloudRunCanary",
      "latest revision",
    );
  }
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
 * - **abort** — `update-traffic --to-tags canary=0`; needs no recorded state.
 */
export function cloudRunCanary(
  configure: Configure<CloudRunCanarySettings>,
): CloudRunCanary {
  return new CloudRunCanary(configure);
}
