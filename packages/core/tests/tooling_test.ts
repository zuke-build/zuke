import {
  assertEquals,
  assertRejects,
  assertThrows,
  messageOf,
} from "./_assert.ts";
import {
  defineTool,
  DynamicToolSettings,
  runSettings,
  shimFallbackArgv,
  ToolNotFoundError,
  ToolSettings,
} from "../src/tooling.ts";
import { CommandError } from "../src/shell.ts";

/** Minimal concrete settings: runs `deno eval <script>` — hermetic. */
class EvalSettings extends ToolSettings {
  #script = "console.log('tool-ok')";

  script(source: string): this {
    this.#script = source;
    return this;
  }

  protected override defaultTool(): string {
    return Deno.execPath();
  }

  protected override buildArgs(): string[] {
    return ["eval", this.#script];
  }
}

Deno.test("argv() is tool + buildArgs + extra args, in order", () => {
  const s = new EvalSettings().script("1").args("--extra", 2);
  assertEquals(s.argv(), [Deno.execPath(), "eval", "1", "--extra", "2"]);
});

Deno.test("toolPath() overrides the default binary", () => {
  const s = new EvalSettings().toolPath("/custom/bin");
  assertEquals(s.argv()[0], "/custom/bin");
});

Deno.test("run() executes and captures output", async () => {
  const out = await new EvalSettings().quiet().run();
  assertEquals(out.code, 0);
  assertEquals(out.stdout.includes("tool-ok"), true);
});

Deno.test("run() applies env and cwd", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Compare the resolved cwd against the target dir *inside* the subprocess,
    // so both paths are normalised by the same realPath in the same process.
    // A plain string match is unreliable cross-platform (macOS temp symlinks,
    // Windows drive-letter casing and 8.3 short vs long names).
    const script = `console.log(Deno.env.get('ZUKE_T') + ':' + ` +
      `(Deno.realPathSync(Deno.cwd()) === Deno.realPathSync(${
        JSON.stringify(dir)
      })))`;
    const out = await new EvalSettings()
      .script(script)
      .env({ ZUKE_T: "v1" })
      .cwd(dir)
      .quiet()
      .run();
    assertEquals(out.stdout.includes("v1:true"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("run() throws CommandError on non-zero exit", async () => {
  await assertRejects(
    () => new EvalSettings().script("Deno.exit(3)").quiet().run(),
    CommandError,
    "exit 3",
  );
});

Deno.test("noThrow() suppresses the non-zero throw", async () => {
  const out = await new EvalSettings()
    .script("Deno.exit(3)")
    .noThrow()
    .quiet()
    .run();
  assertEquals(out.code, 3);
});

Deno.test("missing binary without a shim raises ToolNotFoundError", async () => {
  const s = new EvalSettings().toolPath("zuke-no-such-tool-xyz");
  s.os_ = "linux"; // force the no-fallback path on every platform
  const err = await assertRejects(() => s.run(), ToolNotFoundError);
  assertEquals(messageOf(err).includes("zuke-no-such-tool-xyz"), true);
  assertEquals(messageOf(err).includes("toolPath"), true);
});

Deno.test({
  name: "missing binary on windows retries via cmd /c, then reports the tool",
  // On real Windows `cmd` exists and yields a CommandError instead; the
  // retry construction itself is covered by the shimFallbackArgv tests.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const s = new EvalSettings().toolPath("zuke-no-such-tool-xyz");
    s.os_ = "windows"; // forces the cmd /c retry; `cmd` is absent here
    await assertRejects(() => s.run(), ToolNotFoundError, "zuke-no-such");
  },
});

Deno.test("non-NotFound spawn errors propagate unchanged", async () => {
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

Deno.test("shimFallbackArgv wraps with cmd /c on windows only", () => {
  assertEquals(shimFallbackArgv(["npm", "-v"], "windows"), [
    "cmd",
    "/c",
    "npm",
    "-v",
  ]);
  assertEquals(shimFallbackArgv(["npm", "-v"], "linux"), null);
  assertEquals(shimFallbackArgv(["npm", "-v"], "darwin"), null);
});

Deno.test("runSettings runs unconfigured settings when no lambda given", async () => {
  const out = await runSettings(new EvalSettings().quiet());
  assertEquals(out.stdout.includes("tool-ok"), true);
});

Deno.test("runSettings applies the configure lambda", async () => {
  const out = await runSettings(
    new EvalSettings(),
    (s) => s.script("console.log('configured')").quiet(),
  );
  assertEquals(out.stdout.includes("configured"), true);
});

Deno.test("a subclass can reject invalid settings from buildArgs", () => {
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

Deno.test("defineTool: binary, then arg/flag/option in call order", () => {
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

Deno.test("defineTool: short flags and pre-dashed names are left as-is", () => {
  const s = new DynamicToolSettings("x");
  s.flag("-v").option("-o", "f").flag("--long");
  assertEquals(s.argv().slice(1), ["-v", "-o", "f", "--long"]);
});

Deno.test("defineTool: subcommand prepends a leading token (string or array)", () => {
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

Deno.test("defineTool: numeric args/options are coerced to strings", () => {
  const s = new DynamicToolSettings("x");
  s.arg(1).option("port", 8080);
  assertEquals(s.argv().slice(1), ["1", "--port", "8080"]);
});

/** Force the no-shim-fallback path so a missing binary throws on every OS. */
const onLinux = (s: DynamicToolSettings): DynamicToolSettings => {
  s.os_ = "linux";
  return s;
};

Deno.test("defineTool: base chainers still apply; reaches execution", async () => {
  const tool = defineTool("zuke-no-such-tool-xyz", { subcommand: "go" });
  await assertRejects(
    () => tool((s) => onLinux(s).arg("x")),
    ToolNotFoundError,
  );
});

Deno.test("defineTool: subcommand array initial tokens drive a real run", async () => {
  // Exercise the array-subcommand path through the task closure.
  const tool = defineTool("zuke-no-such-tool-xyz", { subcommand: ["a", "b"] });
  await assertRejects(() => tool(onLinux), ToolNotFoundError);
});
