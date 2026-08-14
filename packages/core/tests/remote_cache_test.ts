// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
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
import { gzip, tar } from "../src/compression.ts";
import { withTemp } from "./_temp.ts";

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

Deno.test("restoreOutputs refuses archive entries that escape the workspace", async () => {
  const out = new MemFs();
  // A ".." entry would land outside the current directory.
  const escaping = await gzip(tar([{ name: "../evil.sh", data: enc("x") }]));
  const escapeErr = await assertRejects(() => restoreOutputs(escaping, out));
  assertStringIncludes(escapeErr.message, "escapes the destination");

  // An absolute path would ignore the workspace entirely.
  const absolute = await gzip(tar([{ name: "/etc/evil", data: enc("x") }]));
  const absErr = await assertRejects(() => restoreOutputs(absolute, out));
  assertStringIncludes(absErr.message, "absolute path");

  // Nothing was written for either malicious archive.
  assertEquals(out.files.size, 0);
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
  await withTemp(async (dir) => {
    const store = new FileSystemCacheStore(`${dir}/cache`);
    assertEquals(await store.get("missing"), null);
    await store.put("k1", enc("payload"));
    const got = await store.get("k1");
    assertEquals(got === null ? "" : dec(got), "payload");
  });
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
  await withTemp(async (dir) => {
    const store = new FileSystemCacheStore(dir);
    // Make the artifact path a directory so reading it fails (not NotFound).
    await Deno.mkdir(`${dir}/busy.tar.gz`);
    const err = await assertRejects(() => store.get("busy"));
    assertEquals(err instanceof Error, true); // a non-NotFound error propagates
  });
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

Deno.test("restoreOutputs confines entries to the target's declared outputs", async () => {
  const out = new MemFs();
  // A poisoned archive stored under a legitimate key: the name is relative and
  // has no `..`, so the older checks pass — but `deno.json` is not what this
  // target archived, and restoring it would let whoever wrote the store choose
  // a file every later target reads.
  const poisoned = await gzip(
    tar([
      { name: "dist/app.js", data: enc("built") },
      { name: "deno.json", data: enc("{}") },
    ]),
  );
  const err = await assertRejects(() =>
    restoreOutputs(poisoned, out, ["dist"])
  );
  assertStringIncludes(err.message, "outside the target's declared outputs");
  assertEquals(out.files.size, 0); // validated up front — nothing written

  // The same archive is fine when the target declares both.
  const written = await restoreOutputs(poisoned, out, ["dist", "deno.json"]);
  assertEquals(written, ["dist/app.js", "deno.json"]);
});

Deno.test("restoreOutputs matches a declared output by path segment, not prefix", async () => {
  const out = new MemFs();
  const sibling = await gzip(tar([{ name: "dist-evil/x.js", data: enc("x") }]));
  const err = await assertRejects(() => restoreOutputs(sibling, out, ["dist"]));
  assertStringIncludes(err.message, "outside the target's declared outputs");

  // A declared output naming the whole workspace matches everything, which is
  // what declaring it asked for.
  assertEquals(
    (await restoreOutputs(sibling, out, ["."])).length,
    1,
  );
});

Deno.test("restoreOutputs refuses protected paths whatever the outputs declare", async () => {
  const out = new MemFs();
  // A restored git hook runs on the developer's next ordinary git command, so
  // `.git` is refused even by a target that declares the workspace root.
  for (
    const name of [
      ".git/hooks/pre-commit",
      ".GIT/config",
      ".zuke/cache.json",
      // A submodule's nested .git runs on the same ordinary git command.
      "dist/sub/.git/hooks/pre-commit",
    ]
  ) {
    const artifact = await gzip(tar([{ name, data: enc("#!/bin/sh\n") }]));
    const err = await assertRejects(() => restoreOutputs(artifact, out, ["."]));
    assertStringIncludes(err.message, "protected path");
  }
  assertEquals(out.files.size, 0);
});

Deno.test("restoreOutputs refuses entry kinds archiveOutputs never produces", async () => {
  const out = new MemFs();
  // A symlink is how a *later* entry writes through a name the checks approved.
  const link = await gzip(
    tar([{ name: "dist/link", data: new Uint8Array(0), linkname: "target" }]),
  );
  const linkErr = await assertRejects(() =>
    restoreOutputs(link, out, ["dist"])
  );
  assertStringIncludes(linkErr.message, "symlink");

  const dir = await gzip(tar([{ name: "dist/sub/", data: new Uint8Array(0) }]));
  const dirErr = await assertRejects(() => restoreOutputs(dir, out, ["dist"]));
  assertStringIncludes(dirErr.message, "directory entry");
  assertEquals(out.files.size, 0);
});

Deno.test("restoreOutputs without declared outputs keeps the older confinement", async () => {
  const out = new MemFs();
  const artifact = await gzip(tar([{ name: "anywhere/x.js", data: enc("x") }]));
  assertEquals(await restoreOutputs(artifact, out), ["anywhere/x.js"]);
  // ...but the protected roots still hold.
  const git = await gzip(tar([{ name: ".git/config", data: enc("x") }]));
  const err = await assertRejects(() => restoreOutputs(git, out));
  assertStringIncludes(err.message, "protected path");
});

Deno.test("archiveOutputs never archives what restore would refuse", async () => {
  const src = new MemFs();
  src.dirs.set("dist", ["app.js", ".git"]);
  src.files.set("dist/app.js", enc("built"));
  src.dirs.set("dist/.git", ["config"]);
  src.files.set("dist/.git/config", enc("[core]"));

  // Uploading a `.git` to a shared store would leak its history — and, since
  // restore refuses it, would leave the target permanently un-restorable.
  const out = new MemFs();
  assertEquals(
    await restoreOutputs(await archiveOutputs(["dist"], src), out, [
      "dist",
    ]),
    ["dist/app.js"],
  );
});
