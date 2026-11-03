// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The reviewers as a task: what a build another SDK hosts calls through the
 * engine's `tool.call`, since it cannot plug a {@link Validation} into a target
 * of its own. `AiTasks.review` runs the configured reviewers the way the
 * scheduler runs a target's `.validateBefore(...)` list: in order, as peers of
 * one target, so they post one combined pull-request comment; a tripped gate
 * throws, which fails the call. `AiTasks.preflight` runs their preflight, the
 * check a comment-started run makes before anything else.
 *
 * @module
 */

import { redactLine, type ValidationContext } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  correctnessReviewer,
  genericReviewer,
  licenseReviewer,
  type Reviewer,
  secretsReviewer,
  securityReviewer,
} from "./reviewer.ts";

/**
 * The reviewers one `AiTasks.review` runs, as `.validateBefore(a, b)` would
 * run them, and the target they review for.
 */
export class ReviewSettings {
  #target = "review";
  #reviewers: Reviewer[] = [];

  /** The target the reviewers are attached to, named in their output; `review` by default. */
  target(name: string): this {
    this.#target = name;
    return this;
  }

  /** Add a code-quality reviewer, as {@link genericReviewer} makes it. */
  generic(configure?: Configure<Reviewer>): this {
    this.#reviewers.push(genericReviewer(configure));
    return this;
  }

  /** Add a security reviewer, as {@link securityReviewer} makes it. */
  security(configure?: Configure<Reviewer>): this {
    this.#reviewers.push(securityReviewer(configure));
    return this;
  }

  /** Add a leaked-secrets reviewer, as {@link secretsReviewer} makes it. */
  secrets(configure?: Configure<Reviewer>): this {
    this.#reviewers.push(secretsReviewer(configure));
    return this;
  }

  /** Add a correctness reviewer, as {@link correctnessReviewer} makes it. */
  correctness(configure?: Configure<Reviewer>): this {
    this.#reviewers.push(correctnessReviewer(configure));
    return this;
  }

  /** Add a license reviewer, as {@link licenseReviewer} makes it. */
  license(configure?: Configure<Reviewer>): this {
    this.#reviewers.push(licenseReviewer(configure));
    return this;
  }

  /** The target name. */
  get target_(): string {
    return this.#target;
  }

  /** The reviewers, in the order they were added. */
  get reviewers_(): readonly Reviewer[] {
    return this.#reviewers;
  }
}

/** The tasks of {@link AiTasks}. */
export interface AiTasksApi {
  /**
   * Run the configured reviewers as peers of one target, in order. Throws when
   * a reviewer's gate trips, as the target it guards would fail.
   */
  review(configure: Configure<ReviewSettings>): Promise<void>;
  /**
   * Run the reviewers' preflight: on a comment-started run, refuse a commenter
   * who may not start a review. A no-op on any other run.
   */
  preflight(configure: Configure<ReviewSettings>): Promise<void>;
}

/** The reviewers' context: one run, every reviewer a peer, the run's secrets masked. */
function contextOf(settings: ReviewSettings): ValidationContext {
  return {
    target: settings.target_,
    redact: redactLine,
    runId: crypto.randomUUID(),
    peers: settings.reviewers_,
  };
}

/** Typed task functions over the reviewers, for a build that calls rather than declares them. */
export const AiTasks: AiTasksApi = {
  async review(configure: Configure<ReviewSettings>): Promise<void> {
    const settings = configure(new ReviewSettings());
    const context = contextOf(settings);
    for (const reviewer of settings.reviewers_) {
      await reviewer.validate(context);
    }
  },
  async preflight(configure: Configure<ReviewSettings>): Promise<void> {
    const settings = configure(new ReviewSettings());
    const context = contextOf(settings);
    for (const reviewer of settings.reviewers_) {
      await reviewer.preflight(context);
    }
  },
};
