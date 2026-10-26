// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import { joinShellArgs } from "../src/join_args.ts";
import { joinShellArgs as fromShell, splitShellArgs } from "../src/shell.ts";

Deno.test("joinShellArgs: plain tokens are written as they are", () => {
  assertEquals(
    joinShellArgs(["gcloud", "--region=europe-west1", "a/b.c", "x@y%z+1,2:3"]),
    "gcloud --region=europe-west1 a/b.c x@y%z+1,2:3",
  );
});

Deno.test("joinShellArgs: an empty argv is an empty line", () => {
  assertEquals(joinShellArgs([]), "");
});

Deno.test("joinShellArgs: an empty token is kept as ''", () => {
  assertEquals(joinShellArgs(["echo", ""]), "echo ''");
});

Deno.test("joinShellArgs: an embedded ' is written as '\\''", () => {
  assertEquals(joinShellArgs(["it's"]), "'it'\\''s'");
  assertEquals(joinShellArgs(["'"]), "''\\'''");
});

Deno.test("joinShellArgs: a newline stays inside single quotes", () => {
  assertEquals(joinShellArgs(["a\nb"]), "'a\nb'");
});

Deno.test("joinShellArgs: spaces, $ and backticks are quoted, never expanded", () => {
  assertEquals(joinShellArgs(["my svc"]), "'my svc'");
  assertEquals(joinShellArgs(["$HOME"]), "'$HOME'");
  assertEquals(joinShellArgs(["`id`"]), "'`id`'");
  assertEquals(joinShellArgs(["$(rm -rf /); x"]), "'$(rm -rf /); x'");
});

Deno.test("joinShellArgs: the shell module re-exports the same function", () => {
  assertEquals(fromShell, joinShellArgs);
});

Deno.test("joinShellArgs: the line splits back into the same argv", () => {
  const argv = [
    "cmd",
    "",
    "plain",
    "it's",
    "two words",
    "a\nb",
    "$HOME",
    "`id`",
    '"quoted"',
    "back\\slash",
    "*.ts",
    "''",
  ];
  assertEquals(splitShellArgs(joinShellArgs(argv)), argv);
});
