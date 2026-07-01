import { ConsoleTasks, type Sink } from "../src/console.ts";
import { defaultTheme } from "../src/theme.ts";
import { SGR, stripAnsi, visibleWidth } from "@zuke/core/render";
import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";

/** Capture output with colour off and a fixed width, at the given level. */
function capture(
  overrides: Parameters<typeof ConsoleTasks.configure>[0] = {},
): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const sink: Sink = { out: (l) => out.push(l), err: (l) => err.push(l) };
  ConsoleTasks.configure({
    sink,
    color: false,
    width: 20,
    github: false,
    level: "trace",
    ...overrides,
  });
  return { out, err };
}

Deno.test("info/success/debug/trace print an icon and message to stdout", () => {
  const { out } = capture();
  ConsoleTasks.info("hello");
  ConsoleTasks.log("aliased");
  ConsoleTasks.success("done");
  ConsoleTasks.debug("dbg");
  ConsoleTasks.trace("trc");
  assertEquals(out, ["ℹ hello", "ℹ aliased", "✔ done", "› dbg", "· trc"]);
  ConsoleTasks.reset();
});

Deno.test("warn and error go to stderr; error appends the cause", () => {
  const { out, err } = capture();
  ConsoleTasks.warn("careful");
  ConsoleTasks.error("boom", { error: new Error("root cause") });
  assertEquals(out, []);
  assertEquals(err, ["⚠ careful", "✖ boom", "  root cause"]);
  ConsoleTasks.reset();
});

Deno.test("error stringifies a non-Error cause", () => {
  const { err } = capture();
  ConsoleTasks.error("nope", { error: "just a string" });
  assertEquals(err, ["✖ nope", "  just a string"]);
  ConsoleTasks.reset();
});

Deno.test("the level gates lower-severity messages", () => {
  const { out, err } = capture({ level: "warn" });
  ConsoleTasks.info("hidden");
  ConsoleTasks.debug("hidden");
  ConsoleTasks.warn("shown");
  assertEquals(ConsoleTasks.level(), "warn");
  assertEquals(out, []);
  assertEquals(err, ["⚠ shown"]);
  ConsoleTasks.reset();
});

Deno.test("markup and theme tokens colour the message when colour is on", () => {
  const { out } = capture({ color: true });
  ConsoleTasks.info("a [bold]b[/] [success]c[/]");
  assertStringIncludes(out[0], SGR.bold);
  assertStringIncludes(out[0], SGR.green); // [success] -> theme green
  ConsoleTasks.reset();
});

Deno.test("GitHub Actions mode emits workflow commands for warn/error", () => {
  const { out, err } = capture({ github: true });
  ConsoleTasks.info("plain");
  ConsoleTasks.warn("heads up");
  ConsoleTasks.error("bad", { error: new Error("why") });
  assertEquals(out, ["ℹ plain"]);
  assertEquals(err, ["::warning::heads up", "::error::bad: why"]);
  ConsoleTasks.reset();
});

Deno.test("line and rule draw across the configured width", () => {
  const { out } = capture();
  ConsoleTasks.line();
  ConsoleTasks.rule();
  ConsoleTasks.rule("Deploy");
  assertEquals(out[0], "═".repeat(20));
  assertEquals(out[1], "═".repeat(20));
  assertEquals(out[2], "═".repeat(6) + " Deploy " + "═".repeat(6));
  ConsoleTasks.reset();
});

Deno.test("a rule with too little room falls back to a plain line", () => {
  const { out } = capture({ width: 6 });
  ConsoleTasks.rule("wide-title");
  assertEquals(out[0], "═".repeat(6));
  ConsoleTasks.reset();
});

Deno.test("box frames markup-rendered content", () => {
  const { out } = capture();
  ConsoleTasks.box("[red]hi[/]", { padding: 1 });
  assertEquals(out, ["┌────┐", "│ hi │", "└────┘"]);
  ConsoleTasks.reset();
});

Deno.test("box accepts an array of lines", () => {
  const { out } = capture();
  ConsoleTasks.box(["a", "bb"], { padding: 0 });
  assertEquals(out, ["┌──┐", "│a │", "│bb│", "└──┘"]);
  ConsoleTasks.reset();
});

Deno.test("table renders headers and cells with markup stripped", () => {
  const { out } = capture();
  ConsoleTasks.table(
    [{ header: "Target" }, { header: "Time", align: "right" }],
    [["[bold]lint[/]", "1s"]],
    { divider: false },
  );
  assertEquals(out, ["Target  Time", "lint      1s"]);
  ConsoleTasks.reset();
});

Deno.test("header and summary reuse Zuke's own build banners", () => {
  const { out } = capture();
  ConsoleTasks.header("build");
  assertEquals(out, ["═".repeat(20), "build", "═".repeat(20)]);
  out.length = 0;
  ConsoleTasks.summary(
    [{ name: "lint", status: "passed", ms: 1000 }],
    1000,
    true,
  );
  assertStringIncludes(out.join("\n"), "Build Summary");
  assertStringIncludes(out.join("\n"), "Build succeeded");
  ConsoleTasks.reset();
});

Deno.test("group and endGroup adapt to GitHub Actions", () => {
  const gh = capture({ github: true });
  ConsoleTasks.group("Build");
  ConsoleTasks.endGroup();
  assertEquals(gh.out, ["::group::Build", "::endgroup::"]);

  const term = capture({ github: false });
  ConsoleTasks.group("Build");
  ConsoleTasks.endGroup(); // no output outside Actions
  assertEquals(term.out.length, 1);
  assertStringIncludes(term.out[0], "Build");
  ConsoleTasks.reset();
});

Deno.test("silent level suppresses logs and structural output alike", () => {
  const { out, err } = capture({ level: "silent" });
  ConsoleTasks.error("hush");
  ConsoleTasks.line();
  ConsoleTasks.rule("x");
  ConsoleTasks.box("y");
  ConsoleTasks.table([{ header: "H" }], [["v"]]);
  ConsoleTasks.header("h");
  ConsoleTasks.summary([], 0, true);
  ConsoleTasks.group("g");
  ConsoleTasks.endGroup();
  assertEquals(out, []);
  assertEquals(err, []);
  ConsoleTasks.reset();
});

Deno.test("a custom theme recolours the palette", () => {
  const { out } = capture({
    color: true,
    theme: { ...defaultTheme, info: ["magenta"] },
  });
  ConsoleTasks.info("hi");
  assertStringIncludes(out[0], SGR.magenta);
  ConsoleTasks.reset();
});

Deno.test("without overrides, the style is auto-detected", () => {
  ConsoleTasks.reset(); // clears every override → auto colour/width/github
  const out: string[] = [];
  ConsoleTasks.configure({
    sink: { out: (l) => out.push(l), err: () => {} },
    level: "trace",
  });
  ConsoleTasks.line();
  // The test process is not a TTY, so colour is off and the width is clamped.
  assertEquals(/^═+$/.test(stripAnsi(out[0])), true);
  const width = visibleWidth(out[0]);
  assertEquals(width >= 40 && width <= 80, true);
  ConsoleTasks.reset();
});

Deno.test("the default sink writes to the console", () => {
  ConsoleTasks.reset(); // restores the default stdout/stderr sink
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => void logs.push(String(args[0]));
  console.error = (...args: unknown[]) => void errs.push(String(args[0]));
  try {
    ConsoleTasks.configure({
      color: false,
      github: false,
      width: 10,
      level: "trace",
    });
    ConsoleTasks.info("hi");
    ConsoleTasks.error("bad");
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assertEquals(logs, ["ℹ hi"]);
  assertEquals(errs, ["✖ bad"]);
  ConsoleTasks.reset();
});

Deno.test("reset restores the default level", () => {
  capture({ level: "error" });
  assertEquals(ConsoleTasks.level(), "error");
  ConsoleTasks.reset();
  assertEquals(ConsoleTasks.level(), "info");
});
