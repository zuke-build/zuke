// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A recording {@link CanaryPlatform} for the canary tests: every call is
 * logged with what the platform state held at that moment, and any call can
 * be made to fail.
 *
 * @module
 */

import type { CanaryContext, CanaryPlatform, ExposureKind } from "../mod.ts";

/** The calls a {@link FakePlatform} can be told to fail. */
export type FakeCall = "stage" | "expose" | "promote" | "abort";

/** A platform that records what the engine asked of it. */
export class FakePlatform implements CanaryPlatform {
  /** Every call, in order: `stage`, `expose 10`, `promote rev-2`, `abort rev-1`. */
  readonly calls: string[] = [];
  /** The exposure kind it claims. */
  readonly exposure: ExposureKind;
  /** The call to fail, if any. */
  failOn?: FakeCall;
  /** What `expose` reports achieving for a requested percent. */
  achieve: (percent: number) => number = (percent) => percent;

  /** A fake of the given exposure kind. */
  constructor(exposure: ExposureKind = "traffic") {
    this.exposure = exposure;
  }

  /** A fixed description. */
  describe(): string {
    return "fake service";
  }

  /** Records the candidate and the stable revision. */
  async stage(ctx: CanaryContext): Promise<void> {
    this.calls.push("stage");
    await ctx.state.set({ candidate: "rev-2", stable: "rev-1" });
    ctx.reportSummary({ Candidate: "rev-2" });
    this.maybeFail("stage");
  }

  /** Records the exposure. */
  expose(percent: number, ctx: CanaryContext): Promise<number> {
    this.calls.push(`expose ${percent} ${String(ctx.state.get().candidate)}`);
    this.maybeFail("expose");
    return Promise.resolve(this.achieve(percent));
  }

  /** Records the candidate it promotes. */
  promote(ctx: CanaryContext): Promise<void> {
    this.calls.push(`promote ${String(ctx.state.get().candidate)}`);
    this.maybeFail("promote");
    return Promise.resolve();
  }

  /** Records the stable revision it returns to. */
  abort(ctx: CanaryContext): Promise<void> {
    this.calls.push(`abort ${String(ctx.state.get().stable ?? "-")}`);
    this.maybeFail("abort");
    return Promise.resolve();
  }

  private maybeFail(call: FakeCall): void {
    if (this.failOn === call) throw new Error(`${call} failed`);
  }
}
