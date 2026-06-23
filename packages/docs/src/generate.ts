/**
 * Assemble the artifact files (keyed by path) the tasks then write or compare,
 * from the per-package docs supplied by the caller. Reads existing READMEs via
 * `@zuke/core`'s `FileTasks`; runs no subprocess and never invokes `deno`.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import type { ResolvedOptions } from "./options.ts";
import {
  buildIndex,
  buildReference,
  cleanDoc,
  type DocEntry,
  summarize,
  withApiBlock,
} from "./render.ts";
import type { PackageDoc } from "./types.ts";

/** Reduce a supplied {@link PackageDoc} to a {@link DocEntry} for rendering. */
function toEntry(input: PackageDoc): DocEntry {
  const doc = cleanDoc(input.doc);
  return { name: input.name, dir: input.dir, summary: summarize(doc), doc };
}

/**
 * Compute every artifact's intended content, keyed by its path. Reads existing
 * READMEs (to preserve their prose around the API block) but writes nothing.
 */
export async function generate(
  docs: PackageDoc[],
  options: ResolvedOptions,
): Promise<Map<string, string>> {
  const entries = docs.map(toEntry);

  const files = new Map<string, string>();
  files.set(options.index, buildIndex(entries, options));
  files.set(options.full, buildReference(entries, options));

  if (options.readmes) {
    for (const entry of entries) {
      const path = `${options.packagesDir}/${entry.dir}/README.md`;
      const existing = (await FileTasks.exists(path))
        ? await FileTasks.readText(path)
        : `# ${entry.name}\n`;
      files.set(path, withApiBlock(existing, entry.doc));
    }
  }
  return files;
}
