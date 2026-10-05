// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Turn a {@link CanarySettings} into the plan the component builds targets
 * from, refusing a settings lambda that could not roll out: no platform, steps
 * a platform cannot express, a bake override for a step that does not exist.
 * Runs when the build is constructed, so a mistake fails before anything
 * deploys.
 *
 * @module
 */

import { type LockSettings, parseDuration } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import { MAX_TIMER_MS } from "./bake.ts";
import { messageOf } from "./message.ts";
import { CanarySettings } from "./settings.ts";
import type { CanaryAnalysis, CanaryPlatform } from "./types.ts";

/** The in-flight analysis interval when none is set. */
const DEFAULT_ANALYSIS_INTERVAL = "1m";

/** One phase of a rollout: a step, or the single soak of a canary with no steps. */
export interface CanaryPhase {
  /** The bundle key the phase's targets live under: `step1`, …, or `soak`. */
  key: string;
  /** The 1-based step, or `0` for the soak. */
  step: number;
  /** The exposure the step sets, in percent; absent for the soak. */
  percent?: number;
  /** How long the phase bakes, in ms (`0` for no bake). */
  bakeMs: number;
}

/** A validated rollout, ready to become targets. */
export interface CanaryPlan {
  /** Where the canary runs. */
  platform: CanaryPlatform;
  /** The phases in order; empty when there is nothing to do between stage and promote. */
  phases: CanaryPhase[];
  /** The analyses each phase runs. */
  analyses: CanaryAnalysis[];
  /** How often an inline bake runs its analyses, in ms. */
  analysisIntervalMs: number;
  /** The approval gate, if any. */
  approval?: { signal: string; timeout?: string | number };
  /** The rollout's lock, if any. */
  lock?: Configure<LockSettings>;
  /** Whether bakes suspend the run. */
  durable: boolean;
}

/** Build and validate the plan `configure` describes. */
export function planCanary(configure: Configure<CanarySettings>): CanaryPlan {
  const settings = configure(new CanarySettings());
  const platform = settings.platform_;
  if (platform === undefined) {
    throw new Error("canary: no platform — call c.platform(...).");
  }
  const steps = settings.steps_;
  checkSteps(steps, platform);
  for (const step of settings.bakeAt_.keys()) {
    if (!Number.isInteger(step) || step < 1 || step > steps.length) {
      throw new Error(
        `canary: .bakeStep(${step}, …) names no step — the canary has ` +
          `${steps.length} step(s).`,
      );
    }
  }
  // An inline bake is a timer; a durable one compares recorded times, so only
  // the inline one is held under the longest timer.
  const bakeOf = (step: number): number => {
    const value = settings.bakeAt_.get(step) ?? settings.bake_;
    return value === undefined
      ? 0
      : duration("bake", value, true, !settings.durable_);
  };
  const phases: CanaryPhase[] = steps.map((percent, index) => ({
    key: `step${index + 1}`,
    step: index + 1,
    percent,
    bakeMs: bakeOf(index + 1),
  }));
  // A canary with no steps still bakes and analyses once, at whatever exposure
  // staging leaves it — a release channel's pre-release, say.
  const soakMs = bakeOf(0);
  if (
    phases.length === 0 &&
    (soakMs > 0 || settings.analyses_.length > 0)
  ) {
    phases.push({ key: "soak", step: 0, bakeMs: soakMs });
  }
  if (settings.approvalTimeout_ !== undefined) {
    if (settings.approval_ === undefined) {
      throw new Error(
        "canary: .approvalTimeout(...) without .approval(...) — there is no " +
          "gate to time out.",
      );
    }
    duration("approval timeout", settings.approvalTimeout_, false, false);
  }
  return {
    platform,
    phases,
    analyses: [...settings.analyses_],
    analysisIntervalMs: duration(
      "analysis interval",
      settings.analysisInterval_ ?? DEFAULT_ANALYSIS_INTERVAL,
      false,
      true,
    ),
    ...(settings.approval_ === undefined ? {} : {
      approval: {
        signal: settings.approval_,
        ...(settings.approvalTimeout_ === undefined
          ? {}
          : { timeout: settings.approvalTimeout_ }),
      },
    }),
    ...(settings.lock_ === undefined ? {} : { lock: settings.lock_ }),
    durable: settings.durable_,
  };
}

/** Refuse steps the platform cannot express, or that do not step up. */
function checkSteps(steps: number[], platform: CanaryPlatform): void {
  if (steps.length > 0 && platform.exposure === "channel") {
    throw new Error(
      `canary: ${platform.describe()} exposes a release channel, not a ` +
        `percentage — declare no .steps(...).`,
    );
  }
  let previous = 0;
  for (const percent of steps) {
    if (!Number.isFinite(percent) || percent <= previous || percent >= 100) {
      throw new Error(
        `canary: .steps(${steps.join(", ")}) must increase, each above 0 and ` +
          `below 100 — promotion is the implicit 100 %.`,
      );
    }
    previous = percent;
  }
}

/**
 * Parse a duration, naming the setting when it is malformed or out of range.
 * A `timer` duration becomes a `setTimeout`, so it must fit one.
 */
function duration(
  label: string,
  value: string | number,
  zeroAllowed: boolean,
  timer: boolean,
): number {
  let ms: number;
  try {
    ms = parseDuration(value);
  } catch (error) {
    throw new Error(`canary: ${label} ${String(value)} — ${messageOf(error)}`);
  }
  if (!zeroAllowed && ms === 0) {
    throw new Error(`canary: ${label} must be positive, got ${String(value)}.`);
  }
  if (timer && ms > MAX_TIMER_MS) {
    throw new Error(
      `canary: ${label} ${String(value)} is longer than the longest timer ` +
        `(about 24 days).`,
    );
  }
  return ms;
}
