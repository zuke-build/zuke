// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the S3 cache store picked up from `ZUKE_REMOTE_CACHE_S3_URL`
 * and the AWS variables, driven through the real CLI ({@link runCli}) against
 * an in-memory bucket that insists on a SigV4 signature. The fake stands in
 * for the global `fetch`, which is safe here because every test file runs in
 * its own process.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";
import { withTempCwd } from "../../packages/core/tests/_temp.ts";

const BUCKET = "https://bucket.s3.eu-west-1.amazonaws.com/zuke-cache";

/** A fake bucket: unsigned requests are refused, signed ones stored. */
function fakeBucket(): {
  fetch: typeof fetch;
  objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
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
    const key = url.slice(`${BUCKET}/`.length);
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

Deno.test("the S3 cache store restores outputs on a fresh checkout", async () => {
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
        Deno.env.set(name, value);
      }
      try {
        await Deno.writeTextFile(`${dir}/input.txt`, "v1");
        const log: string[] = [];
        class B extends Build {
          build = target().inputs("input.txt").outputs("out.txt").executes(
            async () => {
              log.push("build");
              await Deno.writeTextFile("out.txt", "built");
            },
          );
        }

        const first = await runCli(B, ["build"]);
        assertEquals(first.code, 0);
        assertEquals(log, ["build"]);
        assertEquals(bucket.objects.size, 1); // the first run uploaded, signed

        await Deno.remove(`${dir}/.zuke`, { recursive: true });
        await Deno.remove(`${dir}/out.txt`);

        const second = await runCli(B, ["build"]);
        assertEquals(second.code, 0);
        assertEquals(log, ["build"]); // restored, body not re-run
        assertEquals(await Deno.readTextFile(`${dir}/out.txt`), "built");
      } finally {
        globalThis.fetch = realFetch;
        for (const name of Object.keys(vars)) Deno.env.delete(name);
      }
    });
  });
});
