// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { EnvTasks, FileTasks, RuntimeTasks } from "../mod.ts";
import { test } from "../../../tests/_testing.ts";
import { ARGS, EVAL } from "../../../tests/_eval.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../../tests/_assert.ts";
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
 * The ways core starts one. On Deno both run: the Node one through Deno's
 * `node:child_process`, so every expectation below is held to on both. On
 * Node, `spawnProcess` is the Node one.
 */
const BACKENDS: [name: string, spawn: Spawn][] =
  RuntimeTasks.facts().name === "deno"
    ? [["Deno", spawnProcess], ["Node", spawnOnNode]]
    : [["Node", spawnOnNode]];

/** A script's way to read all of its stdin, as text, into `input`. */
const READ_INPUT =
  'let input = ""; for await (const chunk of process.stdin) input += chunk;';

/** Start the running runtime evaluating `script`, with every stream piped. */
function run(
  spawn: Spawn,
  script: string,
  extra: Partial<ProcessOptions> = {},
) {
  return spawn(RuntimeTasks.execPath(), {
    args: [EVAL, script],
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
    const child = run(spawn, `console.log(JSON.stringify(${ARGS}))`);
    // Nothing re-splits or re-quotes an argument: this one stays whole.
    const odd = spawn(RuntimeTasks.execPath(), {
      args: [EVAL, `console.log(JSON.stringify(${ARGS}))`, "a b", '"&c'],
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
    const dir = await FileTasks.makeTempDirectory();
    const child = run(
      spawn,
      `${READ_INPUT}
       const real = process.getBuiltinModule("node:fs").realpathSync.native;
       console.log(input + "|" + process.env.ZUKE_PROCESS_TEST + "|" + real(process.cwd()));
       console.error("to stderr");
       process.exitCode = 3;`,
      { cwd: dir, env: { ZUKE_PROCESS_TEST: "set" } },
    );
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode("typed"));
    await writer.close();
    const [out, err] = await Promise.all([
      text(child.stdout),
      text(child.stderr),
    ]);
    assertEquals(out.trim(), `typed|set|${await FileTasks.realPath(dir)}`);
    assertEquals(err.trim(), "to stderr");
    assertEquals(await child.status, { success: false, code: 3, signal: null });
    await FileTasks.remove(dir);
  });

  test(`${backend}: a child started from a cleared environment sees none of the parent's`, async () => {
    EnvTasks.set("ZUKE_PROCESS_PARENT", "inherited");
    try {
      const script =
        `console.log(process.env.ZUKE_PROCESS_PARENT + "|" + process.env.ZUKE_PROCESS_TEST)`;
      // A Windows program cannot start without knowing the system directory.
      const system = EnvTasks.get("SystemRoot");
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
      EnvTasks.delete("ZUKE_PROCESS_PARENT");
    }
  });

  test(`${backend}: a process run to its end gives its status and what it piped`, async () => {
    const options: ProcessOptions = {
      args: [
        EVAL,
        `process.stdout.write(new Uint8Array(300_000).fill(120));
         console.error("to stderr");
         process.exitCode = 4;`,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    };
    const output = await outputOf(
      spawn(RuntimeTasks.execPath(), options),
      options,
    );
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
      args: [EVAL, "console.log('unseen')"],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    };
    const silent = await outputOf(
      spawn(RuntimeTasks.execPath(), quiet),
      quiet,
    );
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
    const child = spawn(RuntimeTasks.execPath(), {
      args: [EVAL, ""],
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
    if (RuntimeTasks.os() !== "windows") {
      assertEquals(status, { success: false, code: 143, signal: "SIGTERM" });
    }
    assertEquals(status.success, false);
    // It has exited, so there is nothing left to signal.
    assertThrows(() => child.kill());
  });

  test(`${backend}: output larger than a pipe holds arrives whole, with input written meanwhile`, async () => {
    const child = run(
      spawn,
      `${READ_INPUT}
       process.stdout.write("x".repeat(1_000_000) + input.length);`,
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
    const child = spawn(RuntimeTasks.execPath(), {
      args: [EVAL, ""],
      stdin: "piped",
      stdout: "null",
      stderr: "null",
    });
    await child.status;
    await child.stdin.close();
  });
}

test({
  name: "Deno: a command that does not exist is refused at once",
  denoOnly: "checks Deno's own NotFound from Deno.Command",
  fn: () => {
    assertThrows(
      () => spawnProcess("zuke-no-such-command-anywhere", { args: [] }),
      Deno.errors.NotFound,
    );
  },
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
  const child = spawnOnNode(RuntimeTasks.execPath(), {
    args: [EVAL, ""],
    cwd: "/zuke/no/such/directory",
    stdout: "null",
    stderr: "null",
  });
  assertEquals(isNotFound(await assertRejects(() => child.status)), true);
});

test("Node: a signal the platform does not have is refused by name", async () => {
  const child = spawnOnNode(RuntimeTasks.execPath(), {
    args: [EVAL, ""],
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
  const output = await runProcess(RuntimeTasks.execPath(), {
    args: [EVAL, "console.log('ran')"],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  });
  assertEquals(new TextDecoder().decode(output.stdout).trim(), "ran");
  assertEquals(output.code, 0);
});
