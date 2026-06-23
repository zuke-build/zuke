/**
 * Pure rendering for the documentation artifacts: cleaning the supplied doc
 * text, the per-README API block, and the `llms.txt` / `llms-full.txt` bodies.
 * No I/O and no subprocess, so every shape here is unit-testable in isolation —
 * and the package never needs `deno`.
 *
 * @module
 */

import type { ResolvedOptions } from "./options.ts";

/** Markers bounding the generated API block in a package README. */
export const API_START = "<!-- ZUKE:API:START -->";
export const API_END = "<!-- ZUKE:API:END -->";

/** A package reduced to what the renderers need. */
export interface DocEntry {
  /** The published name, e.g. `@zuke/deno`. */
  name: string;
  /** The directory under `packagesDir`. */
  dir: string;
  /** One-line summary, derived from the doc's first line. */
  summary: string;
  /** The cleaned documentation text. */
  doc: string;
}

/**
 * Normalise supplied doc text: drop machine-specific `Defined in file://…`
 * source locations (they leak an absolute path and add no API information),
 * strip trailing whitespace per line (so the embedded block stays
 * formatter-clean), and collapse the blank-line runs this leaves behind.
 */
export function cleanDoc(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*Defined in /.test(line))
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A one-line summary, taken from the doc's first non-empty line. */
export function summarize(doc: string): string {
  const first = doc.split("\n").find((l) => l.trim().length > 0) ?? "";
  const dash = first.indexOf("—");
  return (dash >= 0 ? first.slice(dash + 1) : first).trim().replace(/\.$/, "");
}

/** Render the generated API block for a package's cleaned doc text. */
export function apiBlock(doc: string): string {
  return [
    API_START,
    "",
    "## API",
    "",
    "<details>",
    "<summary>Full typed API — generated from <code>deno doc</code></summary>",
    "",
    // A four-backtick fence: the doc text itself contains three-backtick
    // ```ts examples, which must not close the block.
    "````text",
    doc,
    "````",
    "",
    "</details>",
    "",
    API_END,
  ].join("\n");
}

/** Replace the API block in `readme` (or append one if absent). */
export function withApiBlock(readme: string, doc: string): string {
  const block = apiBlock(doc);
  const from = readme.indexOf(API_START);
  const to = readme.indexOf(API_END);
  if (from !== -1 && to !== -1) {
    return readme.slice(0, from) + block + readme.slice(to + API_END.length);
  }
  return `${readme.trimEnd()}\n\n${block}\n`;
}

/** The trailing filename of a path, for relative links in the index. */
function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Build the short, link-first `llms.txt` index. */
export function buildIndex(
  entries: DocEntry[],
  options: ResolvedOptions,
): string {
  const { project } = options;
  const lines = [`# ${project.title}`, ""];
  for (const line of project.summary.split("\n")) {
    lines.push(`> ${line}`.trimEnd());
  }
  lines.push(
    "",
    "## Get the exact API — do not guess",
    "",
    `- Whole typed surface of every package, in one file: [${
      basename(options.full)
    }](./${basename(options.full)})`,
  );
  if (project.install !== undefined) {
    lines.push(`- Scaffold/install: \`${project.install}\``);
  }
  for (const bullet of project.guidance ?? []) lines.push(`- ${bullet}`);
  if (project.example !== undefined) {
    lines.push("", "## Example", "", "```ts", project.example, "```");
  }
  lines.push("", "## Packages", "");
  for (const e of entries) {
    lines.push(`- [${e.name}](${options.jsrBaseUrl}/${e.name}) — ${e.summary}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Build the complete `llms-full.txt` API reference. */
export function buildReference(
  entries: DocEntry[],
  options: ResolvedOptions,
): string {
  const header = [
    `# ${options.project.title} — full API reference`,
    "",
    "The complete typed public surface of every package. Each section is one",
    "package: the tasks you call and the fluent settings each accepts. Use these",
    "signatures verbatim — there is a typed wrapper for every tool, so there is",
    "no need to fall back to raw shell.",
    "",
    `Regenerate with \`${options.regenerateCommand}\`.`,
    "",
  ].join("\n");
  const bar = "=".repeat(72);
  const sections = entries.map((e) =>
    `${bar}\n# ${e.name}\n${bar}\n\n${e.doc}\n`
  );
  return `${header}\n${sections.join("\n")}`;
}
