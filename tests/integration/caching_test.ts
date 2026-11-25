// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: incremental caching (`.inputs`/`.outputs`/`.cacheKey`), the
 * remote cache, and the affected-targets computation. The caching scenarios
 * are driven through the real CLI ({@link runCli}) so the whole
 * parse → cache lookup → execute path is exercised, not a unit seam; the
 * affected scenario exercises {@link affectedTargets} directly (a pure
 * function), with an injected changed-files list instead of a real git repo.
 */

import { test } from "../_testing.ts";
import { assertEquals, assertStringIncludes } from "../_assert.ts";
import {
  affectedTargets,
  Build,
  type ChangedFilesFn,
  EnvTasks,
  FileTasks,
  plan,
  RuntimeTasks,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";
// The incremental cache resolves `.zuke/cache.json` relative to the working directory
// (see `resolveCache` in `packages/core/src/executor.ts`), so a caching test
// must isolate the cwd the way `packages/core/tests/executor_test.ts` does —
// otherwise a run through the real CLI would write its cache store into this
// repository's own `.zuke/` directory.
import { withTempCwd } from "../_temp.ts";
import { gzip, tar } from "../../packages/core/src/compression.ts";

/** Encode test fixture text as archive bytes. */
const enc = (text: string) => new TextEncoder().encode(text);

test("a target with unchanged inputs is skipped as cached, and reruns when the input changes", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      await FileTasks.writeText(`${dir}/input.txt`, "v1");
      const log: string[] = [];
      class B extends Build {
        build = target().inputs("input.txt").executes(() =>
          void log.push("build")
        );
      }

      const first = await runCli(B, ["build"]);
      assertEquals(first.code, 0);
      assertEquals(log, ["build"]);

      const second = await runCli(B, ["build"]);
      assertEquals(second.code, 0);
      assertEquals(log, ["build"]); // unchanged input → skipped, body not re-run
      assertStringIncludes(second.out, "Cached");

      await FileTasks.writeText(`${dir}/input.txt`, "v2");
      const third = await runCli(B, ["build"]);
      assertEquals(third.code, 0);
      assertEquals(log, ["build", "build"]); // changed input → rebuilt
    });
  });
});

test("a custom cacheKey controls freshness independent of file inputs", async () => {
  await withStateDir(async () => {
    await withTempCwd(async () => {
      let key = "v1";
      const log: string[] = [];
      class B extends Build {
        build = target().cacheKey(() => key).executes(() =>
          void log.push("build")
        );
      }

      const first = await runCli(B, ["build"]);
      assertEquals(first.code, 0);
      assertEquals(log, ["build"]);

      const second = await runCli(B, ["build"]);
      assertEquals(second.code, 0);
      assertEquals(log, ["build"]); // same key → cached, body not re-run

      key = "v2";
      const third = await runCli(B, ["build"]);
      assertEquals(third.code, 0);
      assertEquals(log, ["build", "build"]); // key changed → rebuilt
    });
  });
});

test("always() still runs after a build-wide failure, but is not exempt from the incremental cache", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const log: string[] = [];

      // Part 1 — `.always()`'s documented purpose: it keeps running for
      // cleanup even after another target has failed the build (see
      // `TargetBuilder.always` in target.ts). `cleanup` has no dependency on
      // `boom`, so it stays "ready" and is not blocked by the halt.
      class Failing extends Build {
        boom = target().executes(() => {
          throw new Error("boom");
        });
        cleanup = target().always().executes(() => void log.push("cleanup"));
        all = target().dependsOn(this.boom, this.cleanup).executes(() =>
          void log.push("all")
        );
      }
      const failing = await runCli(Failing, ["all"]);
      assertEquals(failing.code, 1); // the build still fails overall
      assertEquals(log, ["cleanup"]); // ran despite the failure; "all" never runs

      // Part 2 — contrary to a common assumption, `.always()` does NOT bypass
      // the incremental cache: the executor's cache lookup (`runTarget` in
      // executor.ts) happens before the always/halted check, so an always()
      // target with unchanged inputs is skipped exactly like any other
      // cacheable target.
      await FileTasks.writeText(`${dir}/input.txt`, "v1");
      class Cached extends Build {
        maintain = target().inputs("input.txt").always().executes(() =>
          void log.push("maintain")
        );
      }
      const firstRun = await runCli(Cached, ["maintain"]);
      assertEquals(firstRun.code, 0);
      assertEquals(log, ["cleanup", "maintain"]);

      const secondRun = await runCli(Cached, ["maintain"]);
      assertEquals(secondRun.code, 0);
      assertEquals(log, ["cleanup", "maintain"]); // still just one run: cached
      assertStringIncludes(secondRun.out, "Cached");
    });
  });
});

test("a FileSystemCacheStore (env-configured) restores outputs on a fresh checkout", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await FileTasks.makeTempDirectory((s) =>
        s.prefix("zuke-it-remote-")
      );
      const prevRemote = EnvTasks.get("ZUKE_REMOTE_CACHE_DIR");
      // `ZUKE_REMOTE_CACHE_DIR` selects a FileSystemCacheStore via the
      // `envCacheStore` seam (see remote_cache.ts); the CLI passes
      // `remoteCache: undefined` unless `--no-remote-cache` is given, so this
      // env var is picked up automatically by a plain `runCli` call.
      EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", remoteDir);
      try {
        await FileTasks.writeText(`${dir}/input.txt`, "v1");
        const log: string[] = [];
        class B extends Build {
          build = target().inputs("input.txt").outputs("out.txt").executes(
            async () => {
              log.push("build");
              await FileTasks.writeText("out.txt", "built");
              if (RuntimeTasks.os() !== "windows") {
                await FileTasks.chmod("out.txt", 0o755);
              }
            },
          );
        }

        const first = await runCli(B, ["build"]);
        assertEquals(first.code, 0);
        assertEquals(log, ["build"]); // first run populates the remote store

        // Simulate a fresh checkout: drop the local cache store and the
        // output, but keep the remote store populated by the first run.
        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        await FileTasks.remove(`${dir}/out.txt`);

        const second = await runCli(B, ["build"]);
        assertEquals(second.code, 0);
        assertEquals(log, ["build"]); // restored from the remote store, body not re-run
        assertEquals(await FileTasks.readText(`${dir}/out.txt`), "built");
        // A restored binary must still run: the executable bit survived the
        // archive. Windows has no permission bits to check.
        if (RuntimeTasks.os() !== "windows") {
          const mode = (await FileTasks.stat(`${dir}/out.txt`)).mode ?? 0;
          assertEquals(mode & 0o111, 0o111);
        }
      } finally {
        if (prevRemote === undefined) {
          EnvTasks.delete("ZUKE_REMOTE_CACHE_DIR");
        } else {
          EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", prevRemote);
        }
        await FileTasks.remove(remoteDir, { recursive: true });
      }
    });
  });
});

test("a node_modules output restores its .bin links as links, so tools still resolve", async () => {
  if (RuntimeTasks.os() === "windows") return; // npm writes .cmd shims there, not links
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await FileTasks.makeTempDirectory((s) =>
        s.prefix("zuke-it-remote-")
      );
      const prevRemote = EnvTasks.get("ZUKE_REMOTE_CACHE_DIR");
      EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", remoteDir);
      try {
        await FileTasks.writeText(`${dir}/package-lock.json`, "{}");
        const log: string[] = [];
        class B extends Build {
          deps = target().inputs("package-lock.json").outputs("node_modules")
            .executes(async () => {
              log.push("npm ci");
              await FileTasks.createDirectory("node_modules/.bin");
              await FileTasks.createDirectory("node_modules/tool/dist");
              await FileTasks.writeText(
                "node_modules/tool/cli.mjs",
                "import './dist/x.js';\n",
              );
              await FileTasks.writeText("node_modules/tool/dist/x.js", "\n");
              await FileTasks.symlink(
                "../tool/cli.mjs",
                "node_modules/.bin/tool",
              );
            });
        }
        assertEquals((await runCli(B, ["deps"])).code, 0);

        // A fresh runner: no local cache, no node_modules.
        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        await FileTasks.remove(`${dir}/node_modules`, { recursive: true });
        const second = await runCli(B, ["deps"]);
        assertEquals(second.code, 0);
        assertEquals(log, ["npm ci"]); // restored, not reinstalled
        assertEquals(
          await FileTasks.readLink(`${dir}/node_modules/.bin/tool`),
          "../tool/cli.mjs",
        );
      } finally {
        if (prevRemote === undefined) {
          EnvTasks.delete("ZUKE_REMOTE_CACHE_DIR");
        } else {
          EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", prevRemote);
        }
        await FileTasks.remove(remoteDir, { recursive: true });
      }
    });
  });
});

test("an output with a looping directory link uploads and restores", async () => {
  if (RuntimeTasks.os() === "windows") return; // symlink creation is privileged there
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await FileTasks.makeTempDirectory((s) =>
        s.prefix("zuke-it-remote-")
      );
      const prevRemote = EnvTasks.get("ZUKE_REMOTE_CACHE_DIR");
      EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", remoteDir);
      try {
        await FileTasks.writeText(`${dir}/input.txt`, "v1");
        const log: string[] = [];
        class B extends Build {
          build = target().inputs("input.txt").outputs("dist").executes(
            async () => {
              log.push("build");
              await FileTasks.createDirectory("dist");
              await FileTasks.writeText("dist/app.js", "built");
              // Absolute, so it is copied rather than kept — and it loops.
              await FileTasks.symlink(
                `${await FileTasks.realPath(".")}/dist`,
                "dist/self",
              );
            },
          );
        }
        const first = await runCli(B, ["build"]);
        assertEquals(first.code, 0);
        // The upload used to descend until ELOOP and fail with a warning.
        assertEquals((first.err + first.out).includes("upload"), false);

        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        await FileTasks.remove(`${dir}/dist`, { recursive: true });
        assertEquals((await runCli(B, ["build"])).code, 0);
        assertEquals(log, ["build"]); // restored, not rebuilt
        assertEquals(await FileTasks.readText(`${dir}/dist/app.js`), "built");
      } finally {
        if (prevRemote === undefined) {
          EnvTasks.delete("ZUKE_REMOTE_CACHE_DIR");
        } else {
          EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", prevRemote);
        }
        await FileTasks.remove(remoteDir, { recursive: true });
      }
    });
  });
});

test("an SDK under .zuke/tools caches with its .git and long paths, within the configured limit", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await FileTasks.makeTempDirectory((s) =>
        s.prefix("zuke-it-remote-")
      );
      const vars = [
        "ZUKE_REMOTE_CACHE_DIR",
        "ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES",
      ];
      const prev = vars.map((name) => EnvTasks.get(name));
      EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", remoteDir);
      EnvTasks.set("ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES", "1048576");
      const sdk = ".zuke/tools/sdk";
      // Past ustar's 100-byte name field, so it rides in a pax header.
      const deep = `${sdk}/${"packages/".repeat(12)}lib.dart`;
      try {
        await FileTasks.writeText(`${dir}/input.txt`, "v1");
        const log: string[] = [];
        class B extends Build {
          sdk = target().inputs("input.txt").outputs(sdk).executes(
            async () => {
              log.push("install");
              await FileTasks.createDirectory(`${sdk}/.git`);
              await FileTasks.writeText(`${sdk}/.git/HEAD`, "ref: stable\n");
              await FileTasks.createDirectory(
                deep.slice(0, deep.lastIndexOf("/")),
              );
              await FileTasks.writeText(deep, "library sdk;\n");
            },
          );
        }
        assertEquals((await runCli(B, ["sdk"])).code, 0);
        // A fresh checkout: the local cache and the SDK both gone.
        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        assertEquals((await runCli(B, ["sdk"])).code, 0);
        assertEquals(log, ["install"]); // restored, not reinstalled
        assertEquals(
          await FileTasks.readText(`${dir}/${sdk}/.git/HEAD`),
          "ref: stable\n",
        );
        assertEquals(
          await FileTasks.readText(`${dir}/${deep}`),
          "library sdk;\n",
        );

        // Below what the artifact inflates to, the restore is refused and
        // the target rebuilds rather than failing.
        EnvTasks.set("ZUKE_REMOTE_CACHE_MAX_INFLATED_BYTES", "1024");
        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        const refused = await runCli(B, ["sdk"]);
        assertEquals(refused.code, 0);
        assertEquals(log, ["install", "install"]);
        assertStringIncludes(refused.err + refused.out, "more than 1024 bytes");
      } finally {
        vars.forEach((name, i) => {
          const value = prev[i];
          if (value === undefined) EnvTasks.delete(name);
          else EnvTasks.set(name, value);
        });
        await FileTasks.remove(remoteDir, { recursive: true });
      }
    });
  });
});

test("a remote restore onto a symlinked output is refused, and rebuilds", async () => {
  if (RuntimeTasks.os() === "windows") return; // symlink creation is privileged there
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await FileTasks.makeTempDirectory((s) =>
        s.prefix("zuke-it-remote-")
      );
      const prevRemote = EnvTasks.get("ZUKE_REMOTE_CACHE_DIR");
      EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", remoteDir);
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
        assertEquals(log, ["build"]); // populates the remote store

        // Fresh checkout, except the workspace now has a symlink where the
        // declared output goes — pointing at a file outside the workspace.
        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        await FileTasks.remove(`${dir}/out.txt`);
        const outside = await FileTasks.makeTempDirectory((s) =>
          s.prefix("zuke-it-outside-")
        );
        const victim = `${outside}/victim.txt`;
        await FileTasks.writeText(victim, "untouched");
        await FileTasks.symlink(victim, `${dir}/out.txt`);

        // Poison the stored artifact. The rebuild writes "built" through the
        // link itself — that is the workspace owner's own symlink doing what
        // they asked for — so only content the *store* chose distinguishes a
        // restore that followed the link from an honest rebuild.
        const stored = await FileTasks.readDirectory(remoteDir);
        assertEquals(stored.length, 1);
        await FileTasks.writeBytes(
          `${remoteDir}/${stored[0].name}`,
          await gzip(tar([{ name: "out.txt", data: enc("poisoned") }])),
        );

        const second = await runCli(B, ["build"]);
        assertEquals(second.code, 0);
        // Refused, so the target re-executes rather than the build failing.
        assertEquals(log, ["build", "build"]);
        assertStringIncludes(second.err + second.out, "refused, rebuilding");

        // The store's bytes never reached the file the link named.
        assertEquals(await FileTasks.readText(victim), "built");
        await FileTasks.remove(outside, { recursive: true });
      } finally {
        if (prevRemote === undefined) {
          EnvTasks.delete("ZUKE_REMOTE_CACHE_DIR");
        } else {
          EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", prevRemote);
        }
        await FileTasks.remove(remoteDir, { recursive: true });
      }
    });
  });
});

test("affectedTargets selects only the targets a changed file can reach, with no real git", async () => {
  const shared = target().inputs("packages/shared");
  const api = target().inputs("packages/api").dependsOn(shared);
  const web = target().inputs("packages/web").dependsOn(shared);
  const all = target().dependsOn(api, web);
  const order = plan(all);

  // An injected `ChangedFilesFn` stands in for a real git diff.
  const apiChanged: ChangedFilesFn = (_base) =>
    Promise.resolve(["packages/api/handler.ts"]);
  const changed = await apiChanged("origin/main");

  const affected = affectedTargets(order, changed);
  assertEquals(affected.has(shared), false); // shared's inputs are unchanged
  assertEquals(affected.has(api), true); // api's own inputs matched
  assertEquals(affected.has(web), false); // web is unrelated to the change
  assertEquals(affected.has(all), true); // no inputs → unprovable, conservatively affected

  // Changing a file under the shared dependency propagates to both consumers.
  const sharedChanged: ChangedFilesFn = (_base) =>
    Promise.resolve(["packages/shared/util.ts"]);
  const affectedViaShared = affectedTargets(order, await sharedChanged("HEAD"));
  assertEquals(affectedViaShared.has(shared), true);
  assertEquals(affectedViaShared.has(api), true); // dirtied by its dependency
  assertEquals(affectedViaShared.has(web), true); // dirtied by its dependency
});

test("a cancelled run does not leave its targets recorded as up to date", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      await FileTasks.writeText(`${dir}/input.txt`, "v1");
      const log: string[] = [];
      const controller = new AbortController();
      class B extends Build {
        // Succeeds, so it records a fingerprint — then the run is cancelled and
        // its compensation undoes the work. The compensation reverses a *side
        // effect* (here, a deployment marker) and leaves the declared output
        // alone, which is the case the outputs-still-exist check cannot catch:
        // inputs unchanged plus outputs present would otherwise read as "up to
        // date" on the strength of work that was rolled back.
        build = target()
          .inputs("input.txt")
          .outputs("out.txt")
          .onCancel(() => this.rollback)
          .executes(async () => {
            log.push("build");
            await FileTasks.writeText("out.txt", "built");
            await FileTasks.writeText("deployed.txt", "yes");
            controller.abort();
          });
        rollback = target().executes(async () => {
          log.push("rollback");
          await FileTasks.remove("deployed.txt");
        });
      }

      const first = await runCli(B, ["build"], { signal: controller.signal });
      assertEquals(first.code, 1);
      assertEquals(log, ["build", "rollback"]);
      // The output survived the rollback; the deployment it represents did not.
      assertEquals(await FileTasks.readText(`${dir}/out.txt`), "built");

      const second = await runCli(B, ["build"]);
      assertEquals(second.code, 0);
      // Rebuilt rather than skipped, so the rolled-back work is done again.
      assertEquals(log, ["build", "rollback", "build"]);
      assertEquals(await FileTasks.readText(`${dir}/deployed.txt`), "yes");
    });
  });
});

test("with a signing key, a store writer's swapped artifact is rebuilt, not restored", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await FileTasks.makeTempDirectory((s) =>
        s.prefix("zuke-it-signed-")
      );
      const names = ["ZUKE_REMOTE_CACHE_DIR", "ZUKE_REMOTE_CACHE_SIGNING_KEY"];
      const prev = names.map((name) => EnvTasks.get(name));
      EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", remoteDir);
      EnvTasks.set("ZUKE_REMOTE_CACHE_SIGNING_KEY", "it-secret");
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
        const fresh = async () => {
          await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
          await FileTasks.remove(`${dir}/out.txt`);
        };

        assertEquals((await runCli(B, ["build"])).code, 0);
        const entries: string[] = [];
        for (const e of await FileTasks.readDirectory(remoteDir)) {
          entries.push(e.name);
        }
        // One entry: the archive with its MAC trailer, under the signed key.
        assertEquals(entries.length, 1);
        const artifact = entries[0];
        assertStringIncludes(artifact, ".signed");

        // The store writer replaces the archive and keeps the old trailer.
        await fresh();
        const genuine = await FileTasks.readBytes(`${remoteDir}/${artifact}`);
        await FileTasks.writeBytes(
          `${remoteDir}/${artifact}`,
          new Uint8Array([
            ...await gzip(tar([{ name: "out.txt", data: enc("evil") }])),
            ...genuine.slice(-32),
          ]),
        );
        if (RuntimeTasks.os() !== "windows") {
          await FileTasks.chmod(`${remoteDir}/${artifact}`, 0o644);
        }
        const poisoned = await runCli(B, ["build"]);
        assertEquals(poisoned.code, 0);
        assertEquals(log, ["build", "build"]); // refused, so rebuilt
        assertEquals(await FileTasks.readText(`${dir}/out.txt`), "built");
        assertStringIncludes(poisoned.out + poisoned.err, "does not match");

        // The rebuild re-signed what it uploaded, so the next checkout restores.
        await fresh();
        assertEquals((await runCli(B, ["build"])).code, 0);
        assertEquals(log, ["build", "build"]);
        assertEquals(await FileTasks.readText(`${dir}/out.txt`), "built");
      } finally {
        names.forEach((name, i) => {
          const value = prev[i];
          if (value === undefined) EnvTasks.delete(name);
          else EnvTasks.set(name, value);
        });
        await FileTasks.remove(remoteDir, { recursive: true });
      }
    });
  });
});

test("a signed output larger than one stream slice restores byte for byte", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await FileTasks.makeTempDirectory((s) =>
        s.prefix("zuke-it-large-")
      );
      const names = ["ZUKE_REMOTE_CACHE_DIR", "ZUKE_REMOTE_CACHE_SIGNING_KEY"];
      const prev = names.map((name) => EnvTasks.get(name));
      EnvTasks.set("ZUKE_REMOTE_CACHE_DIR", remoteDir);
      EnvTasks.set("ZUKE_REMOTE_CACHE_SIGNING_KEY", "it-secret");
      try {
        await FileTasks.writeText(`${dir}/input.txt`, "v1");
        // Several of the 64 KiB slices the archive is streamed in, so the
        // upload, the signature and the restore each span more than one.
        let seed = 0x2545f491;
        const payload = Uint8Array.from({ length: 200 * 1024 }, () => {
          // A shift-register generator: bytes gzip cannot shrink below a slice.
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          return seed & 0xff;
        });
        const log: string[] = [];
        class B extends Build {
          build = target().inputs("input.txt").outputs("out.bin").executes(
            async () => {
              log.push("build");
              await FileTasks.writeBytes("out.bin", payload);
            },
          );
        }

        assertEquals((await runCli(B, ["build"])).code, 0);
        await FileTasks.remove(`${dir}/.zuke`, { recursive: true });
        await FileTasks.remove(`${dir}/out.bin`);
        assertEquals((await runCli(B, ["build"])).code, 0);
        let stored = 0;
        for (const entry of await FileTasks.readDirectory(remoteDir)) {
          stored += (await FileTasks.stat(`${remoteDir}/${entry.name}`)).size;
        }
        assertEquals(stored > 128 * 1024, true); // the archive spans slices
        assertEquals(log, ["build"]); // restored, not rebuilt
        assertEquals(await FileTasks.readBytes(`${dir}/out.bin`), payload);
      } finally {
        names.forEach((name, i) => {
          const value = prev[i];
          if (value === undefined) EnvTasks.delete(name);
          else EnvTasks.set(name, value);
        });
        await FileTasks.remove(remoteDir, { recursive: true });
      }
    });
  });
});
