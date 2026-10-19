// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link containerAppCanary} — an Azure container app as a platform for a
 * `@zuke/canary` rollout.
 *
 * ```ts
 * import { canary } from "@zuke/canary";
 * import { containerAppCanary } from "@zuke/az";
 *
 * rollout = canary((c) =>
 *   c.platform(containerAppCanary((a) =>
 *     a.name("api").resourceGroup("rg-prod").image(this.image.value)
 *       .az((z) => z.subscription("prod"))
 *   ))
 *     .steps(10, 25, 50)
 *     .bake("10m")
 * );
 * ```
 *
 * The app must be in multiple-revision mode. The candidate is a new revision,
 * and its exposure is its share of the app's ingress traffic, split by
 * revision name in whole percents.
 *
 * The canary engine's platform interface lives in `@zuke/canary`, and a wrapper
 * depends only on `@zuke/core`, so this module does not import it: the object
 * {@link containerAppCanary} returns has the same shape and is accepted by
 * `c.platform(...)` as it is.
 *
 * @module
 */

import type { JsonValue, SummaryPairs, TargetStateHandle } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  AzContainerappIngressTrafficSetSettings,
  AzContainerappRevisionListSettings,
  AzContainerappShowSettings,
  AzContainerappUpdateSettings,
} from "./containerapp.ts";
import {
  checkRevisionName,
  type ContainerApp,
  type ContainerAppRevision,
  readApp,
  readRevision,
  REVISION_SHAPE,
} from "./containerapp_canary_app.ts";
import {
  azFlags,
  checkAppId,
  checkIdentity,
  type ContainerAppIdentity,
  type ContainerAppPin,
  type ContainerAppRecord,
  damagedRecord,
  NAME_SHAPE,
  pinRecord,
  recordedPin,
  recordedRollout,
  recovery,
  rolloutRecord,
  sameArgv,
} from "./containerapp_canary_record.ts";
import { runChecked } from "./reader.ts";
import type { AzSettings } from "./settings.ts";

/**
 * The state key recording how far `stage` got: `"pinning"` before traffic is
 * pinned to the stable revision by name, `"deploying"` before the candidate
 * is deployed, `"staged"` once the rollout is on record. Until `"staged"` the
 * candidate has no traffic, so a rollback has nothing to undo.
 */
const STAGE = "containerAppCanaryStage";

/** The name `--revision-weight` takes for "whichever revision is newest". */
const LATEST = "latest";

/**
 * The part of the canary engine's context the Container Apps platform uses:
 * the rollout's durable state, where the staged revisions are recorded, and
 * the build summary. The engine hands a richer context; this is the narrow
 * view.
 */
export interface AzContainerAppCanaryContext {
  /** The rollout's durable platform state, shared by every call. */
  readonly state: TargetStateHandle;
  /** Add key/value pairs to the calling target's row in the build summary. */
  reportSummary(pairs: SummaryPairs): void;
}

/**
 * How {@link containerAppCanary} reaches the app and deploys the candidate,
 * configured through its lambda.
 */
export class AzContainerAppCanarySettings {
  /** The container app (set by {@link name}). */
  name_?: string;
  /** Its resource group (set by {@link resourceGroup}). */
  resourceGroup_?: string;
  /** The candidate's container image (set by {@link image}). */
  image_?: string;
  /** The container the image is for (set by {@link containerName}). */
  containerName_?: string;
  /** A suffix for the candidate revision's name (set by {@link revisionSuffix}). */
  revisionSuffix_?: string;
  /** The revision a hand-run rollback returns to (set by {@link stable}). */
  stable_?: string;
  /** Global options for every command (set by {@link az}). */
  az_: Configure<AzSettings> = (z) => z;

  /** The container app to roll out to. It must already exist. */
  name(name: string): this {
    this.name_ = name;
    return this;
  }

  /** The resource group the app is in. */
  resourceGroup(name: string): this {
    this.resourceGroup_ = name;
    return this;
  }

  /** The candidate's container image, deployed by `stage`. */
  image(reference: string): this {
    this.image_ = reference;
    return this;
  }

  /** The container the image is for, when the app has several (`--container-name`). */
  containerName(name: string): this {
    this.containerName_ = name;
    return this;
  }

  /**
   * A suffix for the candidate revision's name (`--revision-suffix`), so it is
   * `<app>--<suffix>`. It must be new to the app.
   */
  revisionSuffix(suffix: string): this {
    this.revisionSuffix_ = suffix;
    return this;
  }

  /**
   * The revision to send all traffic to when `rollout.abort` is run by hand.
   * Such a run is fresh, with no record of a rollout, so it has nothing else
   * to go on. A rollback the engine runs mid-rollout does not use it: that
   * one returns the traffic to the revision `stage` recorded.
   */
  stable(revision: string): this {
    this.stable_ = revision;
    return this;
  }

  /**
   * Global options for every command the platform runs —
   * `(z) => z.subscription("prod")`, a `.toolPath(...)`, or a `.runner(...)`,
   * the seam a test answers through. The flags it gives are recorded in the
   * rollout's state, which is plain JSON: never pass a secret on the command
   * line here. A reader's `--output` and `--query` are its own and are set
   * after it.
   */
  az(configure: Configure<AzSettings>): this {
    this.az_ = configure;
    return this;
  }
}

/**
 * An Azure container app as a canary platform. Create one with
 * {@link containerAppCanary}; hand it to `@zuke/canary`'s `c.platform(...)`.
 *
 * Exposure is a share of the app's ingress traffic, set exactly, in whole
 * percents.
 */
export class AzContainerAppCanary {
  /** Container Apps splits requests, so exposure is a traffic share. */
  readonly exposure: "traffic" = "traffic";
  readonly #configure: Configure<AzContainerAppCanarySettings>;

  /** A platform whose settings `configure` produces, afresh on every call. */
  constructor(configure: Configure<AzContainerAppCanarySettings>) {
    this.#configure = configure;
  }

  /** `"container app api"`, for the build summary. */
  describe(): string {
    const name = this.#configure(new AzContainerAppCanarySettings()).name_;
    return name === undefined ? "container app" : `container app ${name}`;
  }

  /**
   * Read the app, pin all of its traffic to the revision serving it by name
   * — so the new revision cannot inherit "latest" routing — deploy the
   * candidate image as a new revision, and record the rollout: the app,
   * resource group and `az` flags every later call is checked against, the
   * app's resource id, the stable and candidate revisions, and whether the
   * traffic followed the latest revision before.
   *
   * Before the pin it records the app, resource group and flags, the app's
   * id, the stable revision and whether the traffic followed the latest
   * revision, so a stage run again checks against them, and the rollback of
   * a stage that fails can hand the traffic back to "latest".
   *
   * Refuses an app that is not in multiple-revision mode, one without
   * ingress, one whose traffic is already split or carries labels, one whose
   * traffic follows the latest revision while its newest revision has not
   * provisioned, a deploy that made no new revision, a latest revision other
   * than the one `.revisionSuffix(...)` names, and a candidate that did not
   * provision. A stage run again over a record of the same rollout checks it
   * and changes nothing.
   */
  async stage(ctx: AzContainerAppCanaryContext): Promise<void> {
    const prior = ctx.state.get()[STAGE];
    // A marker this does not know cannot say what was done, so it is neither
    // overwritten nor acted on.
    if (
      prior !== undefined && prior !== "pinning" && prior !== "deploying" &&
      prior !== "staged"
    ) {
      throw damagedStage(prior);
    }
    const settings = this.#settings();
    const identity = identityOf(settings);
    if (prior === "staged") {
      const recorded = recordedRollout(ctx.state.get());
      checkIdentity(recorded, identity);
      checkAppId(recorded, await this.#app(settings, identity, undefined));
      reportStaged(ctx, recorded);
      return;
    }
    const image = settings.image_;
    if (image === undefined || image === "") {
      throw new Error(
        "containerAppCanary: no candidate image — add a.image(...), the " +
          "image the canary deploys.",
      );
    }
    // Before anything changes: a rollback reads this to tell a stage that
    // never gave the candidate traffic from a hand-run one.
    if (prior === undefined) await ctx.state.set({ [STAGE]: "pinning" });
    const pinned = recordedPin(ctx.state.get());
    if (pinned !== undefined) checkIdentity(pinned, identity);
    const app = await this.#app(settings, identity, undefined);
    if (pinned !== undefined) checkAppId(pinned, app);
    const stable = stableOf(app, identity);
    if (pinned !== undefined && stable.revision !== pinned.stable) {
      throw new Error(
        `containerAppCanary: ${identity.name}'s traffic now goes to ` +
          `${stable.revision}, not ${pinned.stable} as when this stage ` +
          "began: something else changed it. This call changed nothing.",
      );
    }
    // On record before the pin, so a stage run again — or the rollback of
    // one that fails — knows what the traffic followed before it.
    const pin: ContainerAppPin = pinned ?? {
      ...identity,
      appId: app.id,
      subscription: app.subscription,
      stable: stable.revision,
      followedLatest: stable.followedLatest,
    };
    if (pinned === undefined) await ctx.state.set(pinRecord(pin));
    await this.#traffic(settings, identity, pin.subscription, [
      [pin.stable, 100],
    ]);
    await ctx.state.set({ [STAGE]: "deploying" });
    const update = new AzContainerappUpdateSettings().name(identity.name)
      .resourceGroup(identity.resourceGroup).image(image);
    if (settings.containerName_ !== undefined) {
      update.containerName(settings.containerName_);
    }
    if (settings.revisionSuffix_ !== undefined) {
      update.revisionSuffix(settings.revisionSuffix_);
    }
    await runSilently(
      this.#scoped(settings, identity, update, pin.subscription),
    );
    const deployed = await this.#app(settings, identity, pin.subscription);
    const candidate = deployed.latest;
    const named = settings.revisionSuffix_ === undefined
      ? undefined
      : `${identity.name}--${settings.revisionSuffix_}`;
    if (named !== undefined && candidate !== named) {
      throw new Error(
        `containerAppCanary: the latest revision of ${identity.name} is ` +
          `${candidate}, not ${named}, the one this deploy made: something ` +
          "else deployed in between, so the candidate cannot be told apart.",
      );
    }
    if (candidate === pin.stable) {
      throw new Error(
        `containerAppCanary: the deploy made no new revision of ` +
          `${identity.name} — the latest is still ${candidate}, the one ` +
          "serving — so there is nothing to roll out. Container Apps makes a " +
          "revision only when the image or the template changes.",
      );
    }
    const revision = await this.#revision(
      settings,
      identity,
      pin.subscription,
      candidate,
    );
    if (revision.provisioning !== "Provisioned") {
      throw new Error(
        `containerAppCanary: the candidate revision ${candidate} is ` +
          `${revision.provisioning}, not Provisioned, so it takes no traffic.`,
      );
    }
    const recorded: ContainerAppRecord = {
      ...pin,
      candidate,
      candidateCreated: revision.created,
    };
    // A rollback reads this to find the revisions, and every later call
    // checks against it, so it must be on record before any traffic can
    // reach the candidate.
    const staged = { [STAGE]: "staged", ...rolloutRecord(recorded) };
    if (!await ctx.state.trySet(staged)) {
      throw new Error(
        "containerAppCanary: could not record the staged rollout, so a " +
          "rollback could not find it. Stopping before the candidate takes " +
          "any traffic.",
      );
    }
    reportStaged(ctx, recorded);
  }

  /**
   * Send `percent` of the app's traffic to the candidate revision and the
   * rest to the stable one, by name. First the configuration is compared
   * with the record; then the app is read, and this refuses — changing
   * nothing — unless it is still the app staged, its traffic still goes only
   * to the stable revision and the candidate, and the candidate is still the
   * revision staged.
   */
  async expose(
    percent: number,
    ctx: AzContainerAppCanaryContext,
  ): Promise<number> {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new Error(
        `containerAppCanary: Container Apps splits traffic in whole percents ` +
          `from 0 to 100, so it cannot expose ${percent} %. Use whole-number ` +
          "steps.",
      );
    }
    const settings = this.#settings();
    const identity = identityOf(settings);
    const stage = ctx.state.get()[STAGE];
    if (stage !== "staged") throw damagedStage(stage);
    const recorded = recordedRollout(ctx.state.get());
    checkIdentity(recorded, identity);
    const app = await this.#app(settings, identity, undefined);
    checkAppId(recorded, app);
    checkSplit(recorded, app);
    await this.#checkCandidate(settings, identity, recorded);
    await this.#traffic(settings, identity, recorded.subscription, [
      [recorded.stable, 100 - percent],
      [recorded.candidate, percent],
    ]);
    return percent;
  }

  /**
   * Send all traffic to the candidate — after checking, as {@link expose}
   * does, the record, the app's id, the split and the candidate, and that
   * the candidate is still the app's latest revision. Traffic that followed
   * the latest revision before the rollout is handed back to "latest";
   * otherwise the candidate is pinned by name. An app already serving only
   * the candidate that way is left as it is, so a promote run again changes
   * nothing.
   */
  async promote(ctx: AzContainerAppCanaryContext): Promise<void> {
    const settings = this.#settings();
    const identity = identityOf(settings);
    if (ctx.state.get()[STAGE] !== "staged") {
      throw new Error(
        "containerAppCanary: no staged candidate is recorded for this " +
          "rollout, so there is nothing to promote. Promote runs after stage, " +
          "in the same run.",
      );
    }
    const recorded = recordedRollout(ctx.state.get());
    checkIdentity(recorded, identity);
    const app = await this.#app(settings, identity, undefined);
    checkAppId(recorded, app);
    if (promoted(recorded, app)) return;
    checkSplit(recorded, app);
    await this.#checkCandidate(settings, identity, recorded);
    if (app.latest !== recorded.candidate) {
      throw new Error(
        `containerAppCanary: the latest revision of ${recorded.name} is ` +
          `${app.latest}, not the staged candidate ${recorded.candidate}. ` +
          "Something deployed in between, so promoting would hand traffic to " +
          "a revision this canary never analysed.",
      );
    }
    if (recorded.followedLatest && app.latestReady !== recorded.candidate) {
      throw new Error(
        `containerAppCanary: the newest ready revision of ${recorded.name} ` +
          `is ${app.latestReady}, not the candidate ${recorded.candidate}, so ` +
          "handing the traffic back to the latest revision would send it " +
          `to ${app.latestReady}. This call changed nothing.`,
      );
    }
    await this.#traffic(
      settings,
      identity,
      recorded.subscription,
      recorded.followedLatest
        ? [[LATEST, 100]]
        : [[recorded.candidate, 100], [recorded.stable, 0]],
    );
  }

  /**
   * Send all traffic back to the stable revision, by name. Idempotent. What
   * it does depends on what this rollout recorded:
   *
   * - **The rollout is staged** (a rollback mid-rollout, or after a promote):
   *   once the configuration and the app's id match the record, the stable
   *   revision gets 100 % and the candidate 0 %. Traffic that also goes to a
   *   third revision is a newer rollout, and this refuses rather than undo it
   *   too. The traffic stays pinned to the stable revision by name, even if it
   *   followed "latest" before: the latest revision is the candidate now.
   * - **`stage` failed before recording it**: the candidate never had any
   *   traffic. Traffic that followed the latest revision and was pinned to
   *   the stable one by name is handed back to "latest" — once the
   *   configuration and the app's id match the pin, the traffic still goes
   *   only to the stable revision, and that is still the newest revision.
   *   Otherwise it is left pinned, and the summary says so.
   * - **Any other stage marker**: the record is damaged, and this refuses.
   * - **Nothing recorded** (`rollout.abort` run by hand, a fresh run): all
   *   traffic goes to the revision set with
   *   {@link AzContainerAppCanarySettings.stable}. Without one this refuses.
   */
  async abort(ctx: AzContainerAppCanaryContext): Promise<void> {
    const stage = ctx.state.get()[STAGE];
    const settings = this.#settings();
    const identity = identityOf(settings);
    if (stage === "pinning" || stage === "deploying") {
      await this.#unpin(settings, identity, ctx);
      return;
    }
    if (stage === "staged") {
      const recorded = recordedRollout(ctx.state.get());
      checkIdentity(recorded, identity);
      const app = await this.#app(settings, identity, undefined);
      checkAppId(recorded, app);
      const foreign = serving(app)
        .filter((revision) =>
          revision !== recorded.stable && revision !== recorded.candidate
        );
      if (foreign.length > 0) {
        throw new Error(
          `containerAppCanary: ${recorded.name} also sends traffic to ` +
            `${foreign.join(", ")} — a newer rollout, or a change made by ` +
            "hand. Sending all traffic back to the stable revision " +
            `${recorded.stable} would undo that as well, so this changed ` +
            "nothing. Roll that change back first.",
        );
      }
      await this.#traffic(settings, identity, recorded.subscription, [
        [recorded.stable, 100],
        [recorded.candidate, 0],
      ]);
      return;
    }
    if (stage !== undefined) throw damagedStage(stage);
    const stable = settings.stable_;
    if (stable === undefined) {
      throw new Error(
        `containerAppCanary: this abort has no record of a rollout of ` +
          `${identity.name} — it was run by hand — so it does not know which ` +
          "revision to go back to. Add a.stable('<revision>') to send all " +
          "traffic there, or use `zuke cancel <run-id>` for a rollout that is " +
          "still running.",
      );
    }
    checkRevisionName(stable);
    await this.#traffic(settings, identity, undefined, [[stable, 100]]);
  }

  /**
   * The rollback of a stage that failed before the rollout was recorded: no
   * candidate took traffic, but the traffic may have been pinned to the
   * stable revision by name. When it followed the latest revision before, it
   * is handed back to "latest" — only once the configuration and the app's
   * id match the pin, the traffic still goes only to the stable revision,
   * and that revision is still the app's newest, so "latest" sends the
   * traffic exactly where it goes now. Otherwise it is left pinned, and the
   * summary says so.
   */
  async #unpin(
    settings: AzContainerAppCanarySettings,
    identity: ContainerAppIdentity,
    ctx: AzContainerAppCanaryContext,
  ): Promise<void> {
    const pin = recordedPin(ctx.state.get());
    if (pin === undefined || !pin.followedLatest) return;
    checkIdentity(pin, identity);
    const app = await this.#app(settings, identity, undefined);
    checkAppId(pin, app);
    const live = (app.traffic ?? []).filter((entry) => entry.weight > 0);
    const only = live[0];
    if (live.length === 1 && only !== undefined && only.latest) return;
    const unchanged = sameArgv(serving(app), [pin.stable]) &&
      app.latest === pin.stable && app.latestReady === pin.stable;
    if (!unchanged) {
      ctx.reportSummary({ "Pinned to": pin.stable });
      return;
    }
    await this.#traffic(settings, identity, pin.subscription, [[LATEST, 100]]);
  }

  /** The settings, evaluated now so the lambda sees resolved parameters. */
  #settings(): AzContainerAppCanarySettings {
    return this.#configure(new AzContainerAppCanarySettings());
  }

  /**
   * `command` with the caller's global options applied — and refused, before
   * it runs, unless the `.az(...)` lambda gave it exactly the flags this call
   * resolved and checked. The lambda runs once per command, so one that
   * resolves differently between two runs of itself through its flags.
   * Once the call has read and checked the app's id, `subscription` — the
   * one that id names — is set on the command after the lambda, so it
   * reaches that subscription whatever the CLI's default has become since.
   */
  #scoped<S extends AzSettings>(
    settings: AzContainerAppCanarySettings,
    identity: ContainerAppIdentity,
    command: S,
    subscription: string | undefined,
  ): S {
    const own = command.argv().length;
    settings.az_(command);
    if (!sameArgv(command.argv().slice(own), identity.flags)) {
      throw new Error(
        "containerAppCanary: a.az(...) gave this command other flags than " +
          "the ones this call resolved and checked, so it does not run: the " +
          "lambda must give the same flags every time it runs. Make it depend " +
          "only on the build's resolved parameters.",
      );
    }
    if (subscription !== undefined) command.subscription(subscription);
    return command;
  }

  /**
   * Read the app this call is configured with — in `subscription` once the
   * call has checked it, through the configuration alone before that.
   */
  #app(
    settings: AzContainerAppCanarySettings,
    identity: ContainerAppIdentity,
    subscription: string | undefined,
  ): Promise<ContainerApp> {
    return readApp(this.#scoped(
      settings,
      identity,
      new AzContainerappShowSettings().name(identity.name)
        .resourceGroup(identity.resourceGroup),
      subscription,
    ));
  }

  /** Read one of the app's revisions, in the subscription checked. */
  #revision(
    settings: AzContainerAppCanarySettings,
    identity: ContainerAppIdentity,
    subscription: string,
    revision: string,
  ): Promise<ContainerAppRevision> {
    return readRevision(
      this.#scoped(
        settings,
        identity,
        new AzContainerappRevisionListSettings().name(identity.name)
          .resourceGroup(identity.resourceGroup).all(),
        subscription,
      ),
      revision,
    );
  }

  /**
   * Set the app's traffic to `weights`, by revision name — in the
   * subscription checked, or, for a hand-run rollback that has none to
   * check, through the configuration alone.
   */
  async #traffic(
    settings: AzContainerAppCanarySettings,
    identity: ContainerAppIdentity,
    subscription: string | undefined,
    weights: ReadonlyArray<readonly [revision: string, weight: number]>,
  ): Promise<void> {
    const command = new AzContainerappIngressTrafficSetSettings()
      .name(identity.name).resourceGroup(identity.resourceGroup);
    for (const [revision, weight] of weights) {
      command.revisionWeight(revision, weight);
    }
    await runSilently(this.#scoped(settings, identity, command, subscription));
  }

  /**
   * Refuse unless the candidate is still the revision `stage` deployed. A
   * revision keeps its creation time, so a different one means the app was
   * deleted and created again and a revision of the same name made since.
   */
  async #checkCandidate(
    settings: AzContainerAppCanarySettings,
    identity: ContainerAppIdentity,
    recorded: ContainerAppRecord,
  ): Promise<void> {
    const live = await this.#revision(
      settings,
      identity,
      recorded.subscription,
      recorded.candidate,
    );
    if (live.created === recorded.candidateCreated) return;
    throw new Error(
      `containerAppCanary: the candidate revision ${recorded.candidate} was ` +
        `created at ${live.created}, not ${recorded.candidateCreated} as ` +
        "staged: the app was deleted and created again. This call changed " +
        `nothing rather than send traffic to a revision the canary never ran. ${
          recovery(recorded)
        }`,
    );
  }
}

/**
 * The revision serving all of the app's traffic, and whether it was reached
 * through the entry that follows the latest revision — refused unless the
 * app can split: multiple-revision mode, ingress, no labels, and one revision
 * taking everything.
 */
function stableOf(
  app: ContainerApp,
  identity: ContainerAppIdentity,
): { revision: string; followedLatest: boolean } {
  if (app.mode.toLowerCase() !== "multiple") {
    throw new Error(
      `containerAppCanary: ${identity.name} is in ${app.mode} revision mode, ` +
        "and only an app in multiple-revision mode can split its traffic " +
        "between revisions. Switch it with `az containerapp revision " +
        "set-mode --mode multiple`.",
    );
  }
  const traffic = app.traffic;
  if (traffic === null) {
    throw new Error(
      `containerAppCanary: ${identity.name} has no ingress, so it has no ` +
        "traffic to split. Enable ingress first.",
    );
  }
  const labelled = traffic.filter((entry) => entry.label !== undefined);
  if (labelled.length > 0) {
    throw new Error(
      `containerAppCanary: ${identity.name}'s traffic carries the label ` +
        `${
          labelled.map((entry) => entry.label).join(", ")
        }; the canary splits by revision name only. Remove the labels first.`,
    );
  }
  const live = traffic.filter((entry) => entry.weight > 0);
  const only = live[0];
  if (live.length !== 1 || only === undefined || only.weight !== 100) {
    throw new Error(
      `containerAppCanary: ${identity.name}'s traffic is already split ` +
        `between ${live.length} entries — another rollout is running, or one ` +
        "left its split behind. Send all traffic to one revision before " +
        "staging this one.",
    );
  }
  if (only.latest && app.latest !== app.latestReady) {
    throw new Error(
      `containerAppCanary: ${identity.name}'s traffic follows the latest ` +
        `revision, which goes to ${app.latestReady}, the newest ready one — ` +
        `but its newest revision is ${app.latest}, which has not provisioned. ` +
        "Let it finish, or deactivate it, before staging, so the revision " +
        "serving is not in doubt.",
    );
  }
  const revision = only.latest ? app.latestReady : only.revision;
  if (!REVISION_SHAPE.test(revision)) {
    throw new Error(
      `containerAppCanary: ${identity.name}'s traffic goes to ` +
        `${JSON.stringify(revision)}, which is not a revision name this can ` +
        "pin.",
    );
  }
  return { revision, followedLatest: only.latest };
}

/** The revisions an app's traffic reaches, with "latest" resolved. */
function serving(app: ContainerApp): string[] {
  return (app.traffic ?? []).filter((entry) => entry.weight > 0)
    .map((entry) => entry.latest ? app.latestReady : entry.revision);
}

/**
 * Whether all of the app's traffic already goes to the candidate the way a
 * promote would send it: through "latest" when it followed the latest
 * revision before, by name otherwise.
 */
function promoted(recorded: ContainerAppRecord, app: ContainerApp): boolean {
  const live = (app.traffic ?? []).filter((entry) => entry.weight > 0);
  const only = live[0];
  if (live.length !== 1 || only === undefined) return false;
  return recorded.followedLatest
    ? only.latest && app.latest === recorded.candidate &&
      app.latestReady === recorded.candidate
    : !only.latest && only.revision === recorded.candidate;
}

/**
 * Refuse unless the app's traffic still goes only to the stable revision and
 * the candidate, as this rollout left it. The rollback that follows a
 * refusal sends the traffic back to the stable revision, unless a third
 * revision has a share.
 */
function checkSplit(recorded: ContainerAppRecord, app: ContainerApp): void {
  const reached = serving(app);
  const foreign = reached.filter((revision) =>
    revision !== recorded.stable && revision !== recorded.candidate
  );
  const labelled = (app.traffic ?? []).some((entry) =>
    entry.label !== undefined && entry.weight > 0
  );
  if (app.traffic !== null && foreign.length === 0 && !labelled) return;
  throw new Error(
    `containerAppCanary: ${recorded.name}'s traffic now goes to ` +
      `${reached.join(", ") || "nothing"}, not only to the stable revision ` +
      `${recorded.stable} and the candidate ${recorded.candidate}: something ` +
      "else changed it. This call changed nothing.",
  );
}

/**
 * Run a command that changes the app, printing nothing: `containerapp update`
 * and `ingress traffic set` answer with the whole app, whose plain environment
 * variables would otherwise land in the build log. `--output none` is set
 * after the `.az(...)` lambda, so it wins over an `--output` the lambda set.
 * A failure still reports the CLI's error.
 */
async function runSilently(command: AzSettings): Promise<void> {
  await runChecked(command.output("none").quiet());
}

/** Report the staged revisions in the build summary. */
function reportStaged(
  ctx: AzContainerAppCanaryContext,
  recorded: ContainerAppRecord,
) {
  ctx.reportSummary({ Candidate: recorded.candidate, Stable: recorded.stable });
}

/**
 * What this call is configured to act through — refused, before any command,
 * unless the app and resource group are set and shaped as Azure takes them.
 */
function identityOf(
  settings: AzContainerAppCanarySettings,
): ContainerAppIdentity {
  const name = settings.name_;
  const resourceGroup = settings.resourceGroup_;
  if (name === undefined || !NAME_SHAPE.test(name)) {
    throw new Error(
      "containerAppCanary: name the container app with a.name('api'). It " +
        "must already exist; the canary amends it.",
    );
  }
  if (resourceGroup === undefined || !NAME_SHAPE.test(resourceGroup)) {
    throw new Error(
      "containerAppCanary: name the resource group with " +
        "a.resourceGroup('rg-prod').",
    );
  }
  return { name, resourceGroup, flags: azFlags(settings.az_) };
}

/** The refusal for a stage marker this call cannot act on. */
function damagedStage(stage: JsonValue | undefined): Error {
  return damagedRecord("a stage marker this call can act on", stage);
}

/**
 * An Azure container app as a canary platform, for `@zuke/canary`:
 *
 * ```ts
 * c.platform(containerAppCanary((a) =>
 *   a.name("api").resourceGroup("rg-prod").image(this.image.value)
 *     .az((z) => z.subscription("prod"))
 * ))
 * ```
 *
 * The lambda runs on every call, so it may read resolved parameters. The app
 * must be in multiple-revision mode, with ingress.
 *
 * - **stage** — reads the app (`containerapp show`); pins all traffic to the
 *   serving revision by name (`ingress traffic set --revision-weight
 *   <stable>=100`); deploys the image (`containerapp update`), which makes
 *   the candidate revision; checks it is `Provisioned`; records the rollout.
 * - **expose** — `ingress traffic set --revision-weight <stable>=<100-n>
 *   <candidate>=<n>`.
 * - **promote** — checks the latest revision is still the candidate, then
 *   `--revision-weight latest=100` when traffic followed the latest revision
 *   before (once the candidate is also the newest ready revision), or
 *   `<candidate>=100 <stable>=0` otherwise.
 * - **abort** — `--revision-weight <stable>=100 <candidate>=0` mid-rollout;
 *   run by hand, `<stable>=100` to the revision set with `.stable(...)`.
 *
 * Every call after `stage` that has its record — expose, promote, and abort
 * mid-rollout — compares the configured app, resource group and `az` flags
 * with the record, reads the app and checks its resource id (which names the
 * subscription), and refuses on any difference before changing anything.
 * Expose and promote also check that the traffic still goes only to the
 * stable revision and the candidate, and that the candidate is the revision
 * staged. Every command after the check carries `--subscription` with the
 * subscription the checked id names, so a default subscription that changes
 * in the meantime cannot redirect it. The CLI has no conditional update for
 * ingress traffic, so a change landing between a read and the write that
 * follows it is not caught.
 */
export function containerAppCanary(
  configure: Configure<AzContainerAppCanarySettings>,
): AzContainerAppCanary {
  return new AzContainerAppCanary(configure);
}
