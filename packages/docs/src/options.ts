/**
 * Resolve the user-facing {@link ApiDocsOptions} into a fully-populated form the
 * renderers can consume without re-checking defaults.
 *
 * @module
 */

import type { ApiDocsOptions, ProjectInfo } from "./types.ts";

/** {@link ApiDocsOptions} with every default filled in. */
export interface ResolvedOptions {
  packagesDir: string;
  jsrBaseUrl: string;
  index: string;
  full: string;
  readmes: boolean;
  project: ProjectInfo;
  regenerateCommand: string;
}

/** Apply defaults to {@link ApiDocsOptions}. */
export function resolveOptions(options: ApiDocsOptions): ResolvedOptions {
  return {
    packagesDir: options.packagesDir ?? "packages",
    jsrBaseUrl: options.jsrBaseUrl ?? "https://jsr.io",
    index: options.index ?? "llms.txt",
    full: options.full ?? "llms-full.txt",
    readmes: options.readmes ?? true,
    project: options.project ??
      { title: "API documentation", summary: "Generated API reference." },
    regenerateCommand: options.regenerateCommand ?? "deno task docs",
  };
}
