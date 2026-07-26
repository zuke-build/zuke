import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { $ } from "../../packages/core/src/shell.ts";
import { ToolSettings } from "../../packages/core/src/tooling.ts";
import { runCli } from "./_harness.ts";

// A child that writes far more than the cap: the target must still succeed, and
// what it reports must be the END of the output, flagged as truncated.
const EMIT =
  `for (let i = 0; i < 64; i++) console.log(String(i).padStart(4, "0") + "y".repeat(1019));`;

class ChattyBuild extends Build {
  chatty = target()
    .description("capture a child that outruns the capture cap")
    .executes(async () => {
      const out = await $`${Deno.execPath()} eval ${EMIT}`
        .quiet()
        .maxCapturedBytes(4096)
        .then();
      const lines = out.stdout.trimEnd().split("\n");
      console.log(
        `code=${out.code} truncated=${out.truncated} ` +
          `bytes=${out.stdout.length} last=${
            lines[lines.length - 1].slice(0, 4)
          }`,
      );
    });
}

Deno.test("a build capturing oversized output succeeds and reports truncation", async () => {
  const { code, out } = await runCli(ChattyBuild, ["chatty"]);
  assertEquals(code, 0);
  assertStringIncludes(out, "code=0 truncated=true");
  // The retained slice is bounded…
  assertStringIncludes(out, "bytes=4096");
  // …and it is the tail: the last line the child wrote is line 63.
  assertStringIncludes(out, "last=0063");
});

/** A tool wrapper, the surface every `*Tasks` package funnels through. */
class EmitSettings extends ToolSettings {
  protected override defaultTool(): string {
    return Deno.execPath();
  }
  protected override buildArgs(): string[] {
    return ["eval", EMIT];
  }
}

class WrapperBuild extends Build {
  capped = target()
    .description("cap a tool wrapper's captured output")
    .executes(async () => {
      const out = await new EmitSettings().quiet().maxCapturedBytes(4096).run();
      console.log(
        `truncated=${out.truncated} cap=${out.maxCapturedBytes} ` +
          `bytes=${out.stdout.length}`,
      );
    });

  badCap = target()
    .description("ask a tool wrapper for a cap capture cannot honour")
    .executes(async () => {
      await new EmitSettings().quiet().maxCapturedBytes(-1).run();
    });
}

Deno.test("a tool wrapper can cap its captured output through the settings lambda", async () => {
  const { code, out } = await runCli(WrapperBuild, ["capped"]);
  assertEquals(code, 0);
  assertStringIncludes(out, "truncated=true cap=4096 bytes=4096");
});

Deno.test("an impossible wrapper cap fails the target with a friendly error", async () => {
  const { code, err } = await runCli(WrapperBuild, ["badCap"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "maxCapturedBytes");
  assertStringIncludes(err, "positive whole number");
});
