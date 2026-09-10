// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fixture for {@link file://../windows_shim_e2e.ts}: run a real `node_modules`
 * batch shim through a real {@link ToolSettings}, passing an operand that
 * `cmd.exe` would act on if anything re-parsed the command line.
 *
 * The shim is planted by the test in `ZUKE_SHIM_DIR`; the target passes
 * `ZUKE_SHIM_ARG` to it verbatim and prints what the shim echoed back, so the
 * test can assert the operand survived as exactly one argument.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";
import { ToolSettings } from "../../../packages/core/src/tooling.ts";

/** Settings for the planted shim: no subcommand, just the caller's operand. */
class ShimSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "zuke-shim";
  }
  protected override defaultResolution(): "path" | "node_modules" {
    return "node_modules";
  }
  protected override buildArgs(): string[] {
    return [];
  }
}

class ShimBuild extends Build {
  spawn = target()
    .description("Spawn the planted batch shim with an untrusted operand")
    .executes(async () => {
      const operand = Deno.env.get("ZUKE_SHIM_ARG") ?? "";
      const out = await new ShimSettings()
        .cwd(Deno.env.get("ZUKE_SHIM_DIR") ?? ".")
        .args(operand)
        .quiet()
        .run();
      // One line per argument the shim actually received.
      console.log(`SHIM_STDOUT_BEGIN\n${out.stdout.trim()}\nSHIM_STDOUT_END`);
    });
}

await run(ShimBuild);
