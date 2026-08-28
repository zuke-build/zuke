// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  NpmCacheSettings,
  NpmConfigSettings,
  NpmInitSettings,
  NpmPkgSettings,
  NpmTasks,
} from "../mod.ts";
import { parsePkgField } from "../src/project.ts";

Deno.test("init renders the initializer and forwards its arguments", () => {
  assertEquals(new NpmInitSettings().yes().argv().slice(1), ["init", "--yes"]);
  assertEquals(
    new NpmInitSettings().yes().scope("@acme").initializer("vite")
      .initArgs("--template", "vanilla-ts").argv().slice(1),
    [
      "init",
      "--yes",
      "--scope=@acme",
      "vite",
      "--",
      "--template",
      "vanilla-ts",
    ],
  );
  // Arguments with nothing to forward them to would be silently dropped.
  assertThrows(
    () => new NpmInitSettings().initArgs("--template").argv(),
    Error,
    "NpmTasks.init: .initArgs(...) are passed to an initializer",
  );
});

Deno.test("pkg renders each operation", () => {
  assertEquals(new NpmPkgSettings().get("version").argv().slice(1), [
    "pkg",
    "get",
    "version",
  ]);
  assertEquals(
    new NpmPkgSettings().set("version=1.2.3", "private=true").argv().slice(1),
    ["pkg", "set", "version=1.2.3", "private=true"],
  );
  assertEquals(
    new NpmPkgSettings().deleteKeys("scripts.postinstall").force()
      .argv().slice(1),
    ["pkg", "delete", "scripts.postinstall", "--force"],
  );
  assertEquals(new NpmPkgSettings().fix().argv().slice(1), ["pkg", "fix"]);
});

Deno.test("pkg refuses an operation npm would misread", () => {
  assertThrows(
    () => new NpmPkgSettings().argv(),
    Error,
    "NpmTasks.pkg: no operation",
  );
  assertThrows(
    () => new NpmPkgSettings().get().argv(),
    Error,
    "NpmTasks.pkg: .get(...) needs at least one key",
  );
  // `npm pkg set version` (no `=`) sets nothing and reports no error, which is
  // the silent no-op this refuses.
  assertThrows(
    () => new NpmPkgSettings().set("version").argv(),
    Error,
    'NpmTasks.pkg: .set(...) takes npm\'s "key=value" form',
  );
});

Deno.test("config renders each operation and its location", () => {
  assertEquals(
    new NpmConfigSettings().set("registry=https://r.example.test/")
      .location("project").argv().slice(1),
    ["config", "set", "registry=https://r.example.test/", "--location=project"],
  );
  assertEquals(new NpmConfigSettings().get("registry").argv().slice(1), [
    "config",
    "get",
    "registry",
  ]);
  assertEquals(
    new NpmConfigSettings().deleteKeys("proxy").argv().slice(1),
    ["config", "delete", "proxy"],
  );
  assertEquals(new NpmConfigSettings().list().long().argv().slice(1), [
    "config",
    "list",
    "--long",
  ]);
  assertEquals(new NpmConfigSettings().fix().argv().slice(1), [
    "config",
    "fix",
  ]);
  assertThrows(
    () => new NpmConfigSettings().argv(),
    Error,
    "NpmTasks.config: no operation",
  );
});

Deno.test("cache verifies by default and refuses an unforced clean", () => {
  assertEquals(new NpmCacheSettings().argv().slice(1), ["cache", "verify"]);
  assertEquals(
    new NpmCacheSettings().add("react@18").argv().slice(1),
    ["cache", "add", "react@18"],
  );
  assertEquals(new NpmCacheSettings().ls().argv().slice(1), ["cache", "ls"]);
  assertEquals(
    new NpmCacheSettings().clean().force().cache(".npm-cache").argv().slice(1),
    ["cache", "clean", "--force", "--cache=.npm-cache"],
  );
  // npm itself refuses this; saying so here beats an opaque exit code.
  assertThrows(
    () => new NpmCacheSettings().clean().argv(),
    Error,
    "NpmTasks.cache: npm refuses to empty the cache without --force",
  );
  assertThrows(
    () => new NpmCacheSettings().add().argv(),
    Error,
    "NpmTasks.cache: .add(...) needs the package spec",
  );
});

Deno.test("pkgGet reads a missing field as undefined rather than failing", async () => {
  // Hermetic: the running `deno` stands in for npm and exits non-zero, which
  // is what `npm pkg get` does outside a package.
  const value = await NpmTasks.pkgGet(
    "version",
    (s) => s.toolPath(Deno.execPath()).quiet(),
  );
  assertEquals(value, undefined);
});

Deno.test("the project tasks reach execution", async () => {
  await assertRejects(() => NpmTasks.init(missingTool), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.pkg((s) => missingTool(s).get("version")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NpmTasks.config((s) => missingTool(s).list()),
    ToolNotFoundError,
  );
  await assertRejects(() => NpmTasks.cache(missingTool), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.pkgGet("version", (s) => missingTool(s)),
    ToolNotFoundError,
  );
});

Deno.test("the remaining tasks reach execution", async () => {
  await assertRejects(() => NpmTasks.dedupe(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.prune(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.rebuild(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.link(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.update(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.test(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.pack(missingTool), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.uninstall((s) => missingTool(s).packages("x")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NpmTasks.unpublish((s) => missingTool(s).spec("app@1.0.0")),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      NpmTasks.deprecate((s) => missingTool(s).spec("app@1").message("old")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NpmTasks.distTag((s) => missingTool(s).ls("app")),
    ToolNotFoundError,
  );
});

Deno.test("init renders an initializer without arguments, and a bare init", () => {
  assertEquals(new NpmInitSettings().initializer("vite").argv().slice(1), [
    "init",
    "vite",
  ]);
  assertEquals(new NpmInitSettings().workspaces().argv().slice(1), [
    "init",
    "--workspaces",
  ]);
});

Deno.test("cache ls narrows to a spec, and add takes several", () => {
  assertEquals(new NpmCacheSettings().ls("react@18").argv().slice(1), [
    "cache",
    "ls",
    "react@18",
  ]);
  assertEquals(
    new NpmCacheSettings().add("react@18", "vue@3").argv().slice(1),
    ["cache", "add", "react@18", "vue@3"],
  );
  assertEquals(
    new NpmCacheSettings().clean("registry.npmjs.org").force().argv().slice(1),
    ["cache", "clean", "registry.npmjs.org", "--force"],
  );
});

Deno.test("pkg and config carry workspace and location selection", () => {
  assertEquals(
    new NpmPkgSettings().get("version").workspace("app").argv().slice(1),
    ["pkg", "get", "version", "--workspace=app"],
  );
  assertEquals(
    new NpmConfigSettings().get("registry").location("global").argv().slice(1),
    ["config", "get", "registry", "--location=global"],
  );
});

Deno.test("pkg refuses each keyless operation by its own name", () => {
  assertThrows(
    () => new NpmPkgSettings().deleteKeys().argv(),
    Error,
    "NpmTasks.pkg: .deleteKeys(...) needs at least one key",
  );
  assertThrows(
    () => new NpmPkgSettings().set().argv(),
    Error,
    "NpmTasks.pkg: .set(...) needs at least one key",
  );
});

Deno.test("parsePkgField unwraps every shape npm answers with", () => {
  // A scalar field comes back as bare JSON.
  assertEquals(parsePkgField('"1.2.3"', "version"), "1.2.3");
  assertEquals(parsePkgField("42", "port"), "42");
  assertEquals(parsePkgField("true", "private"), "true");
  // Within a workspace, or for several keys, npm keys the answer.
  assertEquals(parsePkgField('{"version":"1.2.3"}', "version"), "1.2.3");
  assertEquals(parsePkgField('{"private":true}', "private"), "true");
  // An unset field is `{}`; a structured one has no single string to give.
  assertEquals(parsePkgField("{}", "version"), undefined);
  assertEquals(
    parsePkgField('{"scripts":{"build":"x"}}', "scripts"),
    undefined,
  );
  assertEquals(parsePkgField('{"files":["dist"]}', "files"), undefined);
  assertEquals(parsePkgField("null", "version"), undefined);
  // Not JSON at all — an npm error page, or a proxy's HTML.
  assertEquals(parsePkgField("", "version"), undefined);
  assertEquals(parsePkgField("npm ERR! code ENOENT", "version"), undefined);
});
