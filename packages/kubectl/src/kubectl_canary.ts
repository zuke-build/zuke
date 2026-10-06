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
 * replicas. Each step grows the canary and waits for it before it shrinks the
 * stable Deployment, so a step never drops serving capacity below the total —
 * which needs room in the namespace for the total plus the canary's pods.
 * Promotion and rollback `set image` on the stable Deployment, which rolls out
 * by its own strategy: give it `maxUnavailable: 0` to keep capacity there too.
 *
 * Before it changes anything, `stage` reads single values through kubectl's own
 * `jsonpath` projection: the stable Deployment's image for the container (what
 * a rollback puts back), whether either Deployment is paused, and the canary's
 * replica count, which must be 0. No JSON document is parsed.
 *
 * `stage` also records which Deployments, container and namespace it changed,
 * and `expose`, `promote` and `abort` refuse to act when the lambda now names
 * others: a rollout must be finished or cancelled — by `zuke resume` or
 * `zuke cancel` — with the configuration it started with. The kube context and
 * kubeconfig in `.kubectl(...)` cannot be recorded, so they must not change
 * mid-rollout either: pointed at another cluster, a resume or cancel would act
 * on the Deployments of the same name there.
 *
 * Nothing else may own the two Deployments during a rollout: a
 * HorizontalPodAutoscaler, or a GitOps controller that syncs their replicas or
 * their image, undoes these changes — suspend its sync and self-heal first.
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

/** The state key for the replica total the stable Deployment is restored to. */
const REPLICAS = "kubectlCanaryReplicas";

/** The state key for the stable Deployment's name when staged. */
const STABLE = "kubectlCanaryStable";

/** The state key for the canary Deployment's name when staged. */
const CANARY = "kubectlCanaryCanary";

/** The state key for the container name when staged. */
const CONTAINER = "kubectlCanaryContainer";

/** The state key for the namespace when staged — `null` for none. */
const NAMESPACE = "kubectlCanaryNamespace";

/** The largest replica count kubectl accepts; it holds one in an int32. */
const MAX_REPLICAS = 2147483647;

/** The longest `rollout status` wait accepted: 24 hours, in milliseconds. */
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * A Deployment name: a DNS-1123 subdomain — dot-separated parts that each
 * start and end with a letter or digit. It is interpolated into the single
 * token `deployment/<name>`, so a `/` or a leading `-` must not get through.
 */
const DEPLOYMENT_SHAPE =
  /^(?=.{1,253}$)[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)*$/;

/**
 * A container or namespace name: a DNS label. A container name goes into the
 * `<container>=<image>` token and into a jsonpath filter, so a `=`, `,`, `"`
 * or `*` (kubectl's "every container") must not get through.
 */
const LABEL_SHAPE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * An image reference, loosely: no whitespace or control characters, no `=` or
 * `,` (which would split the `<container>=<image>` token), and no leading `-`.
 */
const IMAGE_SHAPE = /^[^\s\p{Cc}=,-][^\s\p{Cc}=,]*$/u;

/** A Go duration, as `kubectl rollout status --timeout` parses one. */
const DURATION_SHAPE = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/;

/** One `<number><unit>` part of a Go duration. */
const DURATION_PART = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g;

/** Milliseconds per Go duration unit. */
const UNIT_MS: Readonly<Record<string, number>> = {
  ns: 1e-6,
  us: 1e-3,
  "µs": 1e-3,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

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
   * Deployment's size at rest. A whole number from 1 to 2147483647; a step
   * needs enough that it asks for at least half a replica, and at least 2, so
   * it can leave a replica on each side. `stage` records it, so a resumed or
   * rolled-back rollout restores the size it started from.
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
   * ready, as a Go duration from `1ms` to `24h` (default `5m`). kubectl reads
   * 0 as "wait forever", so it is refused.
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
  /** The namespace, or `null` for kubectl's default. */
  readonly namespace: string | null;
}

/**
 * What says which Deployments a rollout changes: the state key `stage` records
 * each under, how it reads in a refusal, and the shape a valid one has.
 */
const IDENTITY: readonly {
  readonly key: string;
  readonly field: "stable" | "canary" | "container" | "namespace";
  readonly label: string;
  readonly shape: RegExp;
}[] = [
  {
    key: STABLE,
    field: "stable",
    label: "the stable Deployment",
    shape: DEPLOYMENT_SHAPE,
  },
  {
    key: CANARY,
    field: "canary",
    label: "the canary Deployment",
    shape: DEPLOYMENT_SHAPE,
  },
  {
    key: CONTAINER,
    field: "container",
    label: "the container",
    shape: LABEL_SHAPE,
  },
  {
    key: NAMESPACE,
    field: "namespace",
    label: "the namespace",
    shape: LABEL_SHAPE,
  },
];

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
   * check that neither Deployment is paused and that the canary has no
   * replicas; then set the candidate image on the canary. With no replicas,
   * nothing runs the candidate yet.
   */
  async stage(ctx: KubectlCanaryContext): Promise<void> {
    // First, before anything can throw: a stage that fails from here on is
    // rolled back with this record, which says nothing has changed yet. With
    // none, the rollback would take the hand-run path and restore stableImage.
    await ctx.state.set({ [STAGE]: "deploying" });
    const r = this.#resolve();
    const image = imageOf(r.settings.image_, "the candidate image");
    if (image === undefined) {
      throw new Error(
        `${CALLER}: no candidate image — add k.image(...), the image the ` +
          "canary Deployment runs.",
      );
    }
    const total = totalOf(r.settings.replicas_);
    const stableImage = await this.#stableImage(r);
    await this.#refusePaused(r, r.stable);
    await this.#refusePaused(r, r.canary);
    await this.#refuseLeftover(r);
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
      [REPLICAS]: total,
      ...Object.fromEntries(IDENTITY.map(({ key, field }) => [key, r[field]])),
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
   * 0 and 100 always leaves at least one replica on each side, and a step that
   * asks for less than half a replica is refused rather than rounded up to a
   * far larger share. The total is the one `stage` recorded, so a resumed
   * process sizes the step the same way, and it refuses when the lambda now
   * names other Deployments than `stage` changed. Returns the share reached,
   * `canary / total × 100`.
   */
  async expose(percent: number, ctx: KubectlCanaryContext): Promise<number> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `${CALLER}: exposure is a percentage from 0 to 100, so it cannot ` +
          `be ${percent}.`,
      );
    }
    const r = this.#resolve();
    const state = ctx.state.get();
    stagedAs(state, r);
    const total = recordedTotal(state, r.settings, r.stable);
    if (percent === 0) {
      await this.#restoreStable(r, total);
      return 0;
    }
    if ((total * percent) / 100 < 0.5) {
      throw new Error(
        `${CALLER}: ${total} replicas at ${percent} % is less than half a ` +
          `replica, so a ${percent} % step needs ` +
          `k.replicas(${Math.ceil(50 / percent)}) or more.`,
      );
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
      // At least half a replica rounds to at least one.
      canary = Math.min(Math.round((total * percent) / 100), total - 1);
    }
    await this.#scale(r, r.canary, canary);
    await this.#waitFor(r, r.canary);
    await this.#scale(r, r.stable, total - canary);
    return (canary / total) * 100;
  }

  /**
   * Set the staged candidate image on the stable Deployment, scale it to the
   * total and wait for it, then empty the canary Deployment — only once the
   * wait succeeded. It promotes the image `stage` recorded — the one
   * analysed — whatever the lambda says now, and refuses when the lambda
   * names other Deployments than `stage` changed. Idempotent.
   */
  async promote(ctx: KubectlCanaryContext): Promise<void> {
    const state = ctx.state.get();
    if (state[STAGE] !== "staged") {
      throw new Error(
        `${CALLER}: no staged candidate is recorded for this rollout, so ` +
          "there is nothing to promote. Promote runs after stage, in the same " +
          "run.",
      );
    }
    const r = this.#resolve();
    stagedAs(state, r);
    const recorded = state[CANDIDATE_IMAGE];
    const staged = typeof recorded === "string"
      ? imageOf(recorded, "the recorded candidate image")
      : undefined;
    if (staged === undefined) throw incomplete("which candidate it staged");
    const total = recordedTotal(state, r.settings, r.stable);
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
   *   the way — the stable Deployment is scaled to the total `stage` recorded
   *   and waited for, and the canary is emptied, even when that wait fails.
   *   What `stage` recorded wins over the lambda's `stableImage` and
   *   `replicas`; a lambda naming other Deployments, container or namespace
   *   than `stage` recorded is refused.
   * - **`stage` failed before the candidate was on record**: the canary had
   *   no replicas and the stable Deployment was not touched, so nothing runs.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): the
   *   same, with the image set by {@link KubectlCanarySettings.stableImage}.
   *   Without one this refuses: after a promote the stable Deployment runs the
   *   candidate, and moving replicas alone would report a rollback that
   *   changed nothing.
   */
  async abort(ctx: KubectlCanaryContext): Promise<void> {
    const state = ctx.state.get();
    if (state[STAGE] === "deploying") return;
    const r = this.#resolve();
    const image = rollbackImage(state, r);
    const total = recordedTotal(state, r.settings, r.stable);
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
    const timeoutMs = durationMs(settings.timeout_);
    if (timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(
        `${CALLER}: the timeout "${settings.timeout_}" must be between 1ms ` +
          "and 24h — kubectl reads 0 as waiting forever.",
      );
    }
    return {
      settings,
      stable,
      canary,
      container,
      namespace: namespace ?? null,
    };
  }

  /** `command` with the namespace and the caller's global flags applied. */
  #scoped<S extends KubectlSettings>(r: Resolved, command: S): S {
    if (r.namespace !== null) command.namespace(r.namespace);
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

  /**
   * One value of `deployment`, through `kubectl get -o jsonpath={<path>}`,
   * trimmed. A truncated capture is refused: capture keeps the newest bytes,
   * so what survives begins mid-value.
   */
  async #read(r: Resolved, deployment: string, path: string): Promise<string> {
    const output = await this.#run(
      r,
      this.#scoped(r, new KubectlGetSettings())
        .resource(`deployment/${deployment}`).output(`jsonpath={${path}}`),
    );
    if (output.truncated) {
      throw new Error(
        `${CALLER}: kubectl printed more than the ` +
          `${output.maxCapturedBytes}-byte capture cap kept reading ${path} ` +
          `of deployment/${deployment}, and capture drops the oldest bytes — ` +
          "raise it with k.kubectl((s) => s.maxCapturedBytes(bytes)).",
      );
    }
    return output.stdout.trim();
  }

  /**
   * Refuse a paused Deployment: it does not roll out a new image, so scaling
   * it up would serve the image it had until the wait timed out.
   */
  async #refusePaused(r: Resolved, deployment: string): Promise<void> {
    const paused = await this.#read(r, deployment, ".spec.paused");
    if (paused !== "" && paused !== "false") {
      throw new Error(
        `${CALLER}: deployment/${deployment} is paused (.spec.paused is ` +
          `"${paused}"), so it would not roll out what the canary sets. ` +
          `Resume it with kubectl rollout resume deployment/${deployment} ` +
          "first.",
      );
    }
  }

  /**
   * Refuse a canary Deployment that still has replicas: it is left from an
   * earlier rollout that did not finish, and the stable Deployment is likely
   * below its total. Scaling it away here would drop serving capacity.
   */
  async #refuseLeftover(r: Resolved): Promise<void> {
    const replicas = await this.#read(r, r.canary, ".spec.replicas");
    if (!/^\d+$/.test(replicas)) {
      throw new Error(
        `${CALLER}: kubectl printed something that is not a replica count: ` +
          `"${replicas}", reading deployment/${r.canary}.`,
      );
    }
    if (Number(replicas) !== 0) {
      throw new Error(
        `${CALLER}: deployment/${r.canary} has ${replicas} replicas, and a ` +
          "canary starts from none — it is left from an earlier rollout. " +
          "Roll that one back with `zuke cancel <run-id>`, or scale the " +
          "canary to 0 by hand once the stable Deployment is back at its " +
          "full size.",
      );
    }
  }

  /** The image the stable Deployment's container runs now. */
  async #stableImage(r: Resolved): Promise<string> {
    const value = await this.#read(
      r,
      r.stable,
      `.spec.template.spec.containers[?(@.name=="${r.container}")].image`,
    );
    const image = imageOf(value, "the stable image");
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
        "must not contain whitespace, control characters, '=' or ',', or " +
        "start with '-'.",
    );
  }
  return reference;
}

/** A replica total, or a friendly error naming the fix. */
function totalOf(total: number | undefined): number {
  if (total === undefined) {
    throw new Error(
      `${CALLER}: no replica count — add k.replicas(n), the replicas the ` +
        "stable Deployment runs at rest.",
    );
  }
  if (!Number.isInteger(total) || total < 1 || total > MAX_REPLICAS) {
    throw new Error(
      `${CALLER}: the replica total ${total} must be a whole number from 1 ` +
        `to ${MAX_REPLICAS}.`,
    );
  }
  return total;
}

/**
 * The image a rollback puts back on the stable Deployment: the one `stage`
 * read off it, or — with no record of a rollout, so run by hand — the one
 * {@link KubectlCanarySettings.stableImage} names, refusing without one.
 */
function rollbackImage(
  state: Readonly<Record<string, unknown>>,
  r: Resolved,
): string {
  if (stagedAs(state, r)) {
    // Written in the same write as the "staged" marker.
    const recorded = state[STABLE_IMAGE];
    const image = typeof recorded === "string"
      ? imageOf(recorded, "the recorded stable image")
      : undefined;
    if (image === undefined) throw incomplete(`what ${r.stable} ran`);
    return image;
  }
  const image = imageOf(r.settings.stableImage_, "k.stableImage(...)");
  if (image === undefined) {
    throw new Error(
      `${CALLER}: this abort has no record of a rollout of ${r.stable} — ` +
        "it was run by hand — so it does not know which image to go back " +
        "to; after a promote the stable Deployment already runs the " +
        "candidate. Add k.stableImage('<image>') to restore it, or use " +
        "`zuke cancel <run-id>` for a rollout that is still running.",
    );
  }
  return image;
}

/**
 * Whether `stage` recorded this rollout. When it did, the Deployments,
 * container and namespace it recorded must be the ones configured now: the
 * call refuses rather than act on Deployments the rollout never touched — or
 * act on a guess, since the kube context cannot be recorded. A record that
 * does not say which ones it changed is refused too.
 */
function stagedAs(
  state: Readonly<Record<string, unknown>>,
  r: Resolved,
): boolean {
  if (state[STAGE] !== "staged") return false;
  const changed: string[] = [];
  for (const { key, field, label, shape } of IDENTITY) {
    const recorded = recordedName(state[key], shape, field === "namespace");
    if (recorded !== r[field]) {
      changed.push(`${label} was ${shown(recorded)}, now ${shown(r[field])}`);
    }
  }
  if (changed.length > 0) {
    const ran = state[STABLE_IMAGE];
    const restore = typeof ran === "string" && IMAGE_SHAPE.test(ran)
      ? `k.stableImage("${ran}")`
      : "k.stableImage(...)";
    throw new Error(
      `${CALLER}: this rollout was staged with other settings than the ones ` +
        `configured now — ${changed.join("; ")}. Nothing was changed: a ` +
        "rollout must be finished or cancelled with the configuration it " +
        "started with, the kube context in k.kubectl(...) included. Set " +
        "these back; if the run has been cancelled meanwhile, roll it back " +
        `by hand with \`zuke rollout.abort\` and ${restore}.`,
    );
  }
  return true;
}

/**
 * A name `stage` recorded, checked against `shape` — `null` only where it may
 * be, for no namespace — or the error for a damaged record.
 */
function recordedName(
  value: unknown,
  shape: RegExp,
  nullable: boolean,
): string | null {
  if (value === null && nullable) return null;
  if (typeof value === "string" && shape.test(value)) return value;
  throw incomplete("which Deployments it changed");
}

/** A name for a refusal: quoted, or `none` for an unset namespace. */
function shown(name: string | null): string {
  return name === null ? "none" : `"${name}"`;
}

/**
 * The total `stage` recorded, else the configured one — validated either
 * way. A staged rollout always recorded one, so a missing or mistyped value
 * there means the record was damaged, and guessing would resize production.
 */
function recordedTotal(
  state: Readonly<Record<string, unknown>>,
  settings: KubectlCanarySettings,
  deployment: string,
): number {
  const recorded = state[REPLICAS];
  if (typeof recorded === "number") return totalOf(recorded);
  if (state[STAGE] === "staged") throw incomplete(`how big ${deployment} was`);
  return totalOf(settings.replicas_);
}

/**
 * The error for a staged rollout whose record does not say `missing` — a
 * value `stage` always writes, so the record was damaged.
 */
function incomplete(missing: string): Error {
  return new Error(
    `${CALLER}: the record of this rollout is incomplete — it is staged ` +
      `but does not say ${missing} — so it cannot go on or roll back ` +
      "safely. Check both Deployments by hand.",
  );
}

/** A Go duration already matching {@link DURATION_SHAPE}, in milliseconds. */
function durationMs(text: string): number {
  let ms = 0;
  for (const [, amount, unit] of text.matchAll(DURATION_PART)) {
    ms += Number(amount) * UNIT_MS[unit];
  }
  return ms;
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
 * - **stage** — reads the stable image, both Deployments' `.spec.paused` and
 *   the canary's `.spec.replicas` (`get -o jsonpath=…`), refusing a paused
 *   Deployment or a canary that is not at 0, then
 *   `set image deployment/<canary> <container>=<image>`.
 * - **expose** — `scale` the canary up, `rollout status` it, then `scale` the
 *   stable Deployment down.
 * - **promote** — `set image` the candidate on the stable Deployment, `scale`
 *   it to the total, `rollout status` it, then `scale` the canary to 0.
 * - **abort** — the same with the stable image: the one `stage` read, or, run
 *   by hand, the one set with `.stableImage(...)`.
 *
 * `stage` records the Deployments, container and namespace it changed, and
 * the later calls refuse a lambda that names others. Keep them — and the kube
 * context or kubeconfig in `.kubectl(...)`, which cannot be recorded —
 * unchanged until the rollout is finished or cancelled.
 */
export function kubectlCanary(
  configure: Configure<KubectlCanarySettings>,
): KubectlCanary {
  return new KubectlCanary(configure);
}
