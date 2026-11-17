// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "./_assert.ts";
import {
  batchCommandLine,
  commandPrompt,
  invocation,
  isBatchFile,
  resolvedBatchFile,
} from "../src/process_batch.ts";

const SCRIPT = "C:\\tools\\nx.cmd";

/** The line for `SCRIPT` with one argument, without the script and wrapping. */
function written(argument: string): string {
  const line = batchCommandLine(SCRIPT, [argument]);
  const prefix = `""${SCRIPT}" `;
  assertEquals(line.startsWith(prefix) && line.endsWith('"'), true);
  return line.slice(prefix.length, -1);
}

Deno.test("isBatchFile knows a batch file by its extension, in any case", () => {
  for (const name of ["a.cmd", "a.bat", "A.CMD", "C:\\x y\\b.Bat"]) {
    assertEquals(isBatchFile(name), true);
  }
  // Windows drops trailing dots and spaces, so these name batch files too.
  for (const name of ["a.cmd.", "a.bat ", "a.cmd . ."]) {
    assertEquals(isBatchFile(name), true);
  }
  for (const name of ["a.exe", "cmd", "a.cmd.exe", "a.cmd2", "a.cmd::$DATA"]) {
    assertEquals(isBatchFile(name), false);
  }
});

Deno.test("a plain argument is written as it is", () => {
  for (
    const plain of [
      "build",
      "--prod",
      "src/main.ts",
      "a:b",
      "C:\\dir\\f",
      "x_1",
    ]
  ) {
    assertEquals(written(plain), plain);
  }
});

Deno.test("anything cmd.exe could act on is inside quotes", () => {
  assertEquals(written("a b"), '"a b"');
  assertEquals(written("a&b"), '"a&b"');
  assertEquals(written("a|b"), '"a|b"');
  assertEquals(written("a^b"), '"a^b"');
  assertEquals(written("<in>out"), '"<in>out"');
  assertEquals(written("(x)"), '"(x)"');
  assertEquals(written("a;b,c=d"), '"a;b,c=d"');
  assertEquals(written("!VAR!"), '"!VAR!"');
  assertEquals(written("tab\there"), '"tab\there"');
  // Not ASCII, and not a control character: written as it is.
  assertEquals(written("café→"), "café→");
});

Deno.test("an empty argument and a trailing backslash are quoted, the backslashes doubled", () => {
  assertEquals(written(""), '""');
  assertEquals(written("dir\\"), '"dir\\\\"');
  assertEquals(written("dir\\\\"), '"dir\\\\\\\\"');
  // Quoted for another reason: the trailing backslash is still doubled.
  assertEquals(written("a b\\"), '"a b\\\\"');
});

Deno.test("a quote is doubled, and the backslashes before it are doubled", () => {
  assertEquals(written('say "hi"'), '"say ""hi"""');
  assertEquals(written('a\\"b'), '"a\\\\""b"');
  assertEquals(written('a\\\\"b'), '"a\\\\\\\\""b"');
  // Backslashes that meet no quote are left alone.
  assertEquals(written("a\\b c"), '"a\\b c"');
});

Deno.test("a percent sign cannot start a variable", () => {
  assertEquals(written("%PATH%"), '"%%cd:~,%PATH%%cd:~,%"');
  assertEquals(written("100%"), '"100%%cd:~,%"');
});

Deno.test("the payload from the disclosure stays one quoted argument", () => {
  assertEquals(
    batchCommandLine(SCRIPT, ["affected", '--head=fix"&calc.exe']),
    `""${SCRIPT}" affected "--head=fix""&calc.exe""`,
  );
});

Deno.test("the line is the quoted script and its arguments, wrapped once more", () => {
  assertEquals(batchCommandLine(SCRIPT, []), `""${SCRIPT}""`);
  assertEquals(
    batchCommandLine("C:\\my tools\\run.bat", ["a", "b c", ""]),
    '""C:\\my tools\\run.bat" a "b c" """',
  );
});

Deno.test("what cannot be made safe is refused", () => {
  for (const argument of ["a\nb", "a\rb", "a\0b"]) {
    assertThrows(() => batchCommandLine(SCRIPT, ["ok", argument]));
  }
  for (const script of ['C:\\a"b.cmd', "C:\\dir\\", "C:\\a\nb.cmd"]) {
    assertThrows(() => batchCommandLine(script, []));
  }
});

Deno.test("cmd.exe is named by its full path under the system directory", () => {
  assertEquals(
    commandPrompt({ SystemRoot: "C:\\Windows" }),
    "C:\\Windows\\System32\\cmd.exe",
  );
  // Whatever the case of the name, and with a trailing separator.
  assertEquals(
    commandPrompt({ SYSTEMROOT: "D:\\Win NT\\" }),
    "D:\\Win NT\\System32\\cmd.exe",
  );
  // Never by name alone, and never relative to anything.
  for (
    const env of [
      {},
      { SystemRoot: "" },
      { SystemRoot: undefined, ComSpec: "cmd.exe" },
      { SystemRoot: "Windows" },
      { SystemRoot: "/" },
      { SystemRoot: "\\\\server\\share" },
      { SystemRoot: "C:\\%EVIL%" },
      { SystemRoot: 'C:\\a"b' },
    ]
  ) {
    assertThrows(() => commandPrompt(env));
  }
});

Deno.test("a bare batch file name is found on PATH, by full paths only, in order", () => {
  const files = new Set(["C:\\b\\npm.cmd", "D:\\c\\npm.cmd", ".\\npm.cmd"]);
  const isFile = (path: string) => files.has(path);
  const path = '.;relative;;C:\\a;"C:\\b\\";D:\\c';
  assertEquals(resolvedBatchFile("npm.cmd", path, isFile), "C:\\b\\npm.cmd");
  // One given with a directory is used as it is, and not looked for.
  for (const given of ["C:\\x\\npm.cmd", ".\\npm.cmd", "bin/npm.cmd"]) {
    assertEquals(resolvedBatchFile(given, path, () => false), given);
  }
  // The working directory is never searched, whatever PATH says.
  const missing = assertThrows(() =>
    resolvedBatchFile("npm.cmd", ".;relative", isFile)
  );
  assertEquals("code" in missing && missing.code, "ENOENT");
  assertThrows(() => resolvedBatchFile("npm.cmd", undefined, isFile));
});

Deno.test("a batch file on Windows is started through cmd.exe on a prepared line", () => {
  const parent = { SystemRoot: "C:\\Windows", PATH: "C:\\parent" };
  const none = () => false;
  assertEquals(invocation(SCRIPT, ["a b", "&c"], true, parent, {}, none), {
    file: "C:\\Windows\\System32\\cmd.exe",
    args: ["/e:ON", "/v:OFF", "/d", "/c", `""${SCRIPT}" "a b" "&c""`],
    verbatim: true,
  });
  // A bare name is looked up on the child's PATH, whatever its case, and the
  // system directory is the parent's, whatever the child's says.
  const child = { Path: "C:\\child", SystemRoot: "C:\\Elsewhere" };
  assertEquals(
    invocation(
      "npm.cmd",
      [],
      true,
      parent,
      child,
      (path) => path === "C:\\child\\npm.cmd",
    ),
    {
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/e:ON", "/v:OFF", "/d", "/c", '""C:\\child\\npm.cmd""'],
      verbatim: true,
    },
  );
  // A name Windows reads as the batch file is written as the batch file.
  assertEquals(
    invocation(`${SCRIPT}. .`, ["&c"], true, parent, {}, none).args[4],
    `""${SCRIPT}" "&c""`,
  );
  // A batch file that cannot be run safely is refused, not started another way.
  assertThrows(() => invocation(SCRIPT, ["a\nb"], true, parent, {}, none));
  assertThrows(() => invocation(SCRIPT, [], true, {}, {}, none));
  assertThrows(() => invocation("npm.cmd", [], true, parent, {}, none));
});

Deno.test("everything else is started as it is", () => {
  const args = ["a b", "&c", "new\nline"];
  const none = () => false;
  assertEquals(invocation("C:\\tools\\node.exe", args, true, {}, {}, none), {
    file: "C:\\tools\\node.exe",
    args,
    verbatim: false,
  });
  // Elsewhere a `.cmd` is only a file name.
  assertEquals(invocation("./tool.cmd", args, false, {}, {}, none), {
    file: "./tool.cmd",
    args,
    verbatim: false,
  });
});
