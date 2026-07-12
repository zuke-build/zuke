import { assertEquals, assertRejects } from "./_assert.ts";
import {
  archiveOutputs,
  envCacheStore,
  FileSystemCacheStore,
  HttpCacheStore,
  type OutputHost,
  remoteCacheKey,
  type RemoteCacheStore,
  resolveRemoteStore,
  restoreOutputs,
} from "../src/remote_cache.ts";
import { HttpError } from "../src/http.ts";

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** An in-memory {@link OutputHost} for archive/restore tests. */
class MemFs implements OutputHost {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Map<string, string[]>();

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
}

Deno.test("archiveOutputs/restoreOutputs round-trip files and directories", async () => {
  const src = new MemFs();
  src.files.set("dist/app.js", enc("built"));
  src.dirs.set("dist", ["app.js", "assets"]);
  src.dirs.set("dist/assets", ["logo.svg"]);
  src.files.set("dist/assets/logo.svg", enc("<svg/>"));
  src.files.set("README.md", enc("readme"));

  const artifact = await archiveOutputs(["dist", "README.md"], src);

  const out = new MemFs();
  const written = await restoreOutputs(artifact, out);
  // Entries are sorted for a reproducible archive.
  assertEquals(written, ["README.md", "dist/app.js", "dist/assets/logo.svg"]);
  assertEquals(dec(out.files.get("dist/app.js") ?? enc("")), "built");
  assertEquals(dec(out.files.get("dist/assets/logo.svg") ?? enc("")), "<svg/>");
  assertEquals(dec(out.files.get("README.md") ?? enc("")), "readme");
});

Deno.test("archiveOutputs skips a declared output that is missing", async () => {
  const src = new MemFs();
  src.files.set("dist/app.js", enc("built"));
  src.dirs.set("dist", ["app.js"]);
  const artifact = await archiveOutputs(["dist", "gone"], src);
  const out = new MemFs();
  const written = await restoreOutputs(artifact, out);
  assertEquals(written, ["dist/app.js"]);
});

Deno.test("remoteCacheKey sanitises the name and carries the fingerprint", () => {
  assertEquals(
    remoteCacheKey("release.publish", "abc123"),
    "release.publish-abc123",
  );
  assertEquals(remoteCacheKey("weird name/slash", "ff"), "weird_name_slash-ff");
});

Deno.test("FileSystemCacheStore stores and retrieves artifacts", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemCacheStore(`${dir}/cache`);
    assertEquals(await store.get("missing"), null);
    await store.put("k1", enc("payload"));
    const got = await store.get("k1");
    assertEquals(got === null ? "" : dec(got), "payload");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** Build a `typeof fetch` stand-in from a synchronous handler, recording calls. */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fetch: fetchFn, calls };
}

Deno.test("HttpCacheStore GET returns bytes, and null on 404", async () => {
  const hit = fakeFetch(() =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  );
  const store = new HttpCacheStore({
    url: "https://cache.test/",
    token: "tok",
    fetch: hit.fetch,
  });
  const got = await store.get("build-abc");
  assertEquals(got === null ? [] : Array.from(got), [1, 2, 3]);
  assertEquals(hit.calls[0].url, "https://cache.test/build-abc"); // trailing slash trimmed
  assertEquals(
    new Headers(hit.calls[0].init?.headers).get("Authorization"),
    "Bearer tok",
  );

  const miss = fakeFetch(() => new Response(null, { status: 404 }));
  const missStore = new HttpCacheStore({
    url: "https://cache.test",
    fetch: miss.fetch,
  });
  assertEquals(await missStore.get("nope"), null);
});

Deno.test("HttpCacheStore GET throws on a non-404 error status", async () => {
  const { fetch } = fakeFetch(() => new Response("boom", { status: 500 }));
  const store = new HttpCacheStore({ url: "https://cache.test", fetch });
  const err = await assertRejects(() => store.get("k"));
  assertEquals(err instanceof HttpError, true);
});

Deno.test("HttpCacheStore PUT sends the artifact and throws on failure", async () => {
  const ok = fakeFetch(() => new Response(null, { status: 201 }));
  const store = new HttpCacheStore({
    url: "https://cache.test",
    token: "t",
    fetch: ok.fetch,
  });
  await store.put("k1", enc("data"));
  assertEquals(ok.calls[0].init?.method, "PUT");
  assertEquals(ok.calls[0].url, "https://cache.test/k1");

  const bad = fakeFetch(() => new Response(null, { status: 403 }));
  const badStore = new HttpCacheStore({
    url: "https://cache.test",
    fetch: bad.fetch,
  });
  const err = await assertRejects(() => badStore.put("k", enc("x")));
  assertEquals(err instanceof HttpError, true);
});

Deno.test("envCacheStore selects HTTP, then filesystem, then nothing", () => {
  const env =
    (vars: Record<string, string>) => (name: string): string | undefined =>
      Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;

  assertEquals(
    envCacheStore(
      env({
        ZUKE_REMOTE_CACHE_URL: "https://c.test",
        ZUKE_REMOTE_CACHE_TOKEN: "t",
      }),
    ) instanceof
      HttpCacheStore,
    true,
  );
  // A URL wins even when a directory is also set.
  assertEquals(
    envCacheStore(
      env({
        ZUKE_REMOTE_CACHE_URL: "https://c.test",
        ZUKE_REMOTE_CACHE_DIR: "/tmp/x",
      }),
    ) instanceof
      HttpCacheStore,
    true,
  );
  assertEquals(
    envCacheStore(env({ ZUKE_REMOTE_CACHE_DIR: "/tmp/cache" })) instanceof
      FileSystemCacheStore,
    true,
  );
  assertEquals(envCacheStore(() => undefined), undefined);
  // An empty value is treated as unset.
  assertEquals(envCacheStore(env({ ZUKE_REMOTE_CACHE_URL: "" })), undefined);
});

Deno.test("archiveOutputs ignores an entry whose file reads back as null", async () => {
  // A host that claims a file exists (stat) but yields no bytes (readFile null).
  const host: OutputHost = {
    stat: () => Promise.resolve({ isDirectory: false }),
    readFile: () => Promise.resolve(null),
    readDir: () => Promise.resolve([]),
    writeFile: () => Promise.resolve(),
  };
  const artifact = await archiveOutputs(["ghost"], host);
  const out = new MemFs();
  assertEquals(await restoreOutputs(artifact, out), []); // nothing archived
});

Deno.test("FileSystemCacheStore.get propagates a non-NotFound read error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new FileSystemCacheStore(dir);
    // Make the artifact path a directory so reading it fails (not NotFound).
    await Deno.mkdir(`${dir}/busy.tar.gz`);
    const err = await assertRejects(() => store.get("busy"));
    assertEquals(err instanceof Error, true); // a non-NotFound error propagates
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("resolveRemoteStore honours option, then declared, then env", () => {
  const explicit: RemoteCacheStore = {
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(),
  };
  const declared: RemoteCacheStore = {
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(),
  };
  const env = (name: string): string | undefined =>
    name === "ZUKE_REMOTE_CACHE_DIR" ? "/tmp/c" : undefined;

  assertEquals(resolveRemoteStore(false, declared, env), undefined); // disabled wins
  assertEquals(resolveRemoteStore(explicit, declared, env), explicit); // explicit option
  assertEquals(resolveRemoteStore(undefined, declared, env), declared); // build override
  assertEquals(
    resolveRemoteStore(undefined, undefined, env) instanceof
      FileSystemCacheStore,
    true, // environment fallback
  );
  assertEquals(
    resolveRemoteStore(undefined, undefined, () => undefined),
    undefined,
  );
});
