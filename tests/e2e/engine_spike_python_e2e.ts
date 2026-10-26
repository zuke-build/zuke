// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The engine/worker spike against a worker written in Python: the one thing
 * the in-process tests cannot show is a foreign-language process speaking the
 * protocol. Skipped where `python3` is not on PATH.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";

const ENGINE = new URL("../../spike/engine/mod.ts", import.meta.url).href;
const WORKER = new URL(
  "../../spike/engine/fixtures/worker.py",
  import.meta.url,
).pathname;

function hasPython(): boolean {
  try {
    return new Deno.Command("python3", { args: ["--version"] }).outputSync()
      .success;
  } catch {
    return false;
  }
}

async function engine(
  cwd: string,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", ENGINE, ...args],
    cwd,
    env: { ZUKE_PLAIN: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code, out: decoder.decode(stdout), err: decoder.decode(stderr) };
}

Deno.test({
  name: "a Python worker's build lists and runs on the TypeScript engine",
  ignore: !hasPython(),
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "zuke-py-" });
    try {
      await Deno.writeTextFile(
        `${dir}/zuke.json`,
        JSON.stringify({
          name: "PyBuild",
          sdk: { command: ["python3", WORKER] },
        }),
      );
      const listed = await engine(dir, ["--list", "--json"]);
      assertEquals(listed.code, 0, listed.err);
      const surface = JSON.parse(listed.out);
      assertEquals(
        surface.targets.map((t: { name: string }) => t.name),
        ["hello", "env", "default"],
      );
      const ran = await engine(dir, ["default"]);
      assertEquals(ran.code, 0, ran.out + ran.err);
      assertStringIncludes(ran.err, "worker: python worker started");
      assertStringIncludes(ran.out, "hello from a python child");
      assertStringIncludes(ran.out, "from-python");
      assertStringIncludes(ran.out, "3/3 targets");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
