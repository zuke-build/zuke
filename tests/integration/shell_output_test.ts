import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { $ } from "../../packages/core/src/shell.ts";
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
