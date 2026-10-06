// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link helmCanary} — a pair of Helm releases as a platform for a
 * `@zuke/canary` rollout.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { helmCanary } from "@zuke/helm";
 *
 * rollout = canary((c) =>
 *   c.platform(helmCanary((h) =>
 *     h.chart("./charts/api").stableRelease("api").namespace("prod")
 *       .image(this.tag.value).replicas(10)
 *   ))
 *     .steps(10, 50)
 *     .bake("10m")
 * );
 * ```
 *
 * The candidate runs as a **second release** of the same chart (the canary
 * release, `<stable>-canary` unless named), and exposure is the share of
 * replicas it holds: each step scales the canary release up and the stable
 * release down through `helm upgrade --reuse-values`. Requests split by
 * replicas only when the stable release's Service also selects the canary
 * release's pods — a property of the chart this module cannot check.
 *
 * A rollback never re-derives the old state: `stage` reads the stable
 * release's current revision (through helm's own `--template` projection, the
 * one value read back) and a rollback is `helm rollback` to exactly that
 * revision, so it restores the stable image, values and replica count even
 * after a promotion that failed half-way.
 *
 * The canary engine's platform interface lives in `@zuke/canary`, and a wrapper
 * depends only on `@zuke/core`, so this module does not import it: the object
 * {@link helmCanary} returns has the same shape and is accepted by
 * `c.platform(...)` as it is.
 *
 * @module
 */

import type { SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { CommandOutput } from "@zuke/core/shell";
import type { Configure, PathLike } from "@zuke/core/tooling";
import {
  HelmGetAllSettings,
  HelmRollbackSettings,
  type HelmSettings,
  HelmUninstallSettings,
  HelmUpgradeSettings,
} from "./helm.ts";

/** The state key recording how far `stage` got. */
const STAGE = "helmStage";

/** The state key the stable release's pre-rollout revision is recorded under. */
const STABLE_REVISION = "helmStableRevision";

/** The `helm get all` template that prints only the current revision. */
const REVISION_TEMPLATE = "{{.Release.Version}}";

/**
 * A Helm release name: a DNS subdomain of at most 53 characters, as helm
 * itself requires. It is a positional argument, so this also keeps a leading
 * `-` from being read as a flag.
 */
const RELEASE_SHAPE =
  /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)*$/;

/** The longest release name helm accepts. */
const RELEASE_MAX = 53;

/**
 * A values path such as `image.tag` or `replicaCount`: dotted plain segments,
 * with no `=`, `,`, `[`, `\` or quote that `--set` would read as syntax.
 */
const KEY_SHAPE =
  /^[A-Za-z0-9_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;

/**
 * An image reference or tag: the characters an OCI reference uses, so a `,`
 * (which `--set-string` splits on), a `\`, a `{` or a `=` cannot reach the
 * value parser.
 */
const IMAGE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;

/**
 * Runs one prepared `helm` command and returns its output. The default runs
 * it; a test or a build that executes helm some other way injects its own
 * with {@link HelmCanarySettings.runner}.
 */
export type HelmSettingsRunner = (
  settings: HelmSettings,
) => Promise<CommandOutput>;

/**
 * The part of the canary engine's context the Helm platform uses: the
 * rollout's durable state, where the stable release's revision is recorded,
 * and the build summary. The engine hands a richer context; this is the
 * narrow view.
 */
export interface HelmCanaryContext {
  /** The rollout's durable platform state, shared by every call. */
  readonly state: TargetStateHandle;
  /** Add key/value pairs to the calling target's row in the build summary. */
  reportSummary(pairs: SummaryPairs): void;
}

/** How {@link helmCanary} reaches the releases, configured through its lambda. */
export class HelmCanarySettings {
  /** The chart both releases are rendered from (set by {@link chart}). */
  chart_?: string;
  /** The chart version (set by {@link version}). */
  version_?: string;
  /** The release serving today (set by {@link stableRelease}). */
  stableRelease_?: string;
  /** The release the candidate runs as (set by {@link canaryRelease}). */
  canaryRelease_?: string;
  /** The namespace both releases live in (set by {@link namespace}). */
  namespace_?: string;
  /** The candidate's image value (set by {@link image}). */
  image_?: string;
  /** The values path the image is set on (set by {@link imageKey}). */
  imageKey_ = "image.tag";
  /** The values path the replica count is set on (set by {@link replicasKey}). */
  replicasKey_ = "replicaCount";
  /** The total replica count across both releases (set by {@link replicas}). */
  replicas_?: number;
  /** Values files for the canary release and the promotion (set by {@link values}). */
  values_: string[] = [];
  /** How long each waiting command may take (set by {@link timeout}). */
  timeout_?: string;
  /** The revision a hand-run rollback returns to (set by {@link stableRevision}). */
  stableRevision_?: number;
  /** Global helm flags for every command (set by {@link helm}). */
  helm_?: Configure<HelmSettings>;
  /** How each command is run (set by {@link runner}). */
  runner_: HelmSettingsRunner = (settings) => settings.run();

  /**
   * The chart both releases are rendered from — a path, `repo/name` or an
   * `oci://` reference. Every upgrade renders it, the stable release's
   * replica moves included, so pin a repository chart with {@link version}.
   */
  chart(ref: string): this {
    this.chart_ = ref;
    return this;
  }

  /** The chart version every upgrade uses (`--version`). */
  version(value: string): this {
    this.version_ = value;
    return this;
  }

  /** The release serving today. It must already exist; the canary amends it. */
  stableRelease(name: string): this {
    this.stableRelease_ = name;
    return this;
  }

  /** The release the candidate runs as (default `<stable>-canary`). */
  canaryRelease(name: string): this {
    this.canaryRelease_ = name;
    return this;
  }

  /** The namespace both releases live in (`--namespace`). */
  namespace(name: string): this {
    this.namespace_ = name;
    return this;
  }

  /**
   * The candidate's image, as the chart reads it at {@link imageKey}. With
   * the default key, `image.tag`, that is the tag alone (`1.4.2`), as the
   * chart `helm create` scaffolds expects; point {@link imageKey} at a key
   * that takes a full reference to pass one. Set with `--set-string`, so a
   * tag like `1.10` is not turned into a number.
   */
  image(value: string): this {
    this.image_ = value;
    return this;
  }

  /** The values path the image is set on (default `image.tag`). */
  imageKey(path: string): this {
    this.imageKey_ = path;
    return this;
  }

  /**
   * The values path the replica count is set on (default `replicaCount`, as
   * `helm create` scaffolds). The chart must honour it — an enabled
   * autoscaler that ignores it makes the exposure meaningless.
   */
  replicasKey(path: string): this {
    this.replicasKey_ = path;
    return this;
  }

  /**
   * The total replica count, split between the two releases while the
   * canary runs and given back to the stable release when it ends.
   */
  replicas(total: number): this {
    this.replicas_ = total;
    return this;
  }

  /**
   * Values files (`--values`) the canary release is installed with, and that
   * the promotion merges into the stable release's reused values.
   */
  values(...files: PathLike[]): this {
    this.values_.push(...files.map(String));
    return this;
  }

  /** How long each command that waits may take, e.g. `10m` (`--timeout`). */
  timeout(duration: string): this {
    this.timeout_ = duration;
    return this;
  }

  /**
   * The stable release's revision to roll back to when `rollout.abort` is run
   * by hand — the one `helm history <stable>` lists from before the rollout.
   * Such a run is fresh, with no record of a rollout, so it has nothing else
   * to go on. A rollback the engine runs mid-rollout does not use it: that one
   * returns to the revision `stage` recorded.
   */
  stableRevision(revision: number): this {
    this.stableRevision_ = revision;
    return this;
  }

  /**
   * Global flags for every helm command the platform runs —
   * `(s) => s.kubeContext("prod").kubeconfig("~/.kube/prod")`, or a
   * `.toolPath(...)` to a specific helm.
   */
  helm(configure: Configure<HelmSettings>): this {
    this.helm_ = configure;
    return this;
  }

  /**
   * Replace how each prepared command is run. The default runs it; this is
   * for a test, or for a build that executes helm through something else.
   */
  runner(run: HelmSettingsRunner): this {
    this.runner_ = run;
    return this;
  }
}

/** The settings once the names every call needs are checked. */
interface Resolved {
  readonly settings: HelmCanarySettings;
  readonly stable: string;
  readonly canary: string;
}

/**
 * Two Helm releases of one chart as a canary platform. Create one with
 * {@link helmCanary}; hand it to `@zuke/canary`'s `c.platform(...)`.
 *
 * Exposure is the canary release's share of the replicas, so it is quantised.
 */
export class HelmCanary {
  /** Exposure is a share of replicas, quantised to whole pods. */
  readonly exposure: "replicas" = "replicas";
  readonly #configure: Configure<HelmCanarySettings>;

  /** A platform whose settings `configure` produces, afresh on every call. */
  constructor(configure: Configure<HelmCanarySettings>) {
    this.#configure = configure;
  }

  /** `"Helm release api in prod"`, for the build summary. */
  describe(): string {
    const settings = this.#configure(new HelmCanarySettings());
    const release = settings.stableRelease_;
    const name = release === undefined
      ? "Helm release"
      : `Helm release ${release}`;
    return settings.namespace_ === undefined
      ? name
      : `${name} in ${settings.namespace_}`;
  }

  /**
   * Record the stable release's current revision, then install the candidate
   * as the canary release with no replicas: `upgrade --install <canary>
   * <chart> --set-string <imageKey>=<image> --set <replicasKey>=0 --wait`.
   */
  async stage(ctx: HelmCanaryContext): Promise<void> {
    const { settings, stable, canary } = this.#resolve();
    const chart = chartOf(settings);
    const image = imageOf(settings);
    // Nothing is changed until the canary upgrade, so a stage that fails on
    // the read leaves a rollback nothing to do — unless an earlier attempt of
    // this stage, cut short, already got further: then its canary release may
    // exist, and forgetting that would leave it behind.
    if (ctx.state.get()[STAGE] === undefined) {
      await ctx.state.set({ [STAGE]: "reading" });
    }
    const revision = await this.#currentRevision(settings, stable);
    await ctx.state.set({ [STAGE]: "deploying", [STABLE_REVISION]: revision });
    const install = this.#upgrade(settings, canary, chart).install()
      .setString(settings.imageKey_, image).set(settings.replicasKey_, "0");
    for (const file of settings.values_) install.values(file);
    await settings.runner_(install);
    // A rollback reads this to know the stable release may have moved, so it
    // must be on record before any exposure can happen.
    if (!await ctx.state.trySet({ [STAGE]: "staged" })) {
      throw new Error(
        "helmCanary: could not record that the canary release is staged, so " +
          "a rollback could not find it. Stopping before it takes any traffic.",
      );
    }
    ctx.reportSummary({ "Stable revision": revision });
  }

  /**
   * Give the canary release `percent` of the replicas — rounded, and at
   * least one for any share above 0 — scaling it up first and the stable
   * release down second, so capacity never dips. Returns the share achieved.
   */
  async expose(percent: number): Promise<number> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `helmCanary: an exposure is a share from 0 to 100, so ${percent} ` +
          "is not one.",
      );
    }
    const { settings, stable, canary } = this.#resolve();
    const chart = chartOf(settings);
    const total = totalOf(settings);
    const rounded = Math.round(total * percent / 100);
    const share = percent > 0 && rounded === 0 ? 1 : rounded;
    await settings.runner_(
      this.#upgrade(settings, canary, chart).reuseValues()
        .set(settings.replicasKey_, String(share)),
    );
    await settings.runner_(
      this.#upgrade(settings, stable, chart, false).reuseValues()
        .set(settings.replicasKey_, String(total - share)),
    );
    return Math.round(share * 10000 / total) / 100;
  }

  /**
   * Upgrade the stable release to the candidate image at the full replica
   * count, waiting for it, then uninstall the canary release. Idempotent.
   */
  async promote(): Promise<void> {
    const { settings, stable, canary } = this.#resolve();
    const chart = chartOf(settings);
    const image = imageOf(settings);
    const total = totalOf(settings);
    const upgrade = this.#upgrade(settings, stable, chart).reuseValues()
      .setString(settings.imageKey_, image)
      .set(settings.replicasKey_, String(total));
    for (const file of settings.values_) upgrade.values(file);
    await settings.runner_(upgrade);
    await settings.runner_(this.#uninstall(settings, canary));
  }

  /**
   * Return the stable release to where it was and remove the canary release.
   * Idempotent. What it does depends on what this rollout recorded:
   *
   * - **Staged** (a rollback mid-rollout, or after a promotion that failed):
   *   `helm rollback <stable> <revision> --wait` to the revision `stage`
   *   recorded, then `helm uninstall <canary> --ignore-not-found`.
   * - **The canary install was under way**: the stable release was never
   *   touched, so only the canary release is uninstalled.
   * - **Stage failed reading the revision**: nothing changed; nothing runs.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): the
   *   rollback goes to {@link HelmCanarySettings.stableRevision}. Without one
   *   this refuses, since claiming a rollback it cannot do would be worse.
   */
  async abort(ctx: HelmCanaryContext): Promise<void> {
    const { settings, stable, canary } = this.#resolve();
    const recorded = ctx.state.get();
    const stage = recorded[STAGE];
    if (stage === "reading") return;
    if (stage === "deploying") {
      await settings.runner_(this.#uninstall(settings, canary));
      return;
    }
    const revision = stage === "staged"
      ? recorded[STABLE_REVISION]
      : settings.stableRevision_;
    if (revision === undefined) {
      throw new Error(
        `helmCanary: this abort has no record of a rollout of ${stable} — it ` +
          "was run by hand — so it does not know which revision to go back " +
          "to. Add h.stableRevision(<n>), the revision `helm history " +
          `${stable}\` lists from before the rollout, or use ` +
          "`zuke cancel <run-id>` for a rollout that is still running.",
      );
    }
    if (typeof revision !== "number" || !isRevision(revision)) {
      throw new Error(
        `helmCanary: ${JSON.stringify(revision)} is not a Helm revision — ` +
          "a whole number from 1 up.",
      );
    }
    const rollback = this.#scoped(settings, new HelmRollbackSettings())
      .release(stable).revision(revision).wait();
    if (settings.timeout_ !== undefined) rollback.timeout(settings.timeout_);
    await settings.runner_(rollback);
    await settings.runner_(this.#uninstall(settings, canary));
  }

  /** The settings, evaluated now so the lambda sees resolved parameters. */
  #resolve(): Resolved {
    const settings = this.#configure(new HelmCanarySettings());
    const stable = settings.stableRelease_;
    if (stable === undefined) {
      throw new Error(
        "helmCanary: no stable release named — add h.stableRelease('api'). " +
          "The release must already exist; the canary amends it.",
      );
    }
    const canary = settings.canaryRelease_ ?? `${stable}-canary`;
    for (const release of [stable, canary]) {
      if (release.length > RELEASE_MAX || !RELEASE_SHAPE.test(release)) {
        throw new Error(
          `helmCanary: "${release}" is not a Helm release name — lowercase ` +
            `letters, digits, "-" and ".", at most ${RELEASE_MAX} characters.`,
        );
      }
    }
    if (stable === canary) {
      throw new Error(
        `helmCanary: the canary release cannot be the stable release ` +
          `"${stable}" — name a second release with h.canaryRelease(...).`,
      );
    }
    for (
      const [setter, key] of [
        ["imageKey", settings.imageKey_],
        ["replicasKey", settings.replicasKey_],
      ]
    ) {
      if (!KEY_SHAPE.test(key)) {
        throw new Error(
          `helmCanary: "${key}" is not a values path this platform sets — ` +
            `use dotted plain names like image.tag in h.${setter}(...).`,
        );
      }
    }
    for (const file of settings.values_) {
      if (file.includes(",") || file === "") {
        throw new Error(
          `helmCanary: the values file "${file}" cannot be passed to helm — ` +
            "--values splits on commas. Rename or move the file.",
        );
      }
    }
    return { settings, stable, canary };
  }

  /** `command` with the namespace and the caller's global flags applied. */
  #scoped<S extends HelmSettings>(settings: HelmCanarySettings, command: S): S {
    if (settings.namespace_ !== undefined) {
      command.namespace(settings.namespace_);
    }
    settings.helm_?.(command);
    return command;
  }

  /** `helm upgrade <release> <chart>`, scoped, waiting unless told not to. */
  #upgrade(
    settings: HelmCanarySettings,
    release: string,
    chart: string,
    wait = true,
  ): HelmUpgradeSettings {
    const upgrade = this.#scoped(settings, new HelmUpgradeSettings())
      .release(release).chart(chart);
    if (settings.version_ !== undefined) upgrade.version(settings.version_);
    if (wait) {
      upgrade.wait();
      if (settings.timeout_ !== undefined) upgrade.timeout(settings.timeout_);
    }
    return upgrade;
  }

  /** `helm uninstall <canary> --ignore-not-found`, scoped. */
  #uninstall(
    settings: HelmCanarySettings,
    canary: string,
  ): HelmUninstallSettings {
    return this.#scoped(settings, new HelmUninstallSettings())
      .release(canary).ignoreNotFound();
  }

  /** The stable release's current revision, through helm's own template. */
  async #currentRevision(
    settings: HelmCanarySettings,
    stable: string,
  ): Promise<number> {
    const output = await settings.runner_(
      this.#scoped(settings, new HelmGetAllSettings()).release(stable)
        .template(REVISION_TEMPLATE),
    );
    const text = output.stdout.trim();
    const revision = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
    if (output.truncated || !isRevision(revision)) {
      throw new Error(
        `helmCanary: reading the current revision of ${stable} printed ` +
          `${JSON.stringify(text)}, not a revision number, so a rollback ` +
          "would have nothing to return to. Check that the release exists " +
          "with `helm status`.",
      );
    }
    return revision;
  }
}

/** Whether `value` is a revision helm could have: a whole number from 1. */
function isRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/** The configured chart, or a friendly error naming the fix. */
function chartOf(settings: HelmCanarySettings): string {
  const chart = settings.chart_;
  if (chart === undefined || chart === "" || chart.startsWith("-")) {
    throw new Error(
      "helmCanary: no usable chart — add h.chart('./charts/api'), the chart " +
        "both releases are rendered from.",
    );
  }
  return chart;
}

/** The configured candidate image, checked against `--set-string` syntax. */
function imageOf(settings: HelmCanarySettings): string {
  const image = settings.image_;
  if (image === undefined) {
    throw new Error(
      "helmCanary: no candidate image — add h.image(...), the value set at " +
        `${settings.imageKey_}.`,
    );
  }
  if (!IMAGE_SHAPE.test(image)) {
    throw new Error(
      `helmCanary: "${image}" is not an image reference or tag — letters, ` +
        'digits and ". _ / : @ -" only, starting with a letter or digit.',
    );
  }
  if (/(^|\.)tag$/.test(settings.imageKey_) && /[/:@]/.test(image)) {
    throw new Error(
      `helmCanary: "${image}" looks like a full image reference, but ` +
        `${settings.imageKey_} takes a tag. Pass just the tag, or point ` +
        "h.imageKey(...) at the key your chart reads a full reference from.",
    );
  }
  return image;
}

/** The configured total replica count, or a friendly error naming the fix. */
function totalOf(settings: HelmCanarySettings): number {
  const total = settings.replicas_;
  if (total === undefined || !Number.isSafeInteger(total) || total < 1) {
    throw new Error(
      `helmCanary: the total replica count must be a whole number from 1 up ` +
        `(got ${total}) — set it with h.replicas(10).`,
    );
  }
  return total;
}

/**
 * Two Helm releases of one chart as a canary platform, for `@zuke/canary`:
 *
 * ```ts
 * c.platform(helmCanary((h) =>
 *   h.chart("./charts/api").stableRelease("api").namespace("prod")
 *     .image(this.tag.value).replicas(10)
 *     .helm((s) => s.kubeContext("prod"))
 * ))
 * ```
 *
 * The lambda runs on every call, so it may read resolved parameters.
 *
 * - **stage** — reads the stable revision with `get all --template`, then
 *   `upgrade --install <stable>-canary <chart> --set-string image.tag=<image>
 *   --set replicaCount=0 --wait`.
 * - **expose** — `upgrade --reuse-values --set replicaCount=<n>` on the canary
 *   release (waiting), then on the stable release with the remainder.
 * - **promote** — `upgrade <stable> --reuse-values` to the candidate image at
 *   the full count (waiting), then `uninstall <canary> --ignore-not-found`.
 * - **abort** — `rollback <stable> <recorded revision> --wait`, then the same
 *   uninstall; run by hand, the revision set with `.stableRevision(...)`.
 */
export function helmCanary(
  configure: Configure<HelmCanarySettings>,
): HelmCanary {
  return new HelmCanary(configure);
}
