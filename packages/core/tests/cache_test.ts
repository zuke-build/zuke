// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import { target } from "../src/target.ts";
import {
  type BuildCache,
  type CacheHost,
  defaultCacheHost,
  fingerprint,
  openCache,
  type SpooledArtifact,
} from "../src/cache.ts";
import { archiveOutputs, remoteCacheKey } from "../src/remote_cache.ts";
import { byteStream, gzip, tar } from "../src/compression.ts";
import { withTemp } from "./_temp.ts";
import { MemCacheStore } from "./_fakes.ts";
import { signArtifact } from "../src/cache_signing.ts";

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
  /**
   * Paths that are symbolic links rather than the file or directory they name.
   * `stat` still resolves them (a link to a file is a file), so only `lstat`
   * can tell — which is the asymmetry the restore guard depends on.
   */
  readonly symlinks = new Set<string>();

  lstat(
    path: string,
  ): Promise<{ isSymlink: boolean; isDirectory: boolean } | null> {
    if (this.symlinks.has(path)) {
      return Promise.resolve({ isSymlink: true, isDirectory: false });
    }
    if (this.dirs.has(path)) {
      return Promise.resolve({ isSymlink: false, isDirectory: true });
    }
    if (this.files.has(path)) {
      return Promise.resolve({ isSymlink: false, isDirectory: false });
    }
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
  await withTemp(async (dir) => {
    await Deno.mkdir(`${dir}/src`);
    await Deno.writeTextFile(`${dir}/src/a.ts`, "a");
    const t = target().inputs(`${dir}/src`, `${dir}/missing.ts`);
    const before = await fingerprint(t, defaultCacheHost);
    await Deno.writeTextFile(`${dir}/src/a.ts`, "changed");
    const after = await fingerprint(t, defaultCacheHost);
    assertEquals(before === after, false);
  });
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
  const store = new MemCacheStore();
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

Deno.test("a restore honours the store's maxInflatedBytes", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const fp = await fingerprint(t, host);
  // The archive inflates past 64 bytes (a tar header alone is 512).
  class TinyStore extends MemCacheStore {
    readonly maxInflatedBytes = 64;
  }
  const store = new TinyStore();
  store.map.set(
    remoteCacheKey("build", fp),
    await archiveOutputs(["dist"], host),
  );
  host.dirs.delete("dist");
  host.files.delete("dist/app.js");
  const warnings: string[] = [];
  const cache = await openCache(STORE, host, {
    remote: store,
    warn: (message) => warnings.push(message),
  });
  assertEquals(await cache.upToDate(t), false); // refused: a rebuild
  assertEquals(warnings.some((w) => w.includes("more than 64 bytes")), true);
});

Deno.test("a successful run uploads outputs to the remote store", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const store = new MemCacheStore();

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
  const store = new MemCacheStore();
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
  const store = new MemCacheStore();
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
  const store = new MemCacheStore();
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
  const store = new MemCacheStore();

  const cache = await openCache(STORE, host, { remote: store });
  assertEquals(await cache.upToDate(t), false);
  await cache.record(t);
  assertEquals(store.gets, []);
  assertEquals(store.puts, []);
});

Deno.test("a poisoned remote archive is a cache miss and a warning, never a restore", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  const t = buildTarget(); // declares `dist` as its only output
  const fp = await fingerprint(t, host);

  // Whoever can write the store put a `deno.json` in the artifact. Restoring it
  // would let them choose a file every later target reads.
  const store = new MemCacheStore();
  store.map.set(
    remoteCacheKey("build", fp),
    await gzip(tar([
      { name: "dist/app.js", data: enc("built") },
      { name: "deno.json", data: enc('{ "tasks": { "x": "curl evil" } }') },
    ])),
  );

  const warnings: string[] = [];
  const cache = await openCache(STORE, host, {
    remote: store,
    warn: (m) => warnings.push(m),
  });

  // A miss, so the target rebuilds — the store cannot halt the build either.
  assertEquals(await cache.upToDate(t), false);
  assertStringIncludes(warnings.join("\n"), "refused");
  assertStringIncludes(warnings.join("\n"), "declared outputs");
  // Nothing from the archive landed, not even the entry that was in scope.
  assertEquals(host.files.has("deno.json"), false);
  assertEquals(host.files.has("dist/app.js"), false);
});

/** A {@link MemCacheStore} that also streams, recording which form was used. */
class StreamingStore extends MemCacheStore {
  /** Keys passed to {@link getStream}, in order. */
  readonly streamGets: string[] = [];
  /** Keys passed to {@link putStream}, in order. */
  readonly streamPuts: string[] = [];

  getStream(
    key: string,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>> | null> {
    this.streamGets.push(key);
    const bytes = this.map.get(key);
    return Promise.resolve(bytes === undefined ? null : byteStream(bytes));
  }
  async putStream(
    key: string,
    artifact: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<void> {
    this.streamPuts.push(key);
    this.map.set(
      key,
      new Uint8Array(await new Response(artifact).arrayBuffer()),
    );
  }
}

/** A {@link MemHost} with an in-memory spool that records its use. */
class SpoolingHost extends MemHost {
  /** How many times a spooled artifact was opened, and removed. */
  opens = 0;
  removes = 0;

  async spool(
    artifact: ReadableStream<Uint8Array<ArrayBuffer>>,
  ): Promise<SpooledArtifact> {
    const bytes = new Uint8Array(await new Response(artifact).arrayBuffer());
    return {
      open: () => {
        this.opens++;
        return Promise.resolve(byteStream(bytes));
      },
      remove: () => {
        this.removes++;
        return Promise.resolve();
      },
    };
  }
}

/** A host holding `dist/app.js`, a store seeded with its archive, and the target. */
async function seeded(
  host: MemHost,
  store: MemCacheStore,
): Promise<{ t: ReturnType<typeof buildTarget>; key: string }> {
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const key = remoteCacheKey("build", await fingerprint(t, host));
  store.map.set(key, await archiveOutputs(["dist"], host));
  host.dirs.delete("dist");
  host.files.delete("dist/app.js");
  return { t, key };
}

Deno.test("a streaming store restores through the host's spool, then removes it", async () => {
  const host = new SpoolingHost();
  const store = new StreamingStore();
  const { t, key } = await seeded(host, store);
  const cache = await openCache(STORE, host, { remote: store });
  assertEquals(await cache.upToDate(t), true);
  assertEquals(store.streamGets, [key]);
  assertEquals(store.gets, []); // never buffered whole
  assertEquals(host.opens, 2); // one validation pass, one write pass
  assertEquals(host.removes, 1);
  assertEquals(dec(host.files.get("dist/app.js") ?? enc("")), "built");
});

Deno.test("a refused spooled restore still removes the spool", async () => {
  const host = new SpoolingHost();
  const store = new StreamingStore();
  const { t, key } = await seeded(host, store);
  store.map.set(key, await gzip(tar([{ name: "../evil", data: enc("x") }])));
  const warnings: string[] = [];
  const cache = await openCache(STORE, host, {
    remote: store,
    warn: (message) => warnings.push(message),
  });
  assertEquals(await cache.upToDate(t), false);
  assertEquals(host.removes, 1);
  assertEquals(warnings.some((w) => w.includes("was refused")), true);
});

Deno.test("a streaming store misses without spooling anything", async () => {
  const host = new SpoolingHost();
  const store = new StreamingStore();
  const { t, key } = await seeded(host, store);
  store.map.delete(key);
  const cache = await openCache(STORE, host, { remote: store });
  assertEquals(await cache.upToDate(t), false);
  assertEquals(host.opens + host.removes, 0);
});

Deno.test("a host without a spool reads a streaming store whole", async () => {
  const host = new MemHost();
  const store = new StreamingStore();
  const { t, key } = await seeded(host, store);
  const cache = await openCache(STORE, host, { remote: store });
  assertEquals(await cache.upToDate(t), true);
  assertEquals(store.gets, [key]);
  assertEquals(store.streamGets, []);
});

Deno.test("an upload streams to a store that takes a stream", async () => {
  const host = new MemHost();
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const store = new StreamingStore();
  const cache = await openCache(STORE, host, { remote: store });
  await cache.record(t);
  const key = remoteCacheKey("build", await fingerprint(t, host));
  assertEquals(store.streamPuts, [key]);
  assertEquals(store.puts, []);
  assertEquals(store.map.get(key), await archiveOutputs(["dist"], host));
});

Deno.test("defaultCacheHost spools to a temporary file it can reopen and remove", async () => {
  await withTemp(async (dir) => {
    // So the spool's file is the only one here.
    await withTempDirEnv(dir, async () => {
      const spooled = await defaultCacheHost.spool?.(
        byteStream(enc("artifact bytes")),
      );
      if (spooled === undefined) throw new Error("the default host spools");
      for (let pass = 0; pass < 2; pass++) {
        const bytes = await new Response(await spooled.open()).arrayBuffer();
        assertEquals(dec(new Uint8Array(bytes)), "artifact bytes");
      }
      assertEquals([...Deno.readDirSync(dir)].length, 1);
      await spooled.remove();
      await spooled.remove(); // already gone: still no throw
      assertEquals([...Deno.readDirSync(dir)].length, 0);

      // A download that fails part-way leaves no file behind.
      const failing = new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
          controller.error(new Error("connection reset"));
        },
      });
      const err = await assertRejects(() =>
        defaultCacheHost.spool?.(failing) ?? Promise.resolve()
      );
      assertStringIncludes(err.message, "connection reset");
      assertEquals([...Deno.readDirSync(dir)].length, 0);
    });
  });
});

Deno.test("defaultCacheHost cancels the download when it cannot make a spool file", async () => {
  await withTemp(async (dir) => {
    let cancelled = false;
    const download = new ReadableStream<Uint8Array<ArrayBuffer>>({
      cancel() {
        cancelled = true;
      },
    });
    // No such directory, so no temporary file can be made.
    await withTempDirEnv(`${dir}/missing`, async () => {
      await assertRejects(() =>
        defaultCacheHost.spool?.(download) ?? Promise.resolve()
      );
    });
    assertEquals(cancelled, true);
  });
});

/**
 * Run `fn` with the system temporary directory pointed at `dir`: `TMPDIR` on
 * POSIX, `TMP`/`TEMP` on Windows, all three restored afterwards.
 */
async function withTempDirEnv(
  dir: string,
  fn: () => Promise<void>,
): Promise<void> {
  const names = ["TMPDIR", "TMP", "TEMP"];
  const previous = names.map((name) => Deno.env.get(name));
  for (const name of names) Deno.env.set(name, dir);
  try {
    await fn();
  } finally {
    names.forEach((name, i) => {
      const value = previous[i];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    });
  }
}

Deno.test("a store error quoting a credentialed URL is redacted in the warning", async () => {
  const host = new MemHost();
  const store = new MemCacheStore();
  const { t } = await seeded(host, store);
  store.get = () =>
    Promise.reject(
      new Error("refusing an artifact from https://c.example/k?sv=1&sig=abc"),
    );
  const warnings: string[] = [];
  const cache = await openCache(STORE, host, {
    remote: store,
    warn: (m) => warnings.push(m),
  });
  assertEquals(await cache.upToDate(t), false);
  assertEquals(warnings.join("\n").includes("sig=abc"), false);
  assertStringIncludes(warnings.join("\n"), "c.example");
});

const SECRET = "build-signing-secret";

/** Upload `dist` through a signing cache, then wipe it as a fresh checkout. */
async function signedUpload(
  host: MemHost,
  store: MemCacheStore,
): Promise<{ t: ReturnType<typeof buildTarget>; key: string }> {
  host.files.set("in.txt", enc("v1"));
  host.dirs.set("dist", ["app.js"]);
  host.files.set("dist/app.js", enc("built"));
  const t = buildTarget();
  const producer = await openCache(STORE, host, {
    remote: store,
    signingKey: SECRET,
  });
  await producer.record(t);
  host.dirs.delete("dist");
  host.files.delete("dist/app.js");
  return { t, key: remoteCacheKey("build", await fingerprint(t, host)) };
}

/** Open a consumer cache with `signingKey`, recording warnings. */
async function consumer(
  host: MemHost,
  store: MemCacheStore,
  signingKey: string | undefined,
): Promise<{ cache: BuildCache; warnings: string[] }> {
  const warnings: string[] = [];
  const cache = await openCache(STORE, host, {
    remote: store,
    warn: (m) => warnings.push(m),
    signingKey,
  });
  return { cache, warnings };
}

Deno.test("a signed artifact is restored by a consumer holding the key", async () => {
  for (const store of [new MemCacheStore(), new StreamingStore()]) {
    const host = new SpoolingHost();
    const { t, key } = await signedUpload(host, store);
    assertEquals(store.map.has(`${key}.sig`), true);
    const { cache, warnings } = await consumer(host, store, SECRET);
    assertEquals(await cache.upToDate(t), true);
    assertEquals(warnings, []);
    assertEquals(dec(host.files.get("dist/app.js") ?? enc("")), "built");
  }
});

Deno.test("an unsigned artifact is refused when a signing key is set", async () => {
  const host = new MemHost();
  const store = new MemCacheStore();
  const { t } = await seeded(host, store); // uploaded with no signature
  const { cache, warnings } = await consumer(host, store, SECRET);
  assertEquals(await cache.upToDate(t), false);
  assertStringIncludes(warnings.join("\n"), "unsigned");
  assertEquals(host.files.has("dist/app.js"), false);
});

Deno.test("an artifact with a wrong signature is refused", async () => {
  const host = new MemHost();
  const store = new MemCacheStore();
  const { t, key } = await signedUpload(host, store);
  const poisoned = await gzip(
    tar([{ name: "dist/app.js", data: enc("evil") }]),
  );
  const cases: Array<[string, Uint8Array]> = [
    // A store writer swaps the archive and keeps the old signature…
    ["kept", store.map.get(`${key}.sig`) ?? new Uint8Array()],
    // …signs it with a key of its own…
    ["own key", await signArtifact("attacker", key, byteStream(poisoned))],
    // …or plants a signature that is not even the right length.
    ["short", new Uint8Array(3)],
  ];
  for (const [label, sig] of cases) {
    store.map.set(key, poisoned);
    store.map.set(`${key}.sig`, sig);
    const { cache, warnings } = await consumer(host, store, SECRET);
    assertEquals(await cache.upToDate(t), false, label);
    assertStringIncludes(warnings.join("\n"), "does not match");
  }
  assertEquals(host.files.has("dist/app.js"), false);
});

Deno.test("a signature does not carry over to another target's key", async () => {
  const host = new MemHost();
  const store = new MemCacheStore();
  const { key } = await signedUpload(host, store);
  // Replay `build`'s signed artifact under a second target's key.
  host.files.set("in.txt", enc("v1"));
  const other = target().inputs("in.txt").outputs("dist");
  other.name_ = "other";
  const otherKey = remoteCacheKey("other", await fingerprint(other, host));
  store.map.set(otherKey, store.map.get(key) ?? new Uint8Array());
  store.map.set(`${otherKey}.sig`, store.map.get(`${key}.sig`) ?? enc(""));
  const { cache } = await consumer(host, store, SECRET);
  assertEquals(await cache.upToDate(other), false);
});

Deno.test("without a signing key nothing is signed or checked", async () => {
  const host = new MemHost();
  const store = new MemCacheStore();
  const { t, key } = await seeded(host, store);
  const { cache } = await consumer(host, store, undefined);
  assertEquals(await cache.upToDate(t), true);
  assertEquals(store.gets, [key]); // no signature lookup
  await cache.record(target().inputs("in.txt").outputs("dist"));
  assertEquals([...store.map.keys()].some((k) => k.endsWith(".sig")), false);
});
