// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Run generated text through dprint, the repository's formatter, so a file
 * this build writes is byte-identical to what the formatter would produce for
 * it.
 *
 * A generated file that lives inside the formatter's scope has to agree with
 * the formatter, or the two gates fight: `format` rejects the committed file
 * and the generator's own drift check then calls a reformatted one stale.
 * Reproducing the formatter's decisions inside a renderer is the wrong
 * direction — it means hand-writing a prose wrapper and a table aligner in
 * order to agree with a prose wrapper and a table aligner — so the renderer
 * stays pure and its output is passed through the real thing on the way to
 * disk.
 *
 * This is the routine `hcl_gen.ts` was written with and `graph_doc.ts` needed
 * next; it lives here so there is one implementation rather than two that can
 * drift over which flags they pass.
 *
 * @module
 */

import { DprintTasks } from "@zuke/dprint";

/**
 * Formats `source` as a file of type `extension` — `ts` for TypeScript, `md`
 * for Markdown, without the dot — and returns the result. A generator takes
 * one, {@link dprint} unless a test supplies its own.
 */
export type Formatter = (source: string, extension: string) => Promise<string>;

/**
 * dprint's `fmt --stdin`: the text goes in on standard input and comes back
 * formatted, by the plugin and the `dprint.json` rules the extension picks.
 */
export const dprint: Formatter = async (source, extension) =>
  (await DprintTasks.fmt((s) => s.stdin(extension, source).quiet())).stdout;
