import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { target } from "../src/target.ts";
import {
  type CacheHost,
  defaultCacheHost,
  fingerprint,
  openCache,
} from "../src/cache.ts";
import {
  archiveOutputs,
  remoteCacheKey,
  type RemoteCacheStore,
} from "../src/remote_cache.ts";

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

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
  writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
    return Promise.resolve();
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

/** A recording in-memory {@link RemoteCacheStore}. */
class MemStore implements RemoteCacheStore {
  readonly map = new Map<string, Uint8Array>();
  readonly gets: string[] = [];
  readonly puts: string[] = [];
  failGet = false;
  failPut = false;
  get(key: string): Promise<Uint8Array | null> {
    this.gets.push(key);
    if (this.failGet) return Promise.reject(new Error("network down"));
    return Promise.resolve(this.map.get(key) ?? null);
  }
  put(key: string, artifact: Uint8Array): Promise<void> {
    this.puts.push(key);
    if (this.failPut) return Promise.reject(new Error("network down"));
    this.map.set(key, artifact);
    return Promise.resolve();
  }
}

/** A cacheable target with one input and one output directory, named `build`. */
function buildTarget(): ReturnType<typeof target> {
  const t = target().inputs("in.txt").outputs("dist");
  t.name_ = "build";
  return t;
}

Deno.test("the remote store restores outputs on a local miss", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();

  // Pre-seed the store with an archive keyed by the current fingerprint, then
  // simulate a fresh checkout by dropping the local output.
  const fp = await fingerprint(t, host);
  const store = new MemStore();
  store.map.set(
    remoteCacheKey("build", fp),
    await archiveOutputs(["dist"], host),
  );
  host.dirs.delete("dist");
  host.files.delete("dist/app.js");

  const cache = await openCache(STORE, host, { remote: store });
  assertEquals(await cache.upToDate(t), true); // restored, counts as a hit
  assertEquals(store.gets, [remoteCacheKey("build", fp)]);
  assertEquals(dec(host.files.get("dist/app.js") ?? enc("")), "built"); // written back
});

Deno.test("a successful run uploads outputs to the remote store", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const store = new MemStore();

  const cache = await openCache(STORE, host, { remote: store });
  await cache.record(t);
  const fp = await fingerprint(t, host);
  assertEquals(store.puts, [remoteCacheKey("build", fp)]);
  assertEquals(store.map.has(remoteCacheKey("build", fp)), true);
});

Deno.test("outputs just restored are not re-uploaded", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const fp = await fingerprint(t, host);
  const store = new MemStore();
  store.map.set(
    remoteCacheKey("build", fp),
    await archiveOutputs(["dist"], host),
  );
  host.dirs.delete("dist");
  host.files.delete("dist/app.js");

  const cache = await openCache(STORE, host, { remote: store });
  await cache.upToDate(t); // restores
  await cache.record(t); // should not upload again
  assertEquals(store.puts, []);
});

Deno.test("a remote lookup failure warns and falls back to a rebuild", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const store = new MemStore();
  store.failGet = true;
  const warnings: string[] = [];

  const cache = await openCache(STORE, host, {
    remote: store,
    warn: (m) => warnings.push(m),
  });
  assertEquals(await cache.upToDate(t), false); // rebuild rather than fail
  assertStringIncludes(warnings.join("\n"), "lookup");
});

Deno.test("a remote upload failure warns but never fails the build", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const store = new MemStore();
  store.failPut = true;
  const warnings: string[] = [];

  const cache = await openCache(STORE, host, {
    remote: store,
    warn: (m) => warnings.push(m),
  });
  await cache.record(t); // resolves despite the upload error
  assertStringIncludes(warnings.join("\n"), "upload");
});

Deno.test("targets without outputs never touch the remote store", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  const t = target().inputs("in.txt"); // no outputs
  t.name_ = "lint";
  const store = new MemStore();

  const cache = await openCache(STORE, host, { remote: store });
  assertEquals(await cache.upToDate(t), false);
  await cache.record(t);
  assertEquals(store.gets, []);
  assertEquals(store.puts, []);
});
