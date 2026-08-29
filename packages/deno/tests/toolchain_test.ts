// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  DenoCleanSettings,
  DenoCompileSettings,
  DenoInfoSettings,
  DenoInitSettings,
  DenoUpgradeSettings,
} from "../mod.ts";

Deno.test("compile: entrypoint, output, target and permissions", () => {
  const argv = new DenoCompileSettings()
    .allowAll()
    .output("dist/app")
    .target("x86_64-unknown-linux-gnu")
    .script("mod.ts")
    .scriptArgs("--verbose")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "compile",
    "--allow-all",
    "--output",
    "dist/app",
    "--target",
    "x86_64-unknown-linux-gnu",
    "mod.ts",
    "--verbose",
  ]);
});

Deno.test("compile: include and exclude repeat, each with its own flag", () => {
  const argv = new DenoCompileSettings()
    .include("assets", "workers/main.ts")
    .exclude("assets/fixtures")
    .excludeUnusedNpm()
    .selfExtracting()
    .script("mod.ts")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "compile",
    "--self-extracting",
    "--exclude-unused-npm",
    "--include",
    "assets",
    "--include",
    "workers/main.ts",
    "--exclude",
    "assets/fixtures",
    "mod.ts",
  ]);
});

Deno.test("compile: minify implies bundle, and is refused without it", () => {
  const bundled = new DenoCompileSettings()
    .bundle()
    .minify()
    .script("mod.ts")
    .argv()
    .slice(1);
  assertEquals(bundled, ["compile", "--bundle", "--minify", "mod.ts"]);

  const error = assertThrows(
    () => new DenoCompileSettings().minify().script("mod.ts").argv(),
    Error,
  );
  assertEquals(error.message.includes(".bundle()"), true);
});

Deno.test("compile: the Windows icon is refused on a non-Windows target", () => {
  const windows = new DenoCompileSettings()
    .target("x86_64-pc-windows-msvc")
    .icon("app.ico")
    .noTerminal()
    .script("mod.ts")
    .argv()
    .slice(1);
  assertEquals(windows, [
    "compile",
    "--target",
    "x86_64-pc-windows-msvc",
    "--no-terminal",
    "--icon",
    "app.ico",
    "mod.ts",
  ]);

  // No target means "build for this host", which may itself be Windows, so
  // the icon is legitimate and must not be refused.
  assertEquals(
    new DenoCompileSettings().icon("app.ico").script("mod.ts").argv().slice(1),
    ["compile", "--icon", "app.ico", "mod.ts"],
  );

  const error = assertThrows(
    () =>
      new DenoCompileSettings()
        .target("aarch64-apple-darwin")
        .icon("app.ico")
        .script("mod.ts")
        .argv(),
    Error,
  );
  assertEquals(error.message.includes("aarch64-apple-darwin"), true);
});

Deno.test("compile: the entrypoint is required", () => {
  const error = assertThrows(() => new DenoCompileSettings().argv(), Error);
  assertEquals(error.message.includes(".script() is required"), true);
});

Deno.test("clean: bare, dry run, and retained paths", () => {
  assertEquals(new DenoCleanSettings().argv().slice(1), ["clean"]);
  assertEquals(
    new DenoCleanSettings().dryRun().except("a.ts", "b.ts").argv().slice(1),
    ["clean", "--dry-run", "--except", "a.ts", "b.ts"],
  );
});

Deno.test("info: flags precede the module operand", () => {
  const argv = new DenoInfoSettings()
    .json()
    .config("deno.json")
    .importMap("imports.json")
    .reload()
    .frozen()
    .noNpm()
    .noRemote()
    .path("mod.ts")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "info",
    "--json",
    "--config",
    "deno.json",
    "--import-map",
    "imports.json",
    "--reload",
    "--frozen",
    "--no-npm",
    "--no-remote",
    "mod.ts",
  ]);
});

Deno.test("info: modulePath reports the operand, not a trailing flag value", () => {
  assertEquals(new DenoInfoSettings().modulePath, undefined);
  // The regression this accessor exists for: --import-map leaves a non-flag
  // token last, which reading the argv would mistake for the module.
  const mapped = new DenoInfoSettings().importMap("imports.json");
  assertEquals(mapped.modulePath, undefined);
  assertEquals(mapped.argv().slice(-1), ["imports.json"]);
  assertEquals(new DenoInfoSettings().path("mod.ts").modulePath, "mod.ts");
});

Deno.test("info: no-lock is distinct from frozen", () => {
  assertEquals(new DenoInfoSettings().noLock().argv().slice(1), [
    "info",
    "--no-lock",
  ]);
});

Deno.test("init: shape, registry and directory", () => {
  assertEquals(
    new DenoInitSettings().lib().yes().directory("my-lib").argv().slice(1),
    ["init", "--lib", "--yes", "my-lib"],
  );
  assertEquals(new DenoInitSettings().serve().argv().slice(1), [
    "init",
    "--serve",
  ]);
  assertEquals(
    new DenoInitSettings().empty().jsr().directory("@scope/pkg").argv().slice(
      1,
    ),
    ["init", "--empty", "--jsr", "@scope/pkg"],
  );
  assertEquals(new DenoInitSettings().npm().argv().slice(1), ["init", "--npm"]);
});

Deno.test("init: two project shapes are refused, one repeated is not", () => {
  assertEquals(new DenoInitSettings().lib().lib().argv().slice(1), [
    "init",
    "--lib",
  ]);
  const shape = assertThrows(() => new DenoInitSettings().lib().serve(), Error);
  assertEquals(shape.message.includes("project"), true);
  const registry = assertThrows(
    () => new DenoInitSettings().jsr().npm(),
    Error,
  );
  assertEquals(registry.message.includes("registries"), true);
});

Deno.test("upgrade: version operand trails the flags", () => {
  assertEquals(new DenoUpgradeSettings().argv().slice(1), ["upgrade"]);
  const argv = new DenoUpgradeSettings()
    .dryRun()
    .force()
    .noDelta()
    .output("/tmp/deno")
    .checksum("abc123")
    .version("canary")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "upgrade",
    "--dry-run",
    "--force",
    "--no-delta",
    "--output",
    "/tmp/deno",
    "--checksum",
    "abc123",
    "canary",
  ]);
});
