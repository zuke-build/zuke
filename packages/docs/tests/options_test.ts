import { assertEquals } from "../../core/tests/_assert.ts";
import { resolveOptions } from "../src/options.ts";

Deno.test("resolveOptions fills in every default", () => {
  const o = resolveOptions({});
  assertEquals(o.packagesDir, "packages");
  assertEquals(o.scope, "@zuke");
  assertEquals(o.jsrBaseUrl, "https://jsr.io");
  assertEquals(o.index, "llms.txt");
  assertEquals(o.full, "llms-full.txt");
  assertEquals(o.readmes, true);
  assertEquals(o.regenerateCommand, "deno task docs");
  // the default project framing derives its blurb from the scope
  assertEquals(o.project.title, "@zuke");
  assertEquals(o.project.summary.includes("@zuke"), true);
});

Deno.test("resolveOptions keeps the default project blurb scoped to the override", () => {
  const o = resolveOptions({ scope: "@acme" });
  assertEquals(o.project.title, "@acme");
  assertEquals(o.project.summary.includes("@acme"), true);
});

Deno.test("resolveOptions honours every override", () => {
  const project = { title: "Acme", summary: "s", example: "e", install: "i" };
  const o = resolveOptions({
    packagesDir: "libs",
    scope: "@acme",
    jsrBaseUrl: "https://example.test",
    index: "a.txt",
    full: "b.txt",
    readmes: false,
    project,
    regenerateCommand: "make docs",
  });
  assertEquals(o.packagesDir, "libs");
  assertEquals(o.jsrBaseUrl, "https://example.test");
  assertEquals(o.index, "a.txt");
  assertEquals(o.full, "b.txt");
  assertEquals(o.readmes, false);
  assertEquals(o.project, project);
  assertEquals(o.regenerateCommand, "make docs");
});
