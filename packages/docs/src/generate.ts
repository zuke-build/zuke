/**
 * The I/O layer: run `deno doc` per package, format the README candidates with
 * `deno fmt`, and assemble the full set of artifact files (keyed by path) the
 * tasks then write or compare. Subprocesses run through the core `$` shell using
 * `Deno.execPath()` — the running `deno` — so there is no dependency on PATH.
 *
 * @module
 */

import { $ } from "@zuke/core/shell";
import { FileTasks } from "@zuke/core";
import type { ResolvedOptions } from "./options.ts";
import {
  buildIndex,
  buildReference,
  cleanDoc,
  type PackageApi,
  summarize,
  withApiBlock,
} from "./render.ts";

/** Run `deno doc` for one package's public entry point and clean it up. */
export async function packageApi(
  dir: string,
  options: ResolvedOptions,
): Promise<PackageApi> {
  const entry = `${options.packagesDir}/${dir}/mod.ts`;
  const raw = await $`${Deno.execPath()} doc ${entry}`
    .env({ NO_COLOR: "1" })
    .text();
  const doc = cleanDoc(raw);
  return { name: `${options.scope}/${dir}`, dir, summary: summarize(doc), doc };
}

/**
 * Format markdown candidates through `deno fmt` so the written READMEs pass a
 * `deno fmt --check` gate. Each candidate is written to a throwaway temp file,
 * formatted in place, and read back; the map keys (real paths) are preserved.
 */
async function formatMarkdown(
  byPath: Map<string, string>,
): Promise<Map<string, string>> {
  const tmp = await Deno.makeTempDir({ prefix: "zuke-docs-" });
  try {
    const order = [...byPath.keys()];
    await Promise.all(
      order.map((path, i) =>
        FileTasks.writeText(`${tmp}/${i}.md`, byPath.get(path) ?? "")
      ),
    );
    await $`${Deno.execPath()} fmt ${tmp}`.env({ NO_COLOR: "1" }).text();
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
 * Compute every artifact's intended content, keyed by its path. Reads sources
 * (and runs `deno doc`/`deno fmt`) but writes nothing to the tracked tree.
 */
export async function generate(
  packages: string[],
  options: ResolvedOptions,
): Promise<Map<string, string>> {
  const apis: PackageApi[] = [];
  for (const dir of packages) apis.push(await packageApi(dir, options));

  const files = new Map<string, string>();
  files.set(options.index, buildIndex(apis, options));
  files.set(options.full, buildReference(apis, options));

  if (options.readmes) {
    const readmes = new Map<string, string>();
    for (const api of apis) {
      const path = `${options.packagesDir}/${api.dir}/README.md`;
      const existing = (await FileTasks.exists(path))
        ? await FileTasks.readText(path)
        : `# ${api.name}\n`;
      readmes.set(path, withApiBlock(existing, api));
    }
    for (const [path, content] of await formatMarkdown(readmes)) {
      files.set(path, content);
    }
  }
  return files;
}
