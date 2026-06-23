/**
 * Resolve the user-facing {@link ApiDocsOptions} into a fully-populated form the
 * generator and renderers can consume without re-checking defaults.
 *
 * @module
 */

import type { ApiDocsOptions, ProjectInfo } from "./types.ts";

/** {@link ApiDocsOptions} with every default filled in. */
export interface ResolvedOptions {
  packagesDir: string;
  scope: string;
  jsrBaseUrl: string;
  index: string;
  full: string;
  readmes: boolean;
  project: ProjectInfo;
  regenerateCommand: string;
}

/** Apply defaults to {@link ApiDocsOptions}. */
export function resolveOptions(options: ApiDocsOptions): ResolvedOptions {
  const scope = options.scope ?? "@zuke";
  return {
    packagesDir: options.packagesDir ?? "packages",
    scope,
    jsrBaseUrl: options.jsrBaseUrl ?? "https://jsr.io",
    index: options.index ?? "llms.txt",
    full: options.full ?? "llms-full.txt",
    readmes: options.readmes ?? true,
    project: options.project ??
      {
        title: scope,
        summary: `Typed task wrappers published under ${scope}.`,
      },
    regenerateCommand: options.regenerateCommand ?? "deno task docs",
  };
}
