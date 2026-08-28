// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  NpmCiSettings,
  NpmDedupeSettings,
  NpmExecSettings,
  NpmInitSettings,
  NpmInstallSettings,
  NpmLinkSettings,
  NpmPruneSettings,
  NpmRebuildSettings,
  NpmRunSettings,
  NpmTestSettings,
  NpmUninstallSettings,
  NpmUpdateSettings,
} from "../mod.ts";

Deno.test("install renders the save targets and tree options", () => {
  assertEquals(
    new NpmInstallSettings()
      .saveOptional()
      .savePeer()
      .noSave()
      .installStrategy("nested")
      .noAudit()
      .noFund()
      .argv()
      .slice(1),
    [
      "install",
      "--save-optional",
      "--save-peer",
      "--no-save",
      "--install-strategy=nested",
      "--no-audit",
      "--no-fund",
    ],
  );
});

Deno.test("the dependency-group flags are shared by every install-shaped command", () => {
  // One implementation of --omit/--include, so the commands cannot disagree.
  assertEquals(
    new NpmInstallSettings().omit("dev").include("optional").ignoreScripts()
      .argv().slice(1),
    ["install", "--omit=dev", "--include=optional", "--ignore-scripts"],
  );
  assertEquals(
    new NpmPruneSettings().omit("dev").dryRun().argv().slice(1),
    ["prune", "--dry-run", "--omit=dev"],
  );
  assertEquals(
    new NpmDedupeSettings().omit("peer").foregroundScripts().argv().slice(1),
    ["dedupe", "--omit=peer", "--foreground-scripts"],
  );
});

Deno.test("uninstall requires the packages it removes", () => {
  assertThrows(
    () => new NpmUninstallSettings().argv(),
    Error,
    "NpmTasks.uninstall: .packages(...) is required",
  );
  assertEquals(
    new NpmUninstallSettings().noSave().packages("left-pad").argv().slice(1),
    ["uninstall", "--no-save", "left-pad"],
  );
});

Deno.test("update, rebuild, and link render their options and specs", () => {
  assertEquals(
    new NpmUpdateSettings().save().packages("typescript").argv().slice(1),
    ["update", "--save", "typescript"],
  );
  assertEquals(
    new NpmRebuildSettings().noBinLinks().packages("esbuild").argv().slice(1),
    ["rebuild", "--no-bin-links", "esbuild"],
  );
  assertEquals(
    new NpmLinkSettings().saveDev().packages("../lib").argv().slice(1),
    ["link", "--save-dev", "../lib"],
  );
});

Deno.test("the workspace selectors are shared, and refuse an ambiguous pair", () => {
  assertEquals(
    new NpmCiSettings().workspace("app").workspace("web")
      .includeWorkspaceRoot().argv().slice(1),
    ["ci", "--workspace=app", "--workspace=web", "--include-workspace-root"],
  );
  assertEquals(
    new NpmInstallSettings().workspaces().argv().slice(1),
    ["install", "--workspaces"],
  );
  // The check lives in the shared base, so every command reports it the same
  // way — naming the task the build actually called.
  assertThrows(
    () => new NpmCiSettings().workspace("app").workspaces().argv(),
    Error,
    "NpmTasks.ci: .workspace() and .workspaces() are mutually exclusive",
  );
  assertThrows(
    () => new NpmPruneSettings().workspace("app").workspaces().argv(),
    Error,
    "NpmTasks.prune: .workspace() and .workspaces() are mutually exclusive",
  );
});

Deno.test("the npm config flags are accepted on any command, and render last", () => {
  assertEquals(
    new NpmInstallSettings()
      .packages("react")
      .registry("https://registry.example.test/")
      .logLevel("warn")
      .global()
      .argv()
      .slice(1),
    [
      "install",
      "react",
      "--global",
      "--registry=https://registry.example.test/",
      "--loglevel=warn",
    ],
  );
  assertEquals(
    new NpmCiSettings().prefix("app").userconfig(".npmrc.ci").argv().slice(1),
    ["ci", "--prefix=app", "--userconfig=.npmrc.ci"],
  );
});

Deno.test("install renders the save flags the existing suite does not reach", () => {
  assertEquals(
    new NpmInstallSettings().saveDev().saveExact().argv().slice(1),
    ["install", "--save-dev", "--save-exact"],
  );
  assertEquals(
    new NpmCiSettings().noAudit().noFund().argv().slice(1),
    ["ci", "--no-audit", "--no-fund"],
  );
});

Deno.test("a config flag never lands past npm's -- separator", () => {
  // Everything after `--` belongs to the script or the executed command, not
  // to npm. Appending config flags blindly gave the script a `--json` it never
  // asked for and left npm's own output unchanged.
  assertEquals(
    new NpmRunSettings().script("build").scriptArgs("--watch").json()
      .argv().slice(1),
    ["run", "build", "--json", "--", "--watch"],
  );
  assertEquals(
    new NpmExecSettings().command("tsc").execArgs("--noEmit")
      .registry("https://r.example.test/").argv().slice(1),
    ["exec", "tsc", "--registry=https://r.example.test/", "--", "--noEmit"],
  );
  assertEquals(
    new NpmTestSettings().testArgs("--coverage").logLevel("silly")
      .argv().slice(1),
    ["test", "--loglevel=silly", "--", "--coverage"],
  );
  assertEquals(
    new NpmInitSettings().initializer("vite").initArgs("--template", "vue")
      .global().argv().slice(1),
    ["init", "vite", "--global", "--", "--template", "vue"],
  );
  // With no separator the flags simply follow, as before.
  assertEquals(
    new NpmInstallSettings().json().argv().slice(1),
    ["install", "--json"],
  );
});
