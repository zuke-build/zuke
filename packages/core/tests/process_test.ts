// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "./_assert.ts";
import { spawnProcess } from "../src/process.ts";

/** Start this Deno running `script`, with every stream piped. */
function run(
  script: string,
  extra: { cwd?: string; env?: Record<string, string>; signal?: AbortSignal } =
    {},
) {
  return spawnProcess(Deno.execPath(), {
    args: ["eval", script],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    ...extra,
  });
}

/** Everything a stream carries, as text. */
async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

Deno.test("spawnProcess starts the command with its arguments, one per entry", async () => {
  const child = run("console.log(JSON.stringify(Deno.args))");
  // Nothing re-splits or re-quotes an argument: this one stays whole.
  const odd = spawnProcess(Deno.execPath(), {
    args: ["eval", "console.log(JSON.stringify(Deno.args))", "a b", '"&c'],
    stdout: "piped",
    stderr: "piped",
  });
  assertEquals(JSON.parse(await text(odd.stdout)), ["a b", '"&c']);
  await odd.stderr.cancel();
  assertEquals((await odd.status).success, true);

  await child.stdin.close();
  assertEquals(JSON.parse(await text(child.stdout)), []);
  await child.stderr.cancel();
  assertEquals(await child.status, { success: true, code: 0, signal: null });
  assertEquals(child.pid > 0, true);
});

Deno.test("spawnProcess wires stdin, stdout, stderr, the directory and the environment", async () => {
  const dir = await Deno.makeTempDir();
  const child = run(
    `const input = await new Response(Deno.stdin.readable).text();
     console.log(input + "|" + Deno.env.get("ZUKE_PROCESS_TEST") + "|" + Deno.realPathSync(Deno.cwd()));
     console.error("to stderr");
     Deno.exit(3);`,
    { cwd: dir, env: { ZUKE_PROCESS_TEST: "set" } },
  );
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode("typed"));
  await writer.close();
  const [out, err] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
  ]);
  assertEquals(out.trim(), `typed|set|${await Deno.realPath(dir)}`);
  assertEquals(err.trim(), "to stderr");
  assertEquals(await child.status, { success: false, code: 3, signal: null });
  await Deno.remove(dir);
});

Deno.test("a child ends when it is killed, and when its abort signal fires", async () => {
  const forever = "await new Promise(() => setInterval(() => {}, 1000));";
  const killed = run(forever);
  killed.kill("SIGKILL");
  await Promise.all([
    killed.stdin.close(),
    killed.stdout.cancel(),
    killed.stderr.cancel(),
  ]);
  assertEquals((await killed.status).success, false);

  const controller = new AbortController();
  const aborted = run(forever, { signal: controller.signal });
  controller.abort();
  await Promise.all([
    aborted.stdin.close(),
    aborted.stdout.cancel(),
    aborted.stderr.cancel(),
  ]);
  assertEquals((await aborted.status).success, false);
});

Deno.test("a stream that was not piped is not there to read", async () => {
  const child = spawnProcess(Deno.execPath(), {
    args: ["eval", ""],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  assertThrows(() => child.stdout);
  assertEquals((await child.status).code, 0);
});

Deno.test("spawnProcess reports a command that does not exist", () => {
  assertThrows(
    () => spawnProcess("zuke-no-such-command-anywhere", { args: [] }),
    Deno.errors.NotFound,
  );
});
