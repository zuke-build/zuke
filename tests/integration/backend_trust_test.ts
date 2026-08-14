// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the two trust boundaries a build crosses without the author
 * writing any code for them — the URL of a configured backend, and the contents
 * of a remote-cache artifact. Both are driven through the real CLI
 * ({@link runCli}), so the whole parse → resolve → execute path is exercised.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, gzip, tar, target } from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";
import { withTempCwd } from "../../packages/core/tests/_temp.ts";

const enc = (text: string) => new TextEncoder().encode(text);

Deno.test("a plaintext state-service URL fails the run instead of sending the token", async () => {
  await withEnv(
    {
      ZUKE_STATE_URL: "http://state.example/api",
      ZUKE_STATE_TOKEN: "tok-abc123",
    },
    async () => {
      class B extends Build {
        deploy = target().executes(() => {});
      }
      const result = await runCli(B, ["deploy"]);
      assertEquals(result.code, 1);
      const output = `${result.out}\n${result.err}`;
      assertStringIncludes(output, "ZUKE_STATE_URL");
      assertStringIncludes(output, "https");
      // The message that reports the misconfiguration must not leak the token
      // it was about to send over the wire.
      assertEquals(output.includes("tok-abc123"), false);
    },
  );
});

Deno.test("a plaintext registry URL fails `register` the same way", async () => {
  // The guard sits in every backend resolver, and the CLI reports it once,
  // around every command — so a second command reaching a second backend gets
  // the same named error and exit code, not a stack trace.
  await withEnv({ ZUKE_REGISTRY_URL: "http://registry.example" }, async () => {
    class B extends Build {
      deploy = target().executes(() => {});
    }
    const result = await runCli(B, ["register"]);
    assertEquals(result.code, 1);
    const output = `${result.out}\n${result.err}`;
    assertStringIncludes(output, "ZUKE_REGISTRY_URL");
    assertStringIncludes(output, "ZUKE_ALLOW_INSECURE_URL");
  });
});

Deno.test("a poisoned remote-cache artifact rebuilds the target instead of restoring it", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await Deno.makeTempDir({ prefix: "zuke-it-poison-" });
      await withEnv({ ZUKE_REMOTE_CACHE_DIR: remoteDir }, async () => {
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

          // A first run populates the store, so the archive lands under the key
          // this target's fingerprint resolves to.
          assertEquals((await runCli(B, ["build"])).code, 0);
          assertEquals(log, ["build"]);

          // Whoever can write the store replaces that archive with one carrying
          // an extra file outside the target's declared outputs — the shape a
          // cache-poisoning attack takes, since the name itself is innocuous.
          const stored = [...Deno.readDirSync(remoteDir)].map((e) => e.name);
          assertEquals(stored.length, 1);
          await Deno.writeFile(
            `${remoteDir}/${stored[0]}`,
            await gzip(tar([
              { name: "out.txt", data: enc("built") },
              { name: "deno.json", data: enc('{"tasks":{"x":"curl evil"}}') },
            ])),
          );

          // Simulate a fresh checkout: the local cache and output are gone, so
          // the run reaches for the remote store.
          await Deno.remove(`${dir}/.zuke`, { recursive: true });
          await Deno.remove(`${dir}/out.txt`);

          const second = await runCli(B, ["build"]);
          assertEquals(second.code, 0);
          assertEquals(log, ["build", "build"]); // rebuilt, not restored
          assertEquals(await Deno.readTextFile(`${dir}/out.txt`), "built");
          // The out-of-scope entry never landed, and the refusal was reported.
          assertEquals(
            await Deno.stat(`${dir}/deno.json`).then(() => true).catch(() =>
              false
            ),
            false,
          );
          assertStringIncludes(`${second.out}\n${second.err}`, "refused");
        } finally {
          await Deno.remove(remoteDir, { recursive: true });
        }
      });
    });
  });
});
