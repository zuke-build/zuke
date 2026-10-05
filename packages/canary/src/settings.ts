// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link CanarySettings}: the fluent settings lambda `canary((c) => …)` takes.
 *
 * @module
 */

import type { LockSettings } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import type { CanaryAnalysis, CanaryPlatform } from "./types.ts";

/**
 * How a canary rolls out, configured through `canary((c) => …)`:
 *
 * ```ts
 * rollout = canary((c) =>
 *   c.platform(myPlatform)
 *     .steps(10, 25, 50)
 *     .bake("10m")
 *     .analysis(httpProbe((h) => h.url(HEALTHZ)))
 *     .approval("canary-approved")
 *     .lock((l) => l.lockKey("deploy", "api").withTtl("24h"))
 * );
 * ```
 *
 * The lambda runs once, when the build is constructed, because it decides
 * which targets exist. Anything that reads a parameter — an image tag, a URL —
 * belongs inside the platform's or the analysis's own lambda, which runs when
 * the target does.
 */
export class CanarySettings {
  /** Where the canary runs (set by {@link platform}). */
  platform_?: CanaryPlatform;
  /** The exposure after each step, in percent (set by {@link steps}). */
  steps_: number[] = [];
  /** How long each step bakes by default (set by {@link bake}). */
  bake_?: string | number;
  /** Per-step bake overrides, by 1-based step (set by {@link bakeStep}). */
  readonly bakeAt_ = new Map<number, string | number>();
  /** The analyses each step runs (set by {@link analysis}). */
  readonly analyses_: CanaryAnalysis[] = [];
  /** How often a bake runs its analyses in flight (set by {@link analysisInterval}). */
  analysisInterval_?: string | number;
  /** The signal the approval gate waits for (set by {@link approval}). */
  approval_?: string;
  /** How long the approval gate waits (set by {@link approvalTimeout}). */
  approvalTimeout_?: string | number;
  /** The rollout's lock, held for the whole run (set by {@link lock}). */
  lock_?: Configure<LockSettings>;
  /** Whether bakes suspend the run instead of sleeping (set by {@link durable}). */
  durable_ = false;

  /** Where the canary runs: a platform adapter, or a hand-written object. */
  platform(platform: CanaryPlatform): this {
    this.platform_ = platform;
    return this;
  }

  /**
   * The exposure after each step, in percent and increasing — `steps(10, 25,
   * 50)` exposes 10 %, then 25 %, then 50 %, and promotion takes it to 100 %.
   * A `"channel"` platform has no percentage and declares no steps.
   */
  steps(...percents: number[]): this {
    this.steps_ = percents;
    return this;
  }

  /** How long every step bakes before its final analysis (`"10m"`, or ms). */
  bake(duration: string | number): this {
    this.bake_ = duration;
    return this;
  }

  /** How long one step (1-based) bakes, overriding {@link bake} for it. */
  bakeStep(step: number, duration: string | number): this {
    this.bakeAt_.set(step, duration);
    return this;
  }

  /**
   * Health checks run against each step: on an interval while it bakes (inline
   * bakes only) and once when it ends. Any core `Validation` works.
   */
  analysis(...analyses: CanaryAnalysis[]): this {
    this.analyses_.push(...analyses);
    return this;
  }

  /** How often an inline bake runs its analyses (default `"1m"`). */
  analysisInterval(duration: string | number): this {
    this.analysisInterval_ = duration;
    return this;
  }

  /**
   * Wait for an external signal before promoting —
   * `zuke resume <run-id> --signal <name>` delivers it.
   */
  approval(signal: string): this {
    this.approval_ = signal;
    return this;
  }

  /** How long the approval gate waits before rolling the canary back. */
  approvalTimeout(duration: string | number): this {
    this.approvalTimeout_ = duration;
    return this;
  }

  /**
   * Lock the rollout for the whole run, from staging to promotion or rollback
   * — a core lock settings lambda, held with `holdForRun()`. Set its TTL to
   * cover the longest the run can stay parked at a gate.
   */
  lock(configure: Configure<LockSettings>): this {
    this.lock_ = configure;
    return this;
  }

  /**
   * Bake by suspending the run instead of sleeping in the process: each bake
   * becomes a gate that `zuke resume --check` reopens once its time is up.
   * Needs a state store. In-flight analyses do not run (no process is there to
   * run them); each step's final analysis does.
   */
  durable(): this {
    this.durable_ = true;
    return this;
  }
}
