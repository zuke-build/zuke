import { assertEquals } from "../../core/tests/_assert.ts";
import { resolveOptions } from "../src/options.ts";

Deno.test("resolveOptions fills in every default", () => {
  const o = resolveOptions({});
  assertEquals(o.packagesDir, "packages");
  assertEquals(o.jsrBaseUrl, "https://jsr.io");
  assertEquals(o.index, "llms.txt");
  assertEquals(o.full, "llms-full.txt");
  assertEquals(o.readmes, true);
  assertEquals(o.regenerateCommand, "deno task docs");
  assertEquals(o.project.title, "API documentation");
  assertEquals(typeof o.project.summary, "string");
});

Deno.test("resolveOptions honours every override", () => {
  const project = { title: "Acme", summary: "s", example: "e", install: "i" };
  const o = resolveOptions({
    packagesDir: "libs",
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
