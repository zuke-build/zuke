// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * One test per subcommand that sets *every* flag the wrapper exposes for it
 * and pins the whole argv.
 *
 * These are the flag-by-flag contract: a renamed flag, a dropped one, or a
 * value rendered in the wrong form (`--flag value` where deno wants
 * `--flag=value`) shows up here rather than in a build that silently did
 * something else. Each expected argv was run through `deno 2.8.3` itself
 * before being written down, so these are argvs the real CLI accepts, not
 * only argvs this wrapper happens to produce.
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  DenoCheckSettings,
  DenoDocSettings,
  DenoFmtSettings,
  DenoInstallSettings,
  DenoLintSettings,
  DenoRunSettings,
  DenoTaskSettings,
  DenoTestSettings,
} from "../mod.ts";

Deno.test("run: every flag the wrapper exposes", () => {
  const argv = new DenoRunSettings()
    .allowAll()
    .frozen()
    .config("deno.json")
    .lock("a.lock")
    .importMap("i.json")
    .cachedOnly()
    .noNpm()
    .noRemote()
    .nodeModulesDir("auto")
    .nodeModulesLinker("isolated")
    .vendor(true)
    .reload("npm:")
    .cert("ca.pem")
    .envFile(".env")
    .location("http://x/")
    .seed(1)
    .v8Flags("--f")
    .conditions("dev")
    .preload("p.ts")
    .require("r.cjs")
    .noCodeCache()
    .allowScripts("npm:a")
    .typeCheck("all")
    .inspectWait("127.0.0.1:9229")
    .watch()
    .watchExclude("d")
    .noClearScreen()
    .script("m.ts")
    .scriptArgs("-v")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "run",
    "--allow-all",
    "--frozen",
    "--config",
    "deno.json",
    "--lock",
    "a.lock",
    "--import-map",
    "i.json",
    "--no-npm",
    "--no-remote",
    "--cached-only",
    "--vendor=true",
    "--node-modules-dir=auto",
    "--node-modules-linker=isolated",
    "--reload=npm:",
    "--cert",
    "ca.pem",
    "--env-file=.env",
    "--location",
    "http://x/",
    "--seed",
    "1",
    "--conditions",
    "dev",
    "--preload",
    "p.ts",
    "--require",
    "r.cjs",
    "--allow-scripts=npm:a",
    "--no-code-cache",
    "--v8-flags=--f",
    "--check=all",
    "--inspect-wait=127.0.0.1:9229",
    "--watch",
    "--watch-exclude=d",
    "--no-clear-screen",
    "m.ts",
    "-v",
  ]);
});

Deno.test("task: every flag the wrapper exposes", () => {
  const argv = new DenoTaskSettings()
    .config("deno.json")
    .frozen()
    .lock("a.lock")
    .nodeModulesDir("none")
    .nodeModulesLinker("hoisted")
    .envFile(".env")
    .taskCwd("pkg")
    .recursive()
    .filter("f")
    .noPrefix()
    .evalShell()
    .name("build")
    .taskArgs("-v")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "task",
    "--config",
    "deno.json",
    "--frozen",
    "--lock",
    "a.lock",
    "--node-modules-dir=none",
    "--node-modules-linker=hoisted",
    "--env-file=.env",
    "--cwd",
    "pkg",
    "--recursive",
    "--filter",
    "f",
    "--no-prefix",
    "--eval",
    "build",
    "-v",
  ]);
});

Deno.test("check: every flag the wrapper exposes", () => {
  // --no-remote is left out: deno refuses it beside --all, which this sets.
  const argv = new DenoCheckSettings()
    .config("deno.json")
    .frozen()
    .lock("a.lock")
    .importMap("i.json")
    .noNpm()
    .nodeModulesDir("manual")
    .nodeModulesLinker("isolated")
    .vendor(false)
    .reload()
    .all()
    .docOnly()
    .checkJs()
    .watch()
    .watchExclude("d")
    .noClearScreen()
    .paths("mod.ts")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "check",
    "--config",
    "deno.json",
    "--frozen",
    "--lock",
    "a.lock",
    "--import-map",
    "i.json",
    "--no-npm",
    "--vendor=false",
    "--node-modules-dir=manual",
    "--node-modules-linker=isolated",
    "--reload",
    "--all",
    "--doc-only",
    "--check-js",
    "--watch",
    "--watch-exclude=d",
    "--no-clear-screen",
    "mod.ts",
  ]);
});

Deno.test("check: --no-lock and --doc, the two the exhaustive run excludes", () => {
  assertEquals(
    new DenoCheckSettings().noLock().doc().noRemote().paths("mod.ts").argv()
      .slice(1),
    ["check", "--no-lock", "--no-remote", "--doc", "mod.ts"],
  );
});

Deno.test("fmt: every flag the wrapper exposes", () => {
  const argv = new DenoFmtSettings()
    .config("deno.json")
    .check()
    .failFast()
    .lineWidth(90)
    .indentWidth(3)
    .useTabs()
    .singleQuote()
    .noSemicolons()
    .proseWrap("never")
    .unstableComponent()
    .unstableSql()
    .ext("md")
    .ignore("v")
    .permitNoFiles()
    .watch()
    .watchExclude("d")
    .noClearScreen()
    .paths("docs/")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "fmt",
    "--config",
    "deno.json",
    "--check",
    "--fail-fast",
    "--line-width",
    "90",
    "--indent-width",
    "3",
    "--use-tabs=true",
    "--single-quote=true",
    "--no-semicolons=true",
    "--prose-wrap",
    "never",
    "--unstable-component",
    "--unstable-sql",
    "--ext",
    "md",
    "--ignore=v",
    "--permit-no-files",
    "--watch",
    "--watch-exclude=d",
    "--no-clear-screen",
    "docs/",
  ]);
  assertEquals(new DenoFmtSettings().noConfig().argv().slice(1), [
    "fmt",
    "--no-config",
  ]);
});

Deno.test("lint: every flag the wrapper exposes", () => {
  const argv = new DenoLintSettings()
    .config("deno.json")
    .fix()
    .compact()
    .rulesTags("recommended")
    .rulesInclude("a")
    .rulesExclude("b")
    .ext("ts")
    .ignore("v")
    .permitNoFiles()
    .watch()
    .watchExclude("d")
    .noClearScreen()
    .paths("src/")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "lint",
    "--config",
    "deno.json",
    "--fix",
    "--compact",
    "--rules-tags=recommended",
    "--rules-include=a",
    "--rules-exclude=b",
    "--ext",
    "ts",
    "--ignore=v",
    "--permit-no-files",
    "--watch",
    "--watch-exclude=d",
    "--no-clear-screen",
    "src/",
  ]);
  assertEquals(new DenoLintSettings().noConfig().argv().slice(1), [
    "lint",
    "--no-config",
  ]);
});

Deno.test("doc: every flag the wrapper exposes", () => {
  const argv = new DenoDocSettings()
    .frozen()
    .noLock()
    .lock("a.lock")
    .importMap("i.json")
    .noNpm()
    .noRemote()
    .reload("npm:")
    .json()
    .lint()
    .private()
    .name("N")
    .output("o")
    .stripTrailingHtml()
    .categoryDocs("c.json")
    .symbolRedirectMap("s.json")
    .defaultSymbolMap("d.json")
    .filter("A.b")
    .paths("mod.ts")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "doc",
    "--frozen",
    "--no-lock",
    "--lock",
    "a.lock",
    "--import-map",
    "i.json",
    "--no-npm",
    "--no-remote",
    "--reload=npm:",
    "--json",
    "--lint",
    "--private",
    "--name",
    "N",
    "--output",
    "o",
    "--strip-trailing-html",
    "--category-docs=c.json",
    "--symbol-redirect-map=s.json",
    "--default-symbol-map=d.json",
    "--filter",
    "A.b",
    "mod.ts",
  ]);
});

Deno.test("install: every flag a project install exposes", () => {
  const argv = new DenoInstallSettings()
    .allowAll()
    .frozen()
    .config("deno.json")
    .lock("a.lock")
    .importMap("i.json")
    .cachedOnly()
    .nodeModulesDir("auto")
    .nodeModulesLinker("hoisted")
    .vendor(true)
    .reload()
    .envFile(".env")
    .conditions("dev")
    .preload("p.ts")
    .require("r.cjs")
    .allowScripts()
    .typeCheck()
    .inspect("127.0.0.1:9230")
    .force()
    .dev()
    .saveExact()
    .lockfileOnly()
    .skipTypes()
    .npm()
    .packageJson()
    .argv()
    .slice(1);
  assertEquals(argv, [
    "install",
    "--allow-all",
    "--frozen",
    "--config",
    "deno.json",
    "--lock",
    "a.lock",
    "--import-map",
    "i.json",
    "--cached-only",
    "--vendor=true",
    "--node-modules-dir=auto",
    "--node-modules-linker=hoisted",
    "--reload",
    "--env-file=.env",
    "--conditions",
    "dev",
    "--preload",
    "p.ts",
    "--require",
    "r.cjs",
    "--allow-scripts",
    "--check",
    "--inspect=127.0.0.1:9230",
    "--force",
    "--dev",
    "--save-exact",
    "--lockfile-only",
    "--skip-types",
    "--npm",
    "--package-json",
  ]);
  assertEquals(
    new DenoInstallSettings().noConfig().noLock().prod().argv().slice(1),
    ["install", "--no-config", "--no-lock", "--prod"],
  );
});

Deno.test("install: entrypoint belongs to the executable side, not the project one", () => {
  // deno accepts --entrypoint with --prod and --lockfile-only, and refuses it
  // with the rest of the dependency flags.
  assertEquals(
    new DenoInstallSettings()
      .compile()
      .entrypoint("cli.ts")
      .prod()
      .lockfileOnly()
      .argv()
      .slice(1),
    [
      "install",
      "--prod",
      "--lockfile-only",
      "--compile",
      "--entrypoint",
      "cli.ts",
    ],
  );
});

Deno.test("install: every flag a global install exposes", () => {
  // --global takes the executable-shaped flags; the project-dependency ones
  // are refused beside it, which the guard test covers.
  assertEquals(
    new DenoInstallSettings()
      .allowAll()
      .frozen()
      .global()
      .force()
      .skipTypes()
      .root("r")
      .name("n")
      .module("npm:x")
      .moduleArgs("-a")
      .argv()
      .slice(1),
    [
      "install",
      "--allow-all",
      "--frozen",
      "--global",
      "--force",
      "--skip-types",
      "--root",
      "r",
      "--name",
      "n",
      "npm:x",
      "--",
      "-a",
    ],
  );
});

Deno.test("test: every flag the wrapper exposes", () => {
  const argv = new DenoTestSettings()
    .allowAll()
    .config("deno.json")
    .lock("a.lock")
    .importMap("i.json")
    .cachedOnly()
    .nodeModulesDir("auto")
    .nodeModulesLinker("hoisted")
    .vendor(true)
    .reload()
    .cert("c.pem")
    .envFile(".env")
    .location("http://x/")
    .seed(2)
    .v8Flags("--g")
    .conditions("dev", "browser")
    .preload("p.ts")
    .require("r.cjs")
    .allowScripts("npm:b")
    .noCheck("remote")
    .coverage("cov")
    .clean()
    .coverageRawDataOnly()
    .filter("f")
    .parallel()
    .failFast(2)
    .doc()
    .noRun()
    .shuffle(3)
    .traceLeaks()
    .sanitizeOps()
    .sanitizeResources()
    .hideStacktraces()
    .reporter("tap")
    .junitPath("r.xml")
    .ext("ts")
    .ignore("v")
    .permitNoFiles()
    .paths("t/")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "test",
    "--allow-all",
    "--config",
    "deno.json",
    "--lock",
    "a.lock",
    "--import-map",
    "i.json",
    "--cached-only",
    "--vendor=true",
    "--node-modules-dir=auto",
    "--node-modules-linker=hoisted",
    "--reload",
    "--cert",
    "c.pem",
    "--env-file=.env",
    "--location",
    "http://x/",
    "--seed",
    "2",
    "--conditions",
    "dev,browser",
    "--preload",
    "p.ts",
    "--require",
    "r.cjs",
    "--allow-scripts=npm:b",
    "--v8-flags=--g",
    "--no-check=remote",
    "--coverage=cov",
    "--clean",
    "--coverage-raw-data-only",
    "--filter",
    "f",
    "--parallel",
    "--fail-fast=2",
    "--doc",
    "--no-run",
    "--shuffle=3",
    "--trace-leaks",
    "--sanitize-ops",
    "--sanitize-resources",
    "--hide-stacktraces",
    "--reporter",
    "tap",
    "--junit-path",
    "r.xml",
    "--ext",
    "ts",
    "--ignore=v",
    "--permit-no-files",
    "t/",
  ]);
  assertEquals(
    new DenoTestSettings().noConfig().noLock().noNpm().noRemote().argv()
      .slice(1),
    ["test", "--no-config", "--no-lock", "--no-npm", "--no-remote"],
  );
});
