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
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { binaryEntry } from "../../build/cli_binary.ts";
import { localVersion } from "../../build/packages.ts";

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

Deno.test("a compiled zuke runs a hosted build on its own engine, serving tool.call from the wrappers it carries", async () => {
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
  }, { prefix: "zuke-embedded-engine-" });
});
