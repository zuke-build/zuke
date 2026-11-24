// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end: the global `zuke`, the Node single executable the release
 * ships, forwarding a build.
 *
 * This is the one thing no in-process test can prove. Under `deno test` the
 * executable running the CLI *is* Deno, so the running executable happens to
 * be the right answer and the bug is invisible; only a real standalone binary
 * has an executable path that is the binary itself, which spawning re-enters
 * the CLI with (`zuke run -A zuke.ts ci` is not one of its own commands, so
 * it is forwarded again, forever). So: build the real CLI from the workspace,
 * run it against a scratch project, and have the build report the executable
 * it was spawned with. Both candidates are covered — the `deno` that `PATH` resolves, and the
 * launchers' `DENO_INSTALL` bootstrap directory when `PATH` has none.
 */

import { test } from "../../packages/core/tests/_testing.ts";
import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import {
  buildWorkspaceNodeBinary,
  MUST_HAVE_SEA_NODE,
  SEA_NODE,
} from "./_node_binary.ts";

const CORE = new URL("../../packages/core/mod.ts", import.meta.url).href;

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

test({
  name: "the zuke binary forwards to a real Deno rather than to itself",
  // The bootstrap-directory case below builds a symlink, and the compiled
  // binary is ~150 MB; the resolution order itself is unit tested, and this
  // proves the compiled case on the OSes that carry it.
  ignore: Deno.build.os === "windows" ||
    (SEA_NODE === undefined && !MUST_HAVE_SEA_NODE),
  fn: async (t) => {
    await withTemp(async (dir) => {
      // One compile for both cases: it is the expensive part, and neither
      // case changes the binary.
      const binary = `${dir}/${BINARY}`;
      await buildWorkspaceNodeBinary(binary);

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

/**
 * A Node project's build file, which records the executable and the arguments
 * it was started with; it imports nothing, so no package has to be installed.
 */
const NODE_REPORT_BUILD = `// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { writeFileSync } from "node:fs";
import process from "node:process";

writeFileSync(
  "spawned.json",
  JSON.stringify({ execPath: process.execPath, args: process.argv.slice(2) }),
);
`;

test({
  name: "the zuke binary runs a Node project's build on the node on PATH",
  ignore: SEA_NODE === undefined && !MUST_HAVE_SEA_NODE,
  fn: async () => {
    const node = SEA_NODE ?? "node";
    const nodeDir = node.slice(
      0,
      Math.max(node.lastIndexOf("/"), node.lastIndexOf("\\")),
    );
    await withTemp(async (dir) => {
      const binary = `${dir}/${BINARY}`;
      await buildWorkspaceNodeBinary(binary);
      const project = `${dir}/project`;
      await Deno.mkdir(project);
      await Deno.writeTextFile(
        `${project}/zuke.json`,
        JSON.stringify({ runtime: "node", build: "build.ts" }),
      );
      await Deno.writeTextFile(`${project}/build.ts`, NODE_REPORT_BUILD);
      const { code, stderr } = await new Deno.Command(binary, {
        args: ["report", "--flag"],
        cwd: project,
        env: {
          // Only the Node the test probed, so it is the one that must run.
          PATH: nodeDir,
          HOME: dir,
          USERPROFILE: dir,
          ZUKE_PLAIN: "1",
        },
        stdout: "null",
        stderr: "piped",
        signal: AbortSignal.timeout(120_000),
      }).output();
      assertEquals(code, 0, new TextDecoder().decode(stderr));
      const spawned: { execPath: string; args: string[] } = JSON.parse(
        await Deno.readTextFile(`${project}/spawned.json`),
      );
      // That Node ran the build, not the binary re-entering itself.
      assertEquals(spawned.execPath, node);
      assertEquals(spawned.args, ["report", "--flag"]);
    }, { prefix: "zuke-compiled-cli-node-" });
  },
});
