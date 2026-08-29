// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import { DenoTasks, parseCacheInfo, parseModuleGraph } from "../mod.ts";

Deno.test("parseModuleGraph: roots, modules, dependencies and redirects", () => {
  const graph = parseModuleGraph(JSON.stringify({
    roots: ["file:///a/mod.ts", 7],
    modules: [
      {
        kind: "esm",
        specifier: "file:///a/mod.ts",
        local: "/a/mod.ts",
        size: 120,
        mediaType: "TypeScript",
        dependencies: [
          { specifier: "./b.ts" },
          { specifier: "./missing.ts", error: "Module not found" },
          { error: "no specifier here" },
          "not an object",
        ],
      },
      { specifier: "file:///a/b.ts" },
      { kind: "esm" },
      "not an object",
    ],
    redirects: { "https://x/a": "https://x/b", "https://x/c": 3 },
  }));
  assertEquals(graph.roots, ["file:///a/mod.ts"]);
  assertEquals(graph.modules.length, 2);
  assertEquals(graph.modules[0].kind, "esm");
  assertEquals(graph.modules[0].size, 120);
  assertEquals(graph.modules[0].mediaType, "TypeScript");
  assertEquals(graph.modules[0].local, "/a/mod.ts");
  assertEquals(graph.modules[0].dependencies, [
    { specifier: "./b.ts", error: undefined },
    { specifier: "./missing.ts", error: "Module not found" },
  ]);
  assertEquals(graph.modules[1].dependencies, []);
  assertEquals(graph.modules[1].size, undefined);
  assertEquals(graph.redirects, { "https://x/a": "https://x/b" });
});

Deno.test("parseModuleGraph: an error entry keeps its specifier and reason", () => {
  const graph = parseModuleGraph(JSON.stringify({
    roots: [],
    modules: [{ specifier: "file:///gone.ts", error: "Module not found" }],
  }));
  assertEquals(graph.modules[0].error, "Module not found");
  assertEquals(graph.modules[0].kind, undefined);
  assertEquals(graph.redirects, {});
});

Deno.test("parseModuleGraph: a report with no modules is empty, not a failure", () => {
  const graph = parseModuleGraph(JSON.stringify({}));
  assertEquals(graph, { roots: [], modules: [], redirects: {} });
});

Deno.test("parseModuleGraph: non-JSON and non-object reports name the task", () => {
  const notJson = assertThrows(
    () => parseModuleGraph("deno: not found"),
    Error,
  );
  assertEquals(notJson.message.includes("DenoTasks.moduleGraph"), true);
  assertEquals(notJson.message.includes("did not emit JSON"), true);

  const array = assertThrows(() => parseModuleGraph("[]"), Error);
  assertEquals(array.message.includes("an array"), true);
  const scalar = assertThrows(() => parseModuleGraph("42"), Error);
  assertEquals(scalar.message.includes("number"), true);
});

Deno.test("parseCacheInfo: every documented location, and missing ones", () => {
  const info = parseCacheInfo(JSON.stringify({
    version: 1,
    denoVersion: "2.8.3",
    denoDir: "/cache/deno",
    modulesCache: "/cache/deno/remote",
    npmCache: "/cache/deno/npm",
    typescriptCache: "/cache/deno/gen",
    registryCache: "/cache/deno/registries",
    originStorage: 12,
  }));
  assertEquals(info.denoVersion, "2.8.3");
  assertEquals(info.denoDir, "/cache/deno");
  assertEquals(info.npmCache, "/cache/deno/npm");
  assertEquals(info.registryCache, "/cache/deno/registries");
  assertEquals(info.originStorage, undefined);
  assertEquals(parseCacheInfo("{}").denoDir, undefined);
});

Deno.test("parseCacheInfo: a non-object report names its own task", () => {
  const error = assertThrows(() => parseCacheInfo("null"), Error);
  assertEquals(error.message.includes("DenoTasks.cacheInfo"), true);
});

Deno.test("moduleGraph: a module is required, cacheInfo refuses one", async () => {
  const missing = await assertRejects(
    () => DenoTasks.moduleGraph(missingTool),
    Error,
  );
  assertEquals(missing.message.includes(".path() is required"), true);

  const extra = await assertRejects(
    () => DenoTasks.cacheInfo((s) => missingTool(s).path("mod.ts")),
    Error,
  );
  assertEquals(extra.message.includes("DenoTasks.moduleGraph()"), true);
});

Deno.test("the readers fail loudly when deno is missing", async () => {
  await assertRejects(
    () => DenoTasks.moduleGraph((s) => missingTool(s).path("mod.ts")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => DenoTasks.cacheInfo(missingTool),
    ToolNotFoundError,
  );
});

Deno.test("moduleGraph: the real deno info reports a self-contained module", async () => {
  // Hermetic: the settings class defaults to Deno.execPath(), so this drives
  // the deno already running the suite, and the fixture imports nothing, so
  // building its graph needs no network. The fixture is addressed by file URL
  // rather than by a built path — that string is identical on every OS, where
  // an interpolated path is not, which is what made an earlier version of this
  // test read a not-found module on Windows.
  const entry = new URL("./fixtures/self_contained.ts", import.meta.url).href;
  const graph = await DenoTasks.moduleGraph((s) => s.path(entry));
  assertEquals(graph.roots.length, 1);
  assertEquals(graph.roots[0].endsWith("/fixtures/self_contained.ts"), true);
  assertEquals(graph.modules.length, 1);
  // Asserted before the shape below: a module deno could not load carries an
  // error and none of the rest, so naming the error first says why.
  assertEquals(graph.modules[0].error, undefined);
  assertEquals(graph.modules[0].specifier, graph.roots[0]);
  assertEquals(graph.modules[0].kind, "esm");
  assertEquals(graph.modules[0].mediaType, "TypeScript");
  assertEquals(graph.modules[0].dependencies, []);
});

Deno.test("moduleGraph: a module deno cannot load comes back as an error entry", async () => {
  // deno info exits 0 for a module it could not resolve and reports the
  // failure as data, so the reader must surface it rather than the run
  // throwing — a build reading the graph needs to see which module is broken.
  const missing = new URL("./fixtures/not_here.ts", import.meta.url).href;
  const graph = await DenoTasks.moduleGraph((s) => s.path(missing));
  assertEquals(graph.modules.length, 1);
  assertEquals(graph.modules[0].specifier.endsWith("/not_here.ts"), true);
  assertEquals(graph.modules[0].mediaType, undefined);
  assertEquals(typeof graph.modules[0].error, "string");
});

Deno.test("cacheInfo: the real deno info reports its cache directories", async () => {
  const info = await DenoTasks.cacheInfo();
  assertEquals(typeof info.denoDir, "string");
  assertEquals(info.denoDir !== "", true);
  assertEquals(typeof info.npmCache, "string");
});
