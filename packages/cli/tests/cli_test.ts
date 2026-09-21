// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  type BuildProbe,
  defaultPrompter,
  main,
  parseSetupFlags,
  resolveDocSpec,
} from "../mod.ts";
import { VERSION } from "../src/version.ts";
import { DENO_PIN } from "../src/deno_pin.ts";
import {
  FakeHost,
  FakePrompter,
  FakeStarActions,
  noProjectProbe,
} from "./_fakes.ts";
import { withTemp } from "../../core/tests/_temp.ts";
import { withEnv } from "../../core/tests/_env.ts";
import { capture } from "../../core/tests/_console.ts";
import { ENC } from "../../core/tests/_escaping.ts";
import { defaultHost } from "../src/setup.ts";
import { ConsoleTasks, ZUKE_LOGO } from "@zuke/console";
import { absolutePath } from "@zuke/core";

const LOGO_TOP = ZUKE_LOGO.split("\n")[0];

/**
 * Run `fn` with the console level pinned (an ambient `ZUKE_LOG_LEVEL=silent`
 * would legitimately mute the banner), resetting the global console after.
 */
async function withBanner(fn: () => Promise<void>): Promise<void> {
  ConsoleTasks.configure({ level: "info" });
  try {
    await fn();
  } finally {
    ConsoleTasks.reset();
  }
}

Deno.test("parseSetupFlags reads every flag form", () => {
  assertEquals(parseSetupFlags([]), {
    force: false,
    yes: false,
    mcp: false,
    allowRun: false,
  });
  assertEquals(parseSetupFlags(["--force"]).force, true);
  assertEquals(parseSetupFlags(["-f"]).force, true);
  assertEquals(parseSetupFlags(["--yes"]).yes, true);
  assertEquals(parseSetupFlags(["-y"]).yes, true);
  assertEquals(parseSetupFlags(["--name", "Foo"]).name, "Foo");
  assertEquals(parseSetupFlags(["--name=Bar"]).name, "Bar");
  assertEquals(parseSetupFlags(["--name"]).name, undefined);
  assertEquals(parseSetupFlags(["--dir", "app"]).dir, "app");
  assertEquals(parseSetupFlags(["--dir=pkg"]).dir, "pkg");
  assertEquals(parseSetupFlags(["--dir"]).dir, undefined);
  assertEquals(
    parseSetupFlags(["--launcher-name", "build"]).launcherName,
    "build",
  );
  assertEquals(parseSetupFlags(["--launcher-name=go"]).launcherName, "go");
  assertEquals(parseSetupFlags(["--launcher-name"]).launcherName, undefined);
  assertEquals(parseSetupFlags(["whatever"]).name, undefined);
  assertEquals(parseSetupFlags([]).mcp, false);
  assertEquals(parseSetupFlags(["--mcp"]).mcp, true);
  assertEquals(parseSetupFlags(["--mcp"]).allowRun, false);
  // --allow-run implies --mcp: execution is a property of the registration.
  assertEquals(parseSetupFlags(["--allow-run"]), {
    force: false,
    yes: false,
    mcp: true,
    allowRun: true,
  });
  // Unset means "ask, or take the default"; either flag decides outright, and
  // the last one wins.
  assertEquals(parseSetupFlags([]).bootstrapDeno, undefined);
  assertEquals(parseSetupFlags(["--bootstrap-deno"]).bootstrapDeno, true);
  assertEquals(parseSetupFlags(["--no-bootstrap-deno"]).bootstrapDeno, false);
  assertEquals(
    parseSetupFlags(["--bootstrap-deno", "--no-bootstrap-deno"]).bootstrapDeno,
    false,
  );
});

Deno.test("main setup --yes scaffolds the bootstrapping launchers by default", async () => {
  const host = new FakeHost();
  const prompter = new FakePrompter(true);
  assertEquals(await main(["setup", "--yes"], host, prompter), 0);
  assertEquals(host.files.get("zuke")?.includes("DEFAULT_DENO_VERSION"), true);
  assertEquals(host.files.get("zuke.ps1")?.includes("$DenoChecksums"), true);
  // --yes means no questions, the launcher one included.
  assertEquals(prompter.asks, []);
});

Deno.test("main setup --no-bootstrap-deno scaffolds the plain launchers", async () => {
  const host = new FakeHost();
  const code = await main(
    ["setup", "--yes", "--no-bootstrap-deno"],
    host,
    new FakePrompter(false),
  );
  assertEquals(code, 0);
  assertEquals(
    host.files.get("zuke")?.includes("Deno not found on PATH"),
    true,
  );
  assertEquals(host.files.get("zuke")?.includes("DEFAULT_DENO_VERSION"), false);
  assertEquals(
    host.files.get("zuke.ps1")?.includes("Deno not found on PATH"),
    true,
  );
});

Deno.test("main setup (interactive) asks about the launcher and honours a no", async () => {
  const host = new FakeHost();
  const prompter = new FakePrompter(true, "", true, false, "n");
  assertEquals(await main(["setup"], host, prompter), 0);
  const question = prompter.asks.find((q) => q.includes("bootstrap a pinned"));
  assertEquals(question !== undefined, true);
  // The question names the release a yes will pin, so the choice is informed.
  assertEquals(question?.includes(`Deno v${DENO_PIN.version}`), true);
  assertEquals(
    host.files.get("zuke")?.includes("Deno not found on PATH"),
    true,
  );
});

Deno.test("main setup (interactive) takes Enter as the default: bootstrap", async () => {
  const host = new FakeHost();
  const prompter = new FakePrompter(true, "", true);
  assertEquals(await main(["setup"], host, prompter), 0);
  assertEquals(
    prompter.asks.some((q) => q.includes("bootstrap a pinned")),
    true,
  );
  assertEquals(host.files.get("zuke")?.includes("DEFAULT_DENO_VERSION"), true);
});

Deno.test("main setup (interactive) does not ask when a flag already answered", async () => {
  const host = new FakeHost();
  const prompter = new FakePrompter(true, "", true, false, "n");
  const code = await main(["setup", "--bootstrap-deno"], host, prompter);
  assertEquals(code, 0);
  assertEquals(
    prompter.asks.some((q) => q.includes("bootstrap a pinned")),
    false,
  );
  // The flag wins over the scripted "n" the prompt would have returned.
  assertEquals(host.files.get("zuke")?.includes("DEFAULT_DENO_VERSION"), true);
});

Deno.test("main import honours the launcher flags and question too", async () => {
  const flagged = new FakeHost({ Makefile: "build:\n\techo hi\n" });
  const code = await main(
    ["import", "--yes", "--no-bootstrap-deno"],
    flagged,
    new FakePrompter(false),
  );
  assertEquals(code, 0);
  assertEquals(
    flagged.files.get("zuke")?.includes("Deno not found on PATH"),
    true,
  );

  const asked = new FakeHost({ Makefile: "build:\n\techo hi\n" });
  const prompter = new FakePrompter(true, "", true, false, "no");
  assertEquals(await main(["import"], asked, prompter), 0);
  assertEquals(
    prompter.asks.some((q) => q.includes("bootstrap a pinned")),
    true,
  );
  assertEquals(
    asked.files.get("zuke")?.includes("Deno not found on PATH"),
    true,
  );
});

Deno.test("main --help documents both launcher flags", async () => {
  const host = new FakeHost();
  assertEquals(
    await main(
      ["--help"],
      host,
      undefined,
      undefined,
      undefined,
      undefined,
      noProjectProbe,
    ),
    0,
  );
  const help = host.logs.join("\n");
  assertEquals(help.includes("--bootstrap-deno"), true);
  assertEquals(help.includes("--no-bootstrap-deno"), true);
});

Deno.test("main setup --mcp writes .mcp.json and import --allow-run passes it through", async () => {
  const host = new FakeHost();
  const code = await main(
    ["setup", "--yes", "--dir", "app", "--mcp"],
    host,
    new FakePrompter(false),
  );
  assertEquals(code, 0);
  const config = JSON.parse(host.files.get("app/.mcp.json") ?? "{}");
  assertEquals(config.mcpServers.zuke.args, ["run", "-A", "zuke.ts", "mcp"]);

  const imported = new FakeHost({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
  });
  const importCode = await main(
    ["import", "--yes", "--allow-run"],
    imported,
    new FakePrompter(false),
  );
  assertEquals(importCode, 0);
  const importedConfig = JSON.parse(imported.files.get(".mcp.json") ?? "{}");
  assertEquals(importedConfig.mcpServers.zuke.args.at(-1), "--allow-run");
});

Deno.test("main setup surfaces a directory collision as a friendly exit 1", async () => {
  const host = new FakeHost();
  host.directories.add("zuke"); // a zuke/ directory is in the way
  const code = await main(["setup", "--yes"], host, new FakePrompter(false));
  assertEquals(code, 1);
  assertEquals(host.logs.some((l) => l.includes("--launcher-name")), true);
  assertEquals(host.files.size, 0); // nothing scaffolded
});

Deno.test("main setup --launcher-name renames the launcher and reports it", async () => {
  const host = new FakeHost();
  const code = await main(
    ["setup", "--yes", "--launcher-name", "build"],
    host,
    new FakePrompter(false),
  );
  assertEquals(code, 0);
  assertEquals(host.files.has("build"), true);
  assertEquals(host.logs.some((l) => l.includes("./build")), true);
});

Deno.test("resolveDocSpec resolves bare, scoped, and explicit specifiers", () => {
  const cwd = "/work";
  assertEquals(resolveDocSpec("core", cwd), "jsr:@zuke/core");
  assertEquals(resolveDocSpec("@scope/pkg", cwd), "jsr:@scope/pkg");
  assertEquals(resolveDocSpec("jsr:@zuke/deno", cwd), "jsr:@zuke/deno");
  assertEquals(resolveDocSpec("npm:cowsay", cwd), "npm:cowsay");
  assertEquals(resolveDocSpec("https://x/y.ts", cwd), "https://x/y.ts");
  // A path is pinned to the caller's directory here, because `deno doc` runs
  // from an isolated empty one where a relative spec would resolve to nothing.
  assertEquals(resolveDocSpec("./local.ts", cwd), "/work/local.ts");
  assertEquals(resolveDocSpec("src/mod.ts", cwd), "/work/src/mod.ts");
  // A bare name that names a file is a file: `@zuke/mod.ts` is not a package.
  assertEquals(resolveDocSpec("mod.ts", cwd), "/work/mod.ts");
  assertEquals(resolveDocSpec("/abs/mod.ts", cwd), "/abs/mod.ts");
});

Deno.test("main doc runs `deno doc <spec>` in an isolated temp-dir cwd", async () => {
  const host = new FakeHost();
  let seen: string[] = [];
  const code = await main(["doc", "core"], host, defaultPrompter, (args) => {
    seen = args;
    return Promise.resolve(0);
  });
  assertEquals(code, 0);
  assertEquals(seen, ["doc", "jsr:@zuke/core"]);
});

Deno.test("main doc pins a relative path to an absolute spec (cwd changes under it)", async () => {
  const host = new FakeHost();
  let seen: string[] = [];
  const code = await main(
    ["doc", "./lib.ts"],
    host,
    defaultPrompter,
    (args) => {
      seen = args;
      return Promise.resolve(0);
    },
  );
  assertEquals(code, 0);
  // The relative path was resolved against the user's cwd, not left relative
  // (which would resolve against the runner's throwaway directory).
  assertEquals(seen[0], "doc");
  assertEquals(seen[1].startsWith("."), false);
  assertEquals(seen[1].endsWith("/lib.ts"), true);
});

Deno.test("main doc forwards extra flags and propagates the exit code", async () => {
  const host = new FakeHost();
  let seen: string[] = [];
  const code = await main(
    ["doc", "deno", "--filter", "DenoTasks"],
    host,
    defaultPrompter,
    (args) => {
      seen = args;
      return Promise.resolve(3);
    },
  );
  assertEquals(code, 3);
  assertEquals(seen, ["doc", "--filter", "DenoTasks", "jsr:@zuke/deno"]);
});

Deno.test("main doc without a package prints usage and never spawns", async () => {
  const host = new FakeHost();
  let called = false;
  const runner = () => {
    called = true;
    return Promise.resolve(0);
  };
  assertEquals(await main(["doc"], host, defaultPrompter, runner), 1);
  assertEquals(
    await main(["doc", "--filter"], host, defaultPrompter, runner),
    1,
  );
  assertEquals(called, false);
  assertEquals(host.logs.some((l) => l.includes("name a package")), true);
});

Deno.test("main doc runs a real `deno doc` via the default runner (end-to-end)", async () => {
  const host = new FakeHost();
  await withTemp(async (dir) => {
    const fixture = `${dir}/lib.ts`;
    await Deno.writeTextFile(
      fixture,
      '/** A documented greeting. */\nexport const hello = "hi";\n',
    );
    // No injected runner → the real defaultDocRunner spawns `deno doc` in its
    // own throwaway directory against the fixture's absolute path.
    const code = await main(["doc", fixture], host);
    assertEquals(code, 0);
  });
});

Deno.test("main doc relays the real runner's output through the sink, escaped on a runner", async () => {
  // `deno doc` repeats a `--filter` it cannot find on stderr. Inherited, that
  // line reached an Actions runner raw; relayed through the sink, the legacy
  // marker in it is neutralised. Off a runner the same line is left as the
  // child wrote it.
  await withTemp(async (dir) => {
    const fixture = `${dir}/doc_fixture.ts`;
    await Deno.writeTextFile(
      fixture,
      '/** A documented greeting. */\nexport const hello = "hi";\n',
    );
    const filter = "##[add-mask]forged";
    const onRunner = await capture(async () => {
      let exit = 0;
      await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
        exit = await main(["doc", fixture, "--filter", filter], new FakeHost());
      });
      return exit;
    });
    assertEquals(onRunner.code === 0, false);
    const wire = onRunner.err.join("\n");
    assertEquals(wire.includes("##["), false);
    assertEquals(wire.includes("%23%23[add-mask]forged"), true);

    const local = await capture(async () => {
      let exit = 0;
      await withEnv({ GITHUB_ACTIONS: undefined }, async () => {
        exit = await main(["doc", fixture, "--filter", filter], new FakeHost());
      });
      return exit;
    });
    assertEquals(local.err.join("\n").includes(filter), true);
  });
});

Deno.test("main doc propagates a non-zero exit from the real runner", async () => {
  const host = new FakeHost();
  // A missing file → `deno doc` exits non-zero. No injected runner, so the real
  // defaultDocRunner runs and its temp dir is still cleaned up on failure.
  const code = await main(["doc", "/no/such/zuke-doc-fixture.ts"], host);
  assertEquals(code !== 0, true);
});

Deno.test("main setup honours --dir", async () => {
  const host = new FakeHost();
  const code = await main(
    ["setup", "--yes", "--dir", "sub", "--name", "Widget"],
    host,
    new FakePrompter(false),
  );
  assertEquals(code, 0);
  assertEquals(host.files.get("sub/zuke.ts")?.includes("class Widget"), true);
  assertEquals(host.files.has("sub/deno.json"), true);
  assertEquals(host.logs.some((l) => l.includes("into sub")), true);
});

Deno.test("main --version prints the version, under both spellings", async () => {
  // The probe finds no project on purpose. `--version` reaches the build now,
  // so the real one would locate this repository's own zuke.json and spawn
  // its build — a subprocess in a test that only wants to read a string, and
  // a second version in the assertion below.
  const bare = async (args: string[]) => {
    const host = new FakeHost();
    assertEquals(
      await main(
        args,
        host,
        defaultPrompter,
        undefined,
        undefined,
        () => Promise.resolve(0),
        noProjectProbe,
      ),
      0,
    );
    return host.logs;
  };
  assertEquals(await bare(["--version"]), [VERSION]);
  assertEquals(await bare(["-V"]), [VERSION]);
});

Deno.test("main shows help for --help, -h and no args", async () => {
  // Outside any project: the probe sees no zuke.json, so a bare `zuke` is the
  // usage rather than a forwarded default target.
  for (const args of [[], ["--help"], ["-h"]]) {
    const host = new FakeHost();
    const { runner, reached } = neverRun();
    assertEquals(
      await main(
        args,
        host,
        defaultPrompter,
        undefined,
        undefined,
        runner,
        probeAt([]),
      ),
      0,
    );
    assertEquals(reached(), false);
    assertEquals(host.logs[0].includes("Usage:"), true);
  }
});

Deno.test("main rejects an unknown command", async () => {
  const host = new FakeHost();
  const { runner, reached } = neverRun();
  const code = await main(
    ["bogus"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    runner,
    probeAt([]),
  );
  assertEquals(code, 1);
  assertEquals(reached(), false);
  assertEquals(host.logs[0].includes("Unknown command: bogus"), true);
});

Deno.test("main setup (non-interactive) scaffolds with flags", async () => {
  const host = new FakeHost();
  const code = await main(
    ["setup", "--yes", "--name", "Widget"],
    host,
    new FakePrompter(true, "IGNORED", true),
  );
  assertEquals(code, 0);
  assertEquals(host.files.get("zuke.ts")?.includes("class Widget"), true);
});

Deno.test("main setup (non-tty) uses defaults without prompting", async () => {
  const host = new FakeHost();
  const code = await main(["setup"], host, new FakePrompter(false));
  assertEquals(code, 0);
  assertEquals(host.files.get("zuke.ts")?.includes("class MyBuild"), true);
});

Deno.test("main setup (interactive) asks for name and overwrite", async () => {
  const host = new FakeHost({ "zuke.ts": "old" });
  const code = await main(
    ["setup"],
    host,
    new FakePrompter(true, "Chosen", true),
  );
  assertEquals(code, 0);
  // confirm() returned true -> existing zuke.ts is overwritten.
  assertEquals(host.files.get("zuke.ts")?.includes("class Chosen"), true);
});

Deno.test("main setup (interactive) keeps --force without asking", async () => {
  const host = new FakeHost();
  // confirm would return false, but --force already set: files still written.
  const code = await main(
    ["setup", "--force"],
    host,
    new FakePrompter(true, "Named", false),
  );
  assertEquals(code, 0);
  assertEquals(host.files.get("zuke.ts")?.includes("class Named"), true);
});

Deno.test("main setup opens with the Zuke logo and the version", async () => {
  await withBanner(async () => {
    const host = new FakeHost();
    const code = await main(["setup", "--yes"], host, new FakePrompter(false));
    assertEquals(code, 0);
    assertEquals(host.logs.some((l) => l.includes(LOGO_TOP)), true);
    assertEquals(host.logs.some((l) => l.includes(VERSION)), true);
  });
});

Deno.test("main import opens with the Zuke logo too", async () => {
  await withBanner(async () => {
    const host = new FakeHost({ Makefile: "build:\n\techo hi\n" });
    const code = await main(["import", "--yes"], host, new FakePrompter(false));
    assertEquals(code, 0);
    assertEquals(host.logs.some((l) => l.includes(LOGO_TOP)), true);
  });
});

Deno.test("main setup (interactive) offers the star prompt and stars on yes", async () => {
  const host = new FakeHost();
  const actions = new FakeStarActions(true);
  const code = await main(
    ["setup"],
    host,
    new FakePrompter(true, "", false, true),
    undefined,
    actions,
  );
  assertEquals(code, 0);
  assertEquals(actions.calls, ["auth", "star"]);
  assertEquals(host.logs.some((l) => l.includes("thank you!")), true);
});

Deno.test("main setup skips the star prompt under --yes and non-TTY", async () => {
  for (
    const [args, prompter] of [
      [["setup", "--yes"], new FakePrompter(true, "", false, true)],
      [["setup"], new FakePrompter(false, "", false, true)],
    ] as const
  ) {
    const host = new FakeHost();
    const actions = new FakeStarActions(true);
    const code = await main([...args], host, prompter, undefined, actions);
    assertEquals(code, 0);
    assertEquals(actions.calls, []);
  }
});

Deno.test("main uses default host/prompter when omitted", async () => {
  // `undefined` for host and prompter is what exercises their defaults — the
  // point of this test. The probe is given, though: `--version` reaches the
  // build now, so the real one would find this repository's own zuke.json and
  // spawn its build, turning a string assertion into a subprocess.
  assertEquals(
    await main(
      ["--version"],
      undefined,
      undefined,
      undefined,
      undefined,
      () => Promise.resolve(0),
      noProjectProbe,
    ),
    0,
  );
});

Deno.test("defaultPrompter wraps prompt/confirm", () => {
  assertEquals(typeof defaultPrompter.interactive(), "boolean");

  const realPrompt = globalThis.prompt;
  const realConfirm = globalThis.confirm;
  try {
    globalThis.prompt = () => "typed";
    assertEquals(defaultPrompter.ask("q", "fallback"), "typed");
    // An empty answer and an end of input both mean "the default".
    globalThis.prompt = () => "";
    assertEquals(defaultPrompter.ask("q", "fallback"), "fallback");
    globalThis.prompt = () => null;
    assertEquals(defaultPrompter.ask("q", "fallback"), "fallback");
    globalThis.confirm = () => true;
    assertEquals(defaultPrompter.confirm("q"), true);
  } finally {
    globalThis.prompt = realPrompt;
    globalThis.confirm = realConfirm;
  }
});

Deno.test("defaultPrompter shows the default in the question, neutralised on a runner", async () => {
  // `prompt` writes to the terminal past the package's sink, and the default
  // it shows is `--name` from the command line. It is shown in the question
  // rather than prefilled, escaped like every other line, and the value the
  // caller gets back is still exactly what was typed.
  const realPrompt = globalThis.prompt;
  const shown: string[] = [];
  try {
    globalThis.prompt = (message?: string) => {
      shown.push(message ?? "");
      return "";
    };
    await withEnv({ GITHUB_ACTIONS: "true" }, () => {
      assertEquals(
        defaultPrompter.ask("Build class name", "::stop-commands::forged"),
        "::stop-commands::forged",
      );
    });
    await withEnv({ GITHUB_ACTIONS: undefined }, () => {
      defaultPrompter.ask("Build class name", "Acme");
    });
  } finally {
    globalThis.prompt = realPrompt;
  }
  assertEquals(shown, [
    "Build class name [::stop-commands::forged]",
    "Build class name [Acme]",
  ]);
  assertEquals(shown[0].includes(ENC), false); // no line opens with `::`
});

/** The path of `name` at the real cwd, where `main` starts its walk. */
function atCwd(name: string): string {
  return `${Deno.cwd().replaceAll("\\", "/")}/${name}`;
}

/**
 * A build probe that sees only `names` at the real cwd — never the real
 * filesystem, where this very repository's `zuke.json` would have a test run
 * Zuke's own build. Ownership is the inert pairing (no ids on either side)
 * unless `owned` says otherwise: the gate has its own tests in
 * `dispatch_test.ts`; these are about routing.
 */
function probeAt(
  names: string[],
  owned: { uid: number | null; owner: number | null } = {
    uid: null,
    owner: null,
  },
): BuildProbe {
  const present = new Set(names.map(atCwd));
  return {
    exists: (path) => Promise.resolve(present.has(path)),
    // Only the root is ever owned here; an ancestor config file is absent.
    ownership: (path) =>
      Promise.resolve(
        path === Deno.cwd().replaceAll("\\", "/") && owned.owner !== null
          ? { uid: owned.owner, mode: 0o755 }
          : null,
      ),
    uid: () => owned.uid,
  };
}

/** A runner that records whether it was reached. */
function neverRun(): { runner: () => Promise<number>; reached: () => boolean } {
  let reached = false;
  return {
    runner: () => {
      reached = true;
      return Promise.resolve(0);
    },
    reached: () => reached,
  };
}

/**
 * Run `fn` with stderr captured — the no-lock notice and a refusal go there,
 * never to stdout where a piped `--list --json` lives — while the console is
 * silenced, proving neither report can be muted by `ZUKE_LOG_LEVEL`. Returns
 * the captured stderr lines.
 */
async function capturingErr(fn: () => Promise<void>): Promise<string[]> {
  const err: string[] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => void err.push(parts.join(" "));
  ConsoleTasks.configure({ level: "silent" });
  try {
    await fn();
  } finally {
    console.error = original;
    ConsoleTasks.reset();
  }
  return err;
}

Deno.test("main forwards a build command to zuke.ts at the nearest zuke.json", async () => {
  const host = new FakeHost();
  let seen: [string, string[]] | undefined;
  const code = await main(
    ["ci", "--parallel"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    (root, denoArgs) => {
      seen = [root, denoArgs];
      return Promise.resolve(0);
    },
    probeAt(["zuke.json"]),
  );
  assertEquals(code, 0);
  assertEquals(seen, [
    Deno.cwd().replaceAll("\\", "/"),
    ["run", "-A", "zuke.ts", "ci", "--parallel"],
  ]);
  // Nothing of the CLI's own output gets in the way of the build's.
  assertEquals(host.logs, []);
});

Deno.test("main forwards with --frozen once a deno.lock sits beside zuke.json", async () => {
  const host = new FakeHost();
  let seen: string[] = [];
  const err = await capturingErr(async () => {
    const code = await main(
      ["--list", "--json"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      (_root, denoArgs) => {
        seen = denoArgs;
        return Promise.resolve(0);
      },
      probeAt(["zuke.json", "deno.lock"]),
    );
    assertEquals(code, 0);
  });
  assertEquals(seen, ["run", "-A", "--frozen", "zuke.ts", "--list", "--json"]);
  assertEquals(err, []);
});

Deno.test("main warns on stderr when forwarding without a lockfile", async () => {
  const host = new FakeHost();
  const err = await capturingErr(async () => {
    await main(
      ["build"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      () => Promise.resolve(0),
      probeAt(["zuke.json"]),
    );
  });
  assertEquals(err.length, 1);
  assertEquals(err[0].includes("no deno.lock here yet"), true);
  // …and never on stdout, which belongs to the build.
  assertEquals(host.logs, []);
});

Deno.test("main propagates the build's exit code and forwards flags verbatim", async () => {
  const host = new FakeHost();
  let seen: string[] = [];
  const code = await main(
    ["graph", "--no-open", "--output=html"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    (_root, denoArgs) => {
      seen = denoArgs;
      return Promise.resolve(5);
    },
    probeAt(["zuke.json"]),
  );
  assertEquals(code, 5);
  assertEquals(seen.slice(3), ["graph", "--no-open", "--output=html"]);
});

Deno.test("main keeps doc for itself even inside a project", async () => {
  // A zuke.json is present, yet `doc` stays the global CLI's and never
  // reaches the build runner — `zuke doc jsr:@zuke/deno` has to work outside
  // a project too, so forwarding it would make it depend on one. It resolves
  // the same specifier the build would either way, which the drift test pins.
  //
  // `--help` and `--version` are deliberately different: both now show the
  // build's surface alongside the CLI's, each covered by its own test.
  const host = new FakeHost();
  const forwarded: string[][] = [];
  const runner = (_root: string, denoArgs: string[]) => {
    forwarded.push(denoArgs);
    return Promise.resolve(0);
  };
  let documented: string[] = [];
  const docRunner = (args: string[]) => {
    documented = args;
    return Promise.resolve(0);
  };
  assertEquals(
    await main(
      ["doc", "core"],
      host,
      defaultPrompter,
      docRunner,
      undefined,
      runner,
      probeAt(["zuke.json"]),
    ),
    0,
  );
  assertEquals(forwarded, []);
  assertEquals(documented, ["doc", "jsr:@zuke/core"]);
});

Deno.test("--version inside a project reports both, the CLI's first", async () => {
  // The CLI and the build are separate packages on separate cadences, and a
  // project pins core through its own import map — so one number cannot stand
  // for both. The CLI's stays the first line, bare, so anything already
  // reading `zuke --version` keeps working.
  const host = new FakeHost();
  const forwarded: string[][] = [];
  const code = await main(
    ["--version"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    (_root, denoArgs) => {
      forwarded.push(denoArgs);
      return Promise.resolve(0);
    },
    probeAt(["zuke.json"]),
  );
  assertEquals(code, 0);
  assertEquals(host.logs[0], VERSION);
  assertStringIncludes(host.logs.join("\n"), "This project's build");
  // Asked of the build rather than assumed from the CLI's own core.
  assertEquals(forwarded, [["run", "-A", "zuke.ts", "--version"]]);
});

Deno.test("--version outside a project is the one line, with no notice", async () => {
  // A version query is not the place to explain what a project is; --help
  // already does that, and a script reading this wants one line.
  const host = new FakeHost();
  const forwarded: string[][] = [];
  const code = await main(
    ["--version"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    (_root, denoArgs) => {
      forwarded.push(denoArgs);
      return Promise.resolve(0);
    },
    noProjectProbe,
  );
  assertEquals(code, 0);
  assertEquals(host.logs.join("\n").trim(), VERSION);
  assertEquals(forwarded, []);
});

Deno.test("--version names a build that could not report one", async () => {
  // The runner returns the build's exit code rather than throwing on one, so
  // a build that ran and failed would otherwise leave a heading over nothing
  // while the command still reported success.
  const host = new FakeHost();
  let code = 1;
  const err = await capturingErr(async () => {
    code = await main(
      ["--version"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      () => Promise.resolve(3),
      probeAt(["zuke.json"]),
    );
  });
  // Still 0: the CLI's own version is correct and is what was asked for.
  assertEquals(code, 0);
  assertEquals(host.logs[0], VERSION);
  assertStringIncludes(err.join("\n"), "could not report its version");
});

Deno.test("--version refuses an untrusted build, and says so", async () => {
  // The trust gate reaches this path too, and a refusal must not be silent:
  // the version on stdout is still the CLI's and still right, but the reason
  // the second line is missing belongs on stderr rather than nowhere.
  const host = new FakeHost();
  const forwarded: string[][] = [];
  let code = 1;
  const err = await capturingErr(async () => {
    code = await main(
      ["--version"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      (_root, denoArgs) => {
        forwarded.push(denoArgs);
        return Promise.resolve(0);
      },
      probeAt(["zuke.json"], { uid: 1000, owner: 0 }),
    );
  });
  assertEquals(code, 0);
  assertEquals(forwarded, []);
  assertEquals(host.logs[0], VERSION);
  assertStringIncludes(err.join("\n"), "owned by user 0");
});

Deno.test("--help inside a project shows both surfaces, each labelled", async () => {
  // The two used to disagree for no visible reason: `zuke --help` described
  // the installed CLI and `./zuke --help` the build, and from inside a project
  // nothing said which you were looking at. Both are shown now, and the
  // build's half is produced by the build rather than re-rendered here.
  const host = new FakeHost();
  const forwarded: string[][] = [];
  const code = await main(
    ["--help"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    (_root, denoArgs) => {
      forwarded.push(denoArgs);
      return Promise.resolve(0);
    },
    probeAt(["zuke.json"]),
  );
  assertEquals(code, 0);
  const logs = host.logs.join("\n");
  // The CLI's own half, under a heading that says it works anywhere.
  assertStringIncludes(logs, "Zuke commands (available anywhere)");
  assertStringIncludes(logs, "setup [options]");
  // …and a heading introducing the build's, before it is asked for.
  assertStringIncludes(logs, "This project's build");
  assertEquals(forwarded, [["run", "-A", "zuke.ts", "--help"]]);
});

Deno.test("--help names a build that ran its help and failed", async () => {
  // The runner returns the build's exit code rather than throwing on one, so
  // a build whose `--help` runs and fails was the one outcome this command
  // passed over without a word: the heading was printed, nothing followed it,
  // and the exit said success. The heading cannot be held back — the build
  // inherits stdio, so there is nothing to inspect first — so the empty
  // section is explained instead.
  const host = new FakeHost();
  let code = 1;
  const err = await capturingErr(async () => {
    code = await main(
      ["--help"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      () => Promise.resolve(2),
      probeAt(["zuke.json"]),
    );
  });
  // Still 0: help is what you reach for when a project is already broken.
  assertEquals(code, 0);
  assertStringIncludes(
    host.logs.join("\n"),
    "Zuke commands (available anywhere)",
  );
  assertStringIncludes(err.join("\n"), "could not describe itself");
});

Deno.test("--help names a build that could not be spawned at all", async () => {
  // The other shape of the same failure: the spawn throws rather than
  // returning a code. Both get the same explanation, so the reader is not
  // left to tell a missing section from an empty one.
  const host = new FakeHost();
  let code = 1;
  const err = await capturingErr(async () => {
    code = await main(
      ["--help"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      () => Promise.reject(new Error("deno could not be started")),
      probeAt(["zuke.json"]),
    );
  });
  assertEquals(code, 0);
  const stderr = err.join("\n");
  // The cause, and what it means for the output.
  assertStringIncludes(stderr, "deno could not be started");
  assertStringIncludes(stderr, "could not describe itself");
});

Deno.test("--help refuses an untrusted build, and says so rather than hiding it", async () => {
  // The help reaches the build now, so the trust gate reaches the help. A
  // refused root must not be reported as an absent one: "there is no build
  // here" would turn a security refusal into a shrug, and the build must not
  // run either way.
  const host = new FakeHost();
  const forwarded: string[][] = [];
  let code = 0;
  const err = await capturingErr(async () => {
    code = await main(
      ["--help"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      (_root, denoArgs) => {
        forwarded.push(denoArgs);
        return Promise.resolve(0);
      },
      // A zuke.json owned by root while we are uid 1000.
      probeAt(["zuke.json"], { uid: 1000, owner: 0 }),
    );
  });
  assertEquals(code, 0);
  // Never executed.
  assertEquals(forwarded, []);
  // The CLI's own half still printed — it does not depend on the build.
  assertStringIncludes(
    host.logs.join("\n"),
    "Zuke commands (available anywhere)",
  );
  // And the refusal was reported, naming the reason, on stderr.
  assertStringIncludes(err.join("\n"), "owned by user 0");
});

Deno.test("--help outside a project says why there is no build section", async () => {
  // Silence would read as "this project has no targets" rather than "you are
  // not in a project", which is a different problem with a different fix.
  const host = new FakeHost();
  const forwarded: string[][] = [];
  const code = await main(
    ["--help"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    (_root, denoArgs) => {
      forwarded.push(denoArgs);
      return Promise.resolve(0);
    },
    probeAt([]),
  );
  assertEquals(code, 0);
  const logs = host.logs.join("\n");
  assertStringIncludes(logs, "Zuke commands (available anywhere)");
  assertStringIncludes(logs, "No zuke.json");
  assertStringIncludes(logs, "zuke setup");
  assertEquals(forwarded, []);
});

Deno.test("main with no arguments runs the default target inside a project, like ./zuke", async () => {
  const host = new FakeHost();
  let seen: string[] | undefined;
  const code = await main(
    [],
    host,
    defaultPrompter,
    undefined,
    undefined,
    (_root, denoArgs) => {
      seen = denoArgs;
      return Promise.resolve(0);
    },
    probeAt(["zuke.json", "deno.lock"]),
  );
  assertEquals(code, 0);
  assertEquals(seen, ["run", "-A", "--frozen", "zuke.ts"]);
  assertEquals(host.logs, []);
});

Deno.test("main with no arguments outside a project prints the help", async () => {
  const host = new FakeHost();
  let called = false;
  const code = await main(
    [],
    host,
    defaultPrompter,
    undefined,
    undefined,
    () => {
      called = true;
      return Promise.resolve(0);
    },
    probeAt([]),
  );
  assertEquals(code, 0);
  assertEquals(called, false);
  assertEquals(host.logs[0].includes("Usage:"), true);
});

Deno.test("main outside a project reports the unknown command and the missing zuke.json", async () => {
  const host = new FakeHost();
  let called = false;
  const code = await main(
    ["ci"],
    host,
    defaultPrompter,
    undefined,
    undefined,
    () => {
      called = true;
      return Promise.resolve(0);
    },
    probeAt([]),
  );
  assertEquals(code, 1);
  assertEquals(called, false);
  assertEquals(host.logs[0].includes("Unknown command: ci"), true);
  assertEquals(host.logs[0].includes("no zuke.json was found"), true);
});

Deno.test("main names the build it forwards to when it is not in the working directory", async () => {
  // A zuke.json at the parent of the cwd: discovery chose it, so stderr says
  // so. (Every other routing test puts it at the cwd, where nothing is said.)
  const parent = absolutePath(Deno.cwd()).parent();
  const present = new Set([parent("zuke.json").path, parent("deno.lock").path]);
  const probe: BuildProbe = {
    exists: (path) => Promise.resolve(present.has(path)),
    ownership: () => Promise.resolve(null),
    uid: () => null,
  };
  const host = new FakeHost();
  let root = "";
  const err = await capturingErr(async () => {
    const code = await main(
      ["ci"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      (at) => {
        root = at;
        return Promise.resolve(0);
      },
      probe,
    );
    assertEquals(code, 0);
  });
  assertEquals(root, parent.path);
  assertEquals(err, [`zuke: running ${parent.path}/zuke.ts`]);
  assertEquals(host.logs, []);
});

Deno.test("main surfaces a runner failure as a clean exit 1 on stderr", async () => {
  // Both forwarding paths — a named command and the bare default-target run
  // — share the handler, so neither can escape as an uncaught throw; and the
  // report goes to stderr, never to the stdout that belongs to the build.
  for (const args of [["ci"], []]) {
    const host = new FakeHost();
    let code = 0;
    const err = await capturingErr(async () => {
      code = await main(
        args,
        host,
        defaultPrompter,
        undefined,
        undefined,
        () => Promise.reject(new Error("spawn failed: deno vanished")),
        // With a lockfile, so the no-lock notice does not share the stream.
        probeAt(["zuke.json", "deno.lock"]),
      );
    });
    assertEquals(code, 1);
    assertEquals(host.logs, []);
    assertEquals(err.length, 1);
    assertEquals(err[0].includes("spawn failed: deno vanished"), true);
  }
});

Deno.test("main refuses to forward into a build owned by another user", async () => {
  // The trust gate's refusal is exit 1 with the advice on stderr — under
  // `zuke mcp` stdout is the JSON-RPC stream — and the runner is never reached.
  const host = new FakeHost();
  const { runner, reached } = neverRun();
  let code = 0;
  const err = await capturingErr(async () => {
    code = await main(
      ["ci"],
      host,
      defaultPrompter,
      undefined,
      undefined,
      runner,
      probeAt(["zuke.json"], { uid: 1000, owner: 0 }),
    );
  });
  assertEquals(code, 1);
  assertEquals(reached(), false);
  assertEquals(host.logs, []);
  assertEquals(err.length, 1);
  assertEquals(err[0].includes("refusing to run the build at"), true);
});

Deno.test("an unknown command cannot forge a workflow command through the real host", async () => {
  // The bug: `Unknown command: <argv>` went out through a bare `console.log`.
  // The runner acts on a line whose first non-blank characters are `::`, and
  // an argument can carry a newline, so the second physical line of the
  // message opened a command. Through the real `defaultHost`, with nothing
  // above the cwd to forward to, asserted over every physical line the runner
  // would read.
  const { runner } = neverRun();
  const { code, out } = await capture(async () => {
    let exit = 0;
    await withEnv({ GITHUB_ACTIONS: "true" }, async () => {
      exit = await main(
        [["typo", "::stop-commands::forged"].join("\n")],
        defaultHost,
        defaultPrompter,
        undefined,
        undefined,
        runner,
        probeAt([]),
      );
    });
    return exit;
  });
  assertEquals(code, 1);
  const lines = out.flatMap((l) => l.split("\n"));
  assertEquals(lines.some((l) => l.trimStart().startsWith("::")), false);
  // Neutralised, not filtered: the text is still there to read.
  assertEquals(
    lines.some((l) => l.startsWith(ENC + "stop-commands::forged")),
    true,
  );
});

Deno.test("a forwarding failure cannot forge a workflow command on stderr", async () => {
  // The catch arm is the sharp end: a spawn failure's message is Deno's, and a
  // refusal names a path from the filesystem — neither is Zuke's text. A
  // message carrying a newline puts the runner's `::` at the start of a line.
  const hostile = ["spawn failed", "::stop-commands::forged"].join("\n");
  let code = 0;
  const err = await capturingErr(() =>
    withEnv({ GITHUB_ACTIONS: "true" }, async () => {
      code = await main(
        ["ci"],
        new FakeHost(),
        defaultPrompter,
        undefined,
        undefined,
        () => Promise.reject(new Error(hostile)),
        probeAt(["zuke.json", "deno.lock"]),
      );
    })
  );
  assertEquals(code, 1);
  const lines = err.flatMap((l) => l.split("\n"));
  assertEquals(lines.some((l) => l.trimStart().startsWith("::")), false);
  assertEquals(lines.includes(ENC + "stop-commands::forged"), true);

  // Off a runner the same message is left readable: nothing is parsing it.
  const local = await capturingErr(() =>
    withEnv({ GITHUB_ACTIONS: undefined }, async () => {
      await main(
        ["ci"],
        new FakeHost(),
        defaultPrompter,
        undefined,
        undefined,
        () => Promise.reject(new Error(hostile)),
        probeAt(["zuke.json", "deno.lock"]),
      );
    })
  );
  assertEquals(local.join("\n").includes("::stop-commands::forged"), true);
});
