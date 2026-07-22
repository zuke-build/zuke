/**
 * Type-check the ```ts snippets in the docs and skills that are explicitly
 * marked for checking, so an example an agent pastes can't silently drift from
 * the real API. Zuke's whole pitch is "never guess the API" — a marked example
 * is held to the same bar via `deno check`.
 *
 * **Opt-in.** Only a fenced ```ts block whose opening fence is immediately
 * preceded by a `<!-- check -->` line is checked. The rest of the corpus is
 * intentionally-elided prose — class-body fragments, `/* … *\/` placeholders,
 * deliberately-unimported symbols — that cannot compile standalone, so checking
 * every block would be nothing but false positives.
 *
 * **Hermetic resolution.** A snippet's `jsr:@zuke/…` specifiers are rewritten to
 * the bare workspace name (`@zuke/…`) and each snippet is checked in a temp
 * directory *inside* the repo, so Deno resolves the imports to the local
 * packages — never the network, never a published version that could drift from
 * this working tree.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";

/** The marker line that opts the following ```ts fence into type-checking. */
export const CHECK_MARKER = "<!-- check -->";

/** A ```ts snippet marked for type-checking, located in its source markdown. */
export interface CheckedSnippet {
  /** The markdown file the snippet lives in (repo-relative). */
  file: string;
  /** The 1-based line of the snippet's opening fence. */
  line: number;
  /** The snippet body, with `jsr:@zuke/…` rewritten to the workspace name. */
  code: string;
}

/** A marked snippet that failed `deno check`, with the checker's output. */
export interface SnippetFailure {
  /** The markdown file the failing snippet lives in (repo-relative). */
  file: string;
  /** The 1-based line of the failing snippet's opening fence. */
  line: number;
  /** The `deno check` output, with the temp path reduced to `snippet.ts`. */
  detail: string;
}

/** Matches an opening ```ts / ```typescript fence (nothing after the language). */
const TS_FENCE = /^```(?:ts|typescript)$/;

/**
 * Extract every `<!-- check -->`-marked ```ts block from `markdown`. A block is
 * checked only when the marker sits on the line immediately above its opening
 * fence (blank lines aside); every other fenced block is left as prose.
 *
 * This is a line scanner, not a full Markdown parser: it does not track being
 * *inside* another fenced block, so a literal `<!-- check -->` + ```ts written
 * as content within an outer fence would be picked up. That only arises when
 * documenting the marker itself, which the docs do in prose — not nested fences.
 */
export function extractCheckedSnippets(
  markdown: string,
  file: string,
): CheckedSnippet[] {
  const lines = markdown.split("\n");
  const snippets: CheckedSnippet[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== CHECK_MARKER) continue;
    // The opening fence is the next non-blank line — tolerating the blank line
    // `deno fmt` keeps between an HTML comment and a following code block. Only
    // blank lines may sit between the marker and its fence; anything else means
    // the marker is not attached to a ```ts block and is ignored.
    let fence = i + 1;
    while (fence < lines.length && lines[fence].trim() === "") fence++;
    if (fence >= lines.length || !TS_FENCE.test(lines[fence].trim())) continue;
    const body: string[] = [];
    let j = fence + 1;
    while (j < lines.length && lines[j].trim() !== "```") {
      body.push(lines[j]);
      j++;
    }
    snippets.push({
      file,
      line: fence + 1, // 1-based line of the opening fence
      code: body.join("\n").replaceAll("jsr:@zuke/", "@zuke/"),
    });
    i = j; // resume past the closing fence
  }
  return snippets;
}

/** Read and extract the marked snippets from every file, in file then document order. */
export async function collectCheckedSnippets(
  files: string[],
): Promise<CheckedSnippet[]> {
  const all: CheckedSnippet[] = [];
  for (const file of files) {
    all.push(...extractCheckedSnippets(await FileTasks.readText(file), file));
  }
  return all;
}

/** The type-check seam: check the module at `path`, returning ok + any output. */
export type SnippetChecker = (
  path: string,
) => Promise<{ ok: boolean; detail: string }>;

/** The default checker: `deno check` against the local workspace. */
const denoCheck: SnippetChecker = async (path) => {
  const out = await DenoTasks.check((s) => s.paths(path).quiet().noThrow());
  return { ok: out.code === 0, detail: `${out.stderr}${out.stdout}`.trim() };
};

/**
 * Reduce the snippet's temp path to `snippet.ts` in checker output, in every
 * form it can appear: the raw path, the forward-slash path, and the `file://`
 * URL. `deno check` always emits forward-slash `file://` URLs even on Windows
 * (where the path itself uses backslashes), so both separator conventions are
 * normalised before matching.
 */
export function reduceTempPath(detail: string, path: string): string {
  const forward = path.replaceAll("\\", "/");
  const url = `file://${forward.startsWith("/") ? forward : `/${forward}`}`;
  return detail
    .replaceAll(url, "snippet.ts")
    .replaceAll(forward, "snippet.ts")
    .replaceAll(path, "snippet.ts");
}

/**
 * Type-check every marked snippet in `files`, returning one {@link
 * SnippetFailure} per snippet that fails. Each snippet is written to a temp file
 * *inside the repo* (so `@zuke/…` resolves to the workspace) and checked; the
 * temp directory is removed afterwards, even on error. The `check` seam is
 * injectable so the orchestration is unit-testable without spawning `deno`.
 */
export async function checkSnippets(
  files: string[],
  check: SnippetChecker = denoCheck,
): Promise<SnippetFailure[]> {
  const snippets = await collectCheckedSnippets(files);
  if (snippets.length === 0) return [];
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".snippets-" });
  const failures: SnippetFailure[] = [];
  try {
    for (let i = 0; i < snippets.length; i++) {
      const snippet = snippets[i];
      const path = `${dir}/snippet_${i}.ts`;
      await FileTasks.writeText(path, `${snippet.code}\n`);
      const { ok, detail } = await check(path);
      if (!ok) {
        failures.push({
          file: snippet.file,
          line: snippet.line,
          detail: reduceTempPath(detail, path),
        });
      }
    }
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
  return failures;
}

/**
 * Render the {@link SnippetFailure}s as one friendly, actionable error message —
 * each failing snippet named by its source location, above the checker output.
 */
export function formatSnippetFailures(failures: SnippetFailure[]): string {
  const blocks = failures.map((f) => {
    const detail = f.detail
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    return `  ${f.file}:${f.line}\n${detail}`;
  });
  return `${failures.length} marked doc snippet(s) failed to type-check:\n` +
    `${blocks.join("\n\n")}\n\n` +
    "Fix the snippet, or remove its `<!-- check -->` marker if it is " +
    "intentionally partial.";
}
