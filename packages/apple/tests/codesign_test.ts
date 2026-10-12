// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  CodesignDisplaySettings,
  CodesignSignSettings,
  CodesignTasks,
  CodesignVerifySettings,
} from "../src/codesign.ts";
import { parseCodesignDisplay } from "../src/codesign_display.ts";

Deno.test("codesign sign: the minimal invocation is identity then file", () => {
  assertEquals(
    new CodesignSignSettings().identity("-").file("dist/a.app").argv(),
    ["codesign", "--sign", "-", "dist/a.app"],
  );
});

Deno.test("codesign sign: every option renders, files last", () => {
  const argv = new CodesignSignSettings()
    .identity("Developer ID Application: Example (ABCDE12345)")
    .force().deep().options("runtime").options("library")
    .timestamp().entitlements("app.entitlements")
    .keychain("/tmp/ci.keychain-db").identifier("com.example.app")
    .verbose().file("dist/a.app", "dist/b.dylib").argv();
  assertEquals(argv, [
    "codesign",
    "--sign",
    "Developer ID Application: Example (ABCDE12345)",
    "--force",
    "--deep",
    "--options",
    "runtime,library",
    "--timestamp",
    "--entitlements",
    "app.entitlements",
    "--keychain",
    "/tmp/ci.keychain-db",
    "--identifier",
    "com.example.app",
    "--verbose",
    "dist/a.app",
    "dist/b.dylib",
  ]);
});

Deno.test("codesign sign: a timestamp server and a verbosity level are one token", () => {
  assertEquals(
    new CodesignSignSettings().identity("X").timestamp("http://ts.example")
      .verbose(4).file("a").argv(),
    [
      "codesign",
      "--sign",
      "X",
      "--timestamp=http://ts.example",
      "--verbose=4",
      "a",
    ],
  );
});

Deno.test("codesign sign: no identity is refused, not sent", () => {
  assertThrows(
    () => new CodesignSignSettings().file("a").argv(),
    Error,
    "no signing identity",
  );
});

Deno.test("codesign: no file is refused for every operation", () => {
  assertThrows(
    () => new CodesignSignSettings().identity("-").argv(),
    Error,
    "codesign --sign: no code",
  );
  assertThrows(
    () => new CodesignVerifySettings().argv(),
    Error,
    "codesign --verify: no code",
  );
  assertThrows(
    () => new CodesignDisplaySettings().argv(),
    Error,
    "codesign --display: no code",
  );
});

Deno.test("codesign: a file that looks like a flag is passed as ./ so it stays a file", () => {
  assertEquals(
    new CodesignVerifySettings().file("--deep", "/abs/-x", "-").argv(),
    ["codesign", "--verify", "./--deep", "/abs/-x", "./-"],
  );
});

Deno.test("codesign verify: strict and deep render", () => {
  assertEquals(
    new CodesignVerifySettings().strict().deep().verbose(2).file("a.app")
      .argv(),
    ["codesign", "--verify", "--strict", "--deep", "--verbose=2", "a.app"],
  );
  assertEquals(
    new CodesignVerifySettings().file("a.app").argv(),
    ["codesign", "--verify", "a.app"],
  );
});

Deno.test("codesign display: verbosity and file", () => {
  assertEquals(
    new CodesignDisplaySettings().verbose(4).file("a.app").argv(),
    ["codesign", "--display", "--verbose=4", "a.app"],
  );
});

Deno.test("codesign display output is read from stderr, where codesign writes it", () => {
  const stderr = [
    "Executable=/dist/a.app/Contents/MacOS/a",
    "Identifier=com.example.app",
    "Format=app bundle with Mach-O universal (x86_64 arm64)",
    "Authority=Developer ID Application: Example (ABCDE12345)",
    "Authority=Developer ID Certification Authority",
    "Authority=Apple Root CA",
    "TeamIdentifier=ABCDE12345",
    "=no key",
    "Sealed Resources version=2 rules=13 files=4",
  ].join("\n");
  const display = parseCodesignDisplay(new CommandOutput(0, "", stderr));
  assertEquals(display.identifier, "com.example.app");
  assertEquals(display.teamIdentifier, "ABCDE12345");
  assertEquals(display.authorities, [
    "Developer ID Application: Example (ABCDE12345)",
    "Developer ID Certification Authority",
    "Apple Root CA",
  ]);
  assertEquals(display.text, stderr);
});

Deno.test("codesign display joins stderr and stdout, and tolerates neither field", () => {
  const display = parseCodesignDisplay(
    new CommandOutput(0, "Identifier=from-stdout\n", "Executable=/x\n"),
  );
  assertEquals(display.text, "Executable=/x\nIdentifier=from-stdout");
  assertEquals(display.identifier, "from-stdout");
  assertEquals(display.teamIdentifier, undefined);
  assertEquals(
    parseCodesignDisplay(new CommandOutput(0, "", "")).authorities,
    [],
  );
});

Deno.test("CodesignTasks reach execution", async () => {
  await assertRejects(
    () => CodesignTasks.sign((s) => missingTool(s).identity("-").file("a")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => CodesignTasks.verify((s) => missingTool(s).file("a")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => CodesignTasks.display((s) => missingTool(s).file("a")),
    ToolNotFoundError,
  );
});

Deno.test("codesign wrappers resolve their binary from PATH", async () => {
  await assertWrapperConformance(
    () => new CodesignSignSettings().identity("-").file("a"),
    "codesign",
    { resolution: "path" },
  );
  await assertWrapperConformance(
    () => new CodesignVerifySettings().file("a"),
    "codesign",
    { resolution: "path" },
  );
  await assertWrapperConformance(
    () => new CodesignDisplaySettings().file("a"),
    "codesign",
    { resolution: "path" },
  );
});
