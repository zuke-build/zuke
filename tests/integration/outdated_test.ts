// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for the `outdated` command: a real build driven through
 * the CLI `main()` entry point, with the lock path, registry origin and
 * `fetch` injected — so the command's own wiring (the reserved word, the
 * `--exit-code` flag, the exit codes, the report on stdout) is exercised
 * without network access.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** A build with a target, so `outdated` is proven not to be read as one. */
class OutdatedBuild extends Build {
  outdated = target().description("a target that shares the command's name")
    .executes(() => {
      throw new Error("the reserved command must win over this target");
    });
  build = target().description("something to run").executes(() => {});
}

/** A `fetch` answering JSR `meta.json` from a name → latest map. */
function registryFetch(latest: Record<string, string>): typeof fetch {
  return (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const match = /\/(@[^/]+\/[^/]+)\/meta\.json$/.exec(url);
    const version = match === null ? undefined : latest[match[1]];
    if (version === undefined) {
      return Promise.resolve(new Response("nope", { status: 404 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ latest: version })));
  };
}

/** Run a temp-lock `outdated`, returning the CLI result. */
async function runOutdated(
  specifiers: Record<string, string>,
  latest: Record<string, string>,
  args: string[] = [],
) {
  const dir = await Deno.makeTempDir();
  try {
    const lockPath = `${dir}/deno.lock`;
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({ version: "5", specifiers }),
    );
    return await runCli(OutdatedBuild, ["outdated", ...args], {
      outdatedOptions: {
        lockPath,
        registry: "https://registry.test",
        fetch: registryFetch(latest),
      },
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("outdated reports a stale pin and exits 0 by default", async () => {
  const { code, out } = await runOutdated(
    { "jsr:@zuke/git@^1": "1.5.0" },
    { "@zuke/git": "1.11.0" },
  );
  // Exit 0: the default is a report, not a gate.
  assertEquals(code, 0);
  assertEquals(out.includes("@zuke/git"), true);
  assertEquals(out.includes("1.5.0"), true);
  assertEquals(out.includes("1.11.0"), true);
});

Deno.test("outdated --exit-code fails when something is behind, not otherwise", async () => {
  const stale = await runOutdated(
    { "jsr:@zuke/git@^1": "1.5.0" },
    { "@zuke/git": "1.11.0" },
    ["--exit-code"],
  );
  assertEquals(stale.code, 1);

  const current = await runOutdated(
    { "jsr:@zuke/git@^1": "1.11.0" },
    { "@zuke/git": "1.11.0" },
    ["--exit-code"],
  );
  assertEquals(current.code, 0);
  assertEquals(current.out.includes("at its latest release"), true);
});

Deno.test("an offline run is reported as unchecked, and --exit-code fails on it", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const lockPath = `${dir}/deno.lock`;
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({ specifiers: { "jsr:@zuke/git@^1": "1.5.0" } }),
    );
    const options = {
      lockPath,
      registry: "https://registry.test",
      fetch: () => Promise.reject(new TypeError("error sending request")),
    };
    // A runner that reached nothing must not be told every pin is current —
    // that confident wrong answer is the silence this command exists to break.
    const report = await runCli(OutdatedBuild, ["outdated"], {
      outdatedOptions: options,
    });
    assertEquals(report.code, 0);
    assertEquals(report.out.includes("at its latest release"), false);
    assertEquals(report.out.includes("could not be checked"), true);
    assertEquals(report.out.includes("error sending request"), true);

    // Under --exit-code an unanswered question is not a "yes".
    const gated = await runCli(OutdatedBuild, ["outdated", "--exit-code"], {
      outdatedOptions: options,
    });
    assertEquals(gated.code, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("outdated names a missing lock and fails", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { code, err } = await runCli(OutdatedBuild, ["outdated"], {
      outdatedOptions: { lockPath: `${dir}/absent.lock` },
    });
    // "Nothing is behind" and "I never read a lock" must not look the same.
    assertEquals(code, 1);
    assertEquals(err.includes("no lock file at"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("outdated is a reserved word, and the help and listing say so", async () => {
  // The build above declares a target called `outdated`; the reserved command
  // has to win, or a build could shadow a command by naming a target after it.
  const help = await runCli(OutdatedBuild, ["--help"]);
  assertEquals(help.code, 0);
  assertEquals(help.out.includes("outdated"), true);

  // The flag lives in the command's own help, which is where the main help
  // sends a reader for it.
  const commandHelp = await runCli(OutdatedBuild, ["outdated", "--help"]);
  assertEquals(commandHelp.code, 0);
  assertEquals(commandHelp.out.includes("--exit-code"), true);
  assertEquals(commandHelp.out.includes("--update"), true);

  const surface = await runCli(OutdatedBuild, ["--list", "--json"]);
  assertEquals(surface.code, 0);
  const parsed: unknown = JSON.parse(surface.out);
  const commands = parsed !== null && typeof parsed === "object"
    ? Reflect.get(parsed, "commands")
    : undefined;
  const names = Array.isArray(commands)
    ? commands.map((c: unknown) =>
      c !== null && typeof c === "object" ? Reflect.get(c, "name") : undefined
    )
    : [];
  assertEquals(names.includes("outdated"), true);
});

/**
 * Run `outdated --update` against a temporary lock, with re-resolution faked
 * by `resolved`: the versions the next resolution would produce, by specifier.
 * Returns the CLI result and the lock as it ended up.
 */
async function runUpdate(
  specifiers: Record<string, string>,
  latest: Record<string, string>,
  resolved: Record<string, string>,
  args: string[] = [],
): Promise<{ code: number; out: string; err: string; lock: string }> {
  const dir = await Deno.makeTempDir();
  try {
    const lockPath = `${dir}/deno.lock`;
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({ version: "5", specifiers }, null, 2),
    );
    const result = await runCli(OutdatedBuild, [
      "outdated",
      "--update",
      ...args,
    ], {
      outdatedOptions: {
        lockPath,
        registry: "https://registry.test",
        fetch: registryFetch(latest),
        resolve: async (path) => {
          // Models `deno install`: it fills in entries that are missing and
          // leaves a satisfying one alone, so only dropped specifiers move.
          const lock = JSON.parse(await Deno.readTextFile(path));
          for (const [specifier, version] of Object.entries(resolved)) {
            if (lock.specifiers[specifier] === undefined) {
              lock.specifiers[specifier] = version;
            }
          }
          await Deno.writeTextFile(path, JSON.stringify(lock, null, 2));
        },
      },
    });
    return { ...result, lock: await Deno.readTextFile(lockPath) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("outdated --update writes the bumped version into the lock", async () => {
  const { code, out, lock } = await runUpdate(
    { "jsr:@zuke/git@^1": "1.2.0" },
    { "@zuke/git": "1.9.0" },
    { "jsr:@zuke/git@^1": "1.9.0" },
  );
  assertEquals(code, 0);
  assertEquals(out.includes("1.2.0"), true);
  assertEquals(out.includes("1.9.0"), true);
  assertEquals(JSON.parse(lock).specifiers["jsr:@zuke/git@^1"], "1.9.0");
});

Deno.test("outdated --update narrows to the packages it is given", async () => {
  const { code, lock } = await runUpdate(
    { "jsr:@zuke/git@^1": "1.2.0", "jsr:@zuke/gh@^2": "2.0.0" },
    { "@zuke/git": "1.9.0", "@zuke/gh": "2.5.0" },
    { "jsr:@zuke/git@^1": "1.9.0", "jsr:@zuke/gh@^2": "2.5.0" },
    ["@zuke/git"],
  );
  assertEquals(code, 0);
  const { specifiers } = JSON.parse(lock);
  assertEquals(specifiers["jsr:@zuke/git@^1"], "1.9.0");
  // Behind as well, but not asked for: its entry was never dropped.
  assertEquals(specifiers["jsr:@zuke/gh@^2"], "2.0.0");
});

Deno.test("outdated --update reports a pinned package as held, and exits 0", async () => {
  // An exact specifier resolves to the same version however often you ask, so
  // there is nothing the lock can do about it. Saying "updated" would be false.
  const { code, out, lock } = await runUpdate(
    { "jsr:@std/yaml@1.0.5": "1.0.5" },
    { "@std/yaml": "1.3.0" },
    // Re-resolution puts it back at the only version the specifier allows.
    { "jsr:@std/yaml@1.0.5": "1.0.5" },
  );
  assertEquals(code, 0);
  assertEquals(out.includes("held at 1.3.0"), true);
  assertEquals(out.includes("widen the range"), true);
  assertEquals(JSON.parse(lock).specifiers["jsr:@std/yaml@1.0.5"], "1.0.5");
});

Deno.test("outdated --update --exit-code fails only on what is still actionable", async () => {
  // A clean update exits 0 even though something *was* behind: after updating,
  // "was behind" is the expected state and failing on it makes the flag
  // unusable in the scheduled pipeline this command is meant for.
  const clean = await runUpdate(
    { "jsr:@zuke/git@^1": "1.2.0" },
    { "@zuke/git": "1.9.0" },
    { "jsr:@zuke/git@^1": "1.9.0" },
    ["--exit-code"],
  );
  assertEquals(clean.code, 0);
  // A package a specifier holds back is still actionable, so it fails.
  const stuck = await runUpdate(
    { "jsr:@std/yaml@1.0.5": "1.0.5" },
    { "@std/yaml": "1.3.0" },
    { "jsr:@std/yaml@1.0.5": "1.0.5" },
    ["--exit-code"],
  );
  assertEquals(stuck.code, 1);
});

Deno.test("outdated rejects package names without --update", async () => {
  const { code, err } = await runOutdated(
    { "jsr:@zuke/git@^1": "1.2.0" },
    { "@zuke/git": "1.9.0" },
    ["@zuke/git"],
  );
  assertEquals(code, 1);
  assertEquals(err.includes("only apply with --update"), true);
});

Deno.test("outdated --update names a package the lock does not resolve", async () => {
  const { code, err } = await runUpdate(
    { "jsr:@zuke/git@^1": "1.2.0" },
    { "@zuke/git": "1.9.0" },
    { "jsr:@zuke/git@^1": "1.9.0" },
    ["@zuke/nope"],
  );
  assertEquals(code, 1);
  assertEquals(err.includes("@zuke/nope"), true);
});
