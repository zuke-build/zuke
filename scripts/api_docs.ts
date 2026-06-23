/**
 * API-doc generation for the workspace — so neither humans nor agents have to
 * guess a wrapper's API.
 *
 * One source of truth (`deno doc`) feeds three artifacts:
 *
 *  - `llms.txt`       — a short, link-first index (the llmstxt.org convention):
 *                       what Zuke is, the canonical build, and every package.
 *  - `llms-full.txt`  — the complete typed public surface of every package, so
 *                       an agent can fetch the whole API in one request.
 *  - a per-package `README.md` "API" block — the same per-package reference,
 *                       inside the file that renders on each `jsr.io/@zuke/<pkg>`
 *                       page (the first thing a consumer lands on).
 *
 * Regenerate with `./zuke apiDocs`; `./zuke apiDocsCheck` (run inside the CI
 * gate) fails if any committed artifact is stale.
 *
 * This is build tooling, not part of the published library — it lives outside
 * `packages/` and is only ever invoked by `zuke.ts`.
 *
 * @module
 */

import { $ } from "@zuke/core/shell";
import { DenoTasks } from "@zuke/deno";
import { FileTasks } from "@zuke/core";

/** Markers bounding the generated API block in a package README. */
const START = "<!-- ZUKE:API:START -->";
const END = "<!-- ZUKE:API:END -->";

/** The resolved API of one package: its name, one-line summary, and full doc. */
export interface PackageApi {
  /** The published name, e.g. `@zuke/deno`. */
  name: string;
  /** The workspace directory under `packages/`, e.g. `deno`. */
  dir: string;
  /** One-line summary, taken from the module doc's first line. */
  summary: string;
  /** The cleaned `deno doc` text (machine paths and noise removed). */
  doc: string;
}

/**
 * Strip the machine-specific `Defined in file://…` source locations (they leak
 * an absolute path and add no API information) and collapse the blank-line runs
 * that removing them leaves behind.
 */
export function cleanDoc(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*Defined in /.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The package's one-line summary, taken from its module-doc first line. */
function summarize(doc: string): string {
  const first = doc.split("\n").find((l) => l.trim().length > 0) ?? "";
  const dash = first.indexOf("—");
  return (dash >= 0 ? first.slice(dash + 1) : first).trim().replace(/\.$/, "");
}

/** Run `deno doc` for one package's public entry point and clean it up. */
export async function packageApi(dir: string): Promise<PackageApi> {
  const raw = await $`deno doc packages/${dir}/mod.ts`
    .env({ NO_COLOR: "1" })
    .text();
  const doc = cleanDoc(raw);
  return { name: `@zuke/${dir}`, dir, summary: summarize(doc), doc };
}

/** Render the generated API block injected into a package README. */
export function apiBlock(api: PackageApi): string {
  return [
    START,
    "",
    "## API",
    "",
    "<details>",
    "<summary>Full typed API — generated from <code>deno doc</code></summary>",
    "",
    // A four-backtick fence: the doc text itself contains three-backtick
    // ```ts examples, which must not close the block.
    "````text",
    api.doc,
    "````",
    "",
    "</details>",
    "",
    END,
  ].join("\n");
}

/** Replace the API block in `readme` (or append one if absent). */
export function withApiBlock(readme: string, api: PackageApi): string {
  const block = apiBlock(api);
  const from = readme.indexOf(START);
  const to = readme.indexOf(END);
  if (from !== -1 && to !== -1) {
    return readme.slice(0, from) + block + readme.slice(to + END.length);
  }
  return `${readme.trimEnd()}\n\n${block}\n`;
}

/** The canonical build, shown in `llms.txt`. */
const EXAMPLE = `import { Build, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";

class CI extends Build {
  lint = target().executes(() => DenoTasks.lint());
  test = target().dependsOn(this.lint) // a reference, not the string "lint"
    .executes(() => DenoTasks.test((s) => s.allowAll()));
}

await run(CI); // runs only when this file is the entry point — no guard needed`;

/** Build the short, link-first `llms.txt` index. */
export function buildLlms(apis: PackageApi[]): string {
  const lines = [
    "# Zuke",
    "",
    "> Code-first, strongly-typed build automation for Deno/TypeScript. Define a",
    "> build by extending `Build`; declare targets with the `target()` fluent",
    "> builder, wiring dependencies as `this.<field>` references (not strings) for",
    "> compile-time safety. Every external tool has a typed `*Tasks` wrapper in a",
    "> settings-lambda style — never shell out by hand.",
    "",
    "## Get the exact API — do not guess",
    "",
    "- Whole typed surface of every package, in one file: [llms-full.txt](./llms-full.txt)",
    "- A single wrapper's API on the command line: `deno doc jsr:@zuke/<package>`",
    "- Scaffold a project (writes `zuke.ts` + launchers): `deno run -A jsr:@zuke/cli setup`",
    "",
    "## Canonical build",
    "",
    "```ts",
    EXAMPLE,
    "```",
    "",
    "## Packages",
    "",
    ...apis.map((a) =>
      `- [${a.name}](https://jsr.io/${a.name}) — ${a.summary}`
    ),
    "",
  ];
  return lines.join("\n");
}

/** Build the complete `llms-full.txt` API reference. */
export function buildLlmsFull(apis: PackageApi[]): string {
  const header = [
    "# Zuke — full API reference",
    "",
    "The complete typed public surface of every Zuke package, generated from",
    "`deno doc`. Each section is one package: the `*Tasks` object(s) you call and",
    "the fluent settings each accepts. If you are wiring Zuke into a project, use",
    "these signatures verbatim — every tool has a typed wrapper, so there is no",
    "need to fall back to raw `Deno.Command`/shell execution.",
    "",
    "Regenerate with `./zuke apiDocs`.",
    "",
  ].join("\n");
  const bar = "=".repeat(72);
  const sections = apis.map((a) => `${bar}\n# ${a.name}\n${bar}\n\n${a.doc}\n`);
  return `${header}\n${sections.join("\n")}`;
}

/** Format markdown candidates through `deno fmt` so they pass `fmt --check`. */
async function formatMarkdown(
  byPath: Map<string, string>,
): Promise<Map<string, string>> {
  const tmp = await Deno.makeTempDir({ prefix: "zuke-api-docs-" });
  try {
    const order = [...byPath.keys()];
    await Promise.all(
      order.map((path, i) =>
        FileTasks.writeText(`${tmp}/${i}.md`, byPath.get(path) ?? "")
      ),
    );
    await DenoTasks.fmt((s) => s.paths(tmp));
    const out = new Map<string, string>();
    await Promise.all(
      order.map(async (path, i) => {
        out.set(path, await FileTasks.readText(`${tmp}/${i}.md`));
      }),
    );
    return out;
  } finally {
    await FileTasks.remove(tmp, { recursive: true });
  }
}

/**
 * Compute every generated artifact's intended content, keyed by repo-relative
 * path. Pure with respect to the repo: it reads sources but writes nothing.
 */
export async function generate(
  dirs: string[],
): Promise<Map<string, string>> {
  const apis: PackageApi[] = [];
  for (const dir of dirs) apis.push(await packageApi(dir));

  const files = new Map<string, string>();
  files.set("llms.txt", buildLlms(apis));
  files.set("llms-full.txt", buildLlmsFull(apis));

  // READMEs are markdown under packages/, so they must be fmt-clean.
  const readmes = new Map<string, string>();
  for (const api of apis) {
    const path = `packages/${api.dir}/README.md`;
    const existing = (await FileTasks.exists(path))
      ? await FileTasks.readText(path)
      : `# ${api.name}\n`;
    readmes.set(path, withApiBlock(existing, api));
  }
  for (const [path, content] of await formatMarkdown(readmes)) {
    files.set(path, content);
  }
  return files;
}

/** Write any artifact whose content differs from disk. Returns the paths written. */
export async function writeApiDocs(dirs: string[]): Promise<string[]> {
  const written: string[] = [];
  for (const [path, content] of await generate(dirs)) {
    const current = (await FileTasks.exists(path))
      ? await FileTasks.readText(path)
      : null;
    if (current !== content) {
      await FileTasks.writeText(path, content);
      written.push(path);
    }
  }
  return written;
}

/** Return the artifacts that are out of date on disk (empty when all current). */
export async function checkApiDocs(dirs: string[]): Promise<string[]> {
  const stale: string[] = [];
  for (const [path, content] of await generate(dirs)) {
    const current = (await FileTasks.exists(path))
      ? await FileTasks.readText(path)
      : null;
    if (current !== content) stale.push(path);
  }
  return stale;
}
