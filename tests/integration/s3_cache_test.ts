// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the S3 cache store picked up from `ZUKE_REMOTE_CACHE_S3_URL`
 * and the AWS variables, driven through the real CLI ({@link runCli}) against
 * an in-memory bucket that insists on a SigV4 signature. The fake stands in
 * for the global `fetch`, which is safe here because every test file runs in
 * its own process.
 */

import { test } from "../_testing.ts";
import { assertEquals } from "../_assert.ts";
import { Build, EnvTasks, FileTasks, target } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";
import { withTempCwd } from "../_temp.ts";

const BUCKET = "https://bucket.s3.eu-west-1.amazonaws.com/zuke-cache";

/** A fake bucket: unsigned requests are refused, signed ones stored. */
function fakeBucket(): {
  fetch: typeof fetch;
  objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  const parts = new Map<number, Uint8Array<ArrayBuffer>>();
  const fetchFn: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization") ?? "";
    if (
      !auth.includes("Credential=AKIDEXAMPLE/") ||
      !auth.includes("/eu-west-1/s3/aws4_request") ||
      headers.get("x-amz-content-sha256") === null
    ) {
      return new Response("unsigned", { status: 403 });
    }
    const [path, query = ""] = url.slice(`${BUCKET}/`.length).split("?");
    const key = path;
    const params = new URLSearchParams(query);
    if (init?.method === "POST" && query === "uploads") {
      return new Response("<R><UploadId>u1</UploadId></R>");
    }
    if (init?.method === "PUT" && params.has("partNumber")) {
      if (headers.get("x-amz-content-sha256") !== "UNSIGNED-PAYLOAD") {
        return new Response("signed part", { status: 400 });
      }
      const part = new Uint8Array(await new Response(init.body).arrayBuffer());
      parts.set(Number(params.get("partNumber")), part);
      return new Response(null, { headers: { etag: '"e"' } });
    }
    if (init?.method === "POST" && params.has("uploadId")) {
      objects.set(
        key,
        new Uint8Array(
          await new Blob(
            [...parts.entries()].sort((a, b) => a[0] - b[0]).map((p) => p[1]),
          ).arrayBuffer(),
        ),
      );
      parts.clear();
      return new Response("<Done/>");
    }
    if (init?.method === "PUT" && init.body instanceof Blob) {
      objects.set(key, new Uint8Array(await init.body.arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    const found = objects.get(key);
    return found === undefined
      ? new Response(null, { status: 404 })
      : new Response(new Blob([new Uint8Array(found)]));
  };
  return { fetch: fetchFn, objects };
}

test("the S3 cache store restores outputs on a fresh checkout", async () => {
  await restoresOutputs(new TextEncoder().encode("built"));
});

test("the S3 cache store uploads and restores a multi-part archive", async () => {
  // Random bytes do not compress, so the archive spans two 8 MiB parts.
  const big = new Uint8Array(9 * 1024 * 1024);
  for (let at = 0; at < big.length; at += 65536) {
    crypto.getRandomValues(big.subarray(at, at + 65536));
  }
  await restoresOutputs(big);
});

/** Build `out.txt` as `content`, drop the local state, and restore it from the bucket. */
async function restoresOutputs(content: Uint8Array): Promise<void> {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const bucket = fakeBucket();
      const realFetch = globalThis.fetch;
      globalThis.fetch = bucket.fetch;
      const vars = {
        ZUKE_REMOTE_CACHE_S3_URL: BUCKET,
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        AWS_REGION: "eu-west-1",
      };
      for (const [name, value] of Object.entries(vars)) {
        EnvTasks.set(name, value);
      }
      try {
        await FileTasks.writeText(`${dir}/input.txt`, "v1");
        const log: string[] = [];
        class B extends Build {
          build = target().inputs("input.txt").outputs("out.txt").executes(
            async () => {
              log.push("build");
              await FileTasks.writeBytes("out.txt", content);
            },
          );
        }

        const first = await runCli(B, ["build"]);
        assertEquals(first.code, 0);
        assertEquals(log, ["build"]);
        assertEquals(bucket.objects.size, 1); // the first run uploaded, signed

        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        await FileTasks.remove(`${dir}/out.txt`);

        const second = await runCli(B, ["build"]);
        assertEquals(second.code, 0);
        assertEquals(log, ["build"]); // restored, body not re-run
        assertEquals(
          await FileTasks.readBytes(`${dir}/out.txt`),
          content,
        );
      } finally {
        globalThis.fetch = realFetch;
        for (const name of Object.keys(vars)) EnvTasks.delete(name);
      }
    });
  });
}
