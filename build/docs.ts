/**
 * Agent-doc generation: the project framing and options for `@zuke/docs`, the
 * per-package doc/doc-lint collectors, and the CLI-block injection that keeps
 * the generated index describing the live `zuke` command.
 */

import { type Build, describeCli, FileTasks, glob } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";
import type {
  ApiDocsOptions,
  DocLintReport,
  PackageDoc,
  ProjectInfo,
} from "@zuke/docs";
import { packageEntrypoints, PACKAGES } from "./packages.ts";

/** Project framing for the generated API docs (`@zuke/docs`). */
const DOCS_PROJECT: ProjectInfo = {
  title: "Zuke",
  summary:
    "Code-first, strongly-typed build automation for Deno/TypeScript. Define " +
    "a build by extending `Build`; declare targets with the `target()` fluent " +
    "builder, wiring dependencies as `this.<field>` references (not strings) " +
    "for compile-time safety. Every external tool has a typed `*Tasks` wrapper " +
    "in a settings-lambda style — never shell out by hand.",
  install: "deno run -A jsr:@zuke/cli setup",
  example: [
    'import { Build, run, target } from "jsr:@zuke/core";',
    'import { DenoTasks } from "jsr:@zuke/deno";',
    "",
    "class CI extends Build {",
    "  lint = target().executes(() => DenoTasks.lint());",
    "  test = target().dependsOn(this.lint)",
    "    .executes(() => DenoTasks.test((s) => s.allowAll()));",
    "}",
    "",
    "await run(CI);",
  ].join("\n"),
  guidance: [
    "A single package's API on the command line: " +
    "`deno doc jsr:@zuke/<package>`",
  ],
};

const DOCS_OPTIONS: ApiDocsOptions = {
  regenerateCommand: "./zuke apiDocs",
  project: DOCS_PROJECT,
};

/**
 * Render the `## CLI` block for the generated index from the build's own
 * command/flag registry (via `describeCli`), so the agent docs describe the
 * `zuke` command — not just the importable API — and never drift from the CLI.
 */
export function cliReference(build: Build): string {
  const { commands, flags } = describeCli(build);
  const bullets = (
    items: ReadonlyArray<{ name: string; description: string }>,
  ) => items.map((i) => `- \`${i.name}\` — ${i.description}`);
  return [
    "Run a build with the `zuke` command — `deno run -A zuke.ts <target>` (or",
    "the `./zuke` launcher). The CLI is self-describing:",
    "",
    "```sh",
    "zuke <target> [--skip <dep>] [--parallel[=N]]    # run a target and its deps",
    "zuke --list [--json]                             # list targets (JSON: full surface)",
    "zuke graph [--output=html]                       # dependency graph",
    "zuke generate-ci [--check]                       # write declared CI files",
    "zuke completions <print|install> <bash|zsh|fish> # shell completion",
    "```",
    "",
    "`zuke --help` prints the usage grammar plus the build's live targets and",
    "parameters; `zuke --list --json` emits the whole surface for tools.",
    "",
    "Reserved commands:",
    "",
    ...bullets(commands),
    "",
    "Option flags:",
    "",
    ...bullets(flags),
    "",
    "Full reference: [docs/cli.md](./docs/cli.md).",
  ].join("\n");
}

/** {@link DOCS_OPTIONS} with the freshly rendered CLI block injected. */
export function docsOptions(build: Build): ApiDocsOptions {
  return {
    ...DOCS_OPTIONS,
    project: { ...DOCS_PROJECT, cli: cliReference(build) },
  };
}

/**
 * Produce each package's API documentation text with `deno doc` (from
 * `@zuke/deno`), so `@zuke/docs` can consume it without running `deno` itself.
 */
export async function collectPackageDocs(): Promise<PackageDoc[]> {
  const docs: PackageDoc[] = [];
  for (const dir of PACKAGES) {
    // Document every declared entrypoint, not just `mod.ts`, so a package with
    // secondary exports (core's `./shell`, `./tooling`, `./render`,
    // `./conformance`) has its whole typed surface in `llms-full.txt` and its
    // README — the "whole typed surface" the docs claim to carry.
    const entrypoints = await packageEntrypoints(dir);
    const { stdout } = await DenoTasks.doc((s) =>
      s.paths(...entrypoints).env({ NO_COLOR: "1" }).quiet()
    );
    docs.push({ name: `@zuke/${dir}`, dir, doc: stdout });
  }
  return docs;
}

/**
 * The local names a package imports from another `@zuke/*` package — the types
 * a public signature may reference without exporting them locally (guideline
 * 4's accepted `private-type-ref` residual). Everything else a `deno doc --lint`
 * `private-type-ref` names is first-party and must be exported, so the doc-lint
 * gate flags it. Covers named specifiers (`{ type X, Y as Z }`), namespace
 * (`* as ns`), and default imports; tests are excluded (not the doc surface).
 */
export async function crossPackageTypesOf(dir: string): Promise<string[]> {
  const files = (await glob(`packages/${dir}/**/*.ts`))
    .filter((f) => !f.includes(`packages/${dir}/tests/`));
  const names = new Set<string>();
  // Each `import … from "…"` statement. Anchored at a line start (`m` flag) so
  // a `* import { … } from "jsr:@zuke/…"` example inside a JSDoc block (prefixed
  // by `* `) is not matched; the specifier is filtered to `@zuke/*` in code.
  const importStmt =
    /^import\b(?:\s+type\b)?([\s\S]*?)\bfrom\s*["']([^"']*)["']/gm;
  for (const file of files) {
    for (const m of (await FileTasks.readText(file)).matchAll(importStmt)) {
      if (!m[2].startsWith("@zuke/")) continue;
      const clause = m[1];
      const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
      if (namespace !== null) names.add(namespace[1]);
      const braces = clause.match(/\{([\s\S]*)\}/);
      if (braces !== null) {
        for (const part of braces[1].split(",")) {
          const spec = part.trim().replace(/^type\s+/, "");
          if (spec === "") continue;
          // `X as Z` binds the local name `Z`; a bare `X` binds `X`.
          const asMatch = spec.match(/\bas\s+([A-Za-z_$][\w$]*)/);
          const local = asMatch !== null
            ? asMatch[1]
            : spec.match(/^([A-Za-z_$][\w$]*)/)?.[1];
          if (local !== undefined) names.add(local);
        }
      } else {
        // A bare default import: `import Foo from "@zuke/…"`.
        const def = clause.match(/^([A-Za-z_$][\w$]*)\s*$/);
        if (def !== null) names.add(def[1]);
      }
    }
  }
  return [...names];
}

/**
 * Collect a {@link DocLintReport} per package: the `deno doc --lint` output for
 * its entrypoints (captured with `noThrow`, since the linter exits non-zero on
 * any diagnostic) plus the types it imports from other `@zuke/*` packages.
 */
export async function collectDocLintReports(): Promise<DocLintReport[]> {
  const reports: DocLintReport[] = [];
  for (const dir of PACKAGES) {
    const entrypoints = await packageEntrypoints(dir);
    const { stderr } = await DenoTasks.doc((s) =>
      s.paths(...entrypoints).lint().env({ NO_COLOR: "1" }).noThrow().quiet()
    );
    reports.push({
      pkg: `@zuke/${dir}`,
      output: stderr,
      crossPackageTypes: await crossPackageTypesOf(dir),
    });
  }
  return reports;
}
