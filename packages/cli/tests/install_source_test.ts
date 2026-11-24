// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

// cspell:ignore linuxbrew libexec

import { test } from "../../core/tests/_testing.ts";
import { assertEquals } from "../../core/tests/_assert.ts";
import {
  type InstallHost,
  installLabel,
  installSource,
  isJsrModule,
} from "../src/install_source.ts";

/** An {@link InstallHost} answering from fixed facts. */
function host(facts: {
  standalone?: boolean;
  main?: string;
  exe?: string;
  links?: Record<string, string>;
  unresolvable?: boolean;
}): InstallHost {
  return {
    standalone: () => facts.standalone ?? false,
    mainModule: () => facts.main ?? "jsr:@zuke/cli@1.14.0",
    execPath: () => facts.exe ?? "/usr/local/bin/zuke",
    realPath: (path) =>
      facts.unresolvable
        ? Promise.reject(new Error("gone"))
        : Promise.resolve(facts.links?.[path] ?? path),
  };
}

test("isJsrModule accepts the package with or without a version, and nothing else", () => {
  assertEquals(isJsrModule("jsr:@zuke/cli"), true);
  assertEquals(isJsrModule("jsr:@zuke/cli@1.14.0"), true);
  for (
    const other of [
      "jsr:@zuke/cli-evil",
      "jsr:@zuke/core@1.0.0",
      "https://jsr.io/@zuke/cli/1.0.0/mod.ts",
      "file:///src/zuke/packages/cli/mod.ts",
    ]
  ) {
    assertEquals(isJsrModule(other), false, other);
  }
});

test("installSource reads a process under Deno by its main module", async () => {
  assertEquals(await installSource(host({})), {
    kind: "jsr",
    location: "jsr:@zuke/cli@1.14.0",
  });
  assertEquals(
    await installSource(host({ main: "file:///src/zuke/packages/cli/mod.ts" })),
    { kind: "source", location: "file:///src/zuke/packages/cli/mod.ts" },
  );
});

test("installSource asks whether the process is compiled before reading its main module", async () => {
  // A binary compiled from JSR keeps `jsr:@zuke/cli` as its main module, so
  // the specifier alone would call it a JSR install.
  const compiled = await installSource(
    host({ standalone: true, exe: "/home/me/bin/zuke" }),
  );
  assertEquals(compiled, { kind: "binary", location: "/home/me/bin/zuke" });
});

test("installSource finds Homebrew's Cellar through the link on PATH", async () => {
  for (
    const cellar of [
      "/opt/homebrew/Cellar/zuke/1.14.0/bin/zuke",
      "/usr/local/Cellar/zuke/1.14.0_1/bin/zuke",
      "/home/linuxbrew/.linuxbrew/Cellar/zuke/1.14.0/bin/zuke",
    ]
  ) {
    const source = await installSource(host({
      standalone: true,
      exe: "/opt/homebrew/bin/zuke",
      links: { "/opt/homebrew/bin/zuke": cellar },
    }));
    assertEquals(source, { kind: "homebrew", location: cellar }, cellar);
  }
});

test("installSource does not take another formula's or directory's Cellar for zuke's", async () => {
  for (
    const path of [
      "/opt/homebrew/Cellar/zuke-evil/1.0.0/bin/zuke",
      "/opt/homebrew/Cellar/zuke/1.0.0/libexec/zuke",
      "/opt/homebrew/Cellar/zuke/1.0.0/bin/zuke-old",
      "/tmp/Cellar/zuke/bin/zuke",
    ]
  ) {
    const source = await installSource(host({ standalone: true, exe: path }));
    assertEquals(source.kind, "binary", path);
  }
});

test("installSource finds Chocolatey's package directory, wherever choco lives", async () => {
  for (
    const path of [
      "C:\\ProgramData\\chocolatey\\lib\\zuke\\tools\\zuke.exe",
      "D:\\Tools\\Choco\\LIB\\Zuke\\Tools\\ZUKE.EXE",
      "C:/ProgramData/chocolatey/lib/zuke/tools/zuke.exe",
    ]
  ) {
    const source = await installSource(host({ standalone: true, exe: path }));
    assertEquals(source, { kind: "chocolatey", location: path }, path);
  }
});

test("installSource does not take another package's or directory's lib for zuke's", async () => {
  for (
    const path of [
      "C:\\ProgramData\\chocolatey\\lib\\zuke-evil\\tools\\zuke.exe",
      "C:\\ProgramData\\chocolatey\\lib\\zuke\\tools\\old\\zuke.exe",
      "C:\\ProgramData\\chocolatey\\lib\\zuke\\zuke.exe",
      "C:\\ProgramData\\chocolatey\\bin\\zuke.exe",
    ]
  ) {
    const source = await installSource(host({ standalone: true, exe: path }));
    assertEquals(source.kind, "binary", path);
  }
});

test("installSource reads a Node process whose main module is under node_modules as npm", async () => {
  for (
    const main of [
      "file:///home/me/.npm/_npx/ab/node_modules/@zuke-build/cli/zuke.js",
      "file:///C:/Users/me/AppData/Roaming/npm/node_modules/@zuke-build/cli/zuke.js",
      "C:\\Users\\me\\npm\\node_modules\\@zuke-build\\cli\\zuke.js",
    ]
  ) {
    assertEquals(await installSource(host({ main })), {
      kind: "npm",
      location: main,
    }, main);
  }
  // Another package, or a lookalike scope, is not the CLI.
  for (
    const main of [
      "file:///a/node_modules/@zuke-build/core/mod.js",
      "file:///a/node_modules/@zuke/cli/zuke.js",
    ]
  ) assertEquals((await installSource(host({ main }))).kind, "source", main);
});

test("installSource keeps the reported path when the link cannot be resolved", async () => {
  const source = await installSource(host({
    standalone: true,
    exe: "/opt/homebrew/Cellar/zuke/1.14.0/bin/zuke",
    unresolvable: true,
  }));
  assertEquals(source, {
    kind: "homebrew",
    location: "/opt/homebrew/Cellar/zuke/1.14.0/bin/zuke",
  });
});

test("installLabel names the kind, shortening a path but never a specifier", () => {
  const tilde = (path: string) => path.replace("/home/me", "~");
  assertEquals(
    installLabel({ kind: "npm", location: "file:///home/me/x/zuke.js" }, tilde),
    "npm (file:///home/me/x/zuke.js)",
  );
  assertEquals(
    installLabel({ kind: "jsr", location: "jsr:@zuke/cli@1.14.0" }, tilde),
    "JSR (jsr:@zuke/cli@1.14.0)",
  );
  assertEquals(
    installLabel({
      kind: "homebrew",
      location: "/home/me/.linuxbrew/Cellar/zuke/1.14.0/bin/zuke",
    }, tilde),
    "Homebrew (~/.linuxbrew/Cellar/zuke/1.14.0/bin/zuke)",
  );
  assertEquals(
    installLabel({
      kind: "chocolatey",
      location: "C:/ProgramData/chocolatey/lib/zuke/tools/zuke.exe",
    }, tilde),
    "Chocolatey (C:/ProgramData/chocolatey/lib/zuke/tools/zuke.exe)",
  );
  assertEquals(
    installLabel({ kind: "binary", location: "/home/me/bin/zuke" }, tilde),
    "standalone binary (~/bin/zuke)",
  );
  assertEquals(
    installLabel(
      { kind: "source", location: "file:///home/me/zuke/packages/cli/mod.ts" },
      tilde,
    ),
    "source (file:///home/me/zuke/packages/cli/mod.ts)",
  );
});
