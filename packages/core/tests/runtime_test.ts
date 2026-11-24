// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import {
  denoPath,
  isSingleExecutable,
  mainModule,
  nodeOptionWords,
  ON_DENO,
  preservesMainSymlink,
  runtimeFacts,
} from "../src/runtime.ts";

test("on Deno the runtime's answers are Deno's own", () => {
  assertEquals(ON_DENO, true);
  assertEquals(runtimeFacts(), {
    name: "deno",
    version: Deno.version.deno,
    typescript: Deno.version.typescript,
    standalone: Deno.build.standalone,
  });
  assertEquals(mainModule(), Deno.mainModule);
  // The tests run under Deno itself, never a compiled binary.
  assertEquals(denoPath(), Deno.execPath());
});

test("the option that keeps the entry's symlink is found where Node takes it from", () => {
  const option = "--preserve-symlinks-main";
  assertEquals(preservesMainSymlink([], undefined), false);
  assertEquals(
    preservesMainSymlink(["--no-warnings", option], undefined),
    true,
  );
  assertEquals(preservesMainSymlink([], `--no-warnings  ${option}`), true);
  // Quoted, as NODE_OPTIONS allows.
  assertEquals(preservesMainSymlink([], `"${option}" --no-warnings`), true);
  // Inside the value of another option it is not an option.
  assertEquals(
    preservesMainSymlink([], `--title "a ${option} b"`),
    false,
  );
  // Turned off again, the last one given decides, the command line last.
  const off = "--no-preserve-symlinks-main";
  assertEquals(preservesMainSymlink([option, off], undefined), false);
  assertEquals(preservesMainSymlink([off, option], undefined), true);
  assertEquals(preservesMainSymlink([off], option), false);
  assertEquals(preservesMainSymlink([option], off), true);
  assertEquals(preservesMainSymlink([], `${option} ${off}`), false);
  // Spelled with underscores, which Node reads as hyphens.
  assertEquals(preservesMainSymlink(["--preserve_symlinks_main"], ""), true);
  assertEquals(
    preservesMainSymlink(["--no_preserve_symlinks_main"], option),
    false,
  );
  assertEquals(preservesMainSymlink([], "--preserve_symlinks_main"), true);
  // Another option that only begins the same way is not it.
  assertEquals(preservesMainSymlink(["--preserve-symlinks"], ""), false);
  assertEquals(preservesMainSymlink([], "--preserve-symlinks"), false);
});

test("NODE_OPTIONS is split as Node splits it", () => {
  assertEquals(nodeOptionWords(""), []);
  assertEquals(nodeOptionWords("  --a   --b "), ["--a", "--b"]);
  assertEquals(nodeOptionWords('--require "./a b.js" --c'), [
    "--require",
    "./a b.js",
    "--c",
  ]);
  // A backslash inside quotes takes the next character as it is.
  assertEquals(nodeOptionWords('"a \\" b" c'), ['a " b', "c"]);
  // Outside quotes it is an ordinary character.
  assertEquals(nodeOptionWords("C:\\dir\\file"), ["C:\\dir\\file"]);
  // A quote left open, and a backslash at the very end of one.
  assertEquals(nodeOptionWords('"open --a'), ["open --a"]);
  assertEquals(nodeOptionWords('"end\\'), ["end"]);
});

test("a Node single executable is told apart by node:sea", () => {
  const builtin = (sea: unknown) => (id: string) =>
    id === "node:sea" ? sea : undefined;
  assertEquals(isSingleExecutable(builtin({ isSea: () => true })), true);
  assertEquals(isSingleExecutable(builtin({ isSea: () => false })), false);
  // A Node with no getBuiltinModule, or a node:sea without isSea, is not one.
  // null, not undefined, which would take the default and read this runtime.
  assertEquals(isSingleExecutable(null), false);
  assertEquals(isSingleExecutable(builtin(undefined)), false);
  assertEquals(isSingleExecutable(builtin({})), false);
  // By default it asks the running process, which here is no single executable.
  assertEquals(isSingleExecutable(), false);
});
