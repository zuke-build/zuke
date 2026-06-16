import { assertEquals } from "./_assert.ts";
import { target } from "../src/target.ts";
import {
  type CacheHost,
  defaultCacheHost,
  fingerprint,
  openCache,
} from "../src/cache.ts";

const enc = (text: string) => new TextEncoder().encode(text);

/** An in-memory {@link CacheHost} for hermetic cache tests. */
class MemHost implements CacheHost {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Map<string, string[]>();
  readonly stores = new Map<string, string>();

  readFile(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }
  stat(path: string): Promise<{ isDirectory: boolean } | null> {
    if (this.dirs.has(path)) return Promise.resolve({ isDirectory: true });
    if (this.files.has(path)) return Promise.resolve({ isDirectory: false });
    return Promise.resolve(null);
  }
  readDir(path: string): Promise<string[]> {
    return Promise.resolve(this.dirs.get(path) ?? []);
  }
  readStore(path: string): Promise<string | null> {
    return Promise.resolve(this.stores.get(path) ?? null);
  }
  writeStore(path: string, content: string): Promise<void> {
    this.stores.set(path, content);
    return Promise.resolve();
  }
}

const STORE = "/repo/.zuke/cache.json";

Deno.test("fingerprint changes with file content and with missing files", async () => {
  const host = new MemHost();
  host.files.set("a.txt", enc("one"));
  const t = target().inputs("a.txt");
  const first = await fingerprint(t, host);
  host.files.set("a.txt", enc("two"));
  const second = await fingerprint(t, host);
  assertEquals(first === second, false);

  const missing = target().inputs("gone.txt");
  const a = await fingerprint(missing, host);
  host.files.set("gone.txt", enc("now here"));
  const b = await fingerprint(missing, host);
  assertEquals(a === b, false); // appearance of the file changes the fingerprint
});

Deno.test("fingerprint hashes directories recursively", async () => {
  const host = new MemHost();
  host.dirs.set("src", ["a.ts", "b.ts"]);
  host.files.set("src/a.ts", enc("a"));
  host.files.set("src/b.ts", enc("b"));
  const t = target().inputs("src");
  const before = await fingerprint(t, host);
  host.files.set("src/b.ts", enc("b changed"));
  const after = await fingerprint(t, host);
  assertEquals(before === after, false);
});

Deno.test("a cache round-trip skips an unchanged target", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  const make = () => {
    const t = target().inputs("in.txt").outputs("out.txt");
    t.name_ = "build";
    return t;
  };

  const cache = await openCache(STORE, host);
  assertEquals(await cache.upToDate(make()), false); // nothing stored yet
  await cache.record(make());
  await cache.save();
  assertEquals(host.stores.has(STORE), true);

  // Reopen: inputs unchanged but the declared output is missing → must rebuild.
  const reopened = await openCache(STORE, host);
  assertEquals(await reopened.upToDate(make()), false);
  host.files.set("out.txt", enc("output"));
  assertEquals(await reopened.upToDate(make()), true); // now a hit

  // Change the input → stale again.
  host.files.set("in.txt", enc("v2"));
  assertEquals(await reopened.upToDate(make()), false);
});

Deno.test("a cacheKey contributes to the fingerprint", async () => {
  const host = new MemHost();
  let key = "v1";
  const t = target().cacheKey(() => key);
  const first = await fingerprint(t, host);
  key = "v2";
  const second = await fingerprint(t, host);
  assertEquals(first === second, false);

  // A target with only a cacheKey (no inputs) is still cacheable.
  t.name_ = "keyed";
  const cache = await openCache(STORE, host);
  key = "v1";
  assertEquals(await cache.upToDate(t), false);
  await cache.record(t);
  await cache.save();
  const reopened = await openCache(STORE, host);
  assertEquals(await reopened.upToDate(t), true);
  key = "v3";
  assertEquals(await reopened.upToDate(t), false);
});

Deno.test("a target without inputs is never cached", async () => {
  const host = new MemHost();
  const cache = await openCache(STORE, host);
  const t = target();
  t.name_ = "nocache";
  assertEquals(await cache.upToDate(t), false);
  await cache.record(t); // no-op
  await cache.save(); // nothing dirty → no write
  assertEquals(host.stores.has(STORE), false);
});

Deno.test("defaultCacheHost hashes a real directory and tolerates missing paths", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/src`);
    await Deno.writeTextFile(`${dir}/src/a.ts`, "a");
    const t = target().inputs(`${dir}/src`, `${dir}/missing.ts`);
    const before = await fingerprint(t, defaultCacheHost);
    await Deno.writeTextFile(`${dir}/src/a.ts`, "changed");
    const after = await fingerprint(t, defaultCacheHost);
    assertEquals(before === after, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a corrupt or non-object store is treated as empty", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.stores.set(STORE, "not json {");
  const corrupt = await openCache(STORE, host);
  const t = target().inputs("in.txt");
  t.name_ = "build";
  assertEquals(await corrupt.upToDate(t), false);

  host.stores.set(STORE, '"a string, not an object"');
  const wrong = await openCache(STORE, host);
  assertEquals(await wrong.upToDate(t), false);

  // Non-string entries are ignored when parsing the store.
  host.stores.set(STORE, '{"build": 42}');
  const mixed = await openCache(STORE, host);
  assertEquals(await mixed.upToDate(t), false);
});
