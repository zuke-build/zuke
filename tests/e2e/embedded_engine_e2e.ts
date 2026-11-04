// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the compiled `zuke` runs a hosted build on the engine compiled
 * into it, with no Deno anywhere it could look.
 *
 * Only a real `deno compile` binary can prove this. Under `deno test` the
 * running executable is Deno, so a CLI that quietly spawned one would pass;
 * a compiled binary cannot import a module it was not compiled with, so an
 * engine that reached for JSR at runtime would fail only here. So: render the
 * entry the release compiles (`build/cli_binary.ts`), with the workspace's
 * CLI, engine and `deno` wrapper in place of their JSR releases, compile it,
 * and run a project whose `zuke.json` names a scripted worker, under an
 * environment where `PATH`, `HOME` and `DENO_INSTALL` hold no Deno. The
 * worker itself is started by absolute path; what is proven is the engine's
 * side, which before this needed a Deno to run `jsr:@zuke/engine`.
 *
 * Then the same binary is served as a release on loopback, and the project
 * runs through the launchers `zuke setup --sdk` writes (`./zuke` on Linux and
 * macOS, `zuke.ps1` on Windows): they download it, verify it against the
 * pinned SHA-256 and run it, again with no Deno on `PATH`. That is the path a
 * Python project's CI job takes.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { binaryEntry } from "../../build/cli_binary.ts";
import { localVersion } from "../../build/packages.ts";
import { gzip, sha256Hex, tar, zip } from "@zuke/core";
import {
  binaryArchiveName,
  type BinaryPin,
  type BinaryTarget,
} from "../../packages/cli/src/binary_pin.ts";
import {
  binaryLauncherBash,
  binaryLauncherPwsh,
} from "../../packages/cli/src/binary_launcher.ts";

const FAKE_WORKER = new URL(
  "../../packages/engine/tests/_fake_worker.ts",
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** The compiled binary's name on this platform. */
const BINARY = Deno.build.os === "windows" ? "zuke.exe" : "zuke";

/**
 * Compile the entry for the workspace's CLI, engine and `deno` wrapper into
 * `dir`, returning the binary's path. The entry is written inside the
 * checkout, where the workspace resolves `@zuke/*` to its members.
 */
async function compileEmbedding(dir: string): Promise<string> {
  const source = await Deno.makeTempDir({
    dir: Deno.cwd(),
    prefix: ".zuke-e2e-entry-",
  });
  try {
    const entry = `${source}/zuke.ts`;
    await Deno.writeTextFile(
      entry,
      binaryEntry({
        cli: "@zuke/cli",
        engine: "@zuke/engine",
        engineVersion: await localVersion("engine"),
        core: "@zuke/core",
        coreVersion: await localVersion("core"),
        wrappers: [{
          name: "deno",
          version: await localVersion("deno"),
          specifier: "@zuke/deno",
        }],
      }),
    );
    const binary = `${dir}/${BINARY}`;
    const { code, stderr } = await new Deno.Command(Deno.execPath(), {
      args: ["compile", "-A", "--no-lock", "--output", binary, entry],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (code !== 0) {
      throw new Error(
        `deno compile failed: ${new TextDecoder().decode(stderr)}`,
      );
    }
    return binary;
  } finally {
    await Deno.remove(source, { recursive: true });
  }
}

/** The environment of a machine with no Deno, which Windows still needs a few of. */
function noDeno(dir: string, extra: Record<string, string>) {
  const windows = Deno.build.os === "windows"
    ? Object.fromEntries(
      ["SystemRoot", "TEMP", "TMP"].flatMap((name) => {
        const value = Deno.env.get(name);
        return value === undefined ? [] : [[name, value]];
      }),
    )
    : {};
  return {
    ...windows,
    PATH: `${dir}/no-deno-here`,
    HOME: dir,
    USERPROFILE: dir,
    DENO_INSTALL: `${dir}/no-deno-here`,
    ZUKE_PLAIN: "1",
    ...extra,
  };
}

/** The release this test serves the compiled binary as. */
const SERVED = "9.9.9";

/** This platform's release target, the one the launchers download. */
const TARGET: BinaryTarget = Deno.build.os === "windows"
  ? "x86_64-pc-windows-msvc"
  : Deno.build.target === "aarch64-apple-darwin"
  ? "aarch64-apple-darwin"
  : Deno.build.target === "x86_64-apple-darwin"
  ? "x86_64-apple-darwin"
  : Deno.build.target === "aarch64-unknown-linux-gnu"
  ? "aarch64-unknown-linux-gnu"
  : "x86_64-unknown-linux-gnu";

/** Pack `binary` as the release archive for this platform, as the release does. */
async function packRelease(binary: string): Promise<Uint8Array> {
  const data = await Deno.readFile(binary);
  return Deno.build.os === "windows"
    ? await zip([{ name: "zuke.exe", data }])
    : await gzip(tar([{ name: "zuke", data, mode: 0o755 }]));
}

/** A pin of {@link SERVED} carrying `engine`, whose digest for every target is `sha256`. */
function servedPin(engine: string, sha256: string): BinaryPin {
  return {
    version: SERVED,
    engine,
    checksums: {
      "aarch64-apple-darwin": sha256,
      "x86_64-apple-darwin": sha256,
      "aarch64-unknown-linux-gnu": sha256,
      "x86_64-unknown-linux-gnu": sha256,
      "x86_64-pc-windows-msvc": sha256,
    },
  };
}

/**
 * Run the project's launcher with `args`: the shell's own tools on `PATH`,
 * and no Deno there, nor in `HOME` or `DENO_INSTALL`.
 */
async function runLauncher(
  project: string,
  dir: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; out: string; err: string }> {
  const windows = Deno.build.os === "windows";
  const system = windows
    ? [
      `${Deno.env.get("SystemRoot")}\\System32`,
      `${Deno.env.get("SystemRoot")}\\System32\\WindowsPowerShell\\v1.0`,
    ].join(";")
    : "/usr/bin:/bin";
  const command = windows
    ? new Deno.Command("powershell.exe", {
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        `${project}\\zuke.ps1`,
        ...args,
      ],
      cwd: project,
      // PowerShell needs the rest of its environment to load its modules.
      env: { ...env, PATH: system, DENO_INSTALL: `${dir}\\no-deno-here` },
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(180_000),
    })
    : new Deno.Command("/bin/bash", {
      args: [`${project}/zuke`, ...args],
      cwd: project,
      clearEnv: true,
      env: { ...noDeno(dir, env), PATH: system },
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(180_000),
    });
  const { code, stdout, stderr } = await command.output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code, out: decode(stdout), err: decode(stderr) };
}

/** Whether `PATH` resolves a `deno`, through the shell the launcher runs on. */
async function denoOnPath(path: string): Promise<boolean> {
  if (Deno.build.os === "windows") return false;
  const { code } = await new Deno.Command("/bin/sh", {
    args: ["-c", "command -v deno"],
    clearEnv: true,
    env: { PATH: path },
    stdout: "null",
  }).output();
  return code === 0;
}

Deno.test("a compiled zuke runs a hosted build on its own engine, directly and through the launchers that download it, with no Deno", async () => {
  await withTemp(async (dir) => {
    const binary = await compileEmbedding(dir);
    const project = `${dir}/project`;
    await Deno.mkdir(project);
    const engine = await localVersion("engine");
    await Deno.writeTextFile(
      `${project}/zuke.json`,
      JSON.stringify({
        name: "Hosted",
        sdk: {
          command: [Deno.execPath(), "run", "-A", "--no-lock", FAKE_WORKER],
        },
        engine,
      }),
    );
    const plan = JSON.stringify({
      name: "Hosted",
      targets: [{
        name: "caller",
        calls: [{
          method: "tool.call",
          params: {
            package: "deno",
            version: await localVersion("deno"),
            tasks: "DenoTasks",
            task: "eval",
            args: [{
              configure: [["toolPath", [Deno.execPath()]], ["code", [
                "console.log(40 + 2)",
              ]]],
            }],
          },
        }],
      }],
    });
    const run = async (args: string[]) => {
      const { code, stdout, stderr } = await new Deno.Command(binary, {
        args,
        cwd: project,
        clearEnv: true,
        env: noDeno(dir, { ZUKE_FAKE_PLAN: plan }),
        stdout: "piped",
        stderr: "piped",
        // A regression that spawns itself without end must fail, not hang.
        signal: AbortSignal.timeout(120_000),
      }).output();
      const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
      return { code, out: decode(stdout), err: decode(stderr) };
    };

    const ran = await run(["caller"]);
    // Had the CLI looked for a Deno, it would have found none and said so.
    assertEquals(ran.code, 0, ran.out + ran.err);
    assertStringIncludes(ran.out + ran.err, '"stdout":"42\\n"');

    const version = await run(["--version"]);
    assertEquals(version.code, 0, version.out + version.err);
    assertStringIncludes(version.out, `on the built-in @zuke/engine ${engine}`);

    // The launchers a Python project commits, against the same binary as a
    // release: downloaded, verified, kept, and run.
    assertEquals(await denoOnPath("/usr/bin:/bin"), false);
    const archive = await packRelease(binary);
    const pin = servedPin(engine, await sha256Hex(archive));
    await Deno.writeTextFile(
      `${project}/zuke`,
      binaryLauncherBash({ download: true }, pin),
      { mode: 0o755 },
    );
    await Deno.writeTextFile(
      `${project}/zuke.ps1`,
      binaryLauncherPwsh({ download: true }, pin),
    );
    const wanted = `/cli-v${SERVED}/${binaryArchiveName(SERVED, TARGET)}`;
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      (request) =>
        new URL(request.url).pathname === wanted
          ? new Response(new Uint8Array(archive))
          : new Response("not found", { status: 404 }),
    );
    try {
      const env = {
        ZUKE_FAKE_PLAN: plan,
        ZUKE_PLAIN: "1",
        ZUKE_INSTALL: `${dir}/zuke-install`,
        ZUKE_RELEASES_URL: `http://127.0.0.1:${server.addr.port}`,
      };
      const launched = await runLauncher(project, dir, ["caller"], env);
      assertEquals(launched.code, 0, launched.out + launched.err);
      assertStringIncludes(launched.out + launched.err, '"stdout":"42\\n"');
      assertStringIncludes(
        launched.out + launched.err,
        `zuke ${SERVED} is not here yet`,
      );
    } finally {
      await server.shutdown();
    }
  }, { prefix: "zuke-embedded-engine-" });
});
