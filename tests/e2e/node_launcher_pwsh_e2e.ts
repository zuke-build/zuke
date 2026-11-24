// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the PowerShell Node launcher, run for real by Windows PowerShell
 * on Windows (no network, no real Node). The one network call, the
 * `Invoke-WebRequest` download, is swapped for a copy of a local zip whose
 * `node.exe` is the running `deno`, so the launcher's bootstrap, checksum
 * check, cache reuse, publication race and install retry all run as shipped.
 */

import { sha256Hex } from "@zuke/core";
import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { nodeLauncherPowerShell } from "../../packages/cli/src/node_launcher.ts";

const WINDOWS = Deno.build.os === "windows";
const DOWNLOAD = "Invoke-WebRequest -Uri $downloadUrl -OutFile $archive";
const SYSTEM = Deno.env.get("SystemRoot") ?? "C:\\Windows";
// Windows PowerShell's own modules: a PSModulePath inherited from pwsh 7 (the
// runner's shell) hides built-ins such as Get-FileHash from it.
const MODULES = `${SYSTEM}\\System32\\WindowsPowerShell\\v1.0\\Modules`;

/** Runs a PowerShell command and fails the test when it does not succeed. */
async function powershell(command: string): Promise<void> {
  const out = await new Deno.Command("powershell.exe", {
    args: ["-NoProfile", "-NonInteractive", "-Command", command],
    env: { PSModulePath: MODULES },
    stdout: "null",
    stderr: "piped",
  }).output();
  assertEquals(out.success, true, new TextDecoder().decode(out.stderr));
}

/**
 * A project whose `zuke.ps1` copies a local Node release zip instead of
 * downloading one, after running `beforeCopy` (PowerShell). The release's
 * `node.exe` is the running `deno`, and `build.ts` prints its arguments.
 */
async function world(root: string, beforeCopy = "") {
  const release = `${root}\\release\\node-v9.9.9-win-x64`;
  await Deno.mkdir(release, { recursive: true });
  await Deno.copyFile(Deno.execPath(), `${release}\\node.exe`);
  const zip = `${root}\\node.zip`;
  await powershell(
    `Compress-Archive -Path '${release}' -DestinationPath '${zip}' -CompressionLevel NoCompression`,
  );
  const project = `${root}\\project`;
  await Deno.mkdir(project);
  await Deno.writeTextFile(
    `${project}\\build.ts`,
    'console.log(`ran ${Deno.args.join(" ")}`);\n',
  );
  const launcher = nodeLauncherPowerShell({ buildFile: "build.ts" });
  assertEquals(launcher.includes(DOWNLOAD), true);
  await Deno.writeTextFile(
    `${project}\\zuke.ps1`,
    launcher.replace(
      DOWNLOAD,
      `${beforeCopy}\n        Copy-Item -LiteralPath $env:ZUKE_TEST_NODE_ZIP -Destination $archive`,
    ),
  );
  const bin = `${root}\\bin`;
  await Deno.mkdir(bin);
  const nodeHome = `${root}\\cache`;
  const run = async (env: Record<string, string>) => {
    const out = await new Deno.Command("powershell.exe", {
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        `${project}\\zuke.ps1`,
        "ci",
      ],
      cwd: project,
      env: {
        // No node or npm but the ones a test puts in bin.
        PATH:
          `${bin};${SYSTEM}\\System32;${SYSTEM}\\System32\\WindowsPowerShell\\v1.0`,
        PSModulePath: MODULES,
        ZUKE_NODE_HOME: nodeHome,
        ZUKE_TEST_NODE_ZIP: zip,
        NODE_VERSION: "9.9.9",
        NODE_SHA256: await sha256Hex(await Deno.readFile(zip)),
        ...env,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder();
    return {
      code: out.code,
      out: text.decode(out.stdout) + text.decode(out.stderr),
    };
  };
  const entries = async (dir: string) =>
    (await Array.fromAsync(Deno.readDir(dir)).catch(() => []))
      .map((e) => e.name).sort();
  return { project, bin, nodeHome, run, entries };
}

Deno.test({
  name:
    "the powershell node launcher bootstraps a verified Node, then reuses the cache",
  ignore: !WINDOWS,
  async fn() {
    await withTemp(async (root) => {
      const w = await world(root);
      const first = await w.run({});
      assertEquals(first.code, 0, first.out);
      assertEquals(first.out.includes("ran ci"), true, first.out);
      assertEquals(await w.entries(w.nodeHome), ["v9.9.9"]);
      assertEquals(await w.entries(`${w.nodeHome}\\v9.9.9`), ["node.exe"]);
      // A second run copies nothing: the zip it would copy is gone.
      const second = await w.run({
        ZUKE_TEST_NODE_ZIP: `${root}\\missing.zip`,
      });
      assertEquals(second.code, 0, second.out);
      assertEquals(second.out.includes("ran ci"), true, second.out);
    });
  },
});

Deno.test({
  name:
    "the powershell node launcher installs nothing on a checksum mismatch or an unpinned override",
  ignore: !WINDOWS,
  async fn() {
    await withTemp(async (root) => {
      const w = await world(root);
      const bad = await w.run({ NODE_SHA256: "0".repeat(64) });
      assertEquals(bad.code, 1, bad.out);
      assertEquals(bad.out.includes("checksum mismatch"), true, bad.out);
      assertEquals(await w.entries(w.nodeHome), []);
      const unpinned = await w.run({ NODE_SHA256: "" });
      assertEquals(unpinned.code, 1, unpinned.out);
      assertEquals(unpinned.out.includes("NODE_SHA256"), true, unpinned.out);
    });
  },
});

Deno.test({
  name:
    "the powershell node launcher uses a Node a concurrent launcher published first",
  ignore: !WINDOWS,
  async fn() {
    await withTemp(async (root) => {
      // The other launcher's Node lands in the cache while this one downloads.
      const winner = `${root}\\winner`;
      await Deno.mkdir(winner);
      await Deno.copyFile(Deno.execPath(), `${winner}\\node.exe`);
      await Deno.writeTextFile(`${winner}\\winner`, "");
      const w = await world(
        root,
        `New-Item -ItemType Directory -Force -Path $nodeRoot | Out-Null; Copy-Item -Recurse -LiteralPath '${winner}' -Destination $nodeHome`,
      );
      const out = await w.run({});
      assertEquals(out.code, 0, out.out);
      assertEquals(out.out.includes("ran ci"), true, out.out);
      // Theirs is kept whole; neither our copy nor our staging is left.
      assertEquals(await w.entries(w.nodeHome), ["v9.9.9"]);
      assertEquals(await w.entries(`${w.nodeHome}\\v9.9.9`), [
        "node.exe",
        "winner",
      ]);
    });
  },
});

Deno.test({
  name:
    "the powershell node launcher stops when npm fails, and retries the install next run",
  ignore: !WINDOWS,
  async fn() {
    await withTemp(async (root) => {
      const w = await world(root);
      await Deno.writeTextFile(`${w.project}\\package.json`, "{}");
      await Deno.writeTextFile(`${w.project}\\package-lock.json`, "{}");
      const log = `${root}\\npm.log`;
      // npm fails part-way, after it has created node_modules.
      await Deno.writeTextFile(
        `${w.bin}\\npm.cmd`,
        `@echo off\r\necho %*>>"${log}"\r\nmkdir node_modules 2>nul\r\nexit /b 3\r\n`,
      );
      const failed = await w.run({});
      assertEquals(failed.code, 3, failed.out);
      assertEquals(failed.out.includes("ran ci"), false, failed.out);
      await Deno.writeTextFile(
        `${w.bin}\\npm.cmd`,
        `@echo off\r\necho %*>>"${log}"\r\nexit /b 0\r\n`,
      );
      const retried = await w.run({});
      assertEquals(retried.code, 0, retried.out);
      assertEquals(retried.out.includes("ran ci"), true, retried.out);
      // The recorded install is trusted from then on.
      const third = await w.run({});
      assertEquals(third.code, 0, third.out);
      assertEquals(
        (await Deno.readTextFile(log)).trim().split(/\r?\n/).map((l) =>
          l.trim()
        ),
        ["ci --ignore-scripts", "ci --ignore-scripts"],
      );
    });
  },
});

Deno.test({
  name:
    "two powershell node launchers started at once install once, and both run the build",
  ignore: !WINDOWS,
  async fn() {
    await withTemp(async (root) => {
      const w = await world(root);
      await Deno.writeTextFile(`${w.project}\\package.json`, "{}");
      await Deno.writeTextFile(`${w.project}\\package-lock.json`, "{}");
      const log = `${root}\\npm.log`;
      // Slow enough that a second launcher arrives while the first installs.
      await Deno.writeTextFile(
        `${w.bin}\\npm.cmd`,
        `@echo off\r\necho %*>>"${log}"\r\nping -n 3 127.0.0.1 >nul\r\nexit /b 0\r\n`,
      );
      // The Node is already cached, so only the install can race.
      const warm = await w.run({});
      assertEquals(warm.code, 0, warm.out);
      await Deno.remove(log);
      await Deno.remove(`${w.project}\\node_modules`, { recursive: true });
      const [first, second] = await Promise.all([w.run({}), w.run({})]);
      assertEquals(first.code, 0, first.out);
      assertEquals(second.code, 0, second.out);
      assertEquals(first.out.includes("ran ci"), true, first.out);
      assertEquals(second.out.includes("ran ci"), true, second.out);
      assertEquals(
        (await Deno.readTextFile(log)).trim().split(/\r?\n/).length,
        1,
      );
      assertEquals(
        await w.entries(`${w.project}\\.zuke`),
        [],
      );
    });
  },
});

Deno.test({
  name:
    "the powershell node launcher reports an install lock its owner left behind, and leaves it",
  ignore: !WINDOWS,
  async fn() {
    await withTemp(async (root) => {
      const w = await world(root);
      await Deno.writeTextFile(`${w.project}\\package-lock.json`, "{}");
      // The id of a process that has exited, as a killed launcher leaves it.
      const gone = new Deno.Command("cmd.exe", { args: ["/c", "exit"] })
        .spawn();
      await gone.status;
      await Deno.mkdir(`${w.project}\\.zuke`);
      const lock = `${w.project}\\.zuke\\install.lock`;
      await Deno.writeTextFile(lock, `${gone.pid}`);
      const out = await w.run({});
      assertEquals(out.code, 1, out.out);
      assertEquals(out.out.includes("remove it and run again"), true, out.out);
      assertEquals(out.out.includes("ran ci"), false, out.out);
      assertEquals(await Deno.readTextFile(lock), `${gone.pid}`);
    });
  },
});
