// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `canary(...)`: the component that turns a {@link CanarySettings} lambda into
 * a rollout's targets — stage, a phase per step, an optional approval, the
 * promotion, and the one rollback every failure path reaches.
 *
 * @module
 */

import {
  externalSignal,
  target,
  type TargetBuilder,
  type TargetContext,
  type TargetStateHandle,
  type Validation,
  type ValidationContext,
} from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { bakeElapsed, bakeFor } from "./bake.ts";
import { type CanaryPhase, planCanary } from "./plan.ts";
import type { CanarySettings } from "./settings.ts";
import { messageOf } from "./message.ts";
import type {
  CanaryAnalysis,
  CanaryAnalysisContext,
  CanaryContext,
  CanaryPlatform,
} from "./types.ts";

/** The targets of one phase of a rollout. */
export interface CanaryPhaseTargets {
  /** Sets the step's exposure; absent for the soak of a canary with no steps. */
  expose?: TargetBuilder;
  /** Waits out the bake; absent when the phase does not bake. */
  bake?: TargetBuilder;
  /** Runs the analyses once at the end; absent when there are none. */
  analyze?: TargetBuilder;
}

/**
 * The targets `canary(...)` creates. Assigned to a build field — `rollout =
 * canary(…)` — they are named under it: `rollout.stage`, `rollout.step1.expose`,
 * `rollout.promote`, `rollout.abort`. Depend on `this.rollout.promote` to run
 * after a successful rollout.
 */
export interface Canary {
  /** Puts the candidate in place at 0 % and takes the rollout's lock. */
  stage: TargetBuilder;
  /** The external-signal gate before promotion, when one is configured. */
  approve?: TargetBuilder;
  /** Sends all traffic to the candidate. Re-driven by a resume. */
  promote: TargetBuilder;
  /** The rollback: every failure path runs it, and it can be run by hand. */
  abort: TargetBuilder;
  /** The single phase of a canary with no steps, when it bakes or analyses. */
  soak?: CanaryPhaseTargets;
  /** A phase per step: `step1`, `step2`, … */
  [step: `step${number}`]: CanaryPhaseTargets;
}

/** Where a phase stands, as its analyses see it. */
interface PhaseView {
  step: number;
  requested: number;
  exposure: number;
  /**
   * The observing target's signal. Core hands a final `validateAfter` check
   * none, so without this a cancelled run would wait out every probe.
   */
  signal?: AbortSignal;
}

/**
 * Declare a canary rollout. The lambda runs when the build is constructed and
 * decides which targets exist; a misconfigured one throws there, naming the
 * fix.
 *
 * ```ts
 * class Deploy extends Build {
 *   rollout = canary((c) =>
 *     c.platform(myPlatform)
 *       .steps(10, 50)
 *       .bake("10m")
 *       .analysis(httpProbe((h) => h.url("https://api.example.com/healthz")))
 *       .lock((l) => l.lockKey("deploy", "api").withTtl("24h"))
 *   );
 *   ship = target().dependsOn(this.rollout.promote).executes(() => {});
 * }
 * ```
 */
export function canary(configure: Configure<CanarySettings>): Canary {
  const plan = planCanary(configure);
  const { platform } = plan;

  // The one rollback, built first so `stage` can name it. Run as `stage`'s
  // compensation, `ctx.state` is seeded with the stage's record — the handles
  // `stage` and every later call wrote. Run by hand, it is a fresh run with
  // none, which the platform contract covers; it takes the rollout's lock (for
  // its body only), so it is refused while a rollout holds the service.
  const abort = target()
    .description("Canary: roll back to the stable version")
    .executes(async (ctx) => {
      // A compensation after promotion — a later target cancelling the run —
      // must not return traffic to a version promotion already retired.
      if (ctx.state.get()[PROMOTED] === true) return;
      await platform.abort(canaryContext(ctx, ctx.state));
      ctx.reportSummary({ "Rolled back": platform.describe() });
    });

  const stage = target()
    .description("Canary: stage the candidate at 0 % exposure")
    .onCancel(abort)
    .executes(async (ctx) => {
      const canaryCtx = canaryContext(ctx, ctx.state);
      try {
        await platform.stage(canaryCtx);
      } catch (error) {
        // A stage that failed part-way, or was cut short by a cancellation,
        // may have left a candidate behind — and a target that did not succeed
        // is never compensated. Roll back here, while the handles are at hand,
        // under a signal the cancellation cannot cut short in turn.
        await rollBackStage(platform, { ...canaryCtx, signal: NEVER }, error);
      }
      ctx.reportSummary({ Platform: platform.describe() });
    });
  const lock = plan.lock;
  if (lock !== undefined) {
    stage.lock((s) => lock(s).holdForRun());
    abort.lock(lock);
  }

  // Every later target reads and writes the platform's handles where `stage`
  // keeps them, so a rollback finds them on the stage's record.
  const platformState = (ctx: TargetContext): TargetStateHandle =>
    ctx.stateOf(nameOf(stage));

  const bundle: Record<string, CanaryPhaseTargets> = {};
  let last = stage;
  for (const phase of plan.phases) {
    const targets: CanaryPhaseTargets = {};
    let expose: TargetBuilder | undefined;
    const percent = phase.percent;
    if (percent !== undefined) {
      expose = target()
        .description(`Canary: expose the candidate to ${percent} %`)
        .dependsOn(last)
        .onFailure(() => "cancel-run")
        .executes(async (ctx) => {
          const achieved = await platform.expose(
            percent,
            canaryContext(ctx, platformState(ctx)),
          );
          if (!Number.isFinite(achieved) || achieved < 0 || achieved > 100) {
            throw new Error(
              `canary: ${platform.describe()} reported an exposure of ` +
                `${achieved} for step ${phase.step} — expected 0 to 100.`,
            );
          }
          await ctx.state.set({ requested: percent, exposure: achieved });
          ctx.reportSummary({
            Exposure: achieved === percent
              ? `${percent}%`
              : `${achieved}% (requested ${percent}%)`,
          });
        });
      targets.expose = expose;
      last = expose;
    }

    // Where the phase stands, read once each target starts — after a resume
    // too, since the exposure comes from the expose target's record.
    let view: PhaseView = { step: phase.step, requested: 0, exposure: 0 };
    const exposeTarget = expose;
    const observe = (ctx: TargetContext): void => {
      view = { ...phaseView(phase, ctx, exposeTarget), signal: ctx.signal };
    };
    const analyses = plan.analyses.map((a) => withPhase(a, () => view));

    if (phase.bakeMs > 0) {
      const bakeMs = phase.bakeMs;
      const bake = target()
        .description(`Canary: bake ${phaseLabel(phase)}`)
        .dependsOn(last)
        .onFailure(() => "cancel-run");
      if (plan.durable) {
        bake.waitsFor((s) => s.on(bakeElapsed(bakeMs)));
      } else {
        bake.executes(async (ctx) => {
          observe(ctx);
          await bakeFor(bakeMs, ctx.signal);
        });
        if (analyses.length > 0) {
          bake.validateDuring((s) =>
            s.every(plan.analysisIntervalMs).check(...analyses)
          );
        }
      }
      targets.bake = bake;
      last = bake;
    }

    if (analyses.length > 0) {
      const analyze = target()
        .description(`Canary: analyse ${phaseLabel(phase)}`)
        .dependsOn(last)
        .onFailure(() => "cancel-run")
        .executes((ctx) => observe(ctx))
        .validateAfter(...analyses);
      targets.analyze = analyze;
      last = analyze;
    }
    bundle[phase.key] = targets;
  }

  let approve: TargetBuilder | undefined;
  const approval = plan.approval;
  if (approval !== undefined) {
    approve = target()
      .description(`Canary: wait for the "${approval.signal}" approval`)
      .dependsOn(last)
      .waitsFor((s) => {
        const gate = s.on(externalSignal(approval.signal));
        return approval.timeout === undefined
          ? gate
          : gate.timeout(approval.timeout).onTimeout(() => "cancel-run");
      });
    last = approve;
  }

  const promote = target()
    .description("Canary: promote the candidate to 100 %")
    .dependsOn(last)
    .onFailure(() => "cancel-run")
    .effect("promote", async (ctx) => {
      const state = platformState(ctx);
      await platform.promote(canaryContext(ctx, state));
      await state.set({ [PROMOTED]: true });
      ctx.reportSummary({ Promoted: platform.describe() });
    });

  return {
    stage,
    ...bundle,
    ...(approve === undefined ? {} : { approve }),
    promote,
    abort,
  };
}

/** The platform-state key `promote` marks a finished promotion with. */
const PROMOTED = "canaryPromoted";

/** A signal that never aborts, for a rollback nothing may interrupt. */
const NEVER: AbortSignal = new AbortController().signal;

/**
 * Roll back what a failed `stage` left, then rethrow its error — with the
 * rollback's own failure added, so neither is lost.
 */
async function rollBackStage(
  platform: CanaryPlatform,
  ctx: CanaryContext,
  cause: unknown,
): Promise<never> {
  try {
    await platform.abort(ctx);
  } catch (rollback) {
    throw new Error(
      `${messageOf(cause)} — and rolling back what stage left also failed: ` +
        `${messageOf(rollback)}`,
      { cause },
    );
  }
  throw cause;
}

/** The {@link CanaryContext} a platform call gets from a target's context. */
function canaryContext(
  ctx: TargetContext,
  state: TargetStateHandle,
): CanaryContext {
  return {
    state,
    signal: ctx.signal,
    reportSummary: (pairs) => ctx.reportSummary(pairs),
  };
}

/** A target's bound name; set when the build discovers its targets. */
function nameOf(t: TargetBuilder): string {
  const name = t.name_;
  if (name === undefined) {
    throw new Error(
      "canary: assign canary(...) to a build field — its targets are named " +
        "after it.",
    );
  }
  return name;
}

/** "step 2 (25 %)" or "the soak". */
function phaseLabel(phase: CanaryPhase): string {
  return phase.percent === undefined
    ? "the soak"
    : `step ${phase.step} (${phase.percent} %)`;
}

/** Where `phase` stands now: its step and the exposure its expose recorded. */
function phaseView(
  phase: CanaryPhase,
  ctx: TargetContext,
  expose: TargetBuilder | undefined,
): PhaseView {
  if (expose === undefined) {
    return { step: phase.step, requested: 0, exposure: 0 };
  }
  const recorded = ctx.stateOf(nameOf(expose)).get();
  const requested = phase.percent ?? 0;
  const exposure = recorded.exposure;
  return {
    step: phase.step,
    requested,
    exposure: typeof exposure === "number" ? exposure : requested,
  };
}

/** An analysis as a core `Validation`, handed where its phase stands. */
function withPhase(
  analysis: CanaryAnalysis,
  view: () => PhaseView,
): Validation {
  const validate = (context: ValidationContext) => {
    // The check's own context wins: an in-flight round's signal ends with the
    // round, which is narrower than the target's.
    const full: CanaryAnalysisContext = { ...view(), ...context };
    return analysis.validate(full);
  };
  return analysis.name === undefined
    ? { validate }
    : { name: analysis.name, validate };
}
