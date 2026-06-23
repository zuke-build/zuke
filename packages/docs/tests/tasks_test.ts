import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { DocsTasks } from "../src/tasks.ts";
import type { ApiDocsOptions } from "../src/types.ts";

const FOO_MOD = `/**
 * \`@example/foo\` — a documented module.
 * @module
 */

/** Add two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}
`;

// bar has no README, and a module doc with no em dash (exercises the summary
// fallback and the "create a README from scratch" path).
const BAR_MOD = `/**
 * A module without a dash.
 * @module
 */

/** Subtract two numbers. */
export function sub(a: number, b: number): number {
  return a - b;
}
`;

/** A throwaway workspace with two fixture packages. */
async function fixture(): Promise<{ root: string; options: ApiDocsOptions }> {
  const root = await Deno.makeTempDir({ prefix: "zuke-docs-test-" });
  await Deno.mkdir(`${root}/packages/foo`, { recursive: true });
  await Deno.mkdir(`${root}/packages/bar`, { recursive: true });
  await Deno.writeTextFile(`${root}/packages/foo/mod.ts`, FOO_MOD);
  await Deno.writeTextFile(
    `${root}/packages/foo/README.md`,
    "# @example/foo\n\nIntro.\n",
  );
  await Deno.writeTextFile(`${root}/packages/bar/mod.ts`, BAR_MOD);
  const options: ApiDocsOptions = {
    packagesDir: `${root}/packages`,
    scope: "@example",
    index: `${root}/llms.txt`,
    full: `${root}/llms-full.txt`,
    regenerateCommand: "./build docs",
    project: {
      title: "Example",
      summary: "A test workspace.",
      example: "const x = 1;",
      install: "deno add",
    },
  };
  return { root, options };
}

Deno.test("apiDocs generates the index, reference, and README blocks", async () => {
  const { root, options } = await fixture();
  try {
    const written = await DocsTasks.apiDocs(["foo", "bar"], options);
    assertEquals(written.includes(`${root}/llms.txt`), true);
    assertEquals(written.includes(`${root}/llms-full.txt`), true);
    assertEquals(written.includes(`${root}/packages/foo/README.md`), true);
    assertEquals(written.includes(`${root}/packages/bar/README.md`), true);

    const index = await Deno.readTextFile(`${root}/llms.txt`);
    assertStringIncludes(index, "# Example");
    assertStringIncludes(index, "> A test workspace.");
    assertStringIncludes(index, "const x = 1;");
    assertStringIncludes(
      index,
      "[@example/foo](https://jsr.io/@example/foo) — a documented module",
    );
    // bar's summary falls back to its first line (it has no em dash)
    assertStringIncludes(index, "/@example/bar) — A module without a dash");

    const full = await Deno.readTextFile(`${root}/llms-full.txt`);
    assertStringIncludes(full, "# Example — full API reference");
    assertStringIncludes(full, "Regenerate with `./build docs`.");
    assertStringIncludes(full, "Add two numbers.");
    assertEquals(/Defined in/.test(full), false); // machine paths stripped

    const fooReadme = await Deno.readTextFile(`${root}/packages/foo/README.md`);
    assertStringIncludes(fooReadme, "Intro."); // existing content preserved
    assertStringIncludes(fooReadme, "## API");
    assertStringIncludes(fooReadme, "Add two numbers.");

    // bar had no README — one is created from the default heading
    const barReadme = await Deno.readTextFile(`${root}/packages/bar/README.md`);
    assertStringIncludes(barReadme, "# @example/bar");
    assertStringIncludes(barReadme, "Subtract two numbers.");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checkApiDocs reports clean, then stale after a manual edit", async () => {
  const { root, options } = await fixture();
  try {
    await DocsTasks.apiDocs(["foo"], options);
    assertEquals(await DocsTasks.checkApiDocs(["foo"], options), []);
    // a second generation writes nothing (idempotent — exercises the replace path)
    assertEquals(await DocsTasks.apiDocs(["foo"], options), []);
    // tamper with the index → it shows up as stale
    await Deno.writeTextFile(`${root}/llms.txt`, "stale\n");
    assertEquals(
      await DocsTasks.checkApiDocs(["foo"], options),
      [`${root}/llms.txt`],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("readmes:false generates only the index and reference", async () => {
  const { root, options } = await fixture();
  try {
    const written = await DocsTasks.apiDocs(["foo"], {
      ...options,
      readmes: false,
    });
    assertEquals(written.includes(`${root}/packages/foo/README.md`), false);
    assertEquals(written.includes(`${root}/llms.txt`), true);
    const fooReadme = await Deno.readTextFile(`${root}/packages/foo/README.md`);
    assertEquals(/## API/.test(fooReadme), false); // README left untouched
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
