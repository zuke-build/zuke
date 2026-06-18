/**
 * The plugin contract: observe a build's lifecycle without subclassing
 * {@link Build} or forking Zuke.
 *
 * A {@link Plugin} is a plain object with optional async hooks. Register one (or
 * several) by passing them to {@link run} or {@link execute}; every hook a
 * plugin implements is invoked alongside the build's own lifecycle methods, in
 * registration order. Plugins observe — they report, time, or notify — they do
 * not alter the plan or a target's result.
 *
 * ```ts
 * import { type Plugin, run } from "jsr:@zuke/core";
 *
 * const timing: Plugin = {
 *   name: "timing",
 *   onTargetEnd: (target, status) => console.log(`${target}: ${status}`),
 * };
 *
 * if (import.meta.main) await run(MyBuild, { plugins: [timing] });
 * ```
 *
 * @module
 */

import type { BuildResult, TargetStatus } from "./build.ts";

/**
 * A lifecycle observer. Every hook is optional; implement only the ones you
 * need. Hooks may be async — the executor awaits each before continuing.
 */
export interface Plugin {
  /** A name for diagnostics (optional). */
  name?: string;
  /** Called once before any target runs. */
  onStart?(): void | Promise<void>;
  /** Called just before a target's body executes (not for skipped/cached). */
  onTargetStart?(target: string): void | Promise<void>;
  /** Called after each target settles, with its final status. */
  onTargetEnd?(target: string, status: TargetStatus): void | Promise<void>;
  /** Called once after the run completes (success or failure). */
  onFinish?(result: BuildResult): void | Promise<void>;
}
