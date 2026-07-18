/**
 * Integration: `ctx.stateOf(ctx.target)` is equivalent to `ctx.state` even for a
 * **store-less** build (no state store configured). Guards the documented
 * invariant against a regression where the store-less branch allocated a fresh
 * empty in-memory handle per `stateOf` call, silently dropping reads and writes.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

Deno.test("store-less ctx.stateOf(self) is equivalent to ctx.state", async () => {
  // Ensure no store resolves, so env.writer is undefined (the store-less path).
  const keys = ["ZUKE_STATE_DIR", "ZUKE_STATE_URL"];
  const saved = keys.map((k) => [k, Deno.env.get(k)] as const);
  for (const k of keys) Deno.env.delete(k);

  const log: string[] = [];
  try {
    class Solo extends Build {
      only = target().executes(async (ctx) => {
        await ctx.state.set({ version: "1.2.3" });
        // stateOf(self) must see the write ctx.state just made…
        log.push(JSON.stringify(ctx.stateOf(ctx.target).get()));
        // …and a write through stateOf(self) must land in ctx.state.
        await ctx.stateOf(ctx.target).set({ k: 1 });
        log.push(JSON.stringify(ctx.state.get()));
      });
    }
    const res = await runCli(Solo, ["only"]);
    assertEquals(res.code, 0);
    assertEquals(log, [
      '{"version":"1.2.3"}',
      '{"version":"1.2.3","k":1}',
    ]);
  } finally {
    for (const [k, v] of saved) if (v !== undefined) Deno.env.set(k, v);
  }
});
