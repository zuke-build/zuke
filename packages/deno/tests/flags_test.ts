// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  DenoCheckSettings,
  DenoCoverageSettings,
  DenoDocSettings,
  DenoFmtSettings,
  DenoInstallSettings,
  DenoLintSettings,
  DenoPublishSettings,
  DenoRunSettings,
  DenoTaskSettings,
  DenoTestSettings,
} from "../mod.ts";

Deno.test("test: the reporting flags a CI run needs", () => {
  const argv = new DenoTestSettings()
    .allowAll()
    .reporter("junit")
    .junitPath("report.xml")
    .traceLeaks()
    .shuffle(7)
    .failFast(3)
    .doc()
    .hideStacktraces()
    .argv()
    .slice(1);
  assertEquals(argv, [
    "test",
    "--allow-all",
    "--fail-fast=3",
    "--doc",
    "--shuffle=7",
    "--trace-leaks",
    "--hide-stacktraces",
    "--reporter",
    "junit",
    "--junit-path",
    "report.xml",
  ]);
});

Deno.test("test: shuffle and fail-fast render bare without a value", () => {
  assertEquals(
    new DenoTestSettings().shuffle().failFast().noRun().argv().slice(1),
    ["test", "--fail-fast", "--no-run", "--shuffle"],
  );
});

Deno.test("test: the coverage-shaping flags stand on their own", () => {
  // deno accepts both without --coverage, and DENO_COVERAGE_DIR can name the
  // directory instead, so neither is tied to the .coverage() setter.
  assertEquals(
    new DenoTestSettings().clean().coverageRawDataOnly().argv().slice(1),
    ["test", "--clean", "--coverage-raw-data-only"],
  );
  assertEquals(
    new DenoTestSettings()
      .coverage("cov")
      .clean()
      .coverageRawDataOnly()
      .argv()
      .slice(1),
    ["test", "--coverage=cov", "--clean", "--coverage-raw-data-only"],
  );
});

Deno.test("test: file selection and sanitizers", () => {
  assertEquals(
    new DenoTestSettings()
      .sanitizeOps()
      .sanitizeResources()
      .ignore("tests/fixtures", "tests/slow")
      .permitNoFiles()
      .ext("ts")
      .paths("packages/")
      .argv()
      .slice(1),
    [
      "test",
      "--sanitize-ops",
      "--sanitize-resources",
      "--ext",
      "ts",
      "--ignore=tests/fixtures,tests/slow",
      "--permit-no-files",
      "packages/",
    ],
  );
});

Deno.test("test: type-check and no-check contradict each other", () => {
  assertEquals(
    new DenoTestSettings().typeCheck("all").argv().slice(1),
    ["test", "--check=all"],
  );
  assertEquals(
    new DenoTestSettings().noCheck("remote").argv().slice(1),
    ["test", "--no-check=remote"],
  );
  const error = assertThrows(
    () => new DenoTestSettings().typeCheck().noCheck().argv(),
    Error,
  );
  assertEquals(error.message.includes("opposite answers"), true);
});

Deno.test("test: the dependency and runtime groups render once, in order", () => {
  const argv = new DenoTestSettings()
    .config("deno.json")
    .lock("custom.lock")
    .importMap("imports.json")
    .cachedOnly()
    .vendor(false)
    .nodeModulesDir("manual")
    .nodeModulesLinker("hoisted")
    .reload("jsr:@std/assert")
    .envFile(".env")
    .cert("ca.pem")
    .seed(42)
    .v8Flags("--max-old-space-size=4096")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "test",
    "--config",
    "deno.json",
    "--lock",
    "custom.lock",
    "--import-map",
    "imports.json",
    "--cached-only",
    "--vendor=false",
    "--node-modules-dir=manual",
    "--node-modules-linker=hoisted",
    "--reload=jsr:@std/assert",
    "--cert",
    "ca.pem",
    "--env-file=.env",
    "--seed",
    "42",
    "--v8-flags=--max-old-space-size=4096",
  ]);
});

Deno.test("run: watch-hmr replaces watch rather than joining it", () => {
  assertEquals(
    new DenoRunSettings().watch().watchHmr().script("main.ts").argv().slice(1),
    ["run", "--watch-hmr", "main.ts"],
  );
  assertEquals(
    new DenoRunSettings()
      .watch()
      .watchExclude("dist", "cov")
      .noClearScreen()
      .script("main.ts")
      .argv()
      .slice(1),
    [
      "run",
      "--watch",
      "--watch-exclude=dist,cov",
      "--no-clear-screen",
      "main.ts",
    ],
  );
});

Deno.test("run: only one inspector attaches, the last one asked for", () => {
  assertEquals(
    new DenoRunSettings().inspect().script("m.ts").argv().slice(1),
    ["run", "--inspect", "m.ts"],
  );
  assertEquals(
    new DenoRunSettings()
      .inspect()
      .inspectBrk("127.0.0.1:9333")
      .script("m.ts")
      .argv()
      .slice(1),
    ["run", "--inspect-brk=127.0.0.1:9333", "m.ts"],
  );
});

Deno.test("run: a bare reload beats a scoped one", () => {
  assertEquals(
    new DenoRunSettings().reload("npm:").reload().script("m.ts").argv().slice(
      1,
    ),
    ["run", "--reload", "m.ts"],
  );
  assertEquals(
    new DenoRunSettings().reload("npm:", "jsr:@std/assert").script("m.ts")
      .argv().slice(1),
    ["run", "--reload=npm:,jsr:@std/assert", "m.ts"],
  );
});

Deno.test("run: config and no-config contradict each other", () => {
  const error = assertThrows(
    () =>
      new DenoRunSettings().config("a.json").noConfig().script("m.ts").argv(),
    Error,
  );
  assertEquals(error.message.includes("pick one"), true);
});

Deno.test("lint: rule selection and the machine-readable formats", () => {
  const argv = new DenoLintSettings()
    .json()
    .rulesTags("recommended")
    .rulesInclude("ban-untagged-todo")
    .rulesExclude("no-explicit-any", "no-console")
    .ignore("vendor")
    .paths("src/")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "lint",
    "--json",
    "--rules-tags=recommended",
    "--rules-include=ban-untagged-todo",
    "--rules-exclude=no-explicit-any,no-console",
    "--ignore=vendor",
    "src/",
  ]);
});

Deno.test("lint: --json and --compact are one format, not two", () => {
  assertEquals(new DenoLintSettings().compact().compact().argv().slice(1), [
    "lint",
    "--compact",
  ]);
  const error = assertThrows(
    () => new DenoLintSettings().json().compact(),
    Error,
  );
  assertEquals(error.message.includes("report formats"), true);
});

Deno.test("lint: listing the rules silently ignores fixing, so it is refused", () => {
  assertEquals(new DenoLintSettings().listRules().json().argv().slice(1), [
    "lint",
    "--rules",
    "--json",
  ]);
  // deno accepts --rules --fix and just prints the catalogue, so a target
  // that meant to fix would report success having fixed nothing.
  const error = assertThrows(
    () => new DenoLintSettings().listRules().fix().argv(),
    Error,
  );
  assertEquals(error.message.includes("silently ignores"), true);
});

Deno.test("fmt: the style flags render with their explicit values", () => {
  const argv = new DenoFmtSettings()
    .check()
    .failFast()
    .lineWidth(100)
    .indentWidth(4)
    .useTabs()
    .singleQuote()
    .noSemicolons()
    .proseWrap("preserve")
    .unstableComponent()
    .unstableSql()
    .ext("md")
    .ignore("vendor")
    .paths("docs/")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "fmt",
    "--check",
    "--fail-fast",
    "--line-width",
    "100",
    "--indent-width",
    "4",
    "--use-tabs=true",
    "--single-quote=true",
    "--no-semicolons=true",
    "--prose-wrap",
    "preserve",
    "--unstable-component",
    "--unstable-sql",
    "--ext",
    "md",
    "--ignore=vendor",
    "docs/",
  ]);
});

Deno.test("fmt: a boolean style flag can be turned back off explicitly", () => {
  assertEquals(
    new DenoFmtSettings().useTabs(false).singleQuote(false).argv().slice(1),
    ["fmt", "--use-tabs=false", "--single-quote=false"],
  );
});

Deno.test("check: the checking flags, and doc versus doc-only", () => {
  assertEquals(
    new DenoCheckSettings()
      .all()
      .checkJs()
      .doc()
      .vendor()
      .paths("mod.ts")
      .argv()
      .slice(1),
    ["check", "--vendor=true", "--all", "--doc", "--check-js", "mod.ts"],
  );
  const error = assertThrows(
    () => new DenoCheckSettings().doc().docOnly().paths("mod.ts").argv(),
    Error,
  );
  assertEquals(error.message.includes("pick one"), true);
});

Deno.test("check: watching is available here, unlike on doc", () => {
  assertEquals(
    new DenoCheckSettings().watch().paths("mod.ts").argv().slice(1),
    ["check", "--watch", "mod.ts"],
  );
  // deno doc has no File watching options section, so the wrapper offers none.
  assertEquals("watch" in new DenoDocSettings(), false);
  // and deno task has no --vendor, so neither does the wrapper.
  assertEquals("vendor" in new DenoTaskSettings(), false);
  assertEquals("vendor" in new DenoCheckSettings(), true);
  // --cached-only is on run/test/install but not check.
  assertEquals("cachedOnly" in new DenoCheckSettings(), false);
  assertEquals("cachedOnly" in new DenoRunSettings(), true);
  // --watch-hmr is run's alone.
  assertEquals("watchHmr" in new DenoTestSettings(), false);
  assertEquals("watchHmr" in new DenoRunSettings(), true);
});

Deno.test("doc: the HTML-rendering extras, and the two output formats", () => {
  const argv = new DenoDocSettings()
    .html()
    .stripTrailingHtml()
    .categoryDocs("categories.json")
    .symbolRedirectMap("redirects.json")
    .defaultSymbolMap("defaults.json")
    .paths("mod.ts")
    .argv()
    .slice(1);
  assertEquals(argv, [
    "doc",
    "--html",
    "--strip-trailing-html",
    "--category-docs=categories.json",
    "--symbol-redirect-map=redirects.json",
    "--default-symbol-map=defaults.json",
    "mod.ts",
  ]);
  const error = assertThrows(
    () => new DenoDocSettings().json().html().paths("mod.ts").argv(),
    Error,
  );
  assertEquals(error.message.includes("output formats"), true);
});

Deno.test("coverage: html is refused beside lcov, which deno would silently win", () => {
  assertEquals(
    new DenoCoverageSettings()
      .dir("cov")
      .html()
      .detailed()
      .include("^file:///src/")
      .ignore("**/*_test.ts")
      .argv()
      .slice(1),
    [
      "coverage",
      "cov",
      "--html",
      "--detailed",
      "--include=^file:///src/",
      "--ignore=**/*_test.ts",
    ],
  );
  const both = assertThrows(
    () => new DenoCoverageSettings().html().lcov().argv(),
    Error,
  );
  assertEquals(both.message.includes("silently skips"), true);
  const gated = assertThrows(
    () => new DenoCoverageSettings().html().threshold(95).argv(),
    Error,
  );
  assertEquals(gated.message.includes("two calls"), true);
});

Deno.test("task: workspace selection and the task's own directory", () => {
  assertEquals(
    new DenoTaskSettings()
      .recursive()
      .filter("@zuke/*")
      .noPrefix()
      .taskCwd("packages/core")
      .envFile(".env")
      .name("build")
      .taskArgs("--verbose")
      .argv()
      .slice(1),
    [
      "task",
      "--env-file=.env",
      "--cwd",
      "packages/core",
      "--recursive",
      "--filter",
      "@zuke/*",
      "--no-prefix",
      "build",
      "--verbose",
    ],
  );
  // --filter selects members on its own; deno does not require --recursive.
  assertEquals(
    new DenoTaskSettings().filter("@zuke/core").name("build").argv().slice(1),
    ["task", "--filter", "@zuke/core", "build"],
  );
});

Deno.test("task: evaluating a shell command instead of a named task", () => {
  assertEquals(
    new DenoTaskSettings().evalShell().name("echo hi").argv().slice(1),
    ["task", "--eval", "echo hi"],
  );
});

Deno.test("publish: the release flags a version-bumping job needs", () => {
  assertEquals(
    new DenoPublishSettings()
      .setVersion("1.2.3")
      .noProvenance()
      .dryRun()
      .argv()
      .slice(1),
    ["publish", "--dry-run", "--no-provenance", "--set-version", "1.2.3"],
  );
  const error = assertThrows(
    () => new DenoPublishSettings().typeCheck("all").noCheck().argv(),
    Error,
  );
  assertEquals(error.message.includes("opposite answers"), true);
});

Deno.test("install: dependency-set flags, and the cross-compile pair", () => {
  assertEquals(
    new DenoInstallSettings()
      .dev()
      .saveExact()
      .lockfileOnly()
      .skipTypes()
      .jsr()
      .packageJson()
      .argv()
      .slice(1),
    [
      "install",
      "--dev",
      "--save-exact",
      "--lockfile-only",
      "--skip-types",
      "--jsr",
      "--package-json",
    ],
  );
  const both = assertThrows(
    () => new DenoInstallSettings().dev().prod().argv(),
    Error,
  );
  assertEquals(both.message.includes("opposite answers"), true);
  const registry = assertThrows(
    () => new DenoInstallSettings().jsr().npm(),
    Error,
  );
  assertEquals(registry.message.includes("registry"), true);
});

Deno.test("install: os and arch only mean something with a compiled launcher", () => {
  assertEquals(
    new DenoInstallSettings()
      .compile()
      .os("linux")
      .arch("aarch64")
      .entrypoint("cli.ts")
      .root("dist")
      .module("npm:cspell@9")
      .argv()
      .slice(1),
    [
      "install",
      "--compile",
      "--os",
      "linux",
      "--arch",
      "aarch64",
      "--entrypoint",
      "cli.ts",
      "--root",
      "dist",
      "npm:cspell@9",
    ],
  );

  // deno refuses --global beside every project-dependency flag, and the
  // message names whichever ones were set.
  const global = assertThrows(
    () =>
      new DenoInstallSettings()
        .global()
        .compile()
        .os("linux")
        .dev()
        .module("npm:x")
        .argv(),
    Error,
  );
  assertEquals(global.message.includes(".dev()"), true);
  assertEquals(global.message.includes(".os()/.arch()"), true);

  for (
    const [label, configure] of [
      [".prod()", (s: DenoInstallSettings) => s.prod()],
      [".saveExact()", (s: DenoInstallSettings) => s.saveExact()],
      [".lockfileOnly()", (s: DenoInstallSettings) => s.lockfileOnly()],
      [".packageJson()", (s: DenoInstallSettings) => s.packageJson()],
      [".entrypoint()", (s: DenoInstallSettings) => s.entrypoint("c.ts")],
      [".jsr()/.npm()", (s: DenoInstallSettings) => s.jsr()],
    ] as const
  ) {
    const error = assertThrows(
      () =>
        configure(new DenoInstallSettings().global()).module("npm:x").argv(),
      Error,
    );
    assertEquals(error.message.includes(label), true);
  }

  // --skip-types is the one that does combine with --global.
  assertEquals(
    new DenoInstallSettings().global().skipTypes().module("npm:x").argv()
      .slice(1),
    ["install", "--global", "--skip-types", "npm:x"],
  );
  // deno accepts --os without --compile and silently ignores it, so a build
  // that meant to cross-compile would ship a launcher for the wrong platform.
  const error = assertThrows(
    () => new DenoInstallSettings().os("linux").module("npm:x").argv(),
    Error,
  );
  assertEquals(error.message.includes("silently ignores"), true);
});

Deno.test("test: an inspector and coverage cannot share the V8 session", () => {
  // deno itself refuses the pair; both want the inspector session.
  assertEquals(new DenoTestSettings().inspectBrk().argv().slice(1), [
    "test",
    "--inspect-brk",
  ]);
  assertEquals(new DenoTestSettings().coverage("cov").argv().slice(1), [
    "test",
    "--coverage=cov",
  ]);
  const error = assertThrows(
    () => new DenoTestSettings().coverage("cov").inspect().argv(),
    Error,
  );
  assertEquals(error.message.includes("inspector"), true);
});

Deno.test("test: coverage and the watch flags cannot combine", () => {
  assertEquals(
    new DenoTestSettings().watch().watchExclude("d").argv().slice(1),
    ["test", "--watch", "--watch-exclude=d"],
  );
  const error = assertThrows(
    () => new DenoTestSettings().coverage("cov").watch().argv(),
    Error,
  );
  assertEquals(error.message.includes("watch"), true);
});

Deno.test("install: launcher arguments follow the separator deno requires", () => {
  // Without the `--`, deno rejects a flag-shaped launcher argument outright.
  assertEquals(
    new DenoInstallSettings()
      .global()
      .name("cw")
      .module("npm:cowsay")
      .moduleArgs("--foo", 2)
      .argv()
      .slice(1),
    ["install", "--global", "--name", "cw", "npm:cowsay", "--", "--foo", "2"],
  );
  // No arguments, no separator.
  assertEquals(
    new DenoInstallSettings().module("npm:cowsay").argv().slice(1),
    ["install", "npm:cowsay"],
  );
});
