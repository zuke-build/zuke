// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import {
  denoPath,
  mainModule,
  ON_DENO,
  preservesMainSymlink,
  runtimeFacts,
} from "../src/runtime.ts";

Deno.test("on Deno the runtime's answers are Deno's own", () => {
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

Deno.test("the option that keeps the entry's symlink is found where Node takes it from", () => {
  const option = "--preserve-symlinks-main";
  assertEquals(preservesMainSymlink([], undefined), false);
  assertEquals(
    preservesMainSymlink(["--no-warnings", option], undefined),
    true,
  );
  assertEquals(preservesMainSymlink([], `--no-warnings  ${option}`), true);
  // Another option that only begins the same way is not it.
  assertEquals(preservesMainSymlink(["--preserve-symlinks"], ""), false);
  assertEquals(preservesMainSymlink([], "--preserve-symlinks"), false);
});
