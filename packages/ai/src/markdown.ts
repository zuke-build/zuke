/**
 * Neutralizing model- and agent-controlled text before it is embedded in the
 * Markdown of a PR comment or CI job summary — the Markdown analogue of the
 * prompt-side {@link "./prompts/fence.ts".fenceUntrusted}.
 *
 * @module
 */

/**
 * Wrap untrusted `content` in a Markdown fenced code block it cannot break out
 * of. A CommonMark fence is closed only by a line bearing **at least** as many
 * backticks as the opening fence, so the fence is built one backtick longer than
 * the longest backtick run anywhere in the content (a minimum of three). An
 * attacker embedding ``` — or a longer run — can then only produce a run shorter
 * than the fence, which stays inert data inside the block instead of closing it
 * and injecting arbitrary Markdown (fake "approved" banners, headings, links).
 *
 * @param content The untrusted text to embed.
 * @param lang An optional info string (e.g. `"diff"`) for the opening fence.
 */
export function fenceMarkdown(content: string, lang = ""): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  // The info string shares the opening fence's line, so a newline or backtick in
  // it would break out; keep only a plain token (callers pass literals today).
  const info = lang.replace(/[`\r\n]+/g, "");
  return `${fence}${info}\n${content}\n${fence}`;
}

/**
 * Wrap untrusted `value` in an **inline** Markdown code span it cannot break out
 * of — the inline counterpart of {@link fenceMarkdown}, for a value embedded in a
 * heading or table (e.g. a model-supplied file path). The span uses one more
 * backtick than the longest run inside `value`, pads a leading/trailing backtick
 * per CommonMark, and drops newlines (an inline span is single-line), so an
 * embedded backtick can't close the span early and inject inline Markdown (a
 * phishing link, a bold "approved" banner) into the surrounding text.
 */
export function codeSpan(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  const ticks = "`".repeat(longestBacktickRun(clean) + 1);
  // A code span whose content starts or ends with a backtick needs a padding
  // space (CommonMark strips one space from each side), else the delimiters merge.
  const pad = clean.startsWith("`") || clean.endsWith("`") ? " " : "";
  return `${ticks}${pad}${clean}${pad}${ticks}`;
}

/** The length of the longest run of consecutive backticks in `text` (0 if none). */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    if (run.length > longest) longest = run.length;
  }
  return longest;
}
