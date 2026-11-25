// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the GitHub Actions cache store, picked up from the environment
 * the way a job that set `actions-cache` would present it, driven through the
 * real CLI ({@link runCli}) against an in-memory fake of the cache service. The
 * fake stands in for the global `fetch`, which is safe here because every test
 * file runs in its own process.
 */

import { setEnv } from "../_env.ts";
import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import { Build, FileTasks, target } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";
import { withTempCwd } from "../_temp.ts";

const RESULTS_URL = "https://results.test/";
const SERVICE =
  `${RESULTS_URL}twirp/github.actions.results.api.v1.CacheService/`;

/** A fake cache service: Twirp calls hand out blob URLs into `blobs`. */
function fakeService(): {
  fetch: typeof fetch;
  blobs: Map<string, Uint8Array>;
} {
  const blobs = new Map<string, Uint8Array>();
  const fetchFn: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(SERVICE)) {
      const { key } = JSON.parse(String(init?.body));
      const blob = `https://blob.test/${key}`;
      switch (url.slice(SERVICE.length)) {
        case "GetCacheEntryDownloadURL":
          return Response.json(
            blobs.has(key)
              ? { ok: true, signed_download_url: blob }
              : { ok: false },
          );
        case "CreateCacheEntry":
          return Response.json({ ok: true, signed_upload_url: blob });
        default:
          return Response.json({ ok: true, entry_id: "1" });
      }
    }
    const key = url.slice("https://blob.test/".length);
    if (init?.method === "PUT" && init.body instanceof Blob) {
      blobs.set(key, new Uint8Array(await init.body.arrayBuffer()));
      return new Response(null, { status: 201 });
    }
    const found = blobs.get(key);
    return found === undefined
      ? new Response(null, { status: 404 })
      : new Response(new Blob([new Uint8Array(found)]));
  };
  return { fetch: fetchFn, blobs };
}

test("the GitHub Actions cache store restores outputs on a fresh checkout", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const service = fakeService();
      const realFetch = globalThis.fetch;
      globalThis.fetch = service.fetch;
      setEnv("ACTIONS_RUNTIME_TOKEN", "runtime-token");
      setEnv("ACTIONS_RESULTS_URL", RESULTS_URL);
      try {
        await FileTasks.writeText(`${dir}/input.txt`, "v1");
        const log: string[] = [];
        class B extends Build {
          build = target().inputs("input.txt").outputs("out.txt").executes(
            async () => {
              log.push("build");
              await FileTasks.writeText("out.txt", "built");
            },
          );
        }

        const first = await runCli(B, ["build"]);
        assertEquals(first.code, 0);
        assertEquals(log, ["build"]);
        assertEquals(service.blobs.size, 1); // the first run uploaded an entry

        // A fresh checkout: no local cache, no output, the service still populated.
        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        await FileTasks.remove(`${dir}/out.txt`);

        const second = await runCli(B, ["build"]);
        assertEquals(second.code, 0);
        assertEquals(log, ["build"]); // restored, body not re-run
        assertEquals(await FileTasks.readText(`${dir}/out.txt`), "built");
      } finally {
        globalThis.fetch = realFetch;
        setEnv("ACTIONS_RUNTIME_TOKEN", undefined);
        setEnv("ACTIONS_RESULTS_URL", undefined);
      }
    });
  });
});
