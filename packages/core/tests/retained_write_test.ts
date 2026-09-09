// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for a **retained** write — one the store refused, whose mutation
 * stays in the writer's in-memory record for a later write to carry.
 *
 * The contract that promise makes is only kept while that record survives. The
 * conflict path replaces it wholesale with a freshly read base, which takes any
 * waiting mutation with it, so the loss has to be reported the way every other
 * permanent loss is: a warning, and `degraded` on the record, which is what
 * stops a later resume trusting per-target progress that is missing a
 * transition that really happened.
 *
 * @module
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Redactor } from "../src/redact.ts";
import { RunStateWriter } from "../src/state/writer.ts";
import { MemStateStore, runRecord } from "./_fakes.ts";
import type { TargetStateHandle } from "../src/target.ts";

const NOW = "2026-09-09T12:00:00.000Z";

/** A writer over `store`, adopted on a running one-target run. */
async function adopted(store: MemStateStore): Promise<{
  writer: RunStateWriter;
  handle: TargetStateHandle;
  warnings: string[];
}> {
  const record = runRecord({
    id: "r1",
    rootTarget: "deploy",
    status: "running",
    targets: { deploy: { status: "running", meta: {} } },
  });
  const put = await store.putRun(record, null);
  assertEquals(put.ok, true);
  if (!put.ok) throw new Error("unreachable: the first put cannot conflict");
  const warnings: string[] = [];
  const writer = RunStateWriter.adopt(
    store,
    structuredClone(record),
    put.version,
    () => NOW,
    new Redactor(),
    (message) => warnings.push(message),
  );
  return { writer, handle: writer.stateHandle("deploy"), warnings };
}

Deno.test("a retained write lost to the next write's conflict is reported", async () => {
  const store = new MemStateStore();
  const { writer, handle, warnings } = await adopted(store);

  // Held back: the store errored, so the patch waits in the record for a later
  // write to carry it.
  store.failNextPut = true;
  assertEquals(await handle.trySet({ a: "1" }), false);
  assertEquals(writer.snapshot().degraded, undefined); // nothing lost yet

  // The write that was going to carry it conflicts once, re-reads a fresh base
  // — which has never seen `a` — and lands. `a` is gone for good.
  store.forceConflicts = 1;
  assertEquals(await handle.trySet({ b: "2" }), true);

  assertEquals(store.record?.targets.deploy.meta, { b: "2" });
  // The point of the fix: the record no longer claims to be complete.
  assertEquals(writer.snapshot().degraded, true);
  assertEquals(warnings.length, 2);
  assertStringIncludes(warnings[1], "held back and is now lost");
});

Deno.test("a retained write carried by the next write is not reported lost", async () => {
  const store = new MemStateStore();
  const { writer, handle, warnings } = await adopted(store);

  store.failNextPut = true;
  assertEquals(await handle.trySet({ a: "1" }), false);

  // This one lands with no conflict, so it persists the record the retained
  // patch is still sitting in — exactly what being retained promised.
  assertEquals(await handle.trySet({ b: "2" }), true);

  assertEquals(store.record?.targets.deploy.meta, { a: "1", b: "2" });
  // Nothing was lost, so nothing is marked: `degraded` means a mutation is
  // missing, and a resume refuses a record carrying it.
  assertEquals(writer.snapshot().degraded, undefined);
  assertEquals(warnings.length, 1); // only the store error itself

  // And the debt is settled, not merely paid once: a later conflict is an
  // ordinary conflict again. Without clearing the flag, every conflict for the
  // rest of the run would report a loss that already reached the store.
  store.forceConflicts = 1;
  assertEquals(await handle.trySet({ c: "3" }), true);
  assertEquals(writer.snapshot().degraded, undefined);
  assertEquals(warnings.length, 1);
});

Deno.test("an ordinary conflict with nothing retained reports no loss", async () => {
  const store = new MemStateStore();
  const { writer, handle, warnings } = await adopted(store);

  // A conflict on its own is routine — the writer re-reads and re-applies —
  // so it must not start marking records degraded.
  store.forceConflicts = 1;
  assertEquals(await handle.trySet({ a: "1" }), true);

  assertEquals(store.record?.targets.deploy.meta, { a: "1" });
  assertEquals(writer.snapshot().degraded, undefined);
  assertEquals(warnings.length, 0);
});
