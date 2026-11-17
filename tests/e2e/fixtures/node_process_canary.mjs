// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run under real Node by `node_process_e2e.ts`: core's process seam, loaded
 * as TypeScript source, starting real children. Exits 0 when every
 * expectation holds; an assertion that fails ends the process with its
 * message.
 */

import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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

  // Started from a cleared environment, it has none of the parent's. A
  // variable of the canary's own is the proof: on Windows, Node hands a child
  // the few the system needs (PATH among them) whatever it was given.
  process.env.ZUKE_CANARY_PARENT = "inherited";
  const report =
    "console.log(process.env.ZUKE_CANARY_PARENT, process.env.ZUKE_CANARY)";
  const kept = spawnProcess(node, {
    args: ["-e", report],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
    env: { ZUKE_CANARY: "set" },
  });
  assert.equal((await text(kept.stdout)).trim(), "inherited set");
  await kept.status;
  const cleared = spawnProcess(node, {
    args: ["-e", report],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
    env: { ZUKE_CANARY: "set" },
    clearEnv: true,
  });
  assert.equal((await text(cleared.stdout)).trim(), "undefined set");
  await cleared.status;
  delete process.env.ZUKE_CANARY_PARENT;

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
    // A batch file is run by cmd.exe, which reads the whole line itself.
    // Every argument must still reach the program behind the batch file
    // unchanged, and none of it may run: the marker is what an injected
    // command would create.
    const marker = join(dir, "injected.txt");
    const received = join(dir, "received.json");
    const print = join(dir, "print.mjs");
    const batch = join(dir, "tool with space.cmd");
    await writeFile(
      print,
      `import { writeFileSync } from "node:fs";
       writeFileSync(${
        JSON.stringify(received)
      }, JSON.stringify(process.argv.slice(2)));
       process.exit(7);`,
    );
    await writeFile(batch, `@echo off\r\n"${node}" "${print}" %*\r\n`);
    const toBatch = [
      "plain",
      "a b",
      "",
      `x"&echo injected>"${marker}`,
      `"&echo injected>"${marker}"&"`,
      `& echo injected> "${marker}"`,
      `| echo injected> "${marker}"`,
      "a&b|c<d>e",
      "^caret^",
      "%PATH%",
      "%%PATH%%",
      "100%",
      "!PATH!",
      "(parens)",
      "a;b,c=d",
      'say "hi"',
      'back\\"quote',
      "trailing\\",
      "C:\\dir with space\\",
      "tab\there",
      "unicode-é→",
      "$(id) `id` *",
      // Odd numbers of quotes, and quotes at the edges.
      '"',
      'x"',
      'a"b"c"',
      '\\\\"',
      // Carets and percents on their own and at the edges.
      "a^",
      "^",
      "%",
      "%cd%",
      "%CD:~,%",
      "%%cd:~,%",
      '"%PATH%"',
      "%~1",
      "!x!%y%",
      // What cmd.exe itself takes as an option.
      "/c",
      "/?",
      "\\\\server\\share\\",
    ];
    const ran = spawnProcess(batch, {
      args: toBatch,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      // The percent handling leans on a variable that always exists. One of
      // the same name in the environment must not change what comes out.
      env: { CD: "decoy" },
    });
    const [batchOut, batchErr] = await Promise.all([
      text(ran.stdout),
      text(ran.stderr),
    ]);
    const batchStatus = await ran.status;
    assert.equal(batchErr, "");
    assert.equal(batchOut, "");
    assert.deepEqual(JSON.parse(await readFile(received, "utf8")), toBatch);
    // The exit code of what the batch file ran comes back through cmd.exe.
    assert.equal(batchStatus.code, 7);
    await assert.rejects(realpath(marker), { code: "ENOENT" });

    // What cannot be made safe is refused before anything starts.
    assert.throws(() => spawnProcess(batch, { args: ["new\nline"], ...quiet }));
    await assert.rejects(realpath(marker), { code: "ENOENT" });

    // A batch file's own exit code comes back, from one in a directory whose
    // name cmd.exe would act on outside quotes, named in upper case.
    const odd = join(dir, "a&b ^(c)!");
    await mkdir(odd);
    const exits = join(odd, "EXITS.BAT");
    await writeFile(exits, "@echo off\r\nexit /b 5\r\n");
    const exited = spawnProcess(exits, { args: [], ...quiet });
    assert.equal((await exited.status).code, 5);

    // A bare name is found on PATH and never in the working directory, where
    // a checkout could plant one.
    const planted = join(dir, "planted");
    await mkdir(planted);
    await writeFile(
      join(planted, "bare-tool.cmd"),
      `@echo off\r\necho planted> "${marker}"\r\n`,
    );
    assert.throws(
      () => spawnProcess("bare-tool.cmd", { args: [], cwd: planted, ...quiet }),
      { code: "ENOENT" },
    );
    await assert.rejects(realpath(marker), { code: "ENOENT" });
    const onPath = spawnProcess("EXITS.BAT", {
      args: [],
      cwd: planted,
      env: { PATH: `${odd};${process.env.PATH}` },
      ...quiet,
    });
    assert.equal((await onPath.status).code, 5);

    // A name Windows would read as the batch file takes the same safe path.
    const dotted = spawnProcess(`${batch}.`, {
      args: [`x"&echo injected>"${marker}`],
      ...quiet,
    });
    assert.equal((await dotted.status).code, 7);
    await assert.rejects(realpath(marker), { code: "ENOENT" });

    // The shim a package manager writes for a tool is seen through: the
    // tool's script is started directly, with no cmd.exe between. The shim
    // here is one npm itself writes, installing a package from a directory,
    // which needs no network. npm is a batch file too, and is not a shim.
    const tool = join(dir, "canary-tool");
    const project = join(dir, "project");
    await mkdir(tool);
    await mkdir(project);
    await writeFile(
      join(tool, "package.json"),
      JSON.stringify({
        name: "canary-tool",
        version: "1.0.0",
        bin: { "canary-tool": "cli.js" },
      }),
    );
    await writeFile(
      join(tool, "cli.js"),
      `#!/usr/bin/env node
       require("node:fs").writeFileSync(
         ${JSON.stringify(received)},
         JSON.stringify({ argv: process.argv.slice(2), parent: process.ppid }),
       );
       process.exit(9);`,
    );
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ name: "project", private: true }),
    );
    const install = spawnProcess("npm.cmd", {
      // Linked, not copied, so the script can be rewritten below.
      args: [
        "install",
        "--offline",
        "--no-audit",
        "--no-fund",
        "--install-links=false",
        tool,
      ],
      cwd: project,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const installed = await Promise.all([
      text(install.stdout),
      text(install.stderr),
    ]);
    assert.equal((await install.status).code, 0, installed.join("\n"));

    const shim = join(project, "node_modules", ".bin", "canary-tool.cmd");
    // A line break too: no line is built, so nothing has to be refused.
    const toTool = [...toBatch, "new\nline"];
    const direct = spawnProcess(shim, { args: toTool, ...quiet });
    assert.equal((await direct.status).code, 9);
    const report = JSON.parse(await readFile(received, "utf8"));
    assert.deepEqual(report.argv, toTool);
    // Started by this process itself: cmd.exe would have been its parent.
    assert.equal(report.parent, process.pid);
    await assert.rejects(realpath(marker), { code: "ENOENT" });

    // So a kill ends the tool, not a shell in front of it.
    await writeFile(
      join(tool, "cli.js"),
      `#!/usr/bin/env node
       require("node:fs").writeFileSync(${
        JSON.stringify(received)
      }, String(process.pid));
       setInterval(() => {}, 1000);`,
    );
    const running = spawnProcess(shim, { args: [], ...quiet });
    // The tool writes its own process id once it is up: the one started.
    for (let waited = 0; waited < 200; waited++) {
      if ((await readFile(received, "utf8")) === String(running.pid)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await readFile(received, "utf8"), String(running.pid));
    running.kill();
    assert.equal((await running.status).success, false);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`node process canary ok on ${process.version}`);
