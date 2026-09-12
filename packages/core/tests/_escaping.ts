// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Helpers for the tests of the escaping a GitHub Actions runner needs: the
 * encoded form of the marker it acts on, and the source-level scan that holds
 * a package to writing through one sink.
 *
 * @module
 */

/**
 * The percent-encoded `::`, kept as its own constant so the encoded prefix
 * never fuses with the word after it into a token no dictionary can know: the
 * spell gate reads the encoding and the word that follows it as one.
 */
export const ENC = "%3A%3A";

/**
 * Every `.ts` file under `root` (recursively) that calls the console directly
 * — any method, by name or by computed key — as paths relative to `root`,
 * skipping the ones in `allowed`. Comments are
 * stripped first: a JSDoc example showing a plugin author how to write one is
 * documentation, not a write. Keyed by path from `root`, not by file name: a
 * nested module sharing a basename with an allowed one would otherwise be
 * exempt by accident.
 *
 * Scanned as source rather than exercised, because what a package promises is
 * not that one message is escaped but that nothing reaches the console except
 * through its sink — a property of the tree, not of any one behaviour a test
 * could trigger, and the regression it guards against is a *new* write
 * appearing somewhere no test was expecting one. It is a lint, not a
 * boundary: an aliased `console`, a raw `Deno.stdout` write, or a `prompt`
 * pass it, so those stay the reviewer's to look for.
 */
export async function consoleWriters(
  root: URL,
  allowed: ReadonlySet<string>,
): Promise<string[]> {
  const offenders: string[] = [];
  const walk = async (dir: URL): Promise<void> => {
    for await (const entry of Deno.readDir(dir)) {
      const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
      if (entry.isDirectory) {
        await walk(child);
        continue;
      }
      const relative = child.href.slice(root.href.length);
      if (!entry.name.endsWith(".ts") || allowed.has(relative)) continue;
      const code = (await Deno.readTextFile(child))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (/\bconsole\s*(?:\.\s*\w+|\[[^\]]*\])\s*\(/.test(code)) {
        offenders.push(relative);
      }
    }
  };
  await walk(root);
  return offenders;
}
