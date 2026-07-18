/**
 * Integration: incremental caching (`.inputs`/`.outputs`/`.cacheKey`), the
 * remote cache, and the affected-targets computation. The caching scenarios
 * are driven through the real CLI ({@link runCli}) so the whole
 * parse → cache lookup → execute path is exercised, not a unit seam; the
 * affected scenario exercises {@link affectedTargets} directly (a pure
 * function), with an injected changed-files list instead of a real git repo.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  affectedTargets,
  Build,
  type ChangedFilesFn,
  plan,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

/**
 * Run `fn` inside a fresh temporary directory used as the process cwd. The
 * incremental cache resolves `.zuke/cache.json` relative to `Deno.cwd()` (see
 * `resolveCache` in `packages/core/src/executor.ts`), so a caching test must
 * isolate the cwd the same way `packages/core/tests/executor_test.ts` does —
 * otherwise a run through the real CLI would write its cache store into this
 * repository's own `.zuke/` directory. Restores the original cwd and removes
 * the directory afterwards, even on failure.
 */
async function withTempCwd(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-cache-" });
  const original = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn(dir);
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a target with unchanged inputs is skipped as cached, and reruns when the input changes", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      await Deno.writeTextFile(`${dir}/input.txt`, "v1");
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

      await Deno.writeTextFile(`${dir}/input.txt`, "v2");
      const third = await runCli(B, ["build"]);
      assertEquals(third.code, 0);
      assertEquals(log, ["build", "build"]); // changed input → rebuilt
    });
  });
});

Deno.test("a custom cacheKey controls freshness independent of file inputs", async () => {
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

Deno.test("always() still runs after a build-wide failure, but is not exempt from the incremental cache", async () => {
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
      await Deno.writeTextFile(`${dir}/input.txt`, "v1");
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

Deno.test("a FileSystemCacheStore (env-configured) restores outputs on a fresh checkout", async () => {
  await withStateDir(async () => {
    await withTempCwd(async (dir) => {
      const remoteDir = await Deno.makeTempDir({ prefix: "zuke-it-remote-" });
      const prevRemote = Deno.env.get("ZUKE_REMOTE_CACHE_DIR");
      // `ZUKE_REMOTE_CACHE_DIR` selects a FileSystemCacheStore via the
      // `envCacheStore` seam (see remote_cache.ts); the CLI passes
      // `remoteCache: undefined` unless `--no-remote-cache` is given, so this
      // env var is picked up automatically by a plain `runCli` call.
      Deno.env.set("ZUKE_REMOTE_CACHE_DIR", remoteDir);
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
        assertEquals(log, ["build"]); // first run populates the remote store

        // Simulate a fresh checkout: drop the local cache store and the
        // output, but keep the remote store populated by the first run.
        await Deno.remove(`${dir}/.zuke`, { recursive: true });
        await Deno.remove(`${dir}/out.txt`);

        const second = await runCli(B, ["build"]);
        assertEquals(second.code, 0);
        assertEquals(log, ["build"]); // restored from the remote store, body not re-run
        assertEquals(await Deno.readTextFile(`${dir}/out.txt`), "built");
      } finally {
        if (prevRemote === undefined) {
          Deno.env.delete("ZUKE_REMOTE_CACHE_DIR");
        } else {
          Deno.env.set("ZUKE_REMOTE_CACHE_DIR", prevRemote);
        }
        await Deno.remove(remoteDir, { recursive: true });
      }
    });
  });
});

Deno.test("affectedTargets selects only the targets a changed file can reach, with no real git", async () => {
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
