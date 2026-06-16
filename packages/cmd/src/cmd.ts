/**
 * `CmdTasks` — the generic command fallback for tools without a dedicated
 * wrapper package. Same fluent settings base and execution machinery as the
 * typed wrappers; arguments stay a discrete argv array, never a shell string.
 *
 * ```ts
 * import { CmdTasks } from "jsr:@zuke/cmd";
 * await CmdTasks.exec("git", (s) => s.args("rev-parse", "HEAD"));
 * ```
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Settings for a generic command: the tool name plus raw arguments. */
export class CmdSettings extends ToolSettings {
  #tool: string;

  constructor(tool: PathLike) {
    super();
    if (!tool) throw new Error("CmdTasks.exec: tool name is required.");
    this.#tool = String(tool);
  }

  protected override defaultTool(): string {
    return this.#tool;
  }

  protected override buildArgs(): string[] {
    return [];
  }
}

/** The shape of {@link CmdTasks}. */
export interface CmdTasksApi {
  /** Run `tool` with the configured settings. */
  exec(
    tool: PathLike,
    configure?: Configure<CmdSettings>,
  ): Promise<CommandOutput>;
}

/** Task functions for running arbitrary tools. */
export const CmdTasks: CmdTasksApi = {
  /**
   * Run `tool` with the configured settings.
   *
   * @example `await CmdTasks.exec("git", (s) => s.args("status", "-s"))`
   */
  exec(
    tool: PathLike,
    configure?: Configure<CmdSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new CmdSettings(tool), configure);
  },
};
