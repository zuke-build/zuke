// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "./_testing.ts";
import { assertEquals, assertRejects, assertThrows } from "./_assert.ts";
import { isNotFound } from "../src/internal.ts";
import {
  type ChildProcess,
  outputOf,
  type ProcessOptions,
  runProcess,
  spawnProcess,
} from "../src/process.ts";
import { childEnvironment, spawnOnNode } from "../src/process_node.ts";
import { SpawnedProcess } from "../src/shell.ts";

/** A way of starting a process. */
type Spawn = (command: string, options: ProcessOptions) => ChildProcess;

/**
 * The two ways core starts one. Both run here: the Node one through Deno's
 * `node:child_process`, so every expectation below is held to on both.
 */
const BACKENDS: [name: string, spawn: Spawn][] = [
  ["Deno", spawnProcess],
  ["Node", spawnOnNode],
];

/** Start this Deno running `script`, with every stream piped. */
function run(
  spawn: Spawn,
  script: string,
  extra: Partial<ProcessOptions> = {},
) {
  return spawn(Deno.execPath(), {
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

for (const [backend, spawn] of BACKENDS) {
  test(`${backend}: spawnProcess starts the command with its arguments, one per entry`, async () => {
    const child = run(spawn, "console.log(JSON.stringify(Deno.args))");
    // Nothing re-splits or re-quotes an argument: this one stays whole.
    const odd = spawn(Deno.execPath(), {
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

  test(`${backend}: spawnProcess wires stdin, stdout, stderr, the directory and the environment`, async () => {
    const dir = await Deno.makeTempDir();
    const child = run(
      spawn,
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

  test(`${backend}: a child started from a cleared environment sees none of the parent's`, async () => {
    Deno.env.set("ZUKE_PROCESS_PARENT", "inherited");
    try {
      const script =
        `console.log(Deno.env.get("ZUKE_PROCESS_PARENT") + "|" + Deno.env.get("ZUKE_PROCESS_TEST"))`;
      // A Windows program cannot start without knowing the system directory.
      const system = Deno.env.get("SystemRoot");
      const base: Record<string, string> = system === undefined
        ? {}
        : { SystemRoot: system };
      const kept = run(spawn, script, { env: { ZUKE_PROCESS_TEST: "set" } });
      const cleared = run(spawn, script, {
        env: { ...base, ZUKE_PROCESS_TEST: "set" },
        clearEnv: true,
      });
      const bare = run(spawn, script, { env: base, clearEnv: true });
      assertEquals((await text(kept.stdout)).trim(), "inherited|set");
      assertEquals((await text(cleared.stdout)).trim(), "undefined|set");
      assertEquals((await text(bare.stdout)).trim(), "undefined|undefined");
      for (const child of [kept, cleared, bare]) {
        await child.stdin.close();
        await child.stderr.cancel();
        await child.status;
      }
    } finally {
      Deno.env.delete("ZUKE_PROCESS_PARENT");
    }
  });

  test(`${backend}: a process run to its end gives its status and what it piped`, async () => {
    const options: ProcessOptions = {
      args: [
        "eval",
        `await Deno.stdout.write(new Uint8Array(300_000).fill(120));
         console.error("to stderr");
         Deno.exit(4);`,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    };
    const output = await outputOf(spawn(Deno.execPath(), options), options);
    assertEquals(
      {
        success: output.success,
        code: output.code,
        stdout: output.stdout.length,
        stderr: new TextDecoder().decode(output.stderr).trim(),
      },
      { success: false, code: 4, stdout: 300_000, stderr: "to stderr" },
    );
    // A stream that was not piped comes back empty.
    const quiet: ProcessOptions = {
      args: ["eval", "console.log('unseen')"],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    };
    const silent = await outputOf(spawn(Deno.execPath(), quiet), quiet);
    assertEquals(
      [silent.code, silent.stdout.length, silent.stderr.length],
      [0, 0, 0],
    );
  });

  test(`${backend}: running a command that is not there rejects`, async () => {
    const options: ProcessOptions = {
      args: [],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    };
    await assertRejects(async () =>
      await outputOf(spawn("zuke-no-such-command-anywhere", options), options)
    );
  });

  test(`${backend}: a child ends when it is killed, and when its abort signal fires`, async () => {
    const forever = "await new Promise(() => setInterval(() => {}, 1000));";
    const killed = run(spawn, forever);
    killed.kill("SIGKILL");
    await Promise.all([
      killed.stdin.close(),
      killed.stdout.cancel(),
      killed.stderr.cancel(),
    ]);
    assertEquals((await killed.status).success, false);

    const controller = new AbortController();
    const aborted = run(spawn, forever, { signal: controller.signal });
    controller.abort();
    await Promise.all([
      aborted.stdin.close(),
      aborted.stdout.cancel(),
      aborted.stderr.cancel(),
    ]);
    assertEquals((await aborted.status).success, false);
  });

  test(`${backend}: a stream that was not piped is not there to read`, async () => {
    const child = spawn(Deno.execPath(), {
      args: ["eval", ""],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    });
    assertThrows(() => child.stdout);
    assertEquals((await child.status).code, 0);
  });

  test(`${backend}: a child killed by a signal reports the signal and the code a shell gives`, async () => {
    const child = run(
      spawn,
      "await new Promise(() => setInterval(() => {}, 1000));",
    );
    child.kill("SIGTERM");
    await Promise.all([
      child.stdin.close().catch(() => {}),
      child.stdout.cancel(),
      child.stderr.cancel(),
    ]);
    const status = await child.status;
    if (Deno.build.os !== "windows") {
      assertEquals(status, { success: false, code: 143, signal: "SIGTERM" });
    }
    assertEquals(status.success, false);
    // It has exited, so there is nothing left to signal.
    assertThrows(() => child.kill());
  });

  test(`${backend}: output larger than a pipe holds arrives whole, with input written meanwhile`, async () => {
    const child = run(
      spawn,
      `const input = await new Response(Deno.stdin.readable).text();
       await Deno.stdout.write(new TextEncoder().encode("x".repeat(1_000_000) + input.length));`,
    );
    const writer = child.stdin.getWriter();
    const [out] = await Promise.all([
      text(child.stdout),
      text(child.stderr),
      writer.write(new TextEncoder().encode("y".repeat(200_000))).then(() =>
        writer.close()
      ),
    ]);
    assertEquals(out.length, 1_000_000 + "200000".length);
    assertEquals(out.endsWith("200000"), true);
    assertEquals((await child.status).code, 0);
  });

  test(`${backend}: closing the input of a child that has exited succeeds`, async () => {
    const child = spawn(Deno.execPath(), {
      args: ["eval", ""],
      stdin: "piped",
      stdout: "null",
      stderr: "null",
    });
    await child.status;
    await child.stdin.close();
  });
}

test("Deno: a command that does not exist is refused at once", () => {
  assertThrows(
    () => spawnProcess("zuke-no-such-command-anywhere", { args: [] }),
    Deno.errors.NotFound,
  );
});

test("Node: a command that does not exist is a child that never started", async () => {
  const child = spawnOnNode("zuke-no-such-command-anywhere", {
    args: [],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  assertEquals(child.pid, -1);
  // Its streams are there and empty, so a caller reading and writing them
  // reaches the status, which is where the failure is.
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode("ignored"));
  await writer.close();
  assertEquals(await text(child.stdout), "");
  assertEquals(await text(child.stderr), "");
  const error = await assertRejects(() => child.status);
  assertEquals(isNotFound(error), true);
  assertThrows(() => child.kill());
});

test("Node: a directory that does not exist is a child that never started", async () => {
  const child = spawnOnNode(Deno.execPath(), {
    args: ["eval", ""],
    cwd: "/zuke/no/such/directory",
    stdout: "null",
    stderr: "null",
  });
  assertEquals(isNotFound(await assertRejects(() => child.status)), true);
});

test("Node: a signal the platform does not have is refused by name", async () => {
  const child = spawnOnNode(Deno.execPath(), {
    args: ["eval", ""],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  // On every platform at least one of these is missing.
  const missing = (["SIGEMT", "SIGSTKFLT", "SIGINFO", "SIGPWR"] as const)
    .filter((name) => {
      try {
        child.kill(name);
        return false;
      } catch (error) {
        return error instanceof TypeError && error.message.includes(name);
      }
    });
  assertEquals(missing.length > 0, true);
  await child.status;
});

test("a spawned process that never started says why when it is stopped", async () => {
  const child = spawnOnNode("zuke-no-such-command-anywhere", { args: [] });
  const service = new SpawnedProcess(child, "zuke-no-such-command-anywhere");
  assertEquals(service.pid, -1);
  assertEquals(isNotFound(await assertRejects(() => service.stop())), true);
  assertEquals(isNotFound(await assertRejects(() => service.status)), true);
});

test("a child's environment is the parent's with the added variables over it", () => {
  const parent = {
    Path: "C:\\parent",
    HOME: "/home",
    EMPTY: "",
    GONE: undefined,
  };
  assertEquals(
    childEnvironment(parent, { path: "C:\\mine", NEW: "1" }, false),
    {
      Path: "C:\\parent",
      HOME: "/home",
      EMPTY: "",
      GONE: undefined,
      path: "C:\\mine",
      NEW: "1",
    },
  );
  // On Windows the two spellings are one variable, and the added one wins.
  assertEquals(childEnvironment(parent, { path: "C:\\mine", NEW: "1" }, true), {
    HOME: "/home",
    EMPTY: "",
    GONE: undefined,
    path: "C:\\mine",
    NEW: "1",
  });
});

test("runProcess starts the command and waits for it", async () => {
  const output = await runProcess(Deno.execPath(), {
    args: ["eval", "console.log('ran')"],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  });
  assertEquals(new TextDecoder().decode(output.stdout).trim(), "ran");
  assertEquals(output.code, 0);
});
