import { assertEquals } from "../../core/tests/_assert.ts";
import { spanIdFor, traceIdFor } from "../src/ids.ts";

const HEX = /^[0-9a-f]+$/;

Deno.test("traceIdFor is 16 bytes of lowercase hex", async () => {
  const id = await traceIdFor("run-abc");
  assertEquals(id.length, 32);
  assertEquals(HEX.test(id), true);
});

Deno.test("spanIdFor is 8 bytes of lowercase hex", async () => {
  const id = await spanIdFor("run-abc", "run");
  assertEquals(id.length, 16);
  assertEquals(HEX.test(id), true);
});

Deno.test("ids are deterministic — the same inputs give the same id", async () => {
  // This is the whole cross-process story: two processes hashing the same run
  // id land the same trace id, with no handoff.
  assertEquals(await traceIdFor("run-1"), await traceIdFor("run-1"));
  assertEquals(
    await spanIdFor("run-1", "build"),
    await spanIdFor("run-1", "build"),
  );
});

Deno.test("different runs get different trace ids", async () => {
  const a = await traceIdFor("run-1");
  const b = await traceIdFor("run-2");
  assertEquals(a === b, false);
});

Deno.test("different targets get different span ids within a run", async () => {
  const run = await spanIdFor("run-1", "run");
  const lint = await spanIdFor("run-1", "lint");
  const test = await spanIdFor("run-1", "test");
  assertEquals(run === lint, false);
  assertEquals(lint === test, false);
});

Deno.test("the same target key in different runs gets different span ids", async () => {
  const a = await spanIdFor("run-1", "lint");
  const b = await spanIdFor("run-2", "lint");
  assertEquals(a === b, false);
});
