// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The Gemini CLI extension archive attached to GitHub releases.
 *
 * `gemini extensions install <github url>` prefers a release asset over
 * cloning: it resolves the repository's **latest** release and picks an asset
 * by name — `{platform}.{arch}.{name}`, then `{platform}.{name}`, then a
 * single generic asset. Without one it downloads the whole source tarball,
 * which for this monorepo means shipping 50+ packages to install two skill
 * folders. This module builds a minimal, deterministic archive — the root
 * `gemini-extension.json` plus `skills/` and the license, exactly what the
 * extension serves — for the `release` target to attach to every release.
 *
 * The asset trio is platform-prefixed rather than one generic file on
 * purpose: Gemini's fallback accepts a generic asset only when it is the
 * *only* asset on the release, so a second file attached later (a checksum, an
 * SBOM) would silently degrade installs back to the source tarball. Platform
 * prefixes match deterministically regardless of what else the release
 * carries; the extension is platform-independent, so all three names carry
 * the same bytes.
 *
 * @module
 */

import { createTarGzip } from "@zuke/core";

/** The extension manifest Gemini requires at the archive root. */
export const GEMINI_MANIFEST = "gemini-extension.json";

/** The skills tree the extension serves. */
export const GEMINI_SKILLS_DIR = "skills";

/**
 * The asset names to attach to a release, one per platform Gemini matches
 * (`os.platform()` values). All three point at identical archive bytes.
 */
export const GEMINI_ASSET_NAMES: readonly string[] = [
  "darwin.zuke.tar.gz",
  "linux.zuke.tar.gz",
  "win32.zuke.tar.gz",
];

/** Every file under `dir`, as `dir`-prefixed paths, sorted for determinism. */
async function walk(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(`${root}/${dir}`)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...await walk(root, path));
    else if (entry.isFile) out.push(path);
    else {
      // Silently dropping it would ship an archive missing content that git
      // (and every other harness) still carries.
      throw new Error(
        `the Gemini extension archive cannot pack "${root}/${path}" — it is ` +
          "neither a regular file nor a directory (a symlink?). Keep " +
          `${GEMINI_SKILLS_DIR}/ to real files so every harness ships the ` +
          "same content.",
      );
    }
  }
  return out.sort();
}

/**
 * The files the extension archive packs, relative to `root`, in a stable
 * order: the manifest, the license, then every file under `skills/`.
 */
export async function geminiArchiveFiles(root = "."): Promise<string[]> {
  for (const required of [GEMINI_MANIFEST, "LICENSE"]) {
    const info = await Deno.stat(`${root}/${required}`).catch(() => null);
    if (info?.isFile !== true) {
      throw new Error(
        `the Gemini extension archive requires ${required} at the extension ` +
          `root — nothing at "${root}/${required}".`,
      );
    }
  }
  try {
    return [GEMINI_MANIFEST, "LICENSE", ...await walk(root, GEMINI_SKILLS_DIR)];
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `the Gemini extension archive requires a ${GEMINI_SKILLS_DIR}/ tree ` +
          `under "${root}" — Gemini auto-discovers skills from it.`,
      );
    }
    throw error;
  }
}

/**
 * Write the extension archive to `dest`: a `.tar.gz` with
 * `gemini-extension.json` at the root, which is where Gemini requires it.
 * Returns the paths that were packed.
 */
export async function buildGeminiArchive(
  dest: string,
  root = ".",
): Promise<string[]> {
  const files = await geminiArchiveFiles(root);
  await createTarGzip(files, dest, { cwd: root });
  return files;
}
