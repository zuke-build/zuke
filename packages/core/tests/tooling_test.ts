// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { EnvTasks, FileTasks, type HostOs, RuntimeTasks } from "../mod.ts";
import { test } from "../../../tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
  messageOf,
} from "../../../tests/_assert.ts";
import {
  defineTool,
  DynamicToolSettings,
  runSettings,
  shimFallbackArgv,
  SubcommandSettings,
  ToolNotFoundError,
  ToolSettings,
  windowsCmdShim,
} from "../src/tooling.ts";
import { withAmbientRedactor } from "../src/ambient_redactor.ts";
import { REDACTED, Redactor } from "../src/redact.ts";
import {
  CommandError,
  type CommandOutput,
  CommandTimeoutError,
} from "../src/shell.ts";
import { withTemp } from "../../../tests/_temp.ts";
import { EVAL } from "../../../tests/_eval.ts";

/** Minimal concrete settings: runs `deno eval <script>` — hermetic. */
class EvalSettings extends ToolSettings {
  #script = "console.log('tool-ok')";

  script(source: string): this {
    this.#script = source;
    return this;
  }

  protected override defaultTool(): string {
    return RuntimeTasks.execPath();
  }

  protected override buildArgs(): string[] {
    return [EVAL, this.#script];
  }
}

/**
 * The same, but supplying standard input — the shape a wrapper takes to reach
 * a tool's stdin form (`docker login --password-stdin` and its kin).
 */
class StdinEvalSettings extends EvalSettings {
  #input?: string;

  input(text: string): this {
    this.#input = text;
    return this;
  }

  protected override stdinInput(): string | undefined {
    return this.#input;
  }
}

/** A script that echoes everything it is given on stdin, prefixed. */
const ECHO_STDIN =
  "const b = new Uint8Array(1024); const n = process.getBuiltinModule('node:fs').readSync(0, b); " +
  "console.log('got:' + new TextDecoder().decode(b.subarray(0, n)).trim())";

test("argv() is tool + buildArgs + extra args, in order", () => {
  const s = new EvalSettings().script("1").args("--extra", 2);
  assertEquals(s.argv(), [RuntimeTasks.execPath(), EVAL, "1", "--extra", "2"]);
});

test("toolPath() overrides the default binary", () => {
  const s = new EvalSettings().toolPath("/custom/bin");
  assertEquals(s.argv()[0], "/custom/bin");
});

test("run() executes and captures output", async () => {
  const out = await new EvalSettings().quiet().run();
  assertEquals(out.code, 0);
  assertEquals(out.stdout.includes("tool-ok"), true);
});

test("run() applies env and cwd", async () => {
  await withTemp(async (dir) => {
    // Compare the resolved cwd against the target dir *inside* the subprocess,
    // so both paths are normalised by the same realPath in the same process.
    // A plain string match is unreliable cross-platform (macOS temp symlinks,
    // Windows drive-letter casing and 8.3 short vs long names).
    const script = "const fs = process.getBuiltinModule('node:fs'); " +
      `console.log(process.env['ZUKE_T'] + ':' + ` +
      `(fs.realpathSync.native(process.cwd()) === fs.realpathSync.native(${
        JSON.stringify(dir)
      })))`;
    const out = await new EvalSettings()
      .script(script)
      .env({ ZUKE_T: "v1" })
      .cwd(dir)
      .quiet()
      .run();
    assertEquals(out.stdout.includes("v1:true"), true);
  });
});

test("run() throws CommandError on non-zero exit", async () => {
  await assertRejects(
    () => new EvalSettings().script("process.exit(3)").quiet().run(),
    CommandError,
    "exit 3",
  );
});

test("killAfter() kills a slow tool run", async () => {
  await assertRejects(
    () =>
      new EvalSettings()
        .script("await new Promise((r) => setTimeout(r, 30000))")
        .quiet()
        .killAfter(100)
        .run(),
    CommandTimeoutError,
  );
});

test("maxCapturedBytes() caps a tool run's captured output at the tail", async () => {
  // Every wrapper funnels through ToolSettings, so the cap has to be settable
  // there too — otherwise a wrapper whose whole output is parsed is stuck with
  // the 8 MiB default and silently receives only the tail.
  const emit =
    `for (let i = 0; i < 40; i++) console.log(String(i).padStart(4, "0") + "x".repeat(1019));`;
  const out = await new EvalSettings()
    .script(emit)
    .quiet()
    .maxCapturedBytes(4096)
    .run();
  assertEquals(out.truncated, true);
  assertEquals(out.maxCapturedBytes, 4096);
  assertEquals(out.stdout.length <= 4096, true, `kept ${out.stdout.length}`);
  assertEquals(out.stdout.includes("0039"), true); // the tail survived…
  assertEquals(out.stdout.includes("0000"), false); // …not the head.
});

test("maxCapturedBytes() leaves output under the cap whole", async () => {
  const out = await new EvalSettings()
    .quiet()
    .maxCapturedBytes(64 * 1024 * 1024) // raised well above the default
    .run();
  assertEquals(out.truncated, false);
  assertEquals(out.stdout.includes("tool-ok"), true);
});

test("maxCapturedBytes() rejects a cap capture cannot honour", () => {
  const err = assertThrows(
    () => new EvalSettings().maxCapturedBytes(-1),
    RangeError,
  );
  assertEquals(messageOf(err).includes("maxCapturedBytes"), true);
});

test("noThrow() suppresses the non-zero throw", async () => {
  const out = await new EvalSettings()
    .script("process.exit(3)")
    .noThrow()
    .quiet()
    .run();
  assertEquals(out.code, 3);
});

test("missing binary without a shim raises ToolNotFoundError", async () => {
  const s = new EvalSettings().toolPath("zuke-no-such-tool-xyz");
  s.os_ = "linux"; // force the no-fallback path on every platform
  const err = await assertRejects(() => s.run(), ToolNotFoundError);
  assertEquals(messageOf(err).includes("zuke-no-such-tool-xyz"), true);
  assertEquals(messageOf(err).includes("toolPath"), true);
});

test({
  name: "a missing binary on windows reports the tool, with no cmd /c retry",
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    const s = new EvalSettings().toolPath("zuke-no-such-tool-xyz");
    s.os_ = "windows";
    await assertRejects(() => s.run(), ToolNotFoundError, "zuke-no-such");
  },
});

test({
  name: "run() spawns a batch shim itself rather than wrapping it in cmd /c",
  // Wrapping handed cmd.exe one command line quoted by C-runtime rules, which
  // leave `&` bare, so a caller operand could be re-parsed as a command. The
  // shim is spawned directly instead. Proven here without Windows: a file
  // named `.cmd` whose shebang makes it executable runs only if it is the
  // process being spawned — a `cmd /c` wrap would look for `cmd` and fail.
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    await withTemp(async (dir) => {
      const shim = `${dir}/tool.cmd`;
      await FileTasks.writeText(
        shim,
        '#!/bin/sh\nfor a in "$@"; do echo "arg:$a"; done\n',
      );
      await FileTasks.chmod(shim, 0o755);

      const s = new EvalSettings().toolPath(shim).args("A=1&whoami").quiet();
      s.os_ = "windows"; // the branch that used to wrap
      const out = await s.run();

      assertEquals(out.code, 0);
      // The metacharacter arrived as exactly one argument, not as a second
      // command, and the shim itself is what ran.
      assertEquals(out.stdout.includes("arg:A=1&whoami"), true);
    });
  },
});

test("non-NotFound spawn errors propagate unchanged", async () => {
  // An empty command is a plain Error from Command, not a NotFound.
  class EmptySettings extends ToolSettings {
    protected override defaultTool(): string {
      return "";
    }
    protected override buildArgs(): string[] {
      return [];
    }
  }
  await assertRejects(() => new EmptySettings().run(), Error, "empty");
});

/** Create `node_modules/.bin/<name>` under `dir` and return its path. */
async function plantBin(dir: string, name: string): Promise<string> {
  const binDir = `${dir}/node_modules/.bin`;
  await FileTasks.createDirectory(binDir);
  const path = `${binDir}/${name}`;
  await FileTasks.writeText(path, "#!/bin/sh\n");
  return path.replace(/\\/g, "/");
}

/**
 * A wrapper whose binary is resolved from `node_modules` by default. The
 * platform is pinned to `linux` so the walk/precedence tests match a planted
 * bare shim regardless of the host OS; the Windows `.cmd`/`.bat` matching has
 * its own tests that set `os_ = "windows"` explicitly.
 */
class NodeToolSettings extends ToolSettings {
  override os_: HostOs = "linux";
  protected override defaultTool(): string {
    return "mytool";
  }
  protected override buildArgs(): string[] {
    return ["run"];
  }
  protected override defaultResolution(): "node_modules" | "path" {
    return "node_modules";
  }
}

test("fromNodeModules resolves a hoisted bin by walking up", () =>
  withTemp(async (root) => {
    const bin = await plantBin(root, "mytool");
    await FileTasks.createDirectory(`${root}/a/b`);
    // The bin lives at the root; the cwd is two levels down → the walk finds it.
    const node = new NodeToolSettings().cwd(`${root}/a/b`);
    assertEquals(node.resolvedArgv(), [bin, "run"]);
  }));

test("resolution falls back to the bare name on a miss", () =>
  withTemp((root) => {
    const s = new NodeToolSettings().cwd(root);
    assertEquals(s.resolvedArgv(), ["mytool", "run"]);
  }));

test("fromPath ignores a present node_modules/.bin", () =>
  withTemp(async (root) => {
    await plantBin(root, "mytool");
    const s = new NodeToolSettings().cwd(root).fromPath();
    assertEquals(s.resolvedArgv(), ["mytool", "run"]);
  }));

test("an explicit toolPath wins over node_modules resolution", () =>
  withTemp(async (root) => {
    await plantBin(root, "mytool");
    const s = new NodeToolSettings().cwd(root).toolPath("/custom/mytool");
    assertEquals(s.resolvedArgv(), ["/custom/mytool", "run"]);
  }));

test("ZUKE_TOOL_RESOLUTION flips a path-default wrapper repo-wide", () =>
  withTemp(async (root) => {
    const prev = EnvTasks.get("ZUKE_TOOL_RESOLUTION");
    try {
      const bin = await plantBin(root, "mytool");
      // A "path"-default wrapper; the ambient override switches it on. Pinned to
      // linux so the planted bare shim matches regardless of the host OS.
      class MyTool extends ToolSettings {
        override os_: HostOs = "linux";
        protected override defaultTool(): string {
          return "mytool";
        }
        protected override buildArgs(): string[] {
          return [];
        }
      }
      EnvTasks.set("ZUKE_TOOL_RESOLUTION", "node_modules");
      assertEquals(new MyTool().cwd(root).resolvedArgv(), [bin]);
      // A per-call .fromPath() still beats the ambient override.
      assertEquals(new MyTool().cwd(root).fromPath().resolvedArgv(), [
        "mytool",
      ]);
      // And "path" turns a node_modules-default wrapper back off.
      EnvTasks.set("ZUKE_TOOL_RESOLUTION", "path");
      assertEquals(new NodeToolSettings().cwd(root).resolvedArgv(), [
        "mytool",
        "run",
      ]);
      // An unrecognised value is ignored (default wins).
      EnvTasks.set("ZUKE_TOOL_RESOLUTION", "bogus");
      assertEquals(new NodeToolSettings().cwd(root).resolvedArgv(), [
        bin,
        "run",
      ]);
    } finally {
      if (prev === undefined) EnvTasks.delete("ZUKE_TOOL_RESOLUTION");
      else EnvTasks.set("ZUKE_TOOL_RESOLUTION", prev);
    }
  }));

test("windows resolution matches the .cmd shim, not the bare shim", () =>
  withTemp(async (root) => {
    const cmd = await plantBin(root, "mytool.cmd");
    await plantBin(root, "mytool"); // the bare shim (no extension) is ignored
    const s = new NodeToolSettings().cwd(root);
    s.os_ = "windows";
    assertEquals(s.resolvedArgv(), [cmd, "run"]);
  }));

test("windows resolution ignores a bare-only shim", () =>
  withTemp(async (root) => {
    await plantBin(root, "mytool"); // no .cmd/.bat → Windows cannot launch it
    const s = new NodeToolSettings().cwd(root);
    s.os_ = "windows";
    assertEquals(s.resolvedArgv(), ["mytool", "run"]); // falls back to PATH
  }));

test("windowsCmdShim wraps .cmd/.bat via cmd /c on windows only", () => {
  assertEquals(windowsCmdShim(["C:/x/foo.cmd", "-v"], "windows"), [
    "cmd",
    "/c",
    "C:/x/foo.cmd",
    "-v",
  ]);
  assertEquals(windowsCmdShim(["C:/x/foo.BAT"], "windows"), [
    "cmd",
    "/c",
    "C:/x/foo.BAT",
  ]);
  // A plain executable is left alone, and non-windows never wraps.
  assertEquals(windowsCmdShim(["foo.exe", "-v"], "windows"), ["foo.exe", "-v"]);
  assertEquals(windowsCmdShim(["/n/foo.cmd"], "linux"), ["/n/foo.cmd"]);
  assertEquals(windowsCmdShim([], "windows"), []);
});

test("the lookup is memoized per (tool, cwd)", () =>
  withTemp(async (root) => {
    const s = new NodeToolSettings().cwd(root);
    assertEquals(s.resolvedArgv(), ["mytool", "run"]); // miss, memoized
    await plantBin(root, "mytool"); // planted *after* the first lookup
    assertEquals(s.resolvedArgv(), ["mytool", "run"]); // still the cached miss
  }));

test("ToolNotFoundError hints at npm ci when node_modules lacked the bin", () =>
  withTemp(async (root) => {
    await FileTasks.createDirectory(`${root}/node_modules`);
    // A bare tool name that does not exist, so the spawn fails NotFound while
    // a node_modules directory was seen during the walk.
    class Missing extends ToolSettings {
      protected override defaultTool(): string {
        return "zuke-no-such-tool-xyz";
      }
      protected override buildArgs(): string[] {
        return [];
      }
    }
    const miss = new Missing().cwd(root).fromNodeModules();
    miss.os_ = "linux";
    const err = await assertRejects(() => miss.run(), ToolNotFoundError);
    assertEquals(messageOf(err).includes("node_modules"), true);
    assertEquals(messageOf(err).includes("npm ci"), true);
  }));

test("shimFallbackArgv wraps with cmd /c on windows only", () => {
  assertEquals(shimFallbackArgv(["npm", "-v"], "windows"), [
    "cmd",
    "/c",
    "npm",
    "-v",
  ]);
  assertEquals(shimFallbackArgv(["npm", "-v"], "linux"), null);
  assertEquals(shimFallbackArgv(["npm", "-v"], "darwin"), null);
});

test("runSettings runs unconfigured settings when no lambda given", async () => {
  const out = await runSettings(new EvalSettings().quiet());
  assertEquals(out.stdout.includes("tool-ok"), true);
});

test("runSettings applies the configure lambda", async () => {
  const out = await runSettings(
    new EvalSettings(),
    (s) => s.script("console.log('configured')").quiet(),
  );
  assertEquals(out.stdout.includes("configured"), true);
});

test("a subclass can reject invalid settings from buildArgs", () => {
  class NeedsValue extends ToolSettings {
    protected override defaultTool(): string {
      return "x";
    }
    protected override buildArgs(): string[] {
      throw new Error("NeedsValue: .value() is required.");
    }
  }
  assertThrows(
    () => new NeedsValue().argv(),
    Error,
    ".value() is required",
  );
});

test("defineTool: binary, then arg/flag/option in call order", () => {
  const tool = defineTool("mytool");
  // The task closes over a fresh settings each call; build one directly to
  // inspect argv via the configure lambda.
  const s = new DynamicToolSettings("mytool");
  s.arg("build").option("output", "dist").flag("verbose").arg("src");
  assertEquals(s.argv(), [
    "mytool",
    "build",
    "--output",
    "dist",
    "--verbose",
    "src",
  ]);
  assertEquals(typeof tool, "function");
});

test("defineTool: short flags and pre-dashed names are left as-is", () => {
  const s = new DynamicToolSettings("x");
  s.flag("-v").option("-o", "f").flag("--long");
  assertEquals(s.argv().slice(1), ["-v", "-o", "f", "--long"]);
});

test("defineTool: subcommand prepends a leading token (string or array)", () => {
  assertEquals(
    new DynamicToolSettings("helm", ["upgrade"]).arg("api").argv().slice(1),
    ["upgrade", "api"],
  );
  // defineTool normalizes its subcommand option to the initial tokens.
  const one = defineTool("git", { subcommand: "status" });
  const many = defineTool("docker", { subcommand: ["image", "ls"] });
  assertEquals(typeof one, "function");
  assertEquals(typeof many, "function");
});

test("defineTool: numeric args/options are coerced to strings", () => {
  const s = new DynamicToolSettings("x");
  s.arg(1).option("port", 8080);
  assertEquals(s.argv().slice(1), ["1", "--port", "8080"]);
});

/** Force the no-shim-fallback path so a missing binary throws on every OS. */
const onLinux = (s: DynamicToolSettings): DynamicToolSettings => {
  s.os_ = "linux";
  return s;
};

test("defineTool: base chainers still apply; reaches execution", async () => {
  const tool = defineTool("zuke-no-such-tool-xyz", { subcommand: "go" });
  await assertRejects(
    () => tool((s) => onLinux(s).arg("x")),
    ToolNotFoundError,
  );
});

test("defineTool: subcommand array initial tokens drive a real run", async () => {
  // Exercise the array-subcommand path through the task closure.
  const tool = defineTool("zuke-no-such-tool-xyz", { subcommand: ["a", "b"] });
  await assertRejects(() => tool(onLinux), ToolNotFoundError);
});

test("SubcommandSettings: command path + flags, no leading/middle by default", () => {
  class Sub extends SubcommandSettings {
    protected override defaultTool(): string {
      return "tool";
    }
  }
  const s = new Sub().command("pr", "create").flag("title", "v1").flag("draft");
  // [tool, ...command, ...flags] — leadingTokens()/middleTokens() default to [].
  assertEquals(s.argv(), ["tool", "pr", "create", "--title", "v1", "--draft"]);
  // A numeric flag value is coerced to a string.
  assertEquals(new Sub().flag("port", 8080).argv().slice(1), [
    "--port",
    "8080",
  ]);
});

test("SubcommandSettings: leadingTokens and middleTokens bracket the command", () => {
  class Sub extends SubcommandSettings {
    protected override defaultTool(): string {
      return "tool";
    }
    protected override leadingTokens(): string[] {
      return ["mcp"];
    }
    protected override middleTokens(): string[] {
      return ["--repo", "o/r"];
    }
  }
  const s = new Sub().command("add", "x").flag("json");
  // [tool, ...leading, ...command, ...middle, ...flags].
  assertEquals(s.argv().slice(1), [
    "mcp",
    "add",
    "x",
    "--repo",
    "o/r",
    "--json",
  ]);
});

/** Settings that record what {@link ToolSettings.onOutput} was handed. */
class ObservingSettings extends EvalSettings {
  readonly seen: Array<{ code: number; stdout: string }> = [];
  protected override onOutput(output: { code: number; stdout: string }): void {
    this.seen.push({ code: output.code, stdout: output.stdout.trim() });
  }
}

test("onOutput sees the output of a successful run", async () => {
  const s = new ObservingSettings().quiet();
  const out = await s.run();
  assertEquals(out.code, 0);
  assertEquals(s.seen, [{ code: 0, stdout: "tool-ok" }]);
});

test("onOutput sees a failed run's output before the CommandError is raised", async () => {
  const s = new ObservingSettings()
    .script("console.log('partial'); process.exit(3)")
    .quiet();
  await assertRejects(() => s.run(), CommandError, "exit 3");
  assertEquals(s.seen, [{ code: 3, stdout: "partial" }]);
});

test("onOutput runs once under noThrow too, and the output is returned", async () => {
  const s = new ObservingSettings()
    .script("console.log('partial'); process.exit(3)")
    .noThrow()
    .quiet();
  const out = await s.run();
  assertEquals(out.code, 3);
  assertEquals(s.seen, [{ code: 3, stdout: "partial" }]);
});

test("markSecret masks a credential a tool only takes as an argument", async () => {
  // Some tools have no stdin form, so the value must ride in argv. This does not
  // hide it from the process table — nothing can — but it keeps it out of every
  // rendered form of the command: the dry-run echo, a CommandError, a recorded
  // service line.
  class TokenSettings extends ToolSettings {
    #token = "";
    token(value: string): this {
      this.#token = value;
      this.markSecret(value);
      return this;
    }
    protected override defaultTool(): string {
      return RuntimeTasks.execPath();
    }
    protected override buildArgs(): string[] {
      return [
        EVAL,
        `console.log(${JSON.stringify(this.#token)})`,
      ];
    }
  }

  const redactor = new Redactor();
  await withAmbientRedactor(redactor, () => {
    const settings = new TokenSettings().token("hunter2");
    assertEquals(redactor.size > 0, true);
    assertEquals(redactor.redact("token=hunter2"), `token=${REDACTED}`);
    return Promise.resolve(settings);
  });
});

test("markSecret outside a run is a no-op, not a crash", async () => {
  // A wrapper used standalone in a script has no redactor to register with. It
  // should still work — with nothing masking its output, which is the honest
  // outcome rather than a failure.
  class TokenSettings extends ToolSettings {
    token(value: string): this {
      this.markSecret(value);
      return this;
    }
    protected override defaultTool(): string {
      return RuntimeTasks.execPath();
    }
    protected override buildArgs(): string[] {
      return [EVAL, "console.log('ok')"];
    }
  }
  new TokenSettings().token("hunter2");
  await Promise.resolve();
});

/**
 * A credential-bearing tool: it prints `script`'s output, and registers the
 * secrets in it — under `SecretString`, unless the caller queried.
 */
class SecretEvalSettings extends EvalSettings {
  /** Whether the caller set a query, as a wrapper's `--query` would. */
  queried = false;

  protected override onOutput(output: CommandOutput): void {
    this.markSecretsInOutput(
      output.stdout,
      (s) => s.keys("SecretString").queried(this.queried),
    );
  }
}

test("markSecretsInOutput registers the secrets a tool printed", async () => {
  const redactor = new Redactor();
  const printed = JSON.stringify({
    Name: "prod/db",
    SecretString: "aaaaaaaa1",
  });
  await withAmbientRedactor(redactor, async () => {
    await new SecretEvalSettings()
      .script(`console.log(${JSON.stringify(printed)})`)
      .quiet()
      .run();
  });
  assertEquals(redactor.redact("pw=aaaaaaaa1"), `pw=${REDACTED}`);
  // Only the secret: the secret's name is ordinary output.
  assertEquals(redactor.redact("prod/db"), "prod/db");
});

test("markSecretsInOutput goes through markSecret, with or without a lambda", () => {
  class Recording extends EvalSettings {
    readonly marked: string[] = [];
    protected override markSecret(value: string): void {
      this.marked.push(value);
    }
    register(stdout: string, keys?: string[]): string[] {
      if (keys === undefined) this.markSecretsInOutput(stdout);
      else this.markSecretsInOutput(stdout, (s) => s.keys(...keys));
      return this.marked;
    }
  }
  assertEquals(new Recording().register("aaaaaaaaaaaa\n"), ["aaaaaaaaaaaa"]);
  assertEquals(
    new Recording().register('{"value":"pin1","other":"bbbbbbbbbb"}', [
      "value",
    ]),
    ["pin1"],
  );
  assertEquals(new Recording().register(""), []);
});

test("markSecretsInOutput outside a run is a no-op, not a crash", async () => {
  const out = await new SecretEvalSettings()
    .script("console.log('\"aaaaaaaa1\"')")
    .quiet()
    .run();
  assertEquals(out.code, 0);
});

test("L3: markSecretsInOutput does not read the output outside a run", async () => {
  // The base markSecret registers nothing without a redactor, so the search
  // is skipped: the lambda describing the output is never even called.
  class Counting extends EvalSettings {
    calls = 0;
    register(stdout: string): void {
      this.markSecretsInOutput(stdout, (s) => {
        this.calls++;
        return s;
      });
    }
  }
  const outside = new Counting();
  outside.register("aaaaaaaa1");
  assertEquals(outside.calls, 0);
  const inside = new Counting();
  const redactor = new Redactor();
  await withAmbientRedactor(redactor, () => {
    inside.register("aaaaaaaa1");
    return Promise.resolve();
  });
  assertEquals(inside.calls, 1);
  assertEquals(redactor.redact("aaaaaaaa1"), REDACTED);
});

test("stdinInput() reaches the tool's standard input", async () => {
  // A real pipe, not an argv assertion: what is being proved is that the text
  // arrives on the child's stdin, which only a subprocess can show.
  const out = await new StdinEvalSettings()
    .script(ECHO_STDIN)
    .input("hunter2")
    .quiet()
    .run();
  assertEquals(out.code, 0);
  assertEquals(out.stdout.includes("got:hunter2"), true);
});

test("stdin text stays out of every rendering of the command", async () => {
  // The whole point of preferring this over markSecret: the secret is not on
  // the command line, so nothing that renders the command line can leak it.
  const settings = new StdinEvalSettings()
    .script("process.exit(7)")
    .input("hunter2")
    .quiet();
  const error = await assertRejects(
    () => settings.run(),
    CommandError,
    "exit 7",
  );
  assertEquals(messageOf(error).includes("hunter2"), false);
  assertEquals(settings.argv().some((a) => a.includes("hunter2")), false);
});

test("the base supplies no stdin, so every existing wrapper is unchanged", () => {
  // The default arm, asserted on the contract rather than on a subprocess.
  // Whether the spawn inherits stdin is `Command`'s decision, keyed on this
  // returning undefined, and it is already covered where that decision lives.
  // What belongs here is that the base returns undefined at all: a base
  // returning an empty string would compile, would read as harmless, and would
  // switch every wrapper in the workspace from inherited stdin to a pipe that
  // closes immediately.
  //
  // Driving it through a subprocess instead would prove nothing: inherited
  // stdin under `deno test` is whatever the runner happened to have, so the
  // assertion would hold either way.
  class PeekSettings extends EvalSettings {
    peek(): string | undefined {
      return this.stdinInput();
    }
  }
  assertEquals(new PeekSettings().peek(), undefined);
});
