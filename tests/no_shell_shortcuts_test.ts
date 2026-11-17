// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * No package source starts a process through a shell.
 *
 * On Windows the two easy ways to run a batch file from Node, the `shell`
 * option and a `cmd /c` prefix, hand `cmd.exe` a line nothing has escaped,
 * so an argument holding `&` or a quote in the right place runs as a
 * command. `packages/core/src/process_batch.ts` is the one place a batch
 * file is run, on a line built for it. This test fails when another way in
 * appears, so a later change cannot reintroduce one unnoticed.
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";

/** What a shell shortcut looks like in code, by name. */
const SHORTCUTS: [name: string, pattern: RegExp][] = [
  // An option that makes the runtime start a shell.
  ["the shell option", /\bshell\s*:\s*true\b/],
  // The command processor by name, as a program, with its run option after
  // it on the line, however the arguments are passed.
  [
    "a cmd /c prefix",
    /["'`]cmd(\.exe)?["'`][^;\n]{0,40}?["'`]\/[ck]["'`]/i,
  ],
  // The same, written as one string.
  ["a cmd /c line", /["'`]cmd(\.exe)?\s+\/[ck][\s"'`]/i],
];

/**
 * The shortcuts that are there on purpose, by file and how many. Both are in
 * the two deprecated helpers `tooling.ts` still exports, which nothing in
 * Zuke calls and which go in 2.0.
 */
const ALLOWED: Record<string, number> = {
  "packages/core/src/tooling.ts": 2,
};

/** `source` without its comments, which may say what the code must not do. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The shortcuts in `source`, one name per occurrence. */
function shortcutsIn(source: string): string[] {
  const text = code(source);
  return SHORTCUTS.flatMap(([name, pattern]) =>
    Array.from(
      text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`)),
      () => name,
    )
  );
}

/** Every `.ts` file under `dir`, recursively. */
async function tsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) found.push(...await tsFiles(path));
    else if (entry.isFile && entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/** Every source file a package publishes: its entry point and its `src`. */
async function packageSources(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir("packages")) {
    if (!entry.isDirectory) continue;
    const root = `packages/${entry.name}`;
    files.push(`${root}/mod.ts`, ...await tsFiles(`${root}/src`));
  }
  return files.sort();
}

Deno.test("a shell shortcut is recognised in each way it is written", () => {
  for (
    const [source, expected] of [
      ["spawn(command, args, { shell: true });", ["the shell option"]],
      ["spawn(command, args, { shell:true })", ["the shell option"]],
      ['return ["cmd", "/c", ...argv];', ["a cmd /c prefix"]],
      ["new Command('CMD.EXE', ['/C', tool])", ["a cmd /c prefix"]],
      [
        'new Deno.Command("cmd", { args: ["/c", tool] })',
        ["a cmd /c prefix"],
      ],
      ["run('cmd.exe', '/k', tool)", ["a cmd /c prefix"]],
      ["exec(`cmd /c ${tool}`)", ["a cmd /c line"]],
      ['exec("cmd.exe  /C build.bat")', ["a cmd /c line"]],
      // Both at once, and twice.
      [
        'a(["cmd", "/c"], { shell: true }); b(["cmd", "/c"]);',
        ["the shell option", "a cmd /c prefix", "a cmd /c prefix"],
      ],
    ] as const
  ) {
    assertEquals(shortcutsIn(source), [...expected], source);
  }
});

Deno.test("what only looks like a shortcut is not one", () => {
  for (
    const source of [
      // The option off, or a field of the same name that is not the option.
      "spawn(command, args, { shell: false });",
      "interface Completion { shell: string }",
      "const shell: Shell = options.shell;",
      // The command processor named in a comment, or not as a program to run.
      '// never ["cmd", "/c", ...argv] here',
      "/** Not `cmd /c`, which escapes nothing. */",
      'argv0: start.verbatim ? "cmd.exe" : undefined,',
      'const PROMPT_OPTIONS = ["/e:ON", "/v:OFF", "/d", "/c"];',
      'imports["@zuke/cmd"] = zukeDependency("cmd");',
      'this.#flags.push("/c", String(path));',
    ]
  ) {
    assertEquals(shortcutsIn(source), [], source);
  }
});

Deno.test("no package source starts a process through a shell", async () => {
  const found: Record<string, number> = {};
  const named: string[] = [];
  for (const file of await packageSources()) {
    const shortcuts = shortcutsIn(await Deno.readTextFile(file));
    if (shortcuts.length === 0) continue;
    found[file] = shortcuts.length;
    named.push(`${file}: ${shortcuts.join(", ")}`);
  }
  assertEquals(
    found,
    ALLOWED,
    "package source may not start a process through a shell: an argument " +
      "would reach cmd.exe unescaped. Start the program directly, with its " +
      "arguments as an array; a Windows batch file is handled by " +
      `packages/core/src/process_batch.ts.\n  ${named.join("\n  ")}`,
  );
});
