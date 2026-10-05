// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The platform seam: what a canary needs from wherever it runs, and what an
 * analysis is handed. The engine calls only these; a Cloud Run, Kubernetes or
 * hand-written platform implements {@link CanaryPlatform}.
 *
 * @module
 */

import type {
  SummaryPairs,
  TargetStateHandle,
  ValidationContext,
} from "@zuke/core";

/**
 * How a platform exposes a candidate:
 *
 * - `"traffic"` — a share of requests, set exactly (a traffic split).
 * - `"replicas"` — a share of instances, quantised to whole replicas, so the
 *   achieved exposure can differ from the one requested.
 * - `"channel"` — a release channel (a dist-tag, a pre-release); there is no
 *   percentage, so a canary on it declares no steps.
 */
export type ExposureKind = "traffic" | "replicas" | "channel";

/**
 * What the engine hands a {@link CanaryPlatform} on each call.
 *
 * `state` is the one place a platform keeps the handles a later call needs —
 * the revision it staged, the stable one to return to. Every call of one
 * rollout gets the **same** durable state, so `abort` can read what `stage`
 * wrote, even in another process after a resume. Never put a secret in it: it
 * is persisted in plain JSON and shown by `zuke runs show`.
 */
export interface CanaryContext {
  /** The rollout's durable platform state, shared by every call. */
  readonly state: TargetStateHandle;
  /**
   * Aborted when the run is cancelled. Pass it to any network call. A
   * compensation (`abort` during a rollback) is handed one that never aborts:
   * the rollback is finished, not interrupted.
   */
  readonly signal: AbortSignal;
  /** Add key/value pairs to the calling target's row in the build summary. */
  reportSummary(pairs: SummaryPairs): void;
}

/**
 * A place a canary runs. The engine stages the candidate, moves its exposure
 * step by step, and then promotes it or aborts it — through these calls only.
 *
 * Rules the engine relies on:
 *
 * - `expose` is **absolute** (set exposure to `percent`, not add to it) and
 *   returns the exposure actually achieved, which may differ on a `"replicas"`
 *   platform. A repeated call with the same value is harmless — a resumed run
 *   repeats one that was interrupted.
 * - `promote` and `abort` are **idempotent**: either can run twice.
 * - `abort` must also work with **empty** state. A rollback reads the state
 *   `stage` wrote, but `zuke <rollout>.abort` run by hand is a fresh run that
 *   has none, so `abort` falls back to what its own configuration says the
 *   stable version is.
 */
export interface CanaryPlatform {
  /** How this platform measures exposure. */
  readonly exposure: ExposureKind;
  /** A short description for the build summary (`"Cloud Run service api"`). */
  describe(): string;
  /** Put the candidate in place at 0 % exposure; record handles in `ctx.state`. */
  stage(ctx: CanaryContext): Promise<void>;
  /** Set exposure to `percent` (0–100) and return the exposure achieved. */
  expose(percent: number, ctx: CanaryContext): Promise<number>;
  /** Send all traffic to the candidate and retire the old version. */
  promote(ctx: CanaryContext): Promise<void>;
  /** Return all traffic to the stable version and remove the candidate. */
  abort(ctx: CanaryContext): Promise<void>;
}

/**
 * What an analysis is handed: everything a core
 * {@link ValidationContext} carries — the target's name, the run's redactor,
 * and a `signal` — plus where the rollout stands.
 */
export interface CanaryAnalysisContext extends ValidationContext {
  /** The 1-based step being analysed; `0` for a canary with no steps. */
  readonly step: number;
  /** The exposure this step asked for, in percent. */
  readonly requested: number;
  /** The exposure the platform reported achieving, in percent. */
  readonly exposure: number;
}

/**
 * A health check run against a canary: throw to fail it, which rolls the
 * rollout back. Any core `Validation` is one, since a function that accepts a
 * plain {@link ValidationContext} accepts this richer context too.
 */
export interface CanaryAnalysis {
  /** A name for diagnostics (optional). */
  name?: string;
  /** Run the check; throw to fail it. */
  validate(context: CanaryAnalysisContext): void | Promise<void>;
}
