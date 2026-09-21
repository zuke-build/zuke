// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * End-to-end coverage for the first thing anyone does with a scaffold: run the
 * `fmt` and `lint` tasks `zuke setup` just wrote into `deno.json`, over the
 * `zuke.ts` it just wrote beside them.
 *
 * This needs a real `deno` subprocess, which is why it lives here rather than
 * in `tests/integration/`. Deno's *default* lint rule set — the one that
 * applies when a `deno.json` configures no `lint.rules`, which is exactly what
 * setup writes — rejects an inline `jsr:` specifier under `no-import-prefix`,
 * and no in-process assertion about the generated text can prove which rules
 * that binary actually enforces. Asserting the scaffold's source shape is the
 * proxy; running the linter is the fact.
 *
 * The regression: setup used to scaffold
 * `import { Build, run, target } from "jsr:@zuke/core@^1";`, so a brand-new
 * project failed its own `deno task lint` on line 1 of its only source file.
 *
 * Hermetic: `deno lint` and `deno fmt` parse the file and never resolve a
 * module, so no network and no JSR fetch is involved. `deno check` is
 * deliberately *not* run here — it would have to download `@zuke/core`.
 *
 * @module
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import { main } from "../../packages/cli/mod.ts";
import { defaultHost, type SetupHost } from "../../packages/cli/src/setup.ts";

/** Run one `deno` subcommand inside `dir`, returning its code and output. */
async function deno(
  dir: string,
  args: string[],
): Promise<{ code: number; output: string }> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code,
    output: `${decoder.decode(stdout)}${decoder.decode(stderr)}`,
  };
}

/**
 * Scaffold into a fresh temp directory with the real `@zuke/cli` `main()` (only
 * its logging captured), hand the directory to `check`, and clean up after.
 */
async function withScaffold(
  args: string[],
  seed: Record<string, string>,
  check: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-scaffold-lint-" });
  const host: SetupHost = { ...defaultHost, log: () => {} };
  try {
    for (const [name, content] of Object.entries(seed)) {
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    assertEquals(await main([...args, "--dir", dir], host), 0);
    await check(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Assert `deno lint` and `deno fmt --check` both pass over a scaffold. */
async function assertClean(dir: string): Promise<void> {
  const lint = await deno(dir, ["lint"]);
  assertEquals(
    lint.code,
    0,
    `the scaffold fails its own \`deno lint\`:\n${lint.output}`,
  );
  const fmt = await deno(dir, ["fmt", "--check"]);
  assertEquals(
    fmt.code,
    0,
    `the scaffold fails its own \`deno fmt --check\`:\n${fmt.output}`,
  );
}

Deno.test("e2e: a `zuke setup` scaffold passes its own deno lint and fmt", async () => {
  await withScaffold(
    ["setup", "--yes", "--name", "Demo"],
    {},
    assertClean,
  );
});

Deno.test("e2e: a `zuke import` scaffold passes its own deno lint and fmt", async () => {
  // A script that becomes a `CmdTasks.exec` call, so the generated build
  // imports `@zuke/cmd` as well and both bare specifiers must resolve.
  await withScaffold(
    ["import", "--yes", "--name", "Imported"],
    {
      // Pretty-printed with a trailing newline: `deno fmt --check` below runs
      // over the whole directory, and a seed file of the test's own making
      // must not be what fails it.
      "package.json": `${
        JSON.stringify(
          {
            scripts: { lint: "eslint .", build: "npm run lint && tsc -p ." },
          },
          null,
          2,
        )
      }\n`,
    },
    assertClean,
  );
});

Deno.test("e2e: setup completes a deno.json that already declares the zuke task", async () => {
  // Re-scaffolding a project whose deno.json carries the `zuke` task but no
  // import map used to skip the file outright, leaving the freshly written
  // `zuke.ts` importing "@zuke/core" with nothing to resolve it — and, once
  // `deno lint`'s no-import-prefix rule forbids writing the specifier inline,
  // no way to author around it either.
  await withScaffold(
    ["setup", "--yes", "--force", "--name", "Legacy"],
    { "deno.json": `${JSON.stringify({ tasks: { zuke: "custom" } })}\n` },
    async (dir) => {
      await assertClean(dir);
      const parsed: unknown = JSON.parse(
        await Deno.readTextFile(`${dir}/deno.json`),
      );
      const imports =
        parsed !== null && typeof parsed === "object" && "imports" in parsed
          ? parsed.imports
          : undefined;
      const core = imports !== null && typeof imports === "object" &&
          "@zuke/core" in imports
        ? imports["@zuke/core"]
        : undefined;
      assertEquals(core, "jsr:@zuke/core@^1");
      // The project's own task survived the merge.
      const tasks =
        parsed !== null && typeof parsed === "object" && "tasks" in parsed
          ? parsed.tasks
          : undefined;
      assertEquals(
        tasks !== null && typeof tasks === "object" && "zuke" in tasks
          ? tasks.zuke
          : undefined,
        "custom",
      );
    },
  );
});

Deno.test("e2e: setup leaves a delegated import map resolving for real", async () => {
  // The regression: writing an `imports` block beside a lone `importMap` makes
  // Deno ignore the delegation, so a project that resolved before setup ran
  // stops resolving after. Only a real `deno run` shows that — the in-process
  // test can read the JSON, but not what Deno does with it. Fully local
  // modules, so nothing is fetched.
  const dir = await Deno.makeTempDir({ prefix: "zuke-scaffold-import-map-" });
  const host: SetupHost = { ...defaultHost, log: () => {} };
  try {
    await Deno.writeTextFile(
      `${dir}/deno.json`,
      `${JSON.stringify({ importMap: "./import_map.json" }, null, 2)}\n`,
    );
    await Deno.writeTextFile(
      `${dir}/import_map.json`,
      `${JSON.stringify({ imports: { "lib/": "./lib/" } }, null, 2)}\n`,
    );
    await Deno.mkdir(`${dir}/lib`);
    await Deno.writeTextFile(`${dir}/lib/a.ts`, "export const x = 1;\n");
    await Deno.writeTextFile(
      `${dir}/main.ts`,
      'import { x } from "lib/a.ts";\nconsole.log(x);\n',
    );

    // It resolves before setup runs...
    const before = await deno(dir, ["run", "main.ts"]);
    assertEquals(before.code, 0, before.output);

    // ...setup reports the import as a manual step rather than writing it...
    assertEquals(
      await main(["setup", "--yes", "--name", "Demo", "--dir", dir], host),
      1,
    );

    // ...and it still resolves afterwards.
    const after = await deno(dir, ["run", "main.ts"]);
    assertEquals(
      after.code,
      0,
      `setup broke a project that delegates its import map:\n${after.output}`,
    );
    assertEquals(after.output.includes("is ignored when"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
