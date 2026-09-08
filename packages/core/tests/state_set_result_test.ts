// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for what `ctx.state.set` reports back: `true` only when the patch
 * reached the store. Every way a write can be dropped — conflicted away,
 * errored, written onto a run this process no longer owns — answers `false`,
 * because a body checking the result is asking whether the value is durable
 * now, and each of those says it is not.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { Redactor } from "../src/redact.ts";
import { inMemoryStateHandle, RunStateWriter } from "../src/state/writer.ts";
import { MemStateStore, runRecord } from "./_fakes.ts";
import type { TargetStateHandle } from "../src/target.ts";

const NOW = "2026-09-08T12:00:00.000Z";

/** A writer over `store`, adopted on a running one-target run. */
async function adopted(
  store: MemStateStore,
  warn?: (message: string) => void,
): Promise<{ writer: RunStateWriter; handle: TargetStateHandle }> {
  const record = runRecord({
    id: "r1",
    rootTarget: "deploy",
    status: "running",
    targets: { deploy: { status: "running", meta: {} } },
  });
  const put = await store.putRun(record, null);
  assertEquals(put.ok, true);
  if (!put.ok) throw new Error("unreachable: the first put cannot conflict");
  const writer = RunStateWriter.adopt(
    store,
    structuredClone(record),
    put.version,
    () => NOW,
    new Redactor(),
    warn,
  );
  return { writer, handle: writer.stateHandle("deploy") };
}

Deno.test("a write that reaches the store reports true", async () => {
  const store = new MemStateStore();
  const { handle } = await adopted(store);
  assertEquals(await handle.trySet({ slot: "sit-7" }), true);
  assertEquals(store.record?.targets.deploy.meta, { slot: "sit-7" });
});

Deno.test("a write conflicted away for good reports false", async () => {
  const store = new MemStateStore();
  const warnings: string[] = [];
  const { writer, handle } = await adopted(store, (m) => warnings.push(m));
  store.forceConflicts = 99; // never lands

  // The failure a body most needs to hear about: the patch went with a base
  // that was replaced, so nothing carries it forward.
  assertEquals(await handle.trySet({ slot: "sit-7" }), false);
  assertEquals(writer.snapshot().degraded, true);
  assertEquals(warnings.length, 1);
  assertEquals(store.record?.targets.deploy.meta, {});
});

Deno.test("a write the store errored on reports false", async () => {
  const store = new MemStateStore();
  const { writer, handle } = await adopted(store);
  store.failNextPut = true;

  // Retained rather than lost — a later write may carry it — but it is not
  // durable now, which is the question `set` answers. So no `degraded` flag,
  // and still `false`.
  assertEquals(await handle.trySet({ slot: "sit-7" }), false);
  assertEquals(writer.snapshot().degraded, undefined);
});

Deno.test("a write onto a vanished run reports false", async () => {
  const store = new MemStateStore();
  const { handle } = await adopted(store);
  store.forceConflicts = 1;
  store.vanish = true; // pruned between the conflict and the re-read

  assertEquals(await handle.trySet({ slot: "sit-7" }), false);
});

Deno.test("a write from a process that no longer owns the run reports false", async () => {
  const store = new MemStateStore();
  const { handle, writer } = await adopted(store);
  writer.disown();

  // A disowned writer drops every write by design: the run has a new holder,
  // and this process must not claim its patch was recorded.
  assertEquals(await handle.trySet({ slot: "sit-7" }), false);
  assertEquals(store.record?.targets.deploy.meta, {});
});

Deno.test("a build with no state store always reports true", async () => {
  const handle = inMemoryStateHandle();
  // Nothing is persisted, but nothing is dropped either — answering `false`
  // would make every write of a store-less build look failed.
  assertEquals(await handle.trySet({ slot: "sit-7" }), true);
  assertEquals(handle.get(), { slot: "sit-7" });
});

Deno.test("a write re-applied onto a run settled elsewhere reports true", async () => {
  const store = new MemStateStore();
  const { handle } = await adopted(store);
  store.forceConflicts = 1;
  store.freshStatus = "cancelled"; // another process settled it mid-write

  // The writer deliberately re-applies target-level work onto the settler's
  // record so it is not lost to the compensation walk. That re-apply landed,
  // so the patch is durable and the body is told so.
  assertEquals(await handle.trySet({ slot: "sit-7" }), true);
  assertEquals(store.record?.targets.deploy.meta, { slot: "sit-7" });
});

Deno.test("a write whose re-apply also conflicts reports false", async () => {
  const store = new MemStateStore();
  const warnings: string[] = [];
  const { writer, handle } = await adopted(store, (m) => warnings.push(m));
  store.forceConflicts = 2; // the write conflicts, and so does the re-apply
  store.freshStatus = "cancelled";

  // The settler finalises from here, so no later write of ours carries it.
  assertEquals(await handle.trySet({ slot: "sit-7" }), false);
  assertEquals(writer.snapshot().degraded, true);
  assertEquals(warnings.length, 1);
});

Deno.test("a rejecting write is not also an unhandled rejection", async () => {
  const store = new MemStateStore();
  // The warning callback is called outside the persist try, so it can reject
  // the write — in production it writes to the reporter, which throws on a
  // closed pipe (`zuke build | head -1`). Deno kills the process on an
  // unhandled rejection, so the chain must not hold a second, unwatched copy.
  const { handle } = await adopted(store, () => {
    throw new Error("reporter is gone");
  });
  store.failNextPut = true;

  let caught: string | undefined;
  try {
    await handle.trySet({ slot: "sit-7" });
  } catch (error) {
    caught = error instanceof Error ? error.message : String(error);
  }
  // The caller sees it, which is what makes it handled.
  assertEquals(caught, "reporter is gone");
});
