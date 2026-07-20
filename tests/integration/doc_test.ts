import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

// The `doc` command is build-independent; any build serves to reach it.
class Noop extends Build {
  noop = target().executes(() => {});
}

Deno.test("zuke doc runs deno doc for a local module in an isolated cwd", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-doc-it-" });
  try {
    const mod = `${dir}/lib.ts`;
    await Deno.writeTextFile(
      mod,
      '/** A documented greeting. */\nexport function greet(): string {\n  return "hi";\n}\n',
    );
    // The default runner spawns a real `deno doc` (offline for a self-contained
    // local module) from a fresh empty temp dir; success proves the isolation
    // path end-to-end. Output goes to inherited stdout, so assert the exit code.
    const ok = await runCli(Noop, ["doc", mod]);
    assertEquals(ok.code, 0);

    // A spec deno doc cannot resolve fails, and that failure is propagated.
    const missing = await runCli(Noop, ["doc", `${dir}/does-not-exist.ts`]);
    assertEquals(missing.code !== 0, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
