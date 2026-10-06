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
 *       .image(this.tag.value).replicas(10).values("values-prod.yaml")
 *   ))
 *     .steps(10, 50)
 *     .bake("10m")
 * );
 * ```
 *
 * The candidate runs as a **second release** (the canary release,
 * `<stable>-canary` unless named), and exposure is the share of replicas it
 * holds: each step scales the canary release up and then the stable release
 * down, through `helm upgrade --reset-then-reuse-values`. What that relies on,
 * and this module cannot check:
 *
 * - **Requests split by replicas only when the stable release's Service also
 *   selects the canary release's pods.** A chart `helm create` scaffolds
 *   selects on the release name, so its canary pods take no requests at all.
 * - **The canary release inherits nothing from the stable one**: it is the
 *   chart's defaults plus {@link HelmCanarySettings.values}, so those files
 *   must reproduce the stable release's whole configuration.
 * - **A second release of the chart must be able to coexist with the first**:
 *   names hard-coded or set by `fullnameOverride`, a duplicated Ingress host,
 *   cluster-scoped objects and hooks that run again all collide or misbehave.
 * - **Every replica move on the stable release re-renders it** — from
 *   {@link HelmCanarySettings.stableChart} when set, otherwise from the
 *   candidate's chart, whose template changes then reach every stable pod at
 *   the first step.
 * - The stable release scales down without waiting, after the canary release
 *   is ready by `--wait`'s measure (which counts a Deployment ready at
 *   `replicas - maxUnavailable`), so capacity can dip briefly.
 *
 * `stage` records the release names and namespace, and every later call
 * refuses a configuration that names others. It also records when the stable
 * release was first deployed — a time helm sets once, at install, and carries
 * through every upgrade and rollback — and every later call reads it again
 * before it changes anything, refusing a stable release reinstalled under the
 * same name. The kube context in {@link HelmCanarySettings.helm} cannot be
 * recorded, but one that now points at another cluster is refused the same
 * way, since that cluster's release was not first deployed at the same
 * nanosecond: a strong check, not a proof, so the context still must not
 * change mid-rollout.
 *
 * A rollback never re-derives the old state: `stage` reads the stable
 * release's current revision (through helm's own `--template` projection, the
 * one kind of value read back) and a rollback is `helm rollback` to exactly
 * that revision, so it restores the stable image, values and replica count
 * even after a promotion that failed half-way. The adapter's own commands on
 * the stable release pass `--history-max 0` so they never prune that
 * revision. Requires Helm 3.14 or later in the 3.x line.
 *
 * The canary engine's platform interface lives in `@zuke/canary`, and a wrapper
 * depends only on `@zuke/core`, so this module does not import it: the object
 * {@link helmCanary} returns has the same shape and is accepted by
 * `c.platform(...)` as it is.
 *
 * @module
 */

import type { JsonValue, SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  HelmGetAllSettings,
  HelmRollbackSettings,
  type HelmSettings,
  HelmUninstallSettings,
  HelmUpgradeSettings,
} from "./helm.ts";
import type { CommandOutput } from "@zuke/core/shell";
import {
  type Candidate,
  configuredCandidate,
} from "./helm_canary_candidate.ts";
import {
  checkedReleases,
  checkedRevision,
  type ReleaseNames,
} from "./helm_canary_checks.ts";
import {
  candidateRecord,
  checkFirstDeployed,
  checkIdentity,
  FIRST_DEPLOYED_SHAPE,
  identityRecord,
  recordedCandidate,
  recordedFirstDeployed,
  STABLE_FIRST_DEPLOYED,
  STABLE_REVISION,
  STAGE,
} from "./helm_canary_record.ts";
import { HelmCanarySettings } from "./helm_canary_settings.ts";
import { isWholeNumber } from "./whole_number.ts";

/**
 * Prints a release's revision, status and first-deployed time (nanoseconds
 * since 1970) on one line.
 */
const STABLE_TEMPLATE =
  "{{.Release.Version}} {{.Release.Info.Status}} {{.Release.Info.FirstDeployed.UnixNano}}";

/**
 * {@link STABLE_TEMPLATE}'s output: revision, status, first-deployed time —
 * the last held to `FIRST_DEPLOYED_SHAPE` as well.
 */
const STABLE_SHAPE = /^([0-9]+) ([a-z-]+) ([^ ]+)$/;

/**
 * Prints when a release was first deployed, in nanoseconds since 1970. Helm
 * sets it at install and carries it through every upgrade and rollback, so it
 * tells one incarnation of a release — and, in practice, one cluster's — from
 * another of the same name.
 */
const FIRST_DEPLOYED_TEMPLATE = "{{.Release.Info.FirstDeployed.UnixNano}}";

/** What `stage` reads of the stable release. */
interface StableRead {
  /** Its current revision, which a rollback returns to. */
  readonly revision: number;
  /** When it was first deployed, nanoseconds since 1970, as digits. */
  readonly firstDeployed: string;
}

/** Prints a release's revision — only read to learn whether it exists. */
const REVISION_TEMPLATE = "{{.Release.Version}}";

/** What helm prints for a release it has no record of. */
const NOT_FOUND = "release: not found";

/**
 * The part of the canary engine's context the Helm platform uses: the
 * rollout's durable state, where the stable release's revision and the staged
 * candidate are recorded, and the build summary. The engine hands a richer
 * context; this is the narrow view.
 */
export interface HelmCanaryContext {
  /** The rollout's durable platform state, shared by every call. */
  readonly state: TargetStateHandle;
  /** Add key/value pairs to the calling target's row in the build summary. */
  reportSummary(pairs: SummaryPairs): void;
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
   * Check the stable release is deployed and record its revision and
   * first-deployed time, check no canary release is left over, then install
   * the candidate as the canary release with no replicas: `upgrade <canary>
   * <chart> --set <replicasKey>=0 --set-string <imageKey>=<image> --install
   * --wait`. The image, replica count, charts, versions, values files and
   * keys are recorded, and every later call uses those, not a configuration
   * that may have changed since. A stage resumed after an earlier attempt
   * recorded the stable release refuses, before writing anything, unless the
   * release it reads now was first deployed at the recorded time.
   */
  async stage(ctx: HelmCanaryContext): Promise<void> {
    // First, before anything can throw: a stage that fails from here until
    // the canary install leaves a rollback nothing to do. An earlier attempt
    // of this stage that got further keeps its marker, so its canary release
    // is not forgotten.
    const prior = ctx.state.get()[STAGE];
    if (prior === undefined) await ctx.state.set({ [STAGE]: "reading" });
    const settings = this.#configure(new HelmCanarySettings());
    const names = checkedReleases(settings);
    const { stable, canary } = names;
    const resumed = prior === "deploying" || prior === "staged";
    // A resumed stage must find the stable release the earlier attempt
    // recorded, before it writes anything over that record.
    const recordedFirst = resumed
      ? this.#recordedStable(ctx.state.get(), names)
      : undefined;
    const candidate = configuredCandidate(settings);
    const { revision, firstDeployed } = await this.#deployedRevision(
      settings,
      stable,
    );
    if (recordedFirst === undefined) {
      await this.#refuseLeftover(settings, canary);
    } else {
      checkFirstDeployed(
        stable,
        recordedFirst,
        firstDeployed,
        ctx.state.get(),
      );
    }
    // A rollback reads this to know the canary release may exist, and which
    // one, so it must be on record before the install can create it.
    const deploying = {
      [STAGE]: "deploying",
      [STABLE_REVISION]: revision,
      [STABLE_FIRST_DEPLOYED]: firstDeployed,
      ...identityRecord(names),
    };
    if (!await ctx.state.trySet(deploying)) {
      throw new Error(
        "helmCanary: could not record that the canary install is starting, " +
          "so a rollback could not find its release. Stopping before " +
          "installing it.",
      );
    }
    const install = this.#upgrade(
      settings,
      canary,
      candidate.chart,
      candidate.version,
    ).install().setString(candidate.imageKey, candidate.image)
      .set(candidate.replicasKey, "0");
    for (const file of candidate.values) install.values(file);
    await this.#run(settings, "upgrade", install);
    // A rollback reads this to know the stable release may have moved, so it
    // must be on record before any exposure can happen.
    const staged = { [STAGE]: "staged", ...candidateRecord(candidate) };
    if (!await ctx.state.trySet(staged)) {
      throw new Error(
        "helmCanary: could not record that the canary release is staged, so " +
          "a rollback could not find it. Stopping before it takes any traffic.",
      );
    }
    ctx.reportSummary({ "Stable revision": revision });
  }

  /**
   * Give the canary release `percent` of the staged replica count — rounded,
   * and at least one for any share above 0 — scaling it up (waiting) before
   * the stable release down (not waiting). Returns the share achieved.
   * Refuses, changing nothing, unless the stable release was first deployed
   * at the time `stage` recorded.
   */
  async expose(percent: number, ctx: HelmCanaryContext): Promise<number> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `helmCanary: an exposure is a share from 0 to 100, so ${percent} ` +
          "is not one.",
      );
    }
    const settings = this.#configure(new HelmCanarySettings());
    const names = checkedReleases(settings);
    const { stable, canary } = names;
    const staged = await this.#staged(settings, ctx, names);
    const { total, replicasKey } = staged;
    const rounded = Math.round(total * percent / 100);
    const share = percent > 0 && rounded === 0 ? 1 : rounded;
    await this.#run(
      settings,
      "upgrade",
      this.#upgrade(settings, canary, staged.chart, staged.version)
        .set(replicasKey, String(share)),
    );
    await this.#run(
      settings,
      "upgrade",
      this.#upgrade(
        settings,
        stable,
        staged.stableChart,
        staged.stableVersion,
        false,
      ).historyMax(0).set(replicasKey, String(total - share)),
    );
    return Math.round(share * 10000 / total) / 100;
  }

  /**
   * Upgrade the stable release to the staged chart and image at the staged
   * replica count, waiting for it, then uninstall the canary release.
   * Idempotent. Refuses, changing nothing, unless the stable release was
   * first deployed at the time `stage` recorded.
   */
  async promote(ctx: HelmCanaryContext): Promise<void> {
    const settings = this.#configure(new HelmCanarySettings());
    const names = checkedReleases(settings);
    const { stable, canary } = names;
    const staged = await this.#staged(settings, ctx, names);
    const upgrade = this.#upgrade(
      settings,
      stable,
      staged.chart,
      staged.version,
    )
      .historyMax(0).setString(staged.imageKey, staged.image)
      .set(staged.replicasKey, String(staged.total));
    for (const file of staged.values) upgrade.values(file);
    await this.#run(settings, "upgrade", upgrade);
    await this.#run(settings, "uninstall", this.#uninstall(settings, canary));
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
   * - **Stage failed before the canary install**: nothing changed; nothing
   *   runs.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): the
   *   rollback goes to {@link HelmCanarySettings.stableRevision}. Without one
   *   this refuses, since claiming a rollback it cannot do would be worse.
   * - **A record it does not recognise**: refuses.
   *
   * Staged, or with the install under way, it first reads when the stable
   * release was first deployed and refuses, changing nothing, unless that is
   * the time `stage` recorded — a release reinstalled under the same name, or
   * another cluster's through a changed kube context, is not this rollout's to
   * roll back. A hand-run abort has no recorded time to compare with.
   */
  async abort(ctx: HelmCanaryContext): Promise<void> {
    const recorded = ctx.state.get();
    const stage = recorded[STAGE];
    if (stage === "reading") return;
    const settings = this.#configure(new HelmCanarySettings());
    const names = checkedReleases(settings);
    const { stable, canary } = names;
    if (stage === "deploying") {
      const first = this.#recordedStable(recorded, names);
      await this.#verifyStable(settings, stable, first, recorded);
      await this.#run(settings, "uninstall", this.#uninstall(settings, canary));
      return;
    }
    const first = stage === "staged"
      ? this.#recordedStable(recorded, names)
      : undefined;
    const revision = checkedRevision(
      this.#revisionToRestore(settings, stable, recorded),
    );
    // Nothing recorded — a hand-run abort — leaves nothing to compare with.
    if (first !== undefined) {
      await this.#verifyStable(settings, stable, first, recorded);
    }
    const rollback = this.#scoped(settings, new HelmRollbackSettings())
      .release(stable).revision(revision).wait().historyMax(0);
    if (settings.timeout_ !== undefined) rollback.timeout(settings.timeout_);
    await this.#run(settings, "rollback", rollback);
    await this.#run(settings, "uninstall", this.#uninstall(settings, canary));
  }

  /** The revision a rollback returns to, from the record or configuration. */
  #revisionToRestore(
    settings: HelmCanarySettings,
    stable: string,
    recorded: Record<string, JsonValue>,
  ): JsonValue {
    const stage = recorded[STAGE];
    if (stage === "staged") {
      const revision = recorded[STABLE_REVISION];
      if (revision === undefined) {
        throw new Error(
          `helmCanary: the rollout is recorded as staged, but no stable ` +
            `revision is recorded with it, so there is no revision of ` +
            `${stable} to go back to. Find the pre-rollout one with \`helm ` +
            `history ${stable}\` and roll back by hand.`,
        );
      }
      return revision;
    }
    if (stage !== undefined) {
      throw new Error(
        `helmCanary: the rollout's record has an unrecognised stage ` +
          `${JSON.stringify(stage)}, so this abort cannot tell what to undo. ` +
          `Check \`helm history ${stable}\` and roll back by hand.`,
      );
    }
    const configured = settings.stableRevision_;
    if (configured === undefined) {
      throw new Error(
        `helmCanary: this abort has no record of a rollout of ${stable} — it ` +
          "was run by hand — so it does not know which revision to go back " +
          "to. Add h.stableRevision(<n>), the revision `helm history " +
          `${stable}\` lists from before the rollout, or use ` +
          "`zuke cancel <run-id>` for a rollout that is still running.",
      );
    }
    return configured;
  }

  /**
   * The candidate `stage` recorded for these releases, re-checked, once the
   * stable release helm reaches now is shown to be the one `stage` read.
   */
  async #staged(
    settings: HelmCanarySettings,
    ctx: HelmCanaryContext,
    names: ReleaseNames,
  ): Promise<Candidate> {
    const recorded = ctx.state.get();
    if (recorded[STAGE] !== "staged") {
      throw new Error(
        "helmCanary: no staged canary is recorded for this rollout, so there " +
          "is nothing to expose or promote. They run after stage, in the " +
          "same rollout.",
      );
    }
    const first = this.#recordedStable(recorded, names);
    const candidate = recordedCandidate(recorded);
    await this.#verifyStable(settings, names.stable, first, recorded);
    return candidate;
  }

  /**
   * The stable release's first-deployed time this rollout recorded, once the
   * record is shown to name these releases and namespace.
   */
  #recordedStable(
    recorded: Record<string, JsonValue>,
    names: ReleaseNames,
  ): string {
    checkIdentity(recorded, names);
    return recordedFirstDeployed(recorded, names.stable);
  }

  /**
   * Refuse unless the stable release helm reaches now was first deployed at
   * `recorded` — the release `stage` read, not one reinstalled under its name
   * or another cluster's. Run before anything is changed; `state` is the
   * rollout's record, for the recovery a refusal spells out.
   */
  async #verifyStable(
    settings: HelmCanarySettings,
    stable: string,
    recorded: string,
    state: Record<string, JsonValue>,
  ): Promise<void> {
    const output = await this.#run(
      settings,
      "get all",
      this.#getAll(settings, stable, FIRST_DEPLOYED_TEMPLATE),
    );
    const text = output.stdout.trim();
    if (output.truncated || !FIRST_DEPLOYED_SHAPE.test(text)) {
      throw new Error(
        `helmCanary: reading when ${stable} was first deployed printed ` +
          `${JSON.stringify(text)}, not a time, so this call cannot tell it ` +
          "is the release the rollout started with, and changed nothing. " +
          `Check that the release exists with \`helm status ${stable}\`.`,
      );
    }
    checkFirstDeployed(stable, recorded, text, state);
  }

  /**
   * Run `command` and return its output, failing on a non-zero exit whatever
   * the runner or a `.noThrow()` in {@link HelmCanarySettings.helm} let
   * through — a command that failed must never be reported as done.
   */
  async #run(
    settings: HelmCanarySettings,
    subcommand: string,
    command: HelmSettings,
  ): Promise<CommandOutput> {
    const output = await settings.runner_(command);
    if (output.code !== 0) {
      throw new Error(
        `helmCanary: helm ${subcommand} exited ${output.code}: ` +
          output.stderr.trim(),
      );
    }
    return output;
  }

  /** `command` with the namespace and the caller's global flags applied. */
  #scoped<S extends HelmSettings>(settings: HelmCanarySettings, command: S): S {
    if (settings.namespace_ !== undefined) {
      command.namespace(settings.namespace_);
    }
    settings.helm_?.(command);
    return command;
  }

  /**
   * `helm upgrade <release> <chart> --reset-then-reuse-values`, scoped,
   * waiting unless told not to.
   */
  #upgrade(
    settings: HelmCanarySettings,
    release: string,
    chart: string,
    version: string | undefined,
    wait = true,
  ): HelmUpgradeSettings {
    const upgrade = this.#scoped(settings, new HelmUpgradeSettings())
      .release(release).chart(chart).resetThenReuseValues();
    if (version !== undefined) upgrade.version(version);
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

  /** `helm get all <release> --template <template>`, scoped and quiet. */
  #getAll(
    settings: HelmCanarySettings,
    release: string,
    template: string,
  ): HelmGetAllSettings {
    return this.#scoped(settings, new HelmGetAllSettings()).release(release)
      .template(template).quiet();
  }

  /**
   * The stable release's current revision and first-deployed time, refused
   * unless it is deployed.
   */
  async #deployedRevision(
    settings: HelmCanarySettings,
    stable: string,
  ): Promise<StableRead> {
    const output = await this.#run(
      settings,
      "get all",
      this.#getAll(settings, stable, STABLE_TEMPLATE),
    );
    const text = output.stdout.trim();
    const match = output.truncated ? null : STABLE_SHAPE.exec(text);
    const revision = match === null ? Number.NaN : Number(match[1]);
    if (
      match === null || !isWholeNumber(revision) ||
      !FIRST_DEPLOYED_SHAPE.test(match[3])
    ) {
      throw new Error(
        `helmCanary: reading the current revision of ${stable} printed ` +
          `${JSON.stringify(text)}, not a revision, a status and a ` +
          "first-deployed time, so a " +
          "rollback would have nothing to return to. Check that the release " +
          "exists with `helm status`.",
      );
    }
    if (match[2] !== "deployed") {
      throw new Error(
        `helmCanary: the latest revision of ${stable}, ${revision}, is ` +
          `${match[2]}, not deployed — a rollback to it would not restore a ` +
          `working release. Settle it first (\`helm history ${stable}\`, ` +
          "`helm rollback`), then run the canary.",
      );
    }
    return { revision, firstDeployed: match[3] };
  }

  /**
   * Refuse when the canary release already exists: taking it over would
   * hide what an earlier rollout left, and a rollback would then remove a
   * release this rollout never created. A missing release is the only
   * failure read as "absent".
   */
  async #refuseLeftover(
    settings: HelmCanarySettings,
    canary: string,
  ): Promise<void> {
    const output = await settings.runner_(
      this.#getAll(settings, canary, REVISION_TEMPLATE).noThrow(),
    );
    if (output.code === 0) {
      throw new Error(
        `helmCanary: the canary release ${canary} already exists, left by an ` +
          "earlier rollout. If that rollout is still running or parked, " +
          "`zuke cancel <run-id>` rolls it back; otherwise remove it with " +
          `\`helm uninstall ${canary}\` once the stable release is as it ` +
          "should be.",
      );
    }
    if (!output.stderr.includes(NOT_FOUND)) {
      throw new Error(
        `helmCanary: could not tell whether the canary release ${canary} ` +
          `exists — helm exited ${output.code}: ${output.stderr.trim()}`,
      );
    }
  }
}

/**
 * Two Helm releases of one chart as a canary platform, for `@zuke/canary`:
 *
 * ```ts
 * c.platform(helmCanary((h) =>
 *   h.chart("./charts/api").stableRelease("api").namespace("prod")
 *     .image(this.tag.value).replicas(10).values("values-prod.yaml")
 *     .helm((s) => s.kubeContext("prod"))
 * ))
 * ```
 *
 * The lambda runs on every call, so it may read resolved parameters; the
 * image, replica count, charts, versions, values files and keys are fixed by
 * `stage`. Every upgrade passes
 * `--reset-then-reuse-values`, and every command on the stable release
 * `--history-max 0`.
 *
 * - **stage** — reads the stable release's revision, status and
 *   first-deployed time, checks no canary release exists, then `upgrade
 *   <stable>-canary <chart> --set replicaCount=0 --set-string
 *   image.tag=<image> --install --wait`.
 * - **expose** — `upgrade --set replicaCount=<n>` on the canary release
 *   (waiting), then on the stable release with the remainder.
 * - **promote** — `upgrade <stable> --set replicaCount=<total> --set-string
 *   image.tag=<image> --wait`, then `uninstall <canary> --ignore-not-found`.
 * - **abort** — `rollback <stable> <recorded revision> --wait`, then the same
 *   uninstall; run by hand, the revision set with `.stableRevision(...)`.
 *
 * Every call after `stage` that has its record first reads the stable
 * release's first-deployed time again and refuses, changing nothing, unless
 * it is the one `stage` recorded — so a release reinstalled under the same
 * name, or another cluster's reached through a changed kube context, is never
 * upgraded or rolled back.
 */
export function helmCanary(
  configure: Configure<HelmCanarySettings>,
): HelmCanary {
  return new HelmCanary(configure);
}
