// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run generated text through `deno fmt`, so a file this build writes is
 * byte-identical to what the formatter would produce for it.
 *
 * A generated file that lives inside the formatter's scope has to agree with
 * the formatter, or the two gates fight: `format` rewrites the committed file
 * and the generator's own drift check then calls it stale. Reproducing the
 * formatter's decisions inside a renderer is the wrong direction — it means
 * hand-writing a prose wrapper and a table aligner in order to agree with a
 * prose wrapper and a table aligner — so the renderer stays pure and its
 * output is passed through the real thing on the way to disk.
 *
 * This is the routine `hcl_gen.ts` was written with and `graph_doc.ts` needed
 * next; it lives here so there is one implementation rather than two that can
 * drift over which flags they pass.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";

/**
 * Format `source` as a file of type `extension` and return the result.
 *
 * `deno fmt` decides how to parse a file from its extension and reads the
 * repository's `fmt` options from `deno.json`, so the text is written to a
 * real file with the right suffix inside the working directory rather than
 * formatted from a string or in a system temp dir — either would be formatted
 * with the wrong rules, or the default ones.
 *
 * The directory is dot-prefixed because `deno fmt` skips dotted paths: a
 * concurrent `format` target globbing the repository must not discover this
 * file mid-write and report it, and targets do run in parallel.
 *
 * @param source The generated text to format.
 * @param extension The file extension that tells `deno fmt` how to parse it,
 *   without the dot — `ts` for TypeScript, `md` for Markdown.
 */
export async function formatText(
  source: string,
  extension: string,
): Promise<string> {
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".fmt-text-" });
  try {
    const path = `${dir}/out.${extension}`;
    await FileTasks.writeText(path, source);
    await DenoTasks.fmt((s) => s.paths(path).quiet());
    return await FileTasks.readText(path);
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
}
