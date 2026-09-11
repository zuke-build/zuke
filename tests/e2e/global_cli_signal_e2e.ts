// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: signals reaching the global `zuke` while it forwards to a
 * build. The launcher `exec`s Deno, so there is no parent to get in the way;
 * the forwarding CLI is a real parent process, and this proves it behaves
 * like one that is not there: a SIGINT addressed to it alone is ignored (the
 * terminal delivers Ctrl-C to the build directly, whose own handler cancels
 * gracefully), a SIGTERM is forwarded so the build is never orphaned, and
 * the parent stays to report the build's exit code. Real processes, so this
 * lives in the e2e suite; skipped on Windows, which has no SIGTERM.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";

const CORE = new URL("../../packages/core/mod.ts", import.meta.url).href;
const CLI = new URL("../../packages/cli/mod.ts", import.meta.url).pathname;

/** A build whose one target records its pid, then waits to be cancelled. */
const SLOW_BUILD = `import { Build, run, target } from "${CORE}";

class Slow extends Build {
  slow = target().executes(async (ctx) => {
    await Deno.writeTextFile("pid.txt", String(Deno.pid));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (ctx.signal.aborted) await Deno.writeTextFile("cancelled.txt", "yes");
  });
}

await run(Slow);
`;

/** Poll until `path` exists, or fail after `timeoutMs`. */
async function waitFor(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await Deno.lstat(path);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

/** Whether a process with `pid` still exists (signal 0 semantics). */
function alive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name:
    "the forwarding zuke ignores a SIGINT of its own, forwards SIGTERM, and reports the build's exit",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/zuke.json`, '{ "name": "Slow" }\n');
      await Deno.writeTextFile(`${dir}/zuke.ts`, SLOW_BUILD);
      const parent = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", CLI, "slow"],
        cwd: dir,
        stdin: "null",
        stdout: "null",
        stderr: "null",
      }).spawn();
      await waitFor(`${dir}/pid.txt`, 30_000);
      const buildPid = Number(await Deno.readTextFile(`${dir}/pid.txt`));

      // A SIGINT addressed to the parent alone: ignored, so neither process
      // exits and the build keeps waiting (a terminal would have delivered
      // the Ctrl-C to the build itself).
      parent.kill("SIGINT");
      const settledEarly = await Promise.race([
        parent.status.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 500)),
      ]);
      assertEquals(settledEarly, false);
      assertEquals(alive(buildPid), true);

      // SIGTERM: forwarded to the build, which cancels gracefully and exits;
      // the parent waits for it and reports its non-zero code.
      parent.kill("SIGTERM");
      const status = await parent.status;
      assertEquals(status.code !== 0, true);
      assertEquals(await Deno.readTextFile(`${dir}/cancelled.txt`), "yes");
      // Give the OS a moment to reap, then: no orphan.
      await new Promise((r) => setTimeout(r, 100));
      assertEquals(alive(buildPid), false);
    }, { prefix: "zuke-global-signal-" });
  },
});
