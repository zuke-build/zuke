// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `zuke setup`: drive the real `@zuke/cli` `main()`
 * against a real temporary directory (the production {@link defaultHost}, only
 * its logging captured) and assert the files that land on disk are a scaffold
 * whose advertised next step — `./zuke <target>` — can actually run.
 *
 * The regression this pins: a scaffold has no `deno.lock` yet, and
 * `deno run --frozen` against a missing lockfile fails ("The lockfile is out of
 * date") instead of writing one, so an unconditional `--frozen` in the launcher
 * or the `deno.json` task breaks every project on its very first run.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { main } from "../../packages/cli/mod.ts";
import { defaultHost, type SetupHost } from "../../packages/cli/src/setup.ts";

/** Scaffold into a fresh temp directory and return its files plus the log. */
async function scaffold(): Promise<{
  read: (name: string) => Promise<string>;
  log: string;
  code: number;
}> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-setup-" });
  const lines: string[] = [];
  const host: SetupHost = {
    ...defaultHost,
    log: (message: string) => void lines.push(message),
  };
  try {
    const code = await main(
      ["setup", "--yes", "--name", "Foo", "--dir", dir],
      host,
    );
    const files = new Map<string, string>();
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile) {
        files.set(entry.name, await Deno.readTextFile(`${dir}/${entry.name}`));
      }
    }
    return {
      read: (name: string) => {
        const text = files.get(name);
        if (text === undefined) throw new Error(`setup did not write ${name}`);
        return Promise.resolve(text);
      },
      log: lines.join("\n"),
      code,
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("zuke setup scaffolds a project whose first run has no lockfile to freeze", async () => {
  const { read, log, code } = await scaffold();
  assertEquals(code, 0);
  assertEquals(log.includes("Next: ./zuke"), true);

  // The bash launcher — the entry point setup tells the user to run — only
  // asks for --frozen when there is a lockfile to verify.
  const bash = await read("zuke");
  assertEquals(bash.includes("if [ -f deno.lock ]; then"), true);
  assertEquals(bash.split("run -A --frozen").length - 1, 1);
  assertEquals(bash.split(`run -A zuke.ts "$@"`).length - 1, 1);

  // The PowerShell launcher agrees.
  const pwsh = await read("zuke.ps1");
  assertEquals(pwsh.includes(`Test-Path (Join-Path $dir "deno.lock")`), true);
  assertEquals(pwsh.split(`$denoArgs += "--frozen"`).length - 1, 1);
  assertEquals(pwsh.includes(`@("run", "-A")`), true);

  // `deno task`'s shell has no conditionals, so the task cannot bootstrap a
  // lockfile — it must not demand one either.
  const denoJson: unknown = JSON.parse(await read("deno.json"));
  const tasks =
    denoJson !== null && typeof denoJson === "object" && "tasks" in denoJson
      ? denoJson.tasks
      : undefined;
  const zukeTask =
    tasks !== null && typeof tasks === "object" && "zuke" in tasks
      ? tasks.zuke
      : undefined;
  assertEquals(zukeTask, "deno run -A zuke.ts");

  // The starter build stays pinned, so the lock the first run writes is
  // meaningful for every run after it.
  assertEquals((await read("zuke.ts")).includes('jsr:@zuke/core@^1"'), true);
});
