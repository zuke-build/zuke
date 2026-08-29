// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  DenoAddSettings,
  DenoApproveScriptsSettings,
  DenoBumpVersionSettings,
  DenoCiSettings,
  DenoOutdatedSettings,
  DenoPackSettings,
  DenoRemoveSettings,
  DenoUninstallSettings,
  DenoWhySettings,
} from "../mod.ts";

Deno.test("add: specifiers trail the flags", () => {
  const argv = new DenoAddSettings()
    .dev()
    .saveExact()
    .packageJson()
    .packages("npm:express", "npm:cors")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "add",
    "--dev",
    "--save-exact",
    "--package-json",
    "npm:express",
    "npm:cors",
  ]);
});

Deno.test("add: lock flags come from the shared base, once", () => {
  const argv = new DenoAddSettings()
    .frozen()
    .noLock()
    .lock("custom.lock")
    .lockfileOnly()
    .packages("jsr:@std/assert")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "add",
    "--frozen",
    "--no-lock",
    "--lock",
    "custom.lock",
    "--lockfile-only",
    "jsr:@std/assert",
  ]);
});

Deno.test("add: a registry is recorded once, and two are refused", () => {
  assertEquals(
    new DenoAddSettings().jsr().jsr().packages("x").argv().slice(1),
    ["add", "--jsr", "x"],
  );
  assertEquals(
    new DenoAddSettings().npm().packages("x").argv().slice(1),
    ["add", "--npm", "x"],
  );
  const error = assertThrows(() => new DenoAddSettings().jsr().npm(), Error);
  assertEquals(error.message.includes("registry"), true);
});

Deno.test("add: at least one package is required", () => {
  const error = assertThrows(() => new DenoAddSettings().argv(), Error);
  assertEquals(error.message.includes(".packages()"), true);
});

Deno.test("remove: names trail the flags, and are required", () => {
  assertEquals(
    new DenoRemoveSettings()
      .lockfileOnly()
      .packageJson()
      .packages("express")
      .argv()
      .slice(1),
    ["remove", "--lockfile-only", "--package-json", "express"],
  );
  assertThrows(() => new DenoRemoveSettings().argv(), Error);
});

Deno.test("uninstall: global executable with an install root", () => {
  const argv = new DenoUninstallSettings()
    .global()
    .root("/opt/deno")
    .packages("cspell")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "uninstall",
    "--global",
    "--root",
    "/opt/deno",
    "cspell",
  ]);
});

Deno.test("uninstall: an install root without --global is refused", () => {
  const error = assertThrows(
    () => new DenoUninstallSettings().root("/opt/deno").packages("x").argv(),
    Error,
  );
  assertEquals(error.message.includes(".global()"), true);
});

Deno.test("uninstall: a project dependency needs neither flag", () => {
  assertEquals(
    new DenoUninstallSettings()
      .lockfileOnly()
      .packageJson()
      .packages("express")
      .argv()
      .slice(1),
    ["uninstall", "--lockfile-only", "--package-json", "express"],
  );
  assertThrows(() => new DenoUninstallSettings().argv(), Error);
});

Deno.test("outdated: bare report changes nothing", () => {
  assertEquals(new DenoOutdatedSettings().argv().slice(1), ["outdated"]);
});

Deno.test("outdated: filters trail the flags", () => {
  const argv = new DenoOutdatedSettings()
    .compatible()
    .recursive()
    .update()
    .lockfileOnly()
    .filters("@std/*")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "outdated",
    "--compatible",
    "--recursive",
    "--update",
    "--lockfile-only",
    "@std/*",
  ]);
});

Deno.test("outdated: --compatible and --latest are mutually exclusive", () => {
  assertEquals(new DenoOutdatedSettings().latest().latest().argv().slice(1), [
    "outdated",
    "--latest",
  ]);
  const error = assertThrows(
    () => new DenoOutdatedSettings().compatible().latest(),
    Error,
  );
  assertEquals(error.message.includes("--latest"), true);
});

Deno.test("why: the package operand is required and comes last", () => {
  assertEquals(
    new DenoWhySettings().frozen().packageName("express@4.18.2").argv().slice(
      1,
    ),
    ["why", "--frozen", "express@4.18.2"],
  );
  const error = assertThrows(() => new DenoWhySettings().argv(), Error);
  assertEquals(error.message.includes(".packageName()"), true);
});

Deno.test("ci: production install with types skipped", () => {
  assertEquals(new DenoCiSettings().argv().slice(1), ["ci"]);
  assertEquals(
    new DenoCiSettings().prod().skipTypes().envFile(".env.ci").argv().slice(1),
    ["ci", "--prod", "--skip-types", "--env-file=.env.ci"],
  );
});

Deno.test("approveScripts: an empty selection would prompt, so it is refused", () => {
  const error = assertThrows(
    () => new DenoApproveScriptsSettings().argv(),
    Error,
  );
  assertEquals(error.message.includes("prompt"), true);
  assertEquals(
    new DenoApproveScriptsSettings()
      .lockfileOnly()
      .packages("npm:esbuild")
      .argv()
      .slice(1),
    ["approve-scripts", "--lockfile-only", "npm:esbuild"],
  );
});

Deno.test("bumpVersion: the increment operand comes last", () => {
  const argv = new DenoBumpVersionSettings()
    .dryRun()
    .workspace()
    .config("deno.json")
    .importMap("imports.json")
    .increment("minor")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "bump-version",
    "--dry-run",
    "--workspace",
    "--config",
    "deno.json",
    "--import-map",
    "imports.json",
    "minor",
  ]);
});

Deno.test("bumpVersion: conventional-commits mode needs no increment", () => {
  const argv = new DenoBumpVersionSettings()
    .noWorkspace()
    .base("main")
    .start("v1.0.0")
    .releaseNotes("Releases.md")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "bump-version",
    "--no-workspace",
    "--base",
    "main",
    "--start",
    "v1.0.0",
    "--release-notes",
    "Releases.md",
  ]);
});

Deno.test("bumpVersion: --workspace and --no-workspace are mutually exclusive", () => {
  assertEquals(
    new DenoBumpVersionSettings().workspace().workspace().argv().slice(1),
    ["bump-version", "--workspace"],
  );
  const error = assertThrows(
    () => new DenoBumpVersionSettings().workspace().noWorkspace(),
    Error,
  );
  assertEquals(error.message.includes("--no-workspace"), true);
});

Deno.test("pack: ignore patterns join into one flag, files trail", () => {
  const argv = new DenoPackSettings()
    .allowDirty()
    .allowSlowTypes()
    .dryRun()
    .noSourceMaps()
    .output("pkg.tgz")
    .setVersion("1.2.3")
    .config("deno.json")
    .ignore("tests", "fixtures")
    .files("src/**")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "pack",
    "--allow-dirty",
    "--allow-slow-types",
    "--dry-run",
    "--no-source-maps",
    "--output",
    "pkg.tgz",
    "--set-version",
    "1.2.3",
    "--config",
    "deno.json",
    "--ignore=tests,fixtures",
    "src/**",
  ]);
  assertEquals(new DenoPackSettings().argv().slice(1), ["pack"]);
});
