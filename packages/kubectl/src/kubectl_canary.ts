// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link kubectlCanary} — a pair of Kubernetes Deployments as a platform for a
 * `@zuke/canary` rollout.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { kubectlCanary } from "@zuke/kubectl";
 *
 * rollout = canary((c) =>
 *   c.platform(kubectlCanary((k) =>
 *     k.stable("api").canary("api-canary").container("api")
 *       .image(this.image.value).replicas(10).namespace("prod")
 *   ))
 *     .steps(10, 30, 50)
 *     .bake("10m")
 * );
 * ```
 *
 * The model is the classic replica canary: two Deployments whose pods carry a
 * label one Service selects, so the Service spreads requests over every ready
 * pod of both and the candidate's share of traffic follows its share of
 * replicas. The platform moves replicas between the two — always growing one
 * side and waiting for it before it shrinks the other, so serving capacity
 * never drops below the total.
 *
 * The one value read back from the cluster is the stable Deployment's current
 * image for the container, through kubectl's own `jsonpath` projection — the
 * image a rollback puts back. No JSON document is parsed.
 *
 * The canary engine's platform interface lives in `@zuke/canary`, and a wrapper
 * depends only on `@zuke/core`, so this module does not import it: the object
 * {@link kubectlCanary} returns has the same shape and is accepted by
 * `c.platform(...)` as it is.
 *
 * @module
 */

import type { SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import { KubectlGetSettings } from "./resources.ts";
import type { KubectlSettings } from "./settings.ts";
import {
  KubectlRolloutSettings,
  KubectlScaleSettings,
  KubectlSetImageSettings,
} from "./workloads.ts";

/** The factory name every refusal is prefixed with. */
const CALLER = "kubectlCanary";

/**
 * The state key recording how far `stage` got: `"deploying"` before the first
 * change, `"staged"` once the candidate image is on the canary Deployment and
 * the image to roll back to is on record.
 */
const STAGE = "kubectlCanaryStage";

/** The state key for the image the stable Deployment ran when staged. */
const STABLE_IMAGE = "kubectlCanaryStableImage";

/** The state key for the candidate image staged — the one analysed. */
const CANDIDATE_IMAGE = "kubectlCanaryCandidateImage";

/**
 * A Deployment name: a DNS subdomain. It is interpolated into the single token
 * `deployment/<name>`, so a `/` or a leading `-` must not get through.
 */
const DEPLOYMENT_SHAPE = /^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/;

/**
 * A container or namespace name: a DNS label. A container name goes into the
 * `<container>=<image>` token and into a jsonpath filter, so a `=`, `,`, `"`
 * or `*` (kubectl's "every container") must not get through.
 */
const LABEL_SHAPE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * An image reference, loosely: no whitespace, no `=` or `,` (which would split
 * the `<container>=<image>` token), and no leading `-`.
 */
const IMAGE_SHAPE = /^[^\s=,-][^\s=,]*$/;

/** A Go duration, as `kubectl rollout status --timeout` parses one. */
const DURATION_SHAPE = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/;

/**
 * Runs one prepared `kubectl` command and returns its output. The default runs
 * it; a test or a build that executes kubectl some other way injects its own
 * with {@link KubectlCanarySettings.runner}.
 */
export type KubectlSettingsRunner = (
  settings: KubectlSettings,
) => Promise<CommandOutput>;

/**
 * The part of the canary engine's context the Kubernetes platform uses: the
 * rollout's durable state, where `stage` records what a rollback needs, and
 * the build summary. The engine hands a richer context; this is the narrow
 * view.
 */
export interface KubectlCanaryContext {
  /** The rollout's durable platform state, shared by every call. */
  readonly state: TargetStateHandle;
  /** Add key/value pairs to the calling target's row in the build summary. */
  reportSummary(pairs: SummaryPairs): void;
}

/**
 * How {@link kubectlCanary} reaches the two Deployments, configured through
 * its lambda.
 */
export class KubectlCanarySettings {
  /** The Deployment that serves the current release (set by {@link stable}). */
  stable_?: string;
  /** The Deployment that runs the candidate (set by {@link canary}). */
  canary_?: string;
  /** The container whose image is rolled out (set by {@link container}). */
  container_?: string;
  /** The candidate's container image (set by {@link image}). */
  image_?: string;
  /** The image a hand-run rollback restores (set by {@link stableImage}). */
  stableImage_?: string;
  /** Replicas across both Deployments (set by {@link replicas}). */
  replicas_?: number;
  /** The namespace of both Deployments (set by {@link namespace}). */
  namespace_?: string;
  /** How long each `rollout status` waits (set by {@link timeout}). */
  timeout_ = "5m";
  /** Global kubectl flags for every command (set by {@link kubectl}). */
  kubectl_?: Configure<KubectlSettings>;
  /** How each command is run (set by {@link runner}). */
  runner_: KubectlSettingsRunner = (settings) => settings.run();

  /**
   * The Deployment serving the current release. It must already exist, and
   * its pods and the canary's must be selected by the same Service.
   */
  stable(deployment: string): this {
    this.stable_ = deployment;
    return this;
  }

  /**
   * The Deployment the candidate runs in — a second Deployment with the same
   * pod labels the Service selects (plus one of its own, so its selector does
   * not match the stable pods). It must already exist; at rest it has 0
   * replicas.
   */
  canary(deployment: string): this {
    this.canary_ = deployment;
    return this;
  }

  /** The container, in both Deployments, whose image is rolled out. */
  container(name: string): this {
    this.container_ = name;
    return this;
  }

  /**
   * The candidate's container image, set on the canary Deployment by `stage`.
   * Prefer a digest (`repo@sha256:…`) — a mutable tag can point at something
   * else by the time `promote` sets it on the stable Deployment.
   */
  image(reference: string): this {
    this.image_ = reference;
    return this;
  }

  /**
   * The image a `rollout.abort` run by hand puts back on the stable
   * Deployment. Such a run is fresh, with no record of a rollout, and the
   * release it undoes has usually been promoted — so the stable Deployment
   * already runs the candidate, and moving replicas alone would change
   * nothing. A rollback the engine runs mid-rollout does not use it: that one
   * restores the image `stage` read off the stable Deployment.
   */
  stableImage(reference: string): this {
    this.stableImage_ = reference;
    return this;
  }

  /**
   * The replicas the two Deployments run between them — the stable
   * Deployment's size at rest. A whole number of at least 1; a canary with
   * steps needs at least 2, so a step can leave a replica on each side.
   */
  replicas(total: number): this {
    this.replicas_ = total;
    return this;
  }

  /** The namespace both Deployments live in (`--namespace`). */
  namespace(name: string): this {
    this.namespace_ = name;
    return this;
  }

  /**
   * How long each `kubectl rollout status` waits for a Deployment to become
   * ready, as a Go duration (default `5m`).
   */
  timeout(duration: string): this {
    this.timeout_ = duration;
    return this;
  }

  /**
   * Global flags for every kubectl command the platform runs —
   * `(s) => s.context("prod").kubeconfig("~/.kube/prod")`, or a
   * `.toolPath(...)` to a specific kubectl.
   */
  kubectl(configure: Configure<KubectlSettings>): this {
    this.kubectl_ = configure;
    return this;
  }

  /**
   * Replace how each prepared command is run. The default runs it; this is
   * for a test, or for a build that executes kubectl through something else.
   */
  runner(run: KubectlSettingsRunner): this {
    this.runner_ = run;
    return this;
  }
}

/** The settings once the two Deployments are known to be named and valid. */
interface Resolved {
  readonly settings: KubectlCanarySettings;
  readonly stable: string;
  readonly canary: string;
  readonly container: string;
}

/**
 * Two Kubernetes Deployments behind one Service as a canary platform. Create
 * one with {@link kubectlCanary}; hand it to `@zuke/canary`'s
 * `c.platform(...)`.
 *
 * Exposure is a share of replicas, so it is quantised: `expose` returns the
 * share it actually reached.
 */
export class KubectlCanary {
  /** Traffic follows ready pods, so exposure is a share of replicas. */
  readonly exposure: "replicas" = "replicas";
  readonly #configure: Configure<KubectlCanarySettings>;

  /** A platform whose settings `configure` produces, afresh on every call. */
  constructor(configure: Configure<KubectlCanarySettings>) {
    this.#configure = configure;
  }

  /** `"Kubernetes deployment api (canary api-canary)"`, for the summary. */
  describe(): string {
    const { stable_, canary_ } = this.#configure(new KubectlCanarySettings());
    if (stable_ === undefined) return "Kubernetes deployment";
    return canary_ === undefined
      ? `Kubernetes deployment ${stable_}`
      : `Kubernetes deployment ${stable_} (canary ${canary_})`;
  }

  /**
   * Read the image the stable Deployment runs, so a rollback can put it back;
   * then empty the canary Deployment and set the candidate image on it. With
   * no replicas, nothing runs the candidate yet.
   */
  async stage(ctx: KubectlCanaryContext): Promise<void> {
    const r = this.#resolve();
    const image = imageOf(r.settings.image_, "the candidate image");
    if (image === undefined) {
      throw new Error(
        `${CALLER}: no candidate image — add k.image(...), the image the ` +
          "canary Deployment runs.",
      );
    }
    await ctx.state.set({ [STAGE]: "deploying" });
    const stableImage = await this.#stableImage(r);
    await this.#scale(r, r.canary, 0);
    await this.#run(
      r,
      this.#scoped(r, new KubectlSetImageSettings())
        .resource(`deployment/${r.canary}`).image(r.container, image),
    );
    // A rollback reads this to know what to restore, so it must be on record
    // before any replica of the candidate can take traffic.
    const recorded = await ctx.state.trySet({
      [STAGE]: "staged",
      [STABLE_IMAGE]: stableImage,
      [CANDIDATE_IMAGE]: image,
    });
    if (!recorded) {
      throw new Error(
        `${CALLER}: could not record the staged candidate, so a rollback ` +
          "could not restore the stable image. Stopping before the canary " +
          "runs any replica.",
      );
    }
    ctx.reportSummary({ Candidate: image, Stable: stableImage });
  }

  /**
   * Move replicas so the canary Deployment holds about `percent` of the total.
   * The canary grows first and is waited for with `rollout status`; only then
   * does the stable Deployment shrink, so capacity never dips. A step between
   * 0 and 100 always leaves at least one replica on each side. Returns the
   * share reached, `canary / total × 100`.
   */
  async expose(percent: number): Promise<number> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `${CALLER}: exposure is a percentage from 0 to 100, so it cannot ` +
          `be ${percent}.`,
      );
    }
    const r = this.#resolve();
    const total = totalOf(r.settings);
    if (percent === 0) {
      await this.#restoreStable(r, total);
      return 0;
    }
    let canary = total;
    if (percent < 100) {
      if (total < 2) {
        throw new Error(
          `${CALLER}: ${total} replica cannot be split between the stable ` +
            `and canary Deployments, so it cannot expose ${percent} %. Raise ` +
            "k.replicas(...) to at least 2.",
        );
      }
      const rounded = Math.round((total * percent) / 100);
      canary = Math.min(Math.max(rounded, 1), total - 1);
    }
    await this.#scale(r, r.canary, canary);
    await this.#waitFor(r, r.canary);
    await this.#scale(r, r.stable, total - canary);
    return (canary / total) * 100;
  }

  /**
   * Set the staged candidate image on the stable Deployment, scale it to the
   * total and wait for it, then empty the canary Deployment — only once the
   * wait succeeded. It promotes the
   * image `stage` recorded — the one analysed — whatever the lambda says now.
   * Idempotent.
   */
  async promote(ctx: KubectlCanaryContext): Promise<void> {
    const staged = ctx.state.get()[CANDIDATE_IMAGE];
    if (typeof staged !== "string") {
      throw new Error(
        `${CALLER}: no staged candidate is recorded for this rollout, so ` +
          "there is nothing to promote. Promote runs after stage, in the same " +
          "run.",
      );
    }
    const r = this.#resolve();
    const total = totalOf(r.settings);
    await this.#setStableImage(r, staged);
    await this.#scale(r, r.stable, total);
    // Unlike a rollback, the canary keeps serving until the stable Deployment
    // is ready: emptying it after a failed wait would only take capacity away
    // from the release this promotion is installing.
    await this.#waitFor(r, r.stable);
    await this.#scale(r, r.canary, 0);
  }

  /**
   * Return every replica to the stable Deployment, running the stable image.
   * Idempotent. What it does depends on what this rollout recorded:
   *
   * - **Staged** (a rollback mid-rollout): the image `stage` read off the
   *   stable Deployment goes back on it — a no-op unless a promote got part of
   *   the way — the stable Deployment is scaled to the total and waited for,
   *   and the canary is emptied, even when that wait fails.
   * - **`stage` failed before the candidate was on record**: the canary had
   *   no replicas and the stable Deployment was not touched, so nothing runs.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): the
   *   same, with the image set by {@link KubectlCanarySettings.stableImage}.
   *   Without one this refuses: after a promote the stable Deployment runs the
   *   candidate, and moving replicas alone would report a rollback that
   *   changed nothing.
   */
  async abort(ctx: KubectlCanaryContext): Promise<void> {
    const r = this.#resolve();
    const state = ctx.state.get();
    if (state[STAGE] === "deploying") return;
    // Written in the same write as the "staged" marker, so present exactly
    // when the rollout got that far.
    const recorded = state[STABLE_IMAGE];
    const image = typeof recorded === "string"
      ? recorded
      : imageOf(r.settings.stableImage_, "k.stableImage(...)");
    if (image === undefined) {
      throw new Error(
        `${CALLER}: this abort has no record of a rollout of ${r.stable} — ` +
          "it was run by hand — so it does not know which image to go back " +
          "to; after a promote the stable Deployment already runs the " +
          "candidate. Add k.stableImage('<image>') to restore it, or use " +
          "`zuke cancel <run-id>` for a rollout that is still running.",
      );
    }
    const total = totalOf(r.settings);
    await this.#setStableImage(r, image);
    await this.#restoreStable(r, total);
  }

  /** The settings, evaluated now so the lambda sees resolved parameters. */
  #resolve(): Resolved {
    const settings = this.#configure(new KubectlCanarySettings());
    const stable = named(settings.stable_, "k.stable('api')", "stable");
    const canary = named(settings.canary_, "k.canary('api-canary')", "canary");
    if (!DEPLOYMENT_SHAPE.test(stable) || !DEPLOYMENT_SHAPE.test(canary)) {
      throw new Error(
        `${CALLER}: "${stable}" and "${canary}" must both be Deployment ` +
          "names — lowercase letters, digits, '-' and '.', starting and " +
          "ending with a letter or digit.",
      );
    }
    if (stable === canary) {
      throw new Error(
        `${CALLER}: the stable and canary Deployments are both "${stable}". ` +
          "A canary needs a second Deployment beside the stable one.",
      );
    }
    const container = named(
      settings.container_,
      "k.container('api')",
      "container",
    );
    if (!LABEL_SHAPE.test(container)) {
      throw new Error(
        `${CALLER}: "${container}" is not a container name — lowercase ` +
          "letters, digits and '-', starting and ending with a letter or digit.",
      );
    }
    const namespace = settings.namespace_;
    if (namespace !== undefined && !LABEL_SHAPE.test(namespace)) {
      throw new Error(
        `${CALLER}: "${namespace}" is not a namespace name — lowercase ` +
          "letters, digits and '-', starting and ending with a letter or digit.",
      );
    }
    if (!DURATION_SHAPE.test(settings.timeout_)) {
      throw new Error(
        `${CALLER}: the timeout "${settings.timeout_}" is not a duration ` +
          "kubectl reads — use one like 90s, 5m or 1h30m.",
      );
    }
    return { settings, stable, canary, container };
  }

  /** `command` with the namespace and the caller's global flags applied. */
  #scoped<S extends KubectlSettings>(r: Resolved, command: S): S {
    if (r.settings.namespace_ !== undefined) {
      command.namespace(r.settings.namespace_);
    }
    r.settings.kubectl_?.(command);
    return command;
  }

  /** Run `command`, refusing a non-zero exit even when told not to throw. */
  async #run(r: Resolved, command: KubectlSettings): Promise<CommandOutput> {
    const output = await r.settings.runner_(command);
    if (output.code !== 0) {
      throw new Error(
        `${CALLER}: kubectl exited ${output.code} running ` +
          `${command.argv().join(" ")}` +
          (output.stderr.trim() === "" ? "." : `: ${output.stderr.trim()}`),
      );
    }
    return output;
  }

  /** `kubectl scale deployment/<name> --replicas=<count>`. */
  async #scale(r: Resolved, deployment: string, count: number): Promise<void> {
    await this.#run(
      r,
      this.#scoped(r, new KubectlScaleSettings())
        .resource(`deployment/${deployment}`).replicas(count),
    );
  }

  /** `kubectl rollout status deployment/<name> --timeout=<timeout>`. */
  async #waitFor(r: Resolved, deployment: string): Promise<void> {
    await this.#run(
      r,
      this.#scoped(r, new KubectlRolloutSettings()).status()
        .resource(`deployment/${deployment}`).timeout(r.settings.timeout_),
    );
  }

  /** `kubectl set image deployment/<stable> <container>=<image>`. */
  async #setStableImage(r: Resolved, image: string): Promise<void> {
    await this.#run(
      r,
      this.#scoped(r, new KubectlSetImageSettings())
        .resource(`deployment/${r.stable}`).image(r.container, image),
    );
  }

  /**
   * Scale the stable Deployment to the total and wait for it, then empty the
   * canary — even when the wait fails, since a rollback that leaves the
   * candidate serving is not one. The wait's failure still fails the call.
   */
  async #restoreStable(r: Resolved, total: number): Promise<void> {
    await this.#scale(r, r.stable, total);
    try {
      await this.#waitFor(r, r.stable);
    } finally {
      await this.#scale(r, r.canary, 0);
    }
  }

  /** The image the stable Deployment's container runs now. */
  async #stableImage(r: Resolved): Promise<string> {
    const output = await this.#run(
      r,
      this.#scoped(r, new KubectlGetSettings())
        .resource(`deployment/${r.stable}`)
        .output(
          `jsonpath={.spec.template.spec.containers[?(@.name=="${r.container}")].image}`,
        ),
    );
    if (output.truncated) {
      throw new Error(
        `${CALLER}: kubectl produced more output than the capture cap kept, ` +
          `so the image of ${r.stable} cannot be trusted.`,
      );
    }
    const image = imageOf(output.stdout.trim(), "the stable image");
    if (image === undefined) {
      throw new Error(
        `${CALLER}: deployment/${r.stable} has no container named ` +
          `"${r.container}" — check k.container(...).`,
      );
    }
    return image;
  }
}

/** A required name, or a friendly error naming the setting to add. */
function named(
  value: string | undefined,
  fix: string,
  what: string,
): string {
  if (value === undefined) {
    throw new Error(`${CALLER}: no ${what} named — add ${fix}.`);
  }
  return value;
}

/**
 * `reference` when it is a usable image; `undefined` when it is absent or
 * empty; an error naming `what` when it could change the meaning of the
 * `<container>=<image>` token.
 */
function imageOf(
  reference: string | undefined,
  what: string,
): string | undefined {
  if (reference === undefined || reference === "") return undefined;
  if (!IMAGE_SHAPE.test(reference)) {
    throw new Error(
      `${CALLER}: "${reference}" (${what}) is not an image reference — it ` +
        "must not contain whitespace, '=' or ',', or start with '-'.",
    );
  }
  return reference;
}

/** The configured total replicas, or a friendly error naming the fix. */
function totalOf(settings: KubectlCanarySettings): number {
  const total = settings.replicas_;
  if (total === undefined) {
    throw new Error(
      `${CALLER}: no replica count — add k.replicas(n), the replicas the ` +
        "stable Deployment runs at rest.",
    );
  }
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(
      `${CALLER}: k.replicas(${total}) must be a whole number of at least 1.`,
    );
  }
  return total;
}

/**
 * Two Kubernetes Deployments behind one Service as a canary platform, for
 * `@zuke/canary`:
 *
 * ```ts
 * c.platform(kubectlCanary((k) =>
 *   k.stable("api").canary("api-canary").container("api")
 *     .image(this.image.value).replicas(10).namespace("prod")
 *     .kubectl((s) => s.context("prod"))
 * ))
 * ```
 *
 * The lambda runs on every call, so it may read resolved parameters.
 *
 * - **stage** — reads the stable image (`get -o jsonpath=…`), then
 *   `scale deployment/<canary> --replicas=0` and
 *   `set image deployment/<canary> <container>=<image>`.
 * - **expose** — `scale` the canary up, `rollout status` it, then `scale` the
 *   stable Deployment down.
 * - **promote** — `set image` the candidate on the stable Deployment, `scale`
 *   it to the total, `rollout status` it, then `scale` the canary to 0.
 * - **abort** — the same with the stable image: the one `stage` read, or, run
 *   by hand, the one set with `.stableImage(...)`.
 */
export function kubectlCanary(
  configure: Configure<KubectlCanarySettings>,
): KubectlCanary {
  return new KubectlCanary(configure);
}
