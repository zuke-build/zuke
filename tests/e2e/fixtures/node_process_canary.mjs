// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run under real Node by `node_process_e2e.ts`: core's process seam, loaded
 * as TypeScript source, starting real children. Exits 0 when every
 * expectation holds; an assertion that fails ends the process with its
 * message.
 */

import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const { spawnProcess } = await import(
  new URL("../../../packages/core/src/process.ts", import.meta.url).href
);

const WINDOWS = process.platform === "win32";
const node = process.execPath;
const text = (stream) => new Response(stream).text();
const forever = ["-e", "setInterval(() => {}, 1000)"];
const quiet = { stdin: "null", stdout: "null", stderr: "null" };

const dir = await realpath(await mkdtemp(join(tmpdir(), "zuke-canary-")));
try {
  // Arguments arrive one per entry, untouched: no shell reads them.
  const hostile = [
    "a b",
    '"&c',
    "",
    "$(id)",
    "`id`",
    "*",
    "--flag=x y",
    "%PATH%",
    "^caret",
    "a|b",
    "trailing\\",
    "!VAR!",
    "new\nline",
  ];
  const echo = spawnProcess(node, {
    args: [
      "-e",
      `let input = "";
       process.stdin.on("data", (chunk) => input += chunk).on("end", () => {
         console.log(JSON.stringify([
           process.argv.slice(1), input, process.env.ZUKE_CANARY, process.cwd(),
         ]));
         console.error("to stderr");
         process.exit(3);
       });`,
      "--",
      ...hostile,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    cwd: dir,
    env: { ZUKE_CANARY: "set" },
  });
  const writer = echo.stdin.getWriter();
  await writer.write(new TextEncoder().encode("typed"));
  await writer.close();
  const [out, err] = await Promise.all([text(echo.stdout), text(echo.stderr)]);
  const [argv, input, variable, cwd] = JSON.parse(out);
  assert.deepEqual(argv, hostile);
  assert.equal(input, "typed");
  assert.equal(variable, "set");
  assert.equal(await realpath(cwd), dir);
  assert.equal(err.trim(), "to stderr");
  assert.deepEqual(await echo.status, {
    success: false,
    code: 3,
    signal: null,
  });
  assert.ok(echo.pid > 0);

  // The parent's environment is under what is given.
  const inherited = spawnProcess(node, {
    args: [
      "-e",
      "console.log(process.env.PATH === undefined ? 'none' : 'kept')",
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
    env: { ZUKE_CANARY: "set" },
  });
  assert.equal((await text(inherited.stdout)).trim(), "kept");
  await inherited.status;

  // A stream that was not piped is not there; a killed child reports it.
  const killed = spawnProcess(node, { args: forever, ...quiet });
  assert.throws(() => killed.stdout);
  killed.kill("SIGTERM");
  const ended = await killed.status;
  assert.equal(ended.success, false);
  if (!WINDOWS) {
    assert.deepEqual(ended, { success: false, code: 143, signal: "SIGTERM" });
  }
  assert.throws(() => killed.kill());

  // An abort ends the child, and the status still settles.
  const controller = new AbortController();
  const aborted = spawnProcess(node, {
    args: forever,
    ...quiet,
    signal: controller.signal,
  });
  controller.abort();
  assert.equal((await aborted.status).success, false);

  // A command that is not there: no throw, a child that never started.
  const missing = spawnProcess("zuke-no-such-command-anywhere", {
    args: [],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  assert.equal(missing.pid, -1);
  assert.equal(await text(missing.stdout), "");
  await assert.rejects(missing.status, { code: "ENOENT" });
  assert.throws(() => missing.kill());

  // More output than a pipe holds arrives whole.
  const large = spawnProcess(node, {
    args: ["-e", "process.stdout.write('x'.repeat(1_000_000))"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const [big] = await Promise.all([text(large.stdout), text(large.stderr)]);
  assert.equal(big.length, 1_000_000);
  assert.equal((await large.status).code, 0);

  // Closing the input of a child that has exited is not a failure.
  const gone = spawnProcess(node, {
    args: ["-e", ""],
    stdin: "piped",
    stdout: "null",
    stderr: "null",
  });
  await gone.status;
  await gone.stdin.close();

  if (WINDOWS) {
    // A batch file is refused, not run through a shell: an argument that
    // would be a second command to cmd.exe must never get the chance.
    const marker = join(dir, "injected.txt");
    const batch = join(dir, "tool.cmd");
    await writeFile(batch, "@echo off\r\necho %*\r\n");
    let refused = false;
    try {
      const child = spawnProcess(batch, {
        args: [`x"&echo injected>"${marker}`],
        ...quiet,
      });
      await child.status;
    } catch {
      refused = true;
    }
    assert.equal(refused, true, "a batch file was started");
    await assert.rejects(realpath(marker), { code: "ENOENT" });
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`node process canary ok on ${process.version}`);
