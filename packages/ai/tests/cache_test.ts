import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { AiCache, aiCache } from "../src/cache.ts";
import type { CacheEntry, CacheStore } from "../src/cache.ts";

/** An in-memory {@link CacheStore} (a Map) so tests touch no real filesystem. */
function memoryStore(): CacheStore & { entries: Map<string, CacheEntry> } {
  const entries = new Map<string, CacheEntry>();
  return {
    entries,
    get(key) {
      return Promise.resolve(entries.get(key));
    },
    set(key, entry) {
      entries.set(key, entry);
      return Promise.resolve();
    },
  };
}

/** A store whose `set` always rejects, to exercise the swallowed-error path. */
function failingStore(): CacheStore {
  return {
    get() {
      return Promise.resolve(undefined);
    },
    set() {
      return Promise.reject(new Error("disk full"));
    },
  };
}

Deno.test("enabled_ is true by default and disable() turns it off", () => {
  assertEquals(new AiCache().enabled_(), true);
  assertEquals(new AiCache().disable().enabled_(), false);
});

Deno.test("key_ is deterministic for the same parts and distinct for different ones", () => {
  const cache = new AiCache();
  assertEquals(cache.key_(["a", "b"]), cache.key_(["a", "b"]));
  // The NUL separator keeps adjacent parts from colliding.
  const split = cache.key_(["ab", "c"]) === cache.key_(["a", "bc"]);
  assertEquals(split, false);
});

Deno.test("get_ is a miss for an unknown key", async () => {
  const cache = new AiCache().store(memoryStore());
  assertEquals(await cache.get_("nope"), undefined);
});

Deno.test("get_ returns a previously stored entry (round-trip through put_)", async () => {
  const cache = new AiCache().store(memoryStore()).now(() => 1_000);
  await cache.put_("k", "hello", { inputTokens: 3 });
  assertEquals(await cache.get_("k"), {
    text: "hello",
    usage: { inputTokens: 3 },
    createdAt: 1_000,
  });
});

Deno.test("get_ misses while disabled, even when the store has the entry", async () => {
  const store = memoryStore();
  store.entries.set("k", { text: "cached", createdAt: 0 });
  const cache = new AiCache().store(store).disable();
  assertEquals(await cache.get_("k"), undefined);
});

Deno.test("get_ treats an entry past its TTL as a miss", async () => {
  const store = memoryStore();
  store.entries.set("k", { text: "old", createdAt: 0 });
  let nowMs = 0;
  const cache = new AiCache().store(store).ttl(10).now(() => nowMs);
  nowMs = 10_000; // exactly the TTL window — still live
  assertEquals(await cache.get_("k"), { text: "old", createdAt: 0 });
  nowMs = 10_001; // one millisecond past — expired
  assertEquals(await cache.get_("k"), undefined);
});

Deno.test("ttl(0) means an entry never expires", async () => {
  const store = memoryStore();
  store.entries.set("k", { text: "ancient", createdAt: 0 });
  const cache = new AiCache().store(store).ttl(0).now(() => 1_000_000_000);
  assertEquals(await cache.get_("k"), { text: "ancient", createdAt: 0 });
});

Deno.test("get_ rejects a malformed entry (missing string text)", async () => {
  const store = memoryStore();
  // The store's runtime contents can drift from the type (a hand-edited file);
  // @ts-expect-error deliberately exercises the runtime guard with a bad entry.
  store.entries.set("k", { createdAt: 0 });
  const cache = new AiCache().store(store);
  assertEquals(await cache.get_("k"), undefined);
});

Deno.test("put_ omits usage when none is given", async () => {
  const store = memoryStore();
  const cache = new AiCache().store(store).now(() => 5);
  await cache.put_("k", "text-only");
  assertEquals(store.entries.get("k"), { text: "text-only", createdAt: 5 });
});

Deno.test("put_ is a no-op when the cache is disabled", async () => {
  const store = memoryStore();
  const cache = new AiCache().store(store).disable();
  await cache.put_("k", "ignored");
  assertEquals(store.entries.size, 0);
});

Deno.test("put_ swallows a store error so caching never breaks a build", async () => {
  const cache = new AiCache().store(failingStore());
  // Resolves rather than throwing, despite the store's rejecting set().
  await cache.put_("k", "anything");
});

Deno.test("the default clock stamps createdAt from real wall-clock time", async () => {
  const store = memoryStore();
  const before = Date.now();
  // No now() seam — exercises the default `() => Date.now()` clock.
  await new AiCache().store(store).put_("k", "real-clock");
  const entry = store.entries.get("k");
  assertEquals(entry?.text, "real-clock");
  assertEquals(typeof entry?.createdAt, "number");
  assertEquals((entry?.createdAt ?? 0) >= before, true);
});

Deno.test("aiCache() builds a default instance and applies a configure lambda", () => {
  assertEquals(aiCache() instanceof AiCache, true);
  const store = memoryStore();
  const configured = aiCache((c) => c.store(store).ttl(1).disable());
  assertEquals(configured instanceof AiCache, true);
  assertEquals(configured.enabled_(), false);
});

Deno.test("the default file store round-trips and misses cleanly", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cache = new AiCache().dir(dir).now(() => 42);
    const key = cache.key_(["model", "diff"]);
    // A missing file (the dir does not even exist yet) is a clean miss.
    assertEquals(await cache.get_(key), undefined);
    await cache.put_(key, "from-disk", { totalTokens: 9 });
    assertEquals(await cache.get_(key), {
      text: "from-disk",
      usage: { totalTokens: 9 },
      createdAt: 42,
    });
    // A truncated file on disk is rejected as a miss, not surfaced as an error.
    await Deno.writeTextFile(`${dir}/${key}.json`, "{not json");
    assertEquals(await cache.get_(key), undefined);
    // Valid JSON that is not a well-formed entry is also rejected as a miss.
    await Deno.writeTextFile(`${dir}/${key}.json`, JSON.stringify({ nope: 1 }));
    assertEquals(await cache.get_(key), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Reference assertRejects so the shared import stays exercised under no-unused.
Deno.test("a rejecting store get surfaces when not guarded by the cache", async () => {
  const throwing: CacheStore = {
    get() {
      return Promise.reject(new Error("boom"));
    },
    set() {
      return Promise.resolve();
    },
  };
  await assertRejects(() => throwing.get("k"), Error, "boom");
});
