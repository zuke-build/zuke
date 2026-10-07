// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the global `zuke` command forwarding a build command to the
 * project's own `zuke.ts`. Drives `@zuke/cli`'s real `main()` with its real
 * subprocess runner against a scratch project — a `zuke.json` marking the root
 * and a `zuke.ts` that imports `@zuke/core` from this checkout by file URL, so
 * nothing touches the network — and proves the whole path: the walk up from a
 * subdirectory, the spawn from the root, the target executing, and the exit
 * code coming back.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { CONFIG_FILE } from "../../packages/core/src/config.ts";
import {
  type BuildProbe,
  main,
  type UpgradeHost,
} from "../../packages/cli/mod.ts";
import {
  type BuildRunner,
  defaultBuildProbe,
} from "../../packages/cli/src/dispatch.ts";
import {
  denoCandidates,
  type DenoHost,
  spawnDeno,
} from "../../packages/cli/src/deno_path.ts";
import { defaultHost, type SetupHost } from "../../packages/cli/src/setup.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { withEnv } from "../../packages/core/tests/_env.ts";
import { capture } from "../../packages/core/tests/_console.ts";
import { ENC } from "../../packages/core/tests/_escaping.ts";

/**
 * The real, filesystem-probing host — the walk up to `zuke.json` must see the
 * scratch project — with its progress lines captured instead of printed.
 * `defaultHost` is a plain object literal, so spreading it keeps every method.
 */
function recordingHost(): SetupHost & { logs: string[] } {
  const logs: string[] = [];
  return { ...defaultHost, logs, log: (line) => void logs.push(line) };
}

/** This checkout's `@zuke/core` entry point, as an import the scratch build can use. */
const CORE = new URL("../../packages/core/mod.ts", import.meta.url).href;

/** A build with one target that records its run and one that fails. */
function scratchBuild(): string {
  return `import { Build, run, target } from "${CORE}";

class Scratch extends Build {
  hello = target()
    .description("Write a marker so the test can see the target ran")
    .executes(async () => {
      await Deno.writeTextFile("ran.txt", Deno.cwd());
    });
  broken = target()
    .description("Fail on purpose")
    .executes(() => {
      throw new Error("broken on purpose");
    });
  report = target()
    .description("Report the executable and PATH the build was spawned with")
    .executes(async () => {
      await Deno.writeTextFile(
        "spawned.json",
        JSON.stringify({
          execPath: Deno.execPath(),
          standalone: Deno.build.standalone,
        }),
      );
    });
}

await run(Scratch);
`;
}

/** Run `fn` with the process cwd set to `dir`, restoring it afterwards. */
async function inDir(dir: string, fn: () => Promise<void>): Promise<void> {
  const prev = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn();
  } finally {
    Deno.chdir(prev);
  }
}

Deno.test("zuke <target> from a subdirectory runs the build at the project root", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/${CONFIG_FILE}`,
      '{ "name": "Scratch" }\n',
    );
    await Deno.writeTextFile(`${dir}/zuke.ts`, scratchBuild());
    await Deno.mkdir(`${dir}/src/deep`, { recursive: true });
    // The CLI's own stdout is captured so it can be asserted empty; the build
    // itself runs through the real runner with inherited stdio.
    const host = recordingHost();
    await inDir(`${dir}/src/deep`, async () => {
      const code = await main(["hello"], host);
      assertEquals(code, 0);
    });
    // The target executed, from the root (not the subdirectory it was invoked
    // in), so its relative write landed beside zuke.ts.
    const cwd = await Deno.readTextFile(`${dir}/ran.txt`);
    assertEquals(await Deno.realPath(cwd), await Deno.realPath(dir));
    assertEquals(host.logs, []);
  }, { prefix: "zuke-global-cli-" });
});

Deno.test({
  name: "zuke <target> runs the project's own ./zuke launcher when it has one",
  // POSIX launchers only: Windows reports no file mode, so it keeps `deno run`.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(
        `${dir}/${CONFIG_FILE}`,
        '{ "name": "Scratch" }\n',
      );
      await Deno.writeTextFile(`${dir}/zuke.ts`, scratchBuild());
      // A launcher that does something `deno run` alone would not — record
      // its argv — then runs the build as a real one does.
      await Deno.writeTextFile(
        `${dir}/zuke`,
        `#!/bin/sh\nprintf '%s\\n' "$@" > launched.txt\n` +
          `exec "${Deno.execPath()}" run -A zuke.ts "$@"\n`,
        { mode: 0o755 },
      );
      await Deno.mkdir(`${dir}/src`);
      const host = recordingHost();
      await inDir(`${dir}/src`, async () => {
        assertEquals(await main(["hello"], host), 0);
      });
      assertEquals(await Deno.readTextFile(`${dir}/launched.txt`), "hello\n");
      const cwd = await Deno.readTextFile(`${dir}/ran.txt`);
      assertEquals(await Deno.realPath(cwd), await Deno.realPath(dir));
      assertEquals(host.logs, []);
    }, { prefix: "zuke-global-cli-" });
  },
});

Deno.test({
  name:
    "zuke <target> builds this repo when ./zuke is a symlink to a shared launcher",
  // POSIX launchers only: Windows reports no file mode, so it keeps `deno run`.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      // Two repos: the consumer, whose `zuke` links to the shared one's. Each
      // has its own build; the shared launcher, like the real ones, finds the
      // project from the path it was called by.
      for (const repo of ["app", "infra"]) {
        await Deno.mkdir(`${dir}/${repo}`);
        await Deno.writeTextFile(
          `${dir}/${repo}/${CONFIG_FILE}`,
          '{ "name": "Scratch" }\n',
        );
        await Deno.writeTextFile(`${dir}/${repo}/zuke.ts`, scratchBuild());
      }
      await Deno.writeTextFile(
        `${dir}/infra/zuke`,
        `#!/bin/sh\ncd "$(dirname "$0")" || exit 1\n` +
          `exec "${Deno.execPath()}" run -A zuke.ts "$@"\n`,
        { mode: 0o755 },
      );
      await Deno.symlink("../infra/zuke", `${dir}/app/zuke`);
      await inDir(`${dir}/app`, async () => {
        assertEquals(await main(["hello"], recordingHost()), 0);
      });
      // The consumer's build ran; the shared repo's did not.
      const cwd = await Deno.readTextFile(`${dir}/app/ran.txt`);
      assertEquals(await Deno.realPath(cwd), await Deno.realPath(`${dir}/app`));
      assertEquals(await exists(`${dir}/infra/ran.txt`), false);
    }, { prefix: "zuke-global-cli-" });
  },
});

Deno.test("zuke <target> propagates a failing target's exit code", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/${CONFIG_FILE}`,
      '{ "name": "Scratch" }\n',
    );
    await Deno.writeTextFile(`${dir}/zuke.ts`, scratchBuild());
    await inDir(dir, async () => {
      assertEquals(await main(["broken"], recordingHost()), 1);
      // The build's own CLI answers for a typo — the global CLI never treats
      // it as one of its unknown commands once a zuke.json is in reach.
      // cspell:ignore helo
      const host = recordingHost();
      assertEquals(await main(["helo"], host), 1);
      assertEquals(host.logs, []);
    });
  }, { prefix: "zuke-global-cli-" });
});

/**
 * The real probe, confined to `dir`: everything above it reads as absent, so
 * the walk cannot find — and the test cannot run, with `-A` — a `zuke.json`
 * that happens to sit above the temp directory on this machine.
 */
function confinedTo(dir: string): BuildProbe {
  const inside = (path: string) => path.startsWith(`${dir}/`);
  return {
    exists: (path) =>
      inside(path) ? defaultBuildProbe.exists(path) : Promise.resolve(false),
    ownership: (path) =>
      inside(path) ? defaultBuildProbe.ownership(path) : Promise.resolve(null),
    realPath: (path) => defaultBuildProbe.realPath(path),
    readLink: (path) => defaultBuildProbe.readLink(path),
    uid: () => defaultBuildProbe.uid(),
  };
}

Deno.test("zuke <target> outside any project is an unknown command, not a spawn", async () => {
  await withTemp(async (dir) => {
    // No zuke.json in the temp dir, and none reachable above it.
    await inDir(dir, async () => {
      const host = recordingHost();
      const code = await main(
        ["hello"],
        host,
        undefined,
        undefined,
        undefined,
        () => Promise.reject(new Error("must not spawn")),
        confinedTo(dir),
      );
      assertEquals(code, 1);
      assertEquals(host.logs[0].includes("no zuke.json was found"), true);
    });
  }, { prefix: "zuke-global-cli-" });
});

Deno.test("zuke <argv> cannot forge a workflow command on an Actions runner", async () => {
  // The whole path, as the binary runs it: the real host writing through the
  // package's sink, the real probe (confined to the temp dir, so there is no
  // build to forward to), and the runner's environment. The unknown-command
  // message echoed argv raw, and an argument carrying a newline put `::` at
  // the start of a physical line, which the runner executes; every physical
  // line is asserted, since the runner reads lines, not messages.
  await withTemp(async (dir) => {
    await inDir(dir, async () => {
      const { code, out } = await capture(async () => {
        let exit = 0;
        await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
          exit = await main(
            [["typo", "::stop-commands::forged"].join("\n")],
            defaultHost,
            undefined,
            undefined,
            undefined,
            () => Promise.reject(new Error("must not spawn")),
            confinedTo(dir),
          );
        });
        return exit;
      });
      assertEquals(code, 1);
      const lines = out.flatMap((l) => l.split("\n"));
      assertEquals(lines.some((l) => l.trimStart().startsWith("::")), false);
      assertEquals(
        lines.some((l) => l.startsWith(ENC + "stop-commands::forged")),
        true,
      );
    });
  }, { prefix: "zuke-global-cli-" });
});

Deno.test("a forwarded build resolves a real Deno when the CLI is a compiled binary", async () => {
  // The compiled case, which nothing in-process can otherwise reach: under
  // `deno test` the running executable *is* Deno, so `Deno.execPath()` happens
  // to be the right answer and the bug is invisible. A host that says it is
  // standalone puts the real question to the resolution — the running
  // executable is then not an answer at all, and the build runs only if a real
  // Deno was found instead. The rest of the path is real: the walk up to
  // zuke.json, the spawn from the root, the target executing, the exit code
  // coming back.
  await withTemp(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/${CONFIG_FILE}`,
      '{ "name": "Scratch" }\n',
    );
    await Deno.writeTextFile(`${dir}/zuke.ts`, scratchBuild());
    const compiled: DenoHost = {
      standalone: () => true,
      env: (name) => Deno.env.get(name),
      windows: () => Deno.build.os === "windows",
    };
    const runner: BuildRunner = async (root, denoArgs) => {
      const child = spawnDeno(
        denoArgs,
        { cwd: root, stdin: "null", stdout: "null", stderr: "inherit" },
        denoCandidates(compiled),
      );
      return (await child.status).code;
    };
    await inDir(dir, async () => {
      const code = await main(
        ["report"],
        recordingHost(),
        undefined,
        undefined,
        undefined,
        runner,
      );
      assertEquals(code, 0);
    });
    const spawned: { execPath: string; standalone: boolean } = JSON.parse(
      await Deno.readTextFile(`${dir}/spawned.json`),
    );
    // A real Deno ran the build, not the binary the host named — which is the
    // whole of #586: spawning that name re-enters the CLI instead. The PATH
    // the child gets is not asserted here: the candidate that answers is the
    // bare name, which carries no directory to prepend, so the child inherits
    // this process's PATH and the assertion would be about the machine rather
    // than the code. The overlay has its own coverage — `pathWithDeno`'s unit
    // tests, and `defaultBuildRunner puts the running Deno first on the
    // child's PATH` in the package's dispatch tests.
    assertEquals(spawned.standalone, false);
    assertEquals(spawned.execPath.startsWith(dir), false);
  }, { prefix: "zuke-global-cli-" });
});

Deno.test("zuke upgrade is the CLI's own; a build target named upgrade stays reachable past --", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/${CONFIG_FILE}`,
      '{ "name": "Shadowed" }\n',
    );
    await Deno.writeTextFile(
      `${dir}/zuke.ts`,
      `import { Build, run, target } from "${CORE}";

class Shadowed extends Build {
  upgrade = target()
    .description("A project target that happens to share the CLI's word")
    .executes(async () => {
      await Deno.writeTextFile("upgraded.txt", "build");
    });
}

await run(Shadowed);
`,
    );
    const installs: string[][] = [];
    const upgradeHost: UpgradeHost = {
      mainModule: () => "jsr:@zuke/cli",
      binDir: () => `${dir}/bin`,
      exists: () => Promise.resolve(true),
      windows: () => false,
      meta: () => Promise.resolve({ latest: "999.0.0", versions: {} }),
      install: (denoArgs) => {
        installs.push(denoArgs);
        return Promise.resolve(0);
      },
    };
    await inDir(dir, async () => {
      // The CLI answers `upgrade` itself, inside a project, without running
      // the build: the real runner and probe are in place, and the target's
      // marker file is never written. The real probe rather than
      // `confinedTo`: the walk starts from the resolved cwd, which on macOS
      // is `/private/var/…` under a `/var/…` temp dir.
      const host = recordingHost();
      const code = await main(
        ["upgrade"],
        host,
        undefined,
        undefined,
        undefined,
        undefined,
        defaultBuildProbe,
        upgradeHost,
      );
      assertEquals(code, 0);
      assertEquals(installs.length, 1);
      assertEquals(installs[0].at(-1), "jsr:@zuke/cli");
      assertEquals(await exists(`${dir}/upgraded.txt`), false);

      // `--` hands the word to the build, through the real runner.
      const forwarded = await main(
        ["--", "upgrade"],
        recordingHost(),
        undefined,
        undefined,
        undefined,
        undefined,
        defaultBuildProbe,
        upgradeHost,
      );
      assertEquals(forwarded, 0);
      assertEquals(await Deno.readTextFile(`${dir}/upgraded.txt`), "build");
      assertEquals(installs.length, 1);
    });
  }, { prefix: "zuke-global-cli-" });
});

/** Whether `path` exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("zuke --version in a real project reads its core from deno.lock and runs nothing", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/${CONFIG_FILE}`, '{ "name": "Old" }\n');
    // A build that marks any run of it: --version must not reach it.
    await Deno.writeTextFile(
      `${dir}/zuke.ts`,
      'await Deno.writeTextFile("ran.txt", "ran");\n',
    );
    await Deno.writeTextFile(
      `${dir}/deno.lock`,
      JSON.stringify({
        version: "5",
        specifiers: { "jsr:@zuke/core@^1.42.0": "1.42.0" },
      }),
    );
    const host = recordingHost();
    await inDir(dir, async () => {
      assertEquals(await main(["--version"], host), 0);
    });
    assertEquals(host.logs.includes("1.42.0"), true, host.logs.join("\n"));
    assertEquals(await exists(`${dir}/ran.txt`), false);
  }, { prefix: "zuke-global-cli-" });
});

Deno.test({
  name: "a forwarded launcher runs with Deno's update check off",
  // POSIX launchers only: Windows reports no file mode, so it keeps `deno run`.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      await Deno.writeTextFile(`${dir}/${CONFIG_FILE}`, '{ "name": "S" }\n');
      await Deno.writeTextFile(`${dir}/zuke.ts`, scratchBuild());
      await Deno.writeTextFile(
        `${dir}/zuke`,
        '#!/bin/sh\nprintf "%s" "$DENO_NO_UPDATE_CHECK" > env.txt\n',
        { mode: 0o755 },
      );
      await inDir(dir, async () => {
        assertEquals(await main(["hello"], recordingHost()), 0);
      });
      assertEquals(await Deno.readTextFile(`${dir}/env.txt`), "1");
    }, { prefix: "zuke-global-cli-" });
  },
});

Deno.test("zuke --version reads the lockfile a real project's deno.json names", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/${CONFIG_FILE}`, '{ "name": "Moved" }\n');
    await Deno.writeTextFile(
      `${dir}/zuke.ts`,
      'await Deno.writeTextFile("ran.txt", "ran");\n',
    );
    await Deno.writeTextFile(
      `${dir}/deno.json`,
      JSON.stringify({ lock: "locks/zuke.lock" }),
    );
    const lock = (version: string) =>
      JSON.stringify({
        version: "5",
        specifiers: { "jsr:@zuke/core@^1": version },
      });
    // A leftover default lock the build no longer resolves through.
    await Deno.writeTextFile(`${dir}/deno.lock`, lock("1.1.0"));
    await Deno.mkdir(`${dir}/locks`);
    await Deno.writeTextFile(`${dir}/locks/zuke.lock`, lock("1.42.0"));
    const host = recordingHost();
    await inDir(dir, async () => {
      assertEquals(await main(["--version"], host), 0);
    });
    assertEquals(host.logs.includes("1.42.0"), true, host.logs.join("\n"));
    assertEquals(host.logs.includes("1.1.0"), false);
    assertEquals(await exists(`${dir}/ran.txt`), false);
  }, { prefix: "zuke-global-cli-" });
});
