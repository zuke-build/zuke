// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the global `zuke`, compiled with `deno compile`, forwarding a
 * build.
 *
 * This is the one thing no in-process test can prove. Under `deno test` the
 * executable running the CLI *is* Deno, so `Deno.execPath()` happens to be the
 * right answer and the bug is invisible; only a real `deno compile` binary has
 * a `Deno.execPath()` that is the binary itself, which spawning re-enters the
 * CLI with (`zuke run -A zuke.ts ci` is not one of its own commands, so it is
 * forwarded again, forever). So: compile the real CLI, run it against a
 * scratch project, and have the build report the executable it was spawned
 * with. Both candidates are covered — the `deno` that `PATH` resolves, and the
 * launchers' `DENO_INSTALL` bootstrap directory when `PATH` has none.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";

const CORE = new URL("../../packages/core/mod.ts", import.meta.url).href;
const CLI = new URL("../../packages/cli/mod.ts", import.meta.url).pathname;

/** What the forwarded build reports about the process it is running in. */
interface Spawned {
  /** The executable running the build — a real Deno, not the compiled `zuke`. */
  execPath: string;
  /** Whether that executable is itself a `deno compile` binary. */
  standalone: boolean;
}

/** A build whose one target records the executable it was spawned with. */
const REPORT_BUILD = `import { Build, run, target } from "${CORE}";

class Report extends Build {
  report = target().executes(async () => {
    await Deno.writeTextFile(
      "spawned.json",
      JSON.stringify({
        execPath: Deno.execPath(),
        standalone: Deno.build.standalone,
      }),
    );
  });
}

await run(Report);
`;

/** The compiled `zuke` binary's name on this platform. */
const BINARY = Deno.build.os === "windows" ? "zuke.exe" : "zuke";

/** Compile the real CLI into `dir`, returning the binary's path. */
async function compileCli(dir: string): Promise<string> {
  const binary = `${dir}/${BINARY}`;
  const { code, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["compile", "-A", "--output", binary, CLI],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(
      `deno compile failed: ${new TextDecoder().decode(stderr)}`,
    );
  }
  return binary;
}

/** Write a scratch project — root marker and build — into `dir`. */
async function scratchProject(dir: string): Promise<void> {
  await Deno.writeTextFile(`${dir}/zuke.json`, '{ "name": "Report" }\n');
  await Deno.writeTextFile(`${dir}/zuke.ts`, REPORT_BUILD);
}

/**
 * Run the compiled binary against the project in `dir` with `env` as its whole
 * environment, then read back what the build reported.
 *
 * The pre-fix failure is a hang, not an error — the binary spawns itself, each
 * copy forwarding again with a longer argv until the inherited stderr pipe
 * fills — so the run is bounded. A regression then fails this test instead of
 * wedging the OS-matrix job.
 */
async function forward(
  binary: string,
  dir: string,
  env: Record<string, string>,
): Promise<Spawned> {
  const { code, stderr } = await new Deno.Command(binary, {
    args: ["report"],
    cwd: dir,
    clearEnv: true,
    env,
    stdout: "null",
    stderr: "piped",
    signal: AbortSignal.timeout(120_000),
  }).output();
  assertEquals(
    code,
    0,
    `the compiled zuke failed: ${new TextDecoder().decode(stderr)}`,
  );
  return JSON.parse(await Deno.readTextFile(`${dir}/spawned.json`));
}

Deno.test({
  name: "a compiled zuke forwards to a real Deno rather than to itself",
  // The bootstrap-directory case below builds a symlink, and the compiled
  // binary is ~90 MB; the resolution order itself is unit tested, and this
  // proves the compiled case on the OSes that carry it.
  ignore: Deno.build.os === "windows",
  fn: async (t) => {
    await withTemp(async (dir) => {
      // One compile for both cases: it is the expensive part, and neither
      // case changes the binary.
      const binary = await compileCli(dir);

      await t.step("the deno on PATH", async () => {
        const project = `${dir}/on-path`;
        await Deno.mkdir(project);
        await scratchProject(project);
        const denoBin = new URL(".", `file://${Deno.execPath()}`).pathname;
        const spawned = await forward(binary, project, {
          PATH: `${denoBin}:/usr/bin:/bin`,
          HOME: dir,
        });
        // A real Deno ran the build — not the compiled binary, which would
        // have re-entered the CLI instead of running anything.
        assertEquals(spawned.standalone, false);
        assertEquals(spawned.execPath === binary, false);
      });

      await t.step("the launchers' DENO_INSTALL directory", async () => {
        const project = `${dir}/bootstrap-project`;
        await Deno.mkdir(project);
        await scratchProject(project);
        // A bootstrap directory exactly as the launchers install one, and a
        // PATH with no `deno` on it at all, so only the fallback can answer.
        const install = `${dir}/bootstrap`;
        await Deno.mkdir(`${install}/bin`, { recursive: true });
        await Deno.symlink(Deno.execPath(), `${install}/bin/deno`);
        const spawned = await forward(binary, project, {
          PATH: "/nonexistent-for-this-test",
          DENO_INSTALL: install,
          HOME: dir,
        });
        assertEquals(spawned.standalone, false);
        assertEquals(spawned.execPath === binary, false);
      });
    }, { prefix: "zuke-compiled-cli-" });
  },
});
