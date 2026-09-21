// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";
import { withTemp } from "../../packages/core/tests/_temp.ts";
import { VERSION } from "../../packages/core/src/version.ts";

// The `doc` command is build-independent; any build serves to reach it.
class Noop extends Build {
  noop = target().executes(() => {});
}

Deno.test("zuke doc runs deno doc for a local module in an isolated cwd", async () => {
  await withTemp(async (dir) => {
    const mod = `${dir}/lib.ts`;
    await Deno.writeTextFile(
      mod,
      '/** A documented greeting. */\nexport function greet(): string {\n  return "hi";\n}\n',
    );
    // The default runner spawns a real `deno doc` (offline for a self-contained
    // local module) from a fresh empty temp dir; success proves the isolation
    // path end-to-end. Output goes to inherited stdout, so assert the exit code.
    const ok = await runCli(Noop, ["doc", mod]);
    assertEquals(ok.code, 0);

    // A spec deno doc cannot resolve fails, and that failure is propagated.
    const missing = await runCli(Noop, ["doc", `${dir}/does-not-exist.ts`]);
    assertEquals(missing.code !== 0, true);
  }, { prefix: "zuke-doc-it-" });
});

Deno.test("the build's doc resolves a bare name as a package, not a file", async () => {
  // The divergence this rule closed: the installed `zuke doc core` reached
  // jsr:@zuke/core while the launcher's `./zuke doc core` looked for a file
  // called `core` beside the caller and reported it missing. The runner is
  // faked here — what is under test is the specifier the command hands it,
  // not deno doc, and a real one would need the network.
  let seen: string | undefined;
  const { code } = await runCli(Noop, ["doc", "core"], {
    docRunner: (spec: string) => {
      seen = spec;
      return Promise.resolve(0);
    },
  });
  assertEquals(code, 0);
  assertEquals(seen, "jsr:@zuke/core");
});

Deno.test("the build's doc still treats a path as a path", async () => {
  // The other half of the same rule: making bare names resolve as packages
  // must not turn a file into one.
  let seen: string | undefined;
  const runner = (spec: string) => {
    seen = spec;
    return Promise.resolve(0);
  };
  await runCli(Noop, ["doc", "./lib.ts"], { docRunner: runner });
  assertEquals(seen, `${Deno.cwd()}/./lib.ts`);

  await runCli(Noop, ["doc", "@scope/pkg"], { docRunner: runner });
  assertEquals(seen, "jsr:@scope/pkg");
});

Deno.test("the build answers --version with the core version, bare", async () => {
  // `./zuke --version` used to be an unknown flag while `zuke --version`
  // answered, which was the sharpest edge of the two surfaces disagreeing.
  // Bare, so a script can read it without parsing around a banner.
  const { code, out } = await runCli(Noop, ["--version"]);
  assertEquals(code, 0);
  assertEquals(out.trim(), VERSION);
});

Deno.test("--help wins when --version is also given", async () => {
  // Same precedence the parser already gives help over an unknown flag:
  // whoever asked for help is the one who needs it.
  const { code, out } = await runCli(Noop, ["--help", "--version"]);
  assertEquals(code, 0);
  assertEquals(out.trim() === VERSION, false);
  assertEquals(out.includes("Usage"), true);
});

Deno.test("the build's doc refuses an empty spec instead of building a bad one", async () => {
  // Resolving "" would produce `jsr:@zuke/`, which deno doc rejects with a
  // message about a specifier the caller never typed. The installed CLI
  // already refused it; this is the same command, so it refuses it too.
  let seen: string | undefined;
  const { code, err } = await runCli(Noop, ["doc", ""], {
    docRunner: (spec: string) => {
      seen = spec;
      return Promise.resolve(0);
    },
  });
  assertEquals(code, 1);
  assertEquals(seen, undefined);
  assertEquals(err.includes("Usage: zuke doc"), true);
});
