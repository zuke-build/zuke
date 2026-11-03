// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
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
import { GitHubActionsCacheStore } from "../src/github_actions_cache.ts";
import { S3CacheStore } from "../src/s3_cache.ts";
import { gzip, tar } from "../src/compression.ts";
import { withTemp } from "./_temp.ts";
import { defaultCacheHost } from "../src/cache.ts";
import { messageOf } from "../src/internal.ts";

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** An in-memory {@link OutputHost} for archive/restore tests. */
class MemFs implements OutputHost {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Map<string, string[]>();
  /** Permission bits by path, for the files that have them. */
  readonly modes = new Map<string, number>();

  readFile(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }
  stat(path: string): Promise<{ isDirectory: boolean; mode?: number } | null> {
    if (this.dirs.has(path)) return Promise.resolve({ isDirectory: true });
    if (this.files.has(path)) {
      const mode = this.modes.get(path);
      return Promise.resolve(
        mode === undefined
          ? { isDirectory: false }
          : { isDirectory: false, mode },
      );
    }
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
  writeFile(path: string, bytes: Uint8Array, mode?: number): Promise<void> {
    this.files.set(path, bytes);
    if (mode !== undefined) this.modes.set(path, mode);
    return Promise.resolve();
  }
}

/** A {@link MemFs} that can also read and create symlinks, by raw target. */
class LinkFs extends MemFs {
  /** Each link's raw target, keyed by its path. */
  readonly links = new Map<string, string>();
  /** The `type` each created link was given. */
  readonly linkTypes = new Map<string, "file" | "dir">();
  /** Canonical paths that differ from `/w/<path>`, as a followed link's do. */
  readonly realPaths = new Map<string, string>();

  realPath(path: string): Promise<string> {
    return Promise.resolve(this.realPaths.get(path) ?? `/w/${path}`);
  }

  readLink(path: string): Promise<string> {
    return Promise.resolve(this.links.get(path) ?? "");
  }
  symlink(target: string, path: string, type: "file" | "dir"): Promise<void> {
    this.links.set(path, target);
    this.symlinks.add(path);
    this.linkTypes.set(path, type);
    return Promise.resolve();
  }
}

/** A gzipped tar holding `entries`, each link given as `name -> target`. */
async function archive(...entries: string[]): Promise<Uint8Array> {
  return await gzip(tar(entries.map((entry) => {
    const [name, linkname] = entry.split(" -> ");
    return linkname === undefined
      ? { name, data: enc("x") }
      : { name, data: new Uint8Array(0), linkname };
  })));
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

Deno.test("archiveOutputs/restoreOutputs carry a file's permission bits", async () => {
  const src = new MemFs();
  src.files.set("tools/bin", enc("ELF"));
  src.modes.set("tools/bin", 0o100755); // a stat mode, file type included
  src.files.set("tools/readme", enc("hi")); // no mode known
  src.dirs.set("tools", ["bin", "readme"]);
  const out = new MemFs();
  await restoreOutputs(await archiveOutputs(["tools"], src), out, ["tools"]);
  assertEquals(out.modes.get("tools/bin"), 0o755); // permission bits only
  assertEquals(out.modes.get("tools/readme"), 0o644); // the archive default
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
    "v2-release.publish-abc123",
  );
  assertEquals(
    remoteCacheKey("weird name/slash", "ff"),
    "v2-weird_name_slash-ff",
  );
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

Deno.test("HttpCacheStore sends extra headers and keeps a base URL's query", async () => {
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 201 }));
  // An Azure Blob container's SAS URL: the key goes before the query.
  const store = new HttpCacheStore({
    url: "https://acct.blob.core.windows.net/container/?sv=2024&sig=abc",
    headers: { "x-custom": "1", Authorization: "Basic credentials" },
    fetch,
  });
  await store.put("k", enc("x"));
  assertEquals(
    calls[0].url,
    "https://acct.blob.core.windows.net/container/k?sv=2024&sig=abc",
  );
  const headers = new Headers(calls[0].init?.headers);
  assertEquals(headers.get("x-custom"), "1");
  assertEquals(headers.get("Authorization"), "Basic credentials");
  assertEquals(headers.get("x-ms-blob-type"), "BlockBlob");
  await store.get("k");
  assertEquals(new Headers(calls[1].init?.headers).get("x-custom"), "1");
  assertEquals(calls[1].url, calls[0].url);

  // On a clash the store's own headers win, on both paths: the bearer token
  // over an extra Authorization, and a PUT's content type and blob type over
  // extras of the same names — so a later refactor of the merge order cannot
  // quietly send a caller's value for a header the protocol relies on.
  const bearer = new HttpCacheStore({
    url: "https://cache.test",
    token: "t",
    headers: {
      Authorization: "Basic x",
      "content-type": "text/plain",
      "x-ms-blob-type": "PageBlob",
    },
    fetch,
  });
  await bearer.get("k");
  const got = new Headers(calls[2].init?.headers);
  assertEquals(got.get("Authorization"), "Bearer t");
  assertEquals(got.get("content-type"), "text/plain"); // nothing of its own on a GET
  await bearer.put("k", enc("x"));
  const put = new Headers(calls[3].init?.headers);
  assertEquals(put.get("Authorization"), "Bearer t");
  assertEquals(put.get("content-type"), "application/octet-stream");
  assertEquals(put.get("x-ms-blob-type"), "BlockBlob");
});

Deno.test("envCacheStore selects an S3 store from the AWS variables", () => {
  const env =
    (vars: Record<string, string>) => (name: string): string | undefined =>
      Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
  const aws = {
    ZUKE_REMOTE_CACHE_S3_URL: "https://bucket.s3.amazonaws.com/cache",
    AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
    AWS_SECRET_ACCESS_KEY: "secret",
    AWS_DEFAULT_REGION: "us-east-1",
  };
  assertEquals(envCacheStore(env(aws)) instanceof S3CacheStore, true);
  assertEquals(
    envCacheStore(
      env({ ...aws, AWS_SESSION_TOKEN: "tok", AWS_REGION: "auto" }),
    ) instanceof
      S3CacheStore,
    true,
  );
  // A plain URL still wins; the S3 URL wins over a directory.
  assertEquals(
    envCacheStore(
      env({ ...aws, ZUKE_REMOTE_CACHE_URL: "https://c.test" }),
    ) instanceof
      HttpCacheStore,
    true,
  );
  assertEquals(
    envCacheStore(env({ ...aws, ZUKE_REMOTE_CACHE_DIR: "/tmp/x" })) instanceof
      S3CacheStore,
    true,
  );
  // Misconfiguration names the variable rather than sending an unsigned request.
  const missing = assertThrows(() =>
    envCacheStore(env({ ...aws, AWS_DEFAULT_REGION: "" }))
  );
  assertStringIncludes(missing.message, "AWS_REGION or AWS_DEFAULT_REGION");
  const noKey = assertThrows(() =>
    envCacheStore(env({ ...aws, AWS_ACCESS_KEY_ID: "" }))
  );
  assertStringIncludes(noKey.message, "AWS_ACCESS_KEY_ID");
  assertThrows(() =>
    envCacheStore(
      env({ ...aws, ZUKE_REMOTE_CACHE_S3_URL: "http://bucket.test/cache" }),
    )
  );
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

Deno.test("envCacheStore picks the Actions cache from the job's own credentials", () => {
  const env =
    (vars: Record<string, string>) => (name: string): string | undefined =>
      Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
  const job = {
    ACTIONS_RUNTIME_TOKEN: "runtime",
    ACTIONS_RESULTS_URL: "https://results.test/",
  };
  assertEquals(
    envCacheStore(env(job)) instanceof GitHubActionsCacheStore,
    true,
  );
  // An explicit Zuke store still wins over the ambient one.
  assertEquals(
    envCacheStore(env({ ...job, ZUKE_REMOTE_CACHE_DIR: "/tmp/x" })) instanceof
      FileSystemCacheStore,
    true,
  );
  // Both halves are needed: a token without a service URL is not a store.
  assertEquals(
    envCacheStore(env({ ACTIONS_RUNTIME_TOKEN: "runtime" })),
    undefined,
  );
  assertEquals(
    envCacheStore(env({ ...job, ACTIONS_RUNTIME_TOKEN: "" })),
    undefined,
  );
  // The token is sent to that URL, so it must be a secure one.
  assertThrows(() =>
    envCacheStore(env({ ...job, ACTIONS_RESULTS_URL: "http://results.test" }))
  );
});

Deno.test("archiveOutputs ignores an entry whose file reads back as null", async () => {
  // A host that claims a file exists (stat) but yields no bytes (readFile null).
  const host: OutputHost = {
    stat: () => Promise.resolve({ isDirectory: false }),
    lstat: () => Promise.resolve({ isSymlink: false, isDirectory: false }),
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
  // The toolchain's install root is the one `.zuke` subtree a restore may
  // write: a provisioned binary is what a remote cache is for, and the
  // toolchain re-verifies it against its recorded checksum before reusing it.
  const tool = await gzip(
    tar([{ name: ".zuke/tools/zizmor", data: enc("ELF") }]),
  );
  assertEquals(await restoreOutputs(tool, out, [".zuke/tools"]), [
    ".zuke/tools/zizmor",
  ]);
  // Only that subtree: the state beside it stays protected, as does a `tools`
  // nested deeper under something else in `.zuke`.
  for (const name of [".zuke/runs/tools/x", ".zuke/tools.json"]) {
    const artifact = await gzip(tar([{ name, data: enc("x") }]));
    const err = await assertRejects(() => restoreOutputs(artifact, out, ["."]));
    assertStringIncludes(err.message, "protected path");
  }
});

Deno.test("a .git inside .zuke/tools round-trips, and only there", async () => {
  // An SDK such as Flutter's is a git checkout that runs git on itself.
  const src = new MemFs();
  src.dirs.set(".zuke/tools", ["flutter"]);
  src.dirs.set(".zuke/tools/flutter", [".git", "bin"]);
  src.dirs.set(".zuke/tools/flutter/.git", ["HEAD"]);
  src.files.set(".zuke/tools/flutter/.git/HEAD", enc("ref: refs/heads/stable"));
  src.files.set(".zuke/tools/flutter/bin", enc("flutter"));
  const out = new MemFs();
  assertEquals(
    await restoreOutputs(
      await archiveOutputs([".zuke/tools"], src),
      out,
      [".zuke/tools"],
    ),
    [".zuke/tools/flutter/.git/HEAD", ".zuke/tools/flutter/bin"],
  );
  // A .git before the tools subtree, or beside it, is still refused.
  for (
    const name of [
      ".git/.zuke/tools/x",
      "sub/.git/hooks/pre-commit",
      ".zuke/.git/config",
      ".zuke/runs/.git/config",
    ]
  ) {
    const artifact = await gzip(tar([{ name, data: enc("x") }]));
    const err = await assertRejects(() => restoreOutputs(artifact, out, ["."]));
    assertStringIncludes(err.message, "protected path");
  }
});

Deno.test("envCacheStore passes ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES to the store", () => {
  const env =
    (vars: Record<string, string>) => (name: string): string | undefined =>
      Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
  const limit = { ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES: "4294967296" };
  const stores: Record<string, string>[] = [
    { ZUKE_REMOTE_CACHE_URL: "https://c.test" },
    {
      ZUKE_REMOTE_CACHE_S3_URL: "https://bucket.s3.amazonaws.com/cache",
      AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "auto",
    },
    { ZUKE_REMOTE_CACHE_DIR: "/tmp/x" },
    { ACTIONS_RUNTIME_TOKEN: "t", ACTIONS_RESULTS_URL: "https://r.test" },
  ];
  for (const vars of stores) {
    assertEquals(
      envCacheStore(env({ ...vars, ...limit }))?.maxInflatedBytes,
      4294967296,
    );
    assertEquals(envCacheStore(env(vars))?.maxInflatedBytes, undefined);
  }
  // Read only once a store is chosen: a bad value cannot fail a build with none.
  assertEquals(
    envCacheStore(env({ ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES: "abc" })),
    undefined,
  );
  for (const bad of ["0", "-1", "4GiB", "1e10", "9007199254740993"]) {
    assertThrows(
      () =>
        envCacheStore(
          env({ ...stores[2], ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES: bad }),
        ),
      Error,
      "ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES",
    );
  }
});

Deno.test("restoreOutputs refuses a bound that is not a positive whole number", async () => {
  const artifact = await gzip(tar([{ name: "dist/a", data: enc("x") }]));
  for (const bound of [NaN, 0, -1, 1.5]) {
    const err = await assertRejects(() =>
      restoreOutputs(artifact, new MemFs(), ["dist"], bound)
    );
    assertStringIncludes(err.message, "maxInflatedBytes");
  }
});

Deno.test("restoreOutputs refuses a .git spelled with a trailing dot or space", async () => {
  // Windows drops both, so either would land in the workspace's real `.git`.
  for (const name of [".git./hooks/pre-commit", ".git /config", ".zuke. /x"]) {
    const artifact = await gzip(tar([{ name, data: enc("x") }]));
    const err = await assertRejects(() =>
      restoreOutputs(artifact, new MemFs(), ["."])
    );
    assertStringIncludes(err.message, "protected path");
  }
});

Deno.test("restoreOutputs refuses entry kinds archiveOutputs never produces", async () => {
  const out = new MemFs();
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

Deno.test("restoreOutputs refuses to write over a symlink at a declared output", async () => {
  // The archive itself cannot carry a link — `assertPlainFileEntry` refuses one
  // — so the link has to already be in the workspace. That is the whole finding:
  // `writeFile` follows it, and every other check is lexical.
  const src = new MemFs();
  src.files.set("dist/app.js", enc("built"));
  src.dirs.set("dist", ["app.js"]);
  const artifact = await archiveOutputs(["dist"], src);

  const out = new MemFs();
  out.dirs.set("dist", []);
  out.symlinks.add("dist/app.js");

  const error = await assertRejects(
    () => restoreOutputs(artifact, out, ["dist"]),
  );
  assertStringIncludes(
    messageOf(error),
    "refusing to restore over the symlink",
  );
  assertStringIncludes(messageOf(error), "dist/app.js");
  // Refused before anything was written: the "nothing half-written" promise.
  assertEquals(out.files.size, 0);
});

Deno.test("restoreOutputs refuses to write through a symlinked ancestor", async () => {
  // `dist` itself is the link, so the leaf check would never see it — the
  // ancestor walk is what catches this one.
  const src = new MemFs();
  src.files.set("dist/nested/app.js", enc("built"));
  src.dirs.set("dist", ["nested"]);
  src.dirs.set("dist/nested", ["app.js"]);
  const artifact = await archiveOutputs(["dist"], src);

  const out = new MemFs();
  out.symlinks.add("dist");

  const error = await assertRejects(
    () => restoreOutputs(artifact, out, ["dist"]),
  );
  assertStringIncludes(
    messageOf(error),
    'refusing to restore "dist/nested/app.js" through the symlink "dist"',
  );
  assertEquals(out.files.size, 0);
});

Deno.test("restoreOutputs restores normally when the path holds a real file", async () => {
  // The guard must not refuse an ordinary overwrite of a previous build's
  // output, which is the common case.
  const src = new MemFs();
  src.files.set("dist/app.js", enc("built"));
  src.dirs.set("dist", ["app.js"]);
  const artifact = await archiveOutputs(["dist"], src);

  const out = new MemFs();
  out.dirs.set("dist", []);
  out.files.set("dist/app.js", enc("stale"));

  assertEquals(await restoreOutputs(artifact, out, ["dist"]), ["dist/app.js"]);
  assertEquals(dec(out.files.get("dist/app.js") ?? new Uint8Array()), "built");
});

Deno.test("restoreOutputs refuses an artifact that decompresses past the cap", async () => {
  const src = new MemFs();
  src.files.set("dist/app.js", enc("x".repeat(4096)));
  src.dirs.set("dist", ["app.js"]);
  const artifact = await archiveOutputs(["dist"], src);

  const out = new MemFs();
  const error = await assertRejects(
    () => restoreOutputs(artifact, out, ["dist"], 512),
  );
  assertStringIncludes(messageOf(error), "decompresses to more than 512 bytes");
  assertEquals(out.files.size, 0);
});

Deno.test("HttpCacheStore.get refuses a body that exceeds the artifact cap", async () => {
  // Streamed in chunks with no content-length, which is the shape a cap has to
  // survive: there is nothing to read the size from up front.
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(64));
    },
    cancel() {
      cancelled = true;
    },
  });
  const store = new HttpCacheStore({
    url: "https://cache.example",
    maxArtifactBytes: 256,
    fetch: () => Promise.resolve(new Response(body, { status: 200 })),
  });

  const error = await assertRejects(() => store.get("k"));
  assertStringIncludes(
    messageOf(error),
    "refusing an artifact larger than 256 bytes",
  );
  // The stream is abandoned rather than drained, so an endless body cannot
  // exhaust memory on its way to being rejected.
  assertEquals(cancelled, true);
});

Deno.test("HttpCacheStore.get returns an artifact within the cap", async () => {
  const store = new HttpCacheStore({
    url: "https://cache.example",
    maxArtifactBytes: 256,
    fetch: () => Promise.resolve(new Response(enc("small"), { status: 200 })),
  });
  assertEquals(dec((await store.get("k")) ?? new Uint8Array()), "small");
});

Deno.test("restoreOutputs refuses a real on-disk symlink through defaultCacheHost", async () => {
  if (Deno.build.os === "windows") return; // symlink creation is privileged there
  await withTemp(async (dir) => {
    const src = new MemFs();
    src.files.set("dist/app.js", enc("built"));
    src.dirs.set("dist", ["app.js"]);
    const artifact = await archiveOutputs(["dist"], src);

    // A workspace where a declared output is a link pointing outside it — the
    // `dist -> /tmp/build` shape the docs now warn about.
    const outside = `${dir}/outside.txt`;
    await Deno.writeTextFile(outside, "untouched");
    await Deno.mkdir(`${dir}/work/dist`, { recursive: true });
    await Deno.symlink(outside, `${dir}/work/dist/app.js`);

    const cwd = Deno.cwd();
    Deno.chdir(`${dir}/work`);
    try {
      const error = await assertRejects(
        () => restoreOutputs(artifact, defaultCacheHost, ["dist"]),
      );
      assertStringIncludes(
        messageOf(error),
        "refusing to restore over the symlink",
      );
    } finally {
      Deno.chdir(cwd);
    }
    // The file the link pointed at is untouched, which is the actual guarantee.
    assertEquals(await Deno.readTextFile(outside), "untouched");
  });
});

Deno.test("restoreOutputs writes the path it validated, not the raw entry name", async () => {
  // A backslash is a legal filename character on POSIX, and `normalize` treats
  // it as a separator. So an entry named `dist\evil` is *checked* as
  // "dist/evil" — forbidden paths, declared outputs and the symlink guard all
  // reason about that form. Writing the raw name instead would check one path
  // and write another, which is how a guard gets walked around.
  const artifact = await gzip(
    tar([{ name: "dist\\evil", data: enc("payload") }]),
  );
  const out = new MemFs();
  out.dirs.set("dist", []);
  // The link sits at the *raw* name, which the guard never looks at.
  out.symlinks.add("dist\\evil");

  assertEquals(await restoreOutputs(artifact, out, ["dist"]), ["dist/evil"]);
  assertEquals(out.files.has("dist/evil"), true);
  assertEquals(out.files.has("dist\\evil"), false); // never written at the link
});

Deno.test("restoreOutputs normalises a leading ./ in an entry name", async () => {
  const artifact = await gzip(
    tar([{ name: "./dist/app.js", data: enc("built") }]),
  );
  const out = new MemFs();
  assertEquals(await restoreOutputs(artifact, out, ["dist"]), ["dist/app.js"]);
});

Deno.test("the inflated bound is not tied to the on-the-wire bound", async () => {
  // Build outputs compress, so an archive well under a store's wire cap can
  // legitimately inflate far past it. Restoring must not refuse that — the two
  // bounds exist for the same reason but cannot share a number.
  const src = new MemFs();
  src.files.set("dist/big.bin", new Uint8Array(4 * 1024 * 1024)); // 4 MiB
  src.dirs.set("dist", ["big.bin"]);
  const artifact = await archiveOutputs(["dist"], src);
  // Compresses to a tiny fraction of what it decompresses to.
  assertEquals(artifact.byteLength < 64 * 1024, true);

  const out = new MemFs();
  assertEquals(await restoreOutputs(artifact, out, ["dist"]), ["dist/big.bin"]);
  assertEquals(out.files.get("dist/big.bin")?.byteLength, 4 * 1024 * 1024);
});

Deno.test("archiveOutputs/restoreOutputs keep a relative link inside its output", async () => {
  const src = new LinkFs();
  src.dirs.set("node_modules", [".bin", "vitest"]);
  src.dirs.set("node_modules/.bin", ["vitest"]);
  src.dirs.set("node_modules/vitest", ["vitest.mjs"]);
  src.files.set(
    "node_modules/vitest/vitest.mjs",
    enc("import './dist/cli.js'"),
  );
  src.symlinks.add("node_modules/.bin/vitest");
  src.links.set("node_modules/.bin/vitest", "../vitest/vitest.mjs");

  const out = new LinkFs();
  const written = await restoreOutputs(
    await archiveOutputs(["node_modules"], src),
    out,
    ["node_modules"],
  );
  // Files first, then links, so no write passes through a planted link.
  assertEquals(written, [
    "node_modules/vitest/vitest.mjs",
    "node_modules/.bin/vitest",
  ]);
  assertEquals(
    out.links.get("node_modules/.bin/vitest"),
    "../vitest/vitest.mjs",
  );
  assertEquals(out.files.has("node_modules/.bin/vitest"), false);
  assertEquals(out.linkTypes.get("node_modules/.bin/vitest"), "file");
});

Deno.test("archiveOutputs copies a link that leaves its output, as before", async () => {
  const src = new LinkFs();
  src.dirs.set("dist", ["out", "abs", "up"]);
  // \`stat\` follows a link, so each reads back as the file it names.
  for (
    const [name, target] of [
      ["dist/out", "../shared.js"],
      ["dist/abs", "/etc/hostname"],
      ["dist/up", "sub/../../x"],
    ]
  ) {
    src.symlinks.add(name);
    src.links.set(name, target);
    src.files.set(name, enc(`copy of ${target}`));
  }
  const out = new LinkFs();
  assertEquals(
    await restoreOutputs(await archiveOutputs(["dist"], src), out, ["dist"]),
    ["dist/abs", "dist/out", "dist/up"],
  );
  assertEquals(out.links.size, 0);
  assertEquals(
    dec(out.files.get("dist/out") ?? enc("")),
    "copy of ../shared.js",
  );
});

Deno.test("archiveOutputs copies a link into a protected path rather than linking it", async () => {
  const src = new LinkFs();
  src.dirs.set("out", ["hook"]);
  src.symlinks.add("out/hook");
  src.links.set("out/hook", ".git/hooks/pre-commit");
  src.files.set("out/hook", enc("#!/bin/sh"));
  const out = new LinkFs();
  await restoreOutputs(await archiveOutputs(["out"], src), out, ["out"]);
  assertEquals(out.links.size, 0);
  assertEquals(out.files.has("out/hook"), true);
});

Deno.test("restoreOutputs types a link to a directory as one", async () => {
  const out = new LinkFs();
  out.dirs.set("node_modules/.pnpm/a@1", []);
  await restoreOutputs(
    await archive("node_modules/a -> .pnpm/a@1"),
    out,
    ["node_modules"],
  );
  assertEquals(out.linkTypes.get("node_modules/a"), "dir");
});

Deno.test("restoreOutputs accepts a workspace-relative link with no declared outputs", async () => {
  const out = new LinkFs();
  assertEquals(
    await restoreOutputs(await archive("bin/tool -> ../lib/t"), out),
    [
      "bin/tool",
    ],
  );
});

Deno.test("restoreOutputs refuses a link that leaves its output or reaches a protected path", async () => {
  const cases: [string, string][] = [
    ["dist/l -> /etc/passwd", "absolute path"],
    ["dist/l -> C:/Windows", "absolute path"],
    ["dist/l -> ../secret", "escapes the destination"],
    ["dist/l -> ..\\secret", "escapes the destination"],
    ["dist/l -> sub/../../x", 'climbs with ".." after a name'],
    ["dist/l -> ", "empty or NUL-bearing"],
    ["dist/l -> .git/config", "protected path"],
    ["dist/l -> ../other/x", "escapes the destination"],
  ];
  for (const [entry, message] of cases) {
    const out = new LinkFs();
    const err = await assertRejects(async () =>
      restoreOutputs(await archive(entry), out, ["dist", "other"])
    );
    assertStringIncludes(err.message, message);
    assertEquals(out.links.size, 0);
  }
});

Deno.test("restoreOutputs refuses a link outside every declared output", async () => {
  const err = await assertRejects(async () =>
    restoreOutputs(await archive("dist/l -> x"), new LinkFs(), ["other"])
  );
  assertStringIncludes(err.message, "outside the target's declared outputs");
});

Deno.test("restoreOutputs refuses an entry under, or on top of, a link from the archive", async () => {
  const cases: [string[], string][] = [
    [["dist/l -> sub", "dist/l/x.js"], 'under the symlink "dist/l"'],
    [["dist/l -> sub", "dist/l -> other"], "twice"],
    [["dist/l -> sub", "dist/l"], "both a file and a symlink"],
    [["dist/l", "dist/l -> sub"], "both a file and a symlink"],
  ];
  for (const [entries, message] of cases) {
    const out = new LinkFs();
    const err = await assertRejects(async () =>
      restoreOutputs(await archive(...entries), out, ["dist"])
    );
    assertStringIncludes(err.message, message);
    // Validation runs before any write.
    assertEquals(out.files.size + out.links.size, 0);
  }
});

Deno.test("restoreOutputs refuses links on a host that cannot create them", async () => {
  const out = new MemFs();
  const err = await assertRejects(async () =>
    restoreOutputs(await archive("dist/a.js", "dist/l -> a.js"), out, ["dist"])
  );
  assertStringIncludes(err.message, "cannot create them");
  assertEquals(out.files.size, 0);
});

Deno.test("defaultCacheHost round-trips a node_modules .bin link on the real filesystem", async () => {
  if (Deno.build.os === "windows") return; // symlink creation is privileged there
  await withTemp(async (dir) => {
    const cwd = Deno.cwd();
    try {
      await Deno.mkdir(`${dir}/src/node_modules/.bin`, { recursive: true });
      await Deno.mkdir(`${dir}/src/node_modules/vitest/dist`, {
        recursive: true,
      });
      await Deno.writeTextFile(
        `${dir}/src/node_modules/vitest/vitest.mjs`,
        "import './dist/cli.js';\n",
      );
      await Deno.writeTextFile(
        `${dir}/src/node_modules/vitest/dist/cli.js`,
        "globalThis.ran = true;\n",
      );
      await Deno.symlink(
        "../vitest/vitest.mjs",
        `${dir}/src/node_modules/.bin/vitest`,
      );
      Deno.chdir(`${dir}/src`);
      const artifact = await archiveOutputs(["node_modules"], defaultCacheHost);

      await Deno.mkdir(`${dir}/dst`);
      Deno.chdir(`${dir}/dst`);
      await restoreOutputs(artifact, defaultCacheHost, ["node_modules"]);
      assertEquals(
        await Deno.readLink("node_modules/.bin/vitest"),
        "../vitest/vitest.mjs",
      );
      // The relative import resolves from the link's target, as after npm ci.
      await import(`file://${dir}/dst/node_modules/.bin/vitest`);
      assertEquals(Reflect.get(globalThis, "ran"), true);
    } finally {
      Deno.chdir(cwd);
      Reflect.deleteProperty(globalThis, "ran");
    }
  });
});

Deno.test("archiveOutputs copies an output that is itself a link, never links it", async () => {
  // \`dist -> build\` resolves to "build", outside the output "dist": keeping it
  // as a link would let a restore point a declared output anywhere.
  const src = new LinkFs();
  src.symlinks.add("dist");
  src.links.set("dist", "build");
  src.dirs.set("dist", ["app.js"]);
  src.files.set("dist/app.js", enc("built"));
  const out = new LinkFs();
  assertEquals(
    await restoreOutputs(await archiveOutputs(["dist"], src), out, ["dist"]),
    ["dist/app.js"],
  );
  assertEquals(out.links.size, 0);

  // ...and a restore refuses an archive that carries one anyway.
  const err = await assertRejects(async () =>
    restoreOutputs(await archive("dist -> build"), new LinkFs(), ["dist"])
  );
  assertStringIncludes(err.message, "is the output itself");
});

Deno.test("archiveOutputs keeps one entry for a link reached through nested outputs", async () => {
  const src = new LinkFs();
  src.dirs.set("node_modules", [".bin", "tool.js"]);
  src.dirs.set("node_modules/.bin", ["tool"]);
  src.files.set("node_modules/tool.js", enc("tool"));
  src.symlinks.add("node_modules/.bin/tool");
  src.links.set("node_modules/.bin/tool", "../tool.js");
  src.files.set("node_modules/.bin/tool", enc("tool")); // stat follows it
  // Under "node_modules/.bin" the link leaves its root and would be a copy;
  // under "node_modules" it stays a link. The link wins, in either order.
  for (
    const outputs of [
      ["node_modules", "node_modules/.bin"],
      ["node_modules/.bin", "node_modules"],
    ]
  ) {
    const out = new LinkFs();
    await restoreOutputs(await archiveOutputs(outputs, src), out, outputs);
    assertEquals(out.links.get("node_modules/.bin/tool"), "../tool.js");
    assertEquals(out.files.has("node_modules/.bin/tool"), false);
  }
});

Deno.test("restoreOutputs counts a link's depth the way the filesystem does", async () => {
  // The filesystem collapses empty and `.` segments, so `dist///x` is
  // `dist/x`: counting it three levels deep would let `../..` leave the
  // workspace, and a second entry would then be created through it.
  const cases: [string[], string[] | undefined][] = [
    [["dist///x -> ../.."], ["dist"]],
    [["dist//x -> .."], ["dist"]],
    [["dist/././w -> ../.."], ["dist"]],
    [["a//b -> ../.."], undefined],
    [["dist///x -> ../..", "dist/x/pwned -> evil"], ["dist"]],
  ];
  for (const [entries, outputs] of cases) {
    const out = new LinkFs();
    await assertRejects(async () =>
      restoreOutputs(await archive(...entries), out, outputs)
    );
    assertEquals(out.links.size, 0);
  }
  // ...and once canonical, the same name is checked under the link it aliases.
  const err = await assertRejects(async () =>
    restoreOutputs(
      await archive("dist/x -> sub", "dist//x/y -> ../z"),
      new LinkFs(),
      ["dist"],
    )
  );
  assertStringIncludes(err.message, 'under the symlink "dist/x"');
});

Deno.test("archiveOutputs names entries canonically for a trailing-slash or `.` output", async () => {
  const src = new LinkFs();
  src.dirs.set("out", ["k"]);
  src.dirs.set(".", ["out"]);
  src.symlinks.add("out/k");
  src.links.set("out/k", "..");
  src.files.set("out/k", enc("followed"));
  // `out/` must not name the link `out//k`, whose extra level would let `..`
  // stay "inside" — it leaves the output, so it is copied.
  for (const outputs of [["out/"], ["./out"]]) {
    const out = new LinkFs();
    assertEquals(
      await restoreOutputs(await archiveOutputs(outputs, src), out, outputs),
      ["out/k"],
    );
    assertEquals(out.links.size, 0);
  }
  // The whole workspace as `.`: `out/k -> ..` stays inside it, as a link.
  const out = new LinkFs();
  await restoreOutputs(await archiveOutputs(["."], src), out, ["."]);
  assertEquals(out.links.get("out/k"), "..");
});

/** A {@link LinkFs} whose `lstat` folds case, as macOS and Windows do. */
class CaseFoldingFs extends LinkFs {
  override lstat(
    path: string,
  ): Promise<{ isSymlink: boolean; isDirectory: boolean } | null> {
    for (const link of this.symlinks) {
      if (link.toLowerCase() === path.toLowerCase()) {
        return Promise.resolve({ isSymlink: true, isDirectory: false });
      }
    }
    return super.lstat(path);
  }
}

Deno.test("restoreOutputs re-checks the live filesystem before each link", async () => {
  // `out/s/h` is not under `out/S` by name, but on a case-insensitive
  // filesystem it is: once `out/S -> .` exists, `../x` from `out/s` climbs out.
  const out = new CaseFoldingFs();
  out.dirs.set("out", []); // the directory the first link lands in
  const err = await assertRejects(async () =>
    restoreOutputs(await archive("out/S -> .", "out/s/h -> ../x"), out, [
      "out",
    ])
  );
  assertStringIncludes(err.message, 'through the symlink "out/s"');
  assertEquals(out.links.has("out/s/h"), false);
});

Deno.test("archiveOutputs does not re-enter a directory a link loops back to", async () => {
  // `dist/loop` and `dist/again` are both copied links back to `dist`; real
  // paths tell the walk it is already inside it.
  const src = new LinkFs();
  src.realPaths.set("dist/loop", "/w/dist");
  src.realPaths.set("dist/again", "/w/dist");
  src.dirs.set("dist", ["again", "app.js", "loop"]);
  src.files.set("dist/app.js", enc("built"));
  for (const link of ["dist/loop", "dist/again"]) {
    src.symlinks.add(link);
    src.links.set(link, "/w/dist");
    src.dirs.set(link, ["app.js"]); // what `stat` and `readDir` see through it
    src.files.set(`${link}/app.js`, enc("built"));
  }
  const out = new LinkFs();
  assertEquals(
    await restoreOutputs(await archiveOutputs(["dist"], src), out, ["dist"]),
    ["dist/app.js"],
  );
});

Deno.test("archiveOutputs still copies two links to one directory outside the walk", async () => {
  const src = new LinkFs();
  src.realPaths.set("dist/a", "/w/shared");
  src.realPaths.set("dist/b", "/w/shared");
  src.dirs.set("dist", ["a", "b"]);
  for (const link of ["dist/a", "dist/b"]) {
    src.symlinks.add(link);
    src.links.set(link, "/w/shared");
    src.dirs.set(link, ["x.js"]);
    src.files.set(`${link}/x.js`, enc("shared"));
  }
  assertEquals(
    await restoreOutputs(await archiveOutputs(["dist"], src), new LinkFs(), [
      "dist",
    ]),
    ["dist/a/x.js", "dist/b/x.js"],
  );
});

Deno.test("defaultCacheHost archives an output holding a looping directory link", async () => {
  if (Deno.build.os === "windows") return; // symlink creation is privileged there
  await withTemp(async (dir) => {
    const cwd = Deno.cwd();
    try {
      Deno.chdir(dir);
      await Deno.mkdir("dist");
      await Deno.writeTextFile("dist/app.js", "built");
      // Absolute: descended until ELOOP, then the upload threw.
      await Deno.symlink(`${await Deno.realPath(dir)}/dist`, "dist/abs");
      // Relative, out and back in: copied once, leaving a dangling link.
      await Deno.symlink("../dist", "dist/rel");
      const out = new LinkFs();
      assertEquals(
        await restoreOutputs(
          await archiveOutputs(["dist"], defaultCacheHost),
          out,
          ["dist"],
        ),
        ["dist/app.js"],
      );
      assertEquals(out.links.size, 0);
    } finally {
      Deno.chdir(cwd);
    }
  });
});

Deno.test("restoreOutputs writes nothing when a late entry is refused", async () => {
  // Restore streams the archive twice; the refusal comes from the first pass,
  // after valid entries have already been read, and still nothing is written.
  const out = new LinkFs();
  const err = await assertRejects(async () =>
    restoreOutputs(
      await archive("dist/a.js", "dist/b.js", "dist/l -> ../../x"),
      out,
      ["dist"],
    )
  );
  assertStringIncludes(err.message, "escapes the destination");
  assertEquals(out.files.size + out.links.size, 0);
});

Deno.test("restoreOutputs writes each file from the second pass, in order", async () => {
  const src = new MemFs();
  src.dirs.set("dist", ["a.js", "big.bin"]);
  src.files.set("dist/a.js", enc("a"));
  // Larger than one inflated chunk, so its bytes span several reads.
  const big = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7) % 253);
  src.files.set("dist/big.bin", big);
  const out = new MemFs();
  assertEquals(
    await restoreOutputs(await archiveOutputs(["dist"], src), out, ["dist"]),
    ["dist/a.js", "dist/big.bin"],
  );
  assertEquals(out.files.get("dist/big.bin"), big);
});

Deno.test("restoreOutputs refuses a corrupt size field rather than hanging", async () => {
  const archive = tar([{ name: "dist/a.js", data: enc("0123456789") }]);
  archive.set(enc(" -1750\0\0\0\0\0\0"), 124); // octal -1000
  const out = new MemFs();
  const err = await assertRejects(async () =>
    restoreOutputs(await gzip(archive), out, ["dist"])
  );
  assertStringIncludes(err.message, "size field");
  assertEquals(out.files.size, 0);
});
